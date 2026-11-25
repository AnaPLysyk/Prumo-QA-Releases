# Gate canônico do Windows no repositório PÚBLICO de distribuição
# (unitários, smoke, integração, E2E, regressão, instalador NSIS, executável empacotado e validação do instalador final), cada um
# com a saída fora do log público (executar-silencioso.mjs). Roda dentro da pasta "codigo" (checkout do commit privado imutável).
# Grupos (rodam em jobs paralelos, escolhidos por $env:GRUPO; sem GRUPO, "tudo" roda todos em sequência, como antes):
#   base (unitários, qualidade, OAuth, smoke e integração) · e2e (com o atestado do Claude Code) ·
#   regressao ($env:FATIA de $env:TOTAL, áreas calculadas a partir da lista real do Lab) · pacote (instalador NSIS e pacote final).
$ErrorActionPreference = 'Stop'
$grupo = if ($env:GRUPO) { $env:GRUPO } else { 'tudo' }
if ($grupo -notin 'tudo', 'base', 'e2e', 'regressao', 'pacote') { Write-Host "grupo inválido: $grupo"; exit 2 }
function NoGrupo([string]$nome) { return ($grupo -eq 'tudo' -or $grupo -eq $nome) }
$silencioso = Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/executar-silencioso.mjs'
$resumo = Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/resumo-seguro.mjs'
# Contrato: 0 = PASS (a função RETORNA e o gate segue para a próxima etapa; nunca "exit 0"), 3 = BLOCKED só no E2E autorizado, resto = FAIL.
# >>> Executar
function Executar([string]$rotulo, [string]$log, [string]$comando) {
  node $silencioso $rotulo $log $comando
  $codigo = $LASTEXITCODE
  if ($rotulo -like 'Lab e2e (*)') {
    # Etapa com resultado estruturado: quem decide PASS/BLOCKED/FAIL é resumo-seguro.mjs, vinculado à versão, aos SHAs, à plataforma e ao job.
    $plataforma = node -p 'process.platform + "-" + process.arch'
    node $resumo --validar-resultado $env:PRUMO_RESULT_FILE $env:PRUMO_CLAUDE_ATTESTATION $env:VERSAO $env:CODIGO_SHA $env:LAB_SHA $plataforma $env:PRUMO_JOB_ID
    $decisao = $LASTEXITCODE
    if ($codigo -eq 0 -and $decisao -eq 0) { return }
    if ($codigo -eq 3 -and $decisao -eq 3) {
      Write-Host "::warning::BLOCKED: $rotulo (Claude Code externo indisponível; os demais gates continuam, mas o teste bloqueado NÃO está aprovado)."
      return
    }
    Write-Host "::error::$rotulo reprovado (código $codigo, validação $decisao)."
    exit 1
  }
  if ($codigo -eq 0) { return }
  # Código 3 só significa BLOCKED no E2E autorizado acima; em qualquer outra etapa é falha.
  if ($codigo -eq 3) { exit 1 }
  exit $codigo
}
# <<< Executar

Executar 'npm ci' npm-ci 'npm ci'
Executar 'Runtime Electron' electron-install 'node node_modules/electron/install.js'
Executar 'Dependências do servidor Better Auth' better-auth 'npm ci --prefix backend/login/servidor --omit=dev'
Executar 'Compilação' build 'npm run build'
if (NoGrupo 'base') {
  Executar 'Testes unitários' unitarios 'npm run test:unitarios'
  Executar 'Quality do Prumo (regras e agentes, sem repetir unitários)' quality-ci 'npm run qualidade:ci'
  Executar 'Contrato OAuth multiplataforma' oauth-broker 'node --test docs/prototipos/integracoes-universais/oauth-broker.test.mjs'
}

# O Windows do Actions não tem GPU: os testes de janela rodam com "reduzir movimento" (docs/RELEASE.md); os demais, em modo normal.
foreach ($tipo in 'smoke', 'integracao', 'e2e', 'regressao') {
  $pertence = if ($tipo -in 'smoke', 'integracao') { NoGrupo 'base' } else { NoGrupo $tipo }
  if (-not $pertence) { continue }
  $env:LAB_MOVIMENTO_REDUZIDO = if ($tipo -in 'e2e', 'regressao') { '1' } else { '' }
  if ($tipo -eq 'regressao' -and $grupo -eq 'regressao') {
    # Fatia da regressão: as áreas vêm da lista real do Lab (nenhum teste fica de fora); todas rodam mesmo se uma falhar, para a rodada trazer toda a informação.
    $listaDaFatia = (node (Join-Path $env:GITHUB_WORKSPACE 'publico/.github/scripts/fatia-regressao.mjs') $env:FATIA $env:TOTAL)
    if ($LASTEXITCODE -ne 0) { exit 1 }
    $areas = @("$listaDaFatia" -split '\s+' | Where-Object { $_ })
    Write-Host "Regressão do Lab, fatia $($env:FATIA) de $($env:TOTAL) ($($areas.Count) áreas)"
    $falhou = $false
    foreach ($area in $areas) {
      node $silencioso "Lab regressao (Windows) fatia $($env:FATIA)/$($env:TOTAL)" "lab-regressao-$($area -replace '/', '-')" "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo regressao --area $area"
      if ($LASTEXITCODE -ne 0) { $falhou = $true }
    }
    if ($falhou) { Write-Host "::error::Lab regressao (fatia $($env:FATIA)/$($env:TOTAL)) reprovado em uma ou mais áreas."; exit 1 }
    continue
  }
  if ($tipo -eq 'e2e') {
    $env:PRUMO_RESULT_FILE = Join-Path $env:RUNNER_TEMP 'lab-e2e-result-windows.json'
    $env:PRUMO_CLAUDE_ATTESTATION = Join-Path $env:RUNNER_TEMP 'claude-evidence-windows.json'
    $env:PRUMO_JOB_ID = "$($env:GITHUB_RUN_ID)-windows-x64"
    Remove-Item $env:PRUMO_RESULT_FILE, $env:PRUMO_CLAUDE_ATTESTATION -ErrorAction SilentlyContinue
  }
  Executar "Lab $tipo (Windows)" "lab-$tipo" "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo $tipo"
  if ($tipo -eq 'e2e') { Remove-Item Env:PRUMO_RESULT_FILE, Env:PRUMO_CLAUDE_ATTESTATION, Env:PRUMO_JOB_ID }
}

if (NoGrupo 'pacote') {
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
}
