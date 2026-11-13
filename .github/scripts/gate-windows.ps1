# Gate canônico do Windows no repositório PÚBLICO de distribuição
# (unitários, smoke, integração, E2E, regressão, instalador NSIS, executável empacotado e validação do instalador final), cada um
# com a saída fora do log público (executar-silencioso.mjs). Roda dentro da pasta "codigo" (checkout do commit privado imutável).
$ErrorActionPreference = 'Stop'
$silencioso = Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/executar-silencioso.mjs'
function Executar([string]$rotulo, [string]$log, [string]$comando) {
  node $silencioso $rotulo $log $comando
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Executar 'npm ci' npm-ci 'npm ci'
Executar 'Runtime Electron' electron-install 'node node_modules/electron/install.js'
Executar 'Dependências do servidor Better Auth' better-auth 'npm ci --prefix backend/login/servidor --omit=dev'
Executar 'Compilação' build 'npm run build'
Executar 'Testes unitários' unitarios 'npm run test:unitarios'
Executar 'Quality do Prumo (regras e agentes, sem repetir unitários)' quality-ci 'npm run qualidade:ci'

# O Windows do Actions não tem GPU: os testes de janela rodam com "reduzir movimento" (docs/RELEASE.md); os demais, em modo normal.
foreach ($tipo in 'smoke', 'integracao', 'e2e', 'regressao') {
  $env:LAB_MOVIMENTO_REDUZIDO = if ($tipo -in 'e2e', 'regressao') { '1' } else { '' }
  Executar "Lab $tipo (Windows)" "lab-$tipo" "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo $tipo"
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
