# Gate canônico do Windows no repositório PÚBLICO de distribuição
# (unitários, smoke, integração, E2E, regressão, instalador NSIS, executável empacotado e validação do instalador final), cada um
# com a saída fora do log público (executar-silencioso.mjs). Roda dentro da pasta "codigo" (checkout do commit privado imutável).
$ErrorActionPreference = 'Stop'
$silencioso = Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/executar-silencioso.mjs'
$resumo = Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/resumo-seguro.mjs'
$arquivoBloqueioClaude = Join-Path $env:RUNNER_TEMP 'claude-e2e-blocked'
function Executar([string]$rotulo, [string]$log, [string]$comando) {
  node $silencioso $rotulo $log $comando
  $codigo = $LASTEXITCODE
  if ($rotulo -like 'Lab e2e (*)' -and $env:PRUMO_RESULT_FILE) {
    $plataforma = node -p 'process.platform + "-" + process.arch'
    node $resumo --validar-resultado $env:PRUMO_RESULT_FILE $env:PRUMO_CLAUDE_ATTESTATION $env:VERSAO $env:CODIGO_SHA $env:LAB_SHA $plataforma $env:PRUMO_JOB_ID
    $validacao = $LASTEXITCODE
    if ($codigo -eq 0 -and $validacao -eq 0) { return }
    if ($codigo -eq 3 -and $validacao -eq 3) {
      Set-Content -Path $arquivoBloqueioClaude -Value 'CLAUDE_CODE_UNAVAILABLE' -NoNewline
      Write-Host "BLOCKED: $rotulo (Claude Code externo indisponível; os demais gates continuam)."
      return
    }
    if ($codigo -eq 0) { exit 1 }
  }
  exit $codigo
}

Executar 'npm ci' npm-ci 'npm ci'
Executar 'Runtime Electron' electron-install 'node node_modules/electron/install.js'
Executar 'Dependências do servidor Better Auth' better-auth 'npm ci --prefix backend/login/servidor --omit=dev'
Executar 'Compilação' build 'npm run build'
Executar 'Testes unitários' unitarios 'npm run test:unitarios'
Executar 'Quality do Prumo (regras e agentes, sem repetir unitários)' quality-ci 'npm run qualidade:ci'
Executar 'Contrato OAuth multiplataforma' oauth-broker 'node --test docs/prototipos/integracoes-universais/oauth-broker.test.mjs'

# O Windows do Actions não tem GPU: os testes de janela rodam com "reduzir movimento" (docs/RELEASE.md); os demais, em modo normal.
foreach ($tipo in 'smoke', 'integracao', 'e2e', 'regressao') {
  $env:LAB_MOVIMENTO_REDUZIDO = if ($tipo -in 'e2e', 'regressao') { '1' } else { '' }
  if ($tipo -eq 'e2e') {
    $env:PRUMO_RESULT_FILE = Join-Path $env:RUNNER_TEMP 'lab-e2e-result-windows.json'
    $env:PRUMO_CLAUDE_ATTESTATION = Join-Path $env:RUNNER_TEMP 'claude-evidence-windows.json'
    $env:PRUMO_JOB_ID = "${env:GITHUB_RUN_ID}-windows"
  }
  Executar "Lab $tipo (Windows)" "lab-$tipo" "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo $tipo"
  if ($tipo -eq 'e2e') { Remove-Item Env:PRUMO_RESULT_FILE; Remove-Item Env:PRUMO_CLAUDE_ATTESTATION; Remove-Item Env:PRUMO_JOB_ID }
}

$env:LAB_MOVIMENTO_REDUZIDO = '1'
Executar 'Instalador NSIS' dist 'npm run dist'
$env:PRUMO_APP_EXE = (Resolve-Path 'release/win-unpacked/Prumo QA.exe').Path
Executar 'Executável empacotado (todas as telas)' empacotado 'node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo e2e --arquivo frontend/aplicativo/todas-as-telas.test.mjs --empacotado'
Remove-Item Env:PRUMO_APP_EXE

$setup = Get-ChildItem release\Prumo-QA-Setup-*.exe
$hash = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower()
"$hash *$($setup.Name)" | Out-File -Encoding ascii "release\$($setup.Name).sha256"
"SHA-256 $($setup.Name): $hash"
$assinatura = (Get-AuthenticodeSignature $setup.FullName).Status
"Assinatura do instalador: $assinatura"

Executar 'Instalador NSIS final (instalar, abrir, E2E, reabrir)' nsis-final "node backend/aplicativo/homologacao/validar-pacote-instalado.mjs --formato nsis --pacote $($setup.FullName)"
