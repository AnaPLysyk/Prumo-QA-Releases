#!/usr/bin/env bash
# Gate canônico de macOS (arm64 e Intel) e Linux no repositório PÚBLICO de distribuição: smoke, integração, E2E,
# instaladores, executável empacotado e
# validação dos pacotes finais), cada um com a saída fora do log público (executar-silencioso.mjs).
# Uso (dentro da pasta "codigo"): bash gate-unix.sh mac|linux [grupo]
# Grupos (rodam em jobs paralelos; "tudo", o padrão, roda todos em sequência, como antes):
#   base      tipos, unitários, qualidade, OAuth, plataforma, conexões, smoke e integração do Lab
#   e2e       E2E do Lab (com o atestado do Claude Code)
#   regressao regressão completa do Lab em um único job por plataforma
#   pacote    instalador, executável empacotado, checksums e validação dos pacotes finais
set -uo pipefail
alvo="${1:?Uso: gate-unix.sh mac|linux [grupo]}"
grupo="${2:-tudo}"
case "$grupo" in tudo|base|e2e|regressao|pacote) ;; *) echo "grupo inválido: $grupo"; exit 2 ;; esac
no_grupo() { [ "$grupo" = tudo ] || [ "$grupo" = "$1" ]; }
silencioso="$GITHUB_WORKSPACE/publico/.github/scripts/executar-silencioso.mjs"
resumo="$GITHUB_WORKSPACE/publico/.github/scripts/resumo-seguro.mjs"
# Sem "set -e" de propósito: os códigos de saída são tratados um a um (0=PASS, 3=BLOCKED só no E2E autorizado, resto=FAIL).
# >>> executar
executar() {
  local rotulo="$1" log="$2" comando="$3" codigo=0 decisao=0
  node "$silencioso" "$rotulo" "$log" "$comando" || codigo=$?
  if [[ "$rotulo" == "Lab e2e ("* ]]; then
    # Etapa com resultado estruturado: quem decide PASS/BLOCKED/FAIL é resumo-seguro.mjs, vinculado à versão, aos SHAs, à plataforma e ao job.
    node "$resumo" --validar-resultado "${PRUMO_RESULT_FILE:-}" "${PRUMO_CLAUDE_ATTESTATION:-}" "${VERSAO:-}" "${CODIGO_SHA:-}" "${LAB_SHA:-}" "$(node -p 'process.platform + "-" + process.arch')" "${PRUMO_JOB_ID:-}" || decisao=$?
    if [ "$codigo" -eq 0 ] && [ "$decisao" -eq 0 ]; then return 0; fi
    if [ "$codigo" -eq 3 ] && [ "$decisao" -eq 3 ]; then
      echo "::warning::BLOCKED: $rotulo (Claude Code externo indisponível; os demais gates continuam, mas o teste bloqueado NÃO está aprovado)."
      return 0
    fi
    echo "::error::$rotulo reprovado (código $codigo, validação $decisao)."
    exit 1
  fi
  [ "$codigo" -eq 0 ] && return 0
  # Código 3 só significa BLOCKED no E2E autorizado acima; em qualquer outra etapa é falha.
  [ "$codigo" -eq 3 ] && codigo=1
  exit "$codigo"
}
# <<< executar
# Linux: janela no Xvfb e cofre do GNOME destravado numa sessão D-Bus própria, como numa área de trabalho real.
# XDG_CURRENT_DESKTOP=GNOME faz o Chromium escolher o gnome-keyring (libsecret) como cofre; sem isso ele cai em "basic_text", que o
# Prumo recusa de propósito (token sem cofre real), e todo teste que conecta Qase, Jira ou GitHub falhava só no Linux.
sessao() {
  if [ "$alvo" = "linux" ]; then
    printf '%s' "dbus-run-session -- bash -c \"export XDG_CURRENT_DESKTOP=GNOME; printf '' | gnome-keyring-daemon --unlock --components=secrets >/dev/null && xvfb-run -a -s '-screen 0 1440x900x24' $1\""
  else printf '%s' "$1"; fi
}

if [ "$alvo" = "linux" ]; then
  sudo apt-get update >/dev/null || exit $?
  sudo apt-get install -y xvfb libsecret-1-0 gnome-keyring dbus-x11 zenity polkitd pkexec libfuse2 rpm fakeroot dpkg >/dev/null || exit $?
  for binario in dbus-run-session gnome-keyring-daemon xvfb-run pkexec; do
    command -v "$binario" >/dev/null || { echo "faltando $binario depois do apt: o gate de janela não pode rodar"; exit 1; }
  done
  # Ubuntu 24.04 restringe namespaces sem privilégio (AppArmor) e o sandbox do Chromium não abre a janela sem eles.
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null || exit $?
fi

executar 'npm ci' npm-ci 'npm ci'
executar 'Runtime Electron' electron-install 'node node_modules/electron/install.js'
executar 'Dependências do servidor Better Auth' better-auth 'npm ci --prefix backend/login/servidor --omit=dev'
if no_grupo base; then
  executar 'Tipos' typecheck 'npm run typecheck'
fi
executar 'Compilação' build 'npm run build'
if no_grupo base; then
  executar 'Testes unitários' unitarios 'npm run test:unitarios'
  executar 'Quality do Prumo (regras e agentes, sem duplicar testes)' quality-ci 'npm run qualidade:ci'
  executar 'Contrato OAuth multiplataforma' oauth-broker 'node --test docs/prototipos/integracoes-universais/oauth-broker.test.mjs'
  executar 'Testes de plataforma' plataforma 'node --test --test-concurrency=1 testes/unitario/backend/aplicativo/multiplataforma.test.mjs testes/unitario/backend/testes/aprovacao-multiplataforma.test.mjs'
  executar 'Conexões pelo navegador (GitHub App e Jira OAuth)' conexoes 'node --test --test-concurrency=1 testes/unitario/backend/projetos/autorizacao-no-servidor.test.mjs testes/unitario/backend/projetos/autorizacao-pelo-navegador.test.mjs testes/unitario/backend/projetos/cliente-do-servico-de-autorizacao.test.mjs testes/unitario/backend/projetos/contas-oauth.test.mjs'
fi
for tipo in smoke integracao e2e regressao; do
  case "$tipo" in smoke|integracao) no_grupo base || continue ;; *) no_grupo "$tipo" || continue ;; esac
  if [ "$tipo" = e2e ]; then
    export PRUMO_RESULT_FILE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lab-e2e-result-${alvo}-$(node -p process.arch).json"
    export PRUMO_CLAUDE_ATTESTATION="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/claude-evidence-${alvo}-$(node -p process.arch).json"
    export PRUMO_JOB_ID="${GITHUB_RUN_ID:-local}-${alvo}-$(node -p process.arch)"
    rm -f "$PRUMO_RESULT_FILE" "$PRUMO_CLAUDE_ATTESTATION"
  fi
  executar "Lab $tipo ($alvo $(node -p process.arch))" "lab-$tipo" "$(sessao "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo $tipo")"
  if [ "$tipo" = e2e ]; then unset PRUMO_RESULT_FILE PRUMO_CLAUDE_ATTESTATION PRUMO_JOB_ID; fi
done
if ! no_grupo pacote; then exit 0; fi
executar "Instaladores ($alvo)" dist "npm run dist:$alvo"

if [ "$alvo" = "mac" ]; then
  # Arquitetura do próprio runner, sem fallback para a outra: o .app arm64 não abre num Mac Intel (erro -86) e vice-versa.
  if [ "$(node -p process.arch)" = "arm64" ]; then pasta=release/mac-arm64; else pasta=release/mac; fi
  exe=$(ls -d "$pasta"/*.app/Contents/MacOS/* 2>/dev/null | head -1)
else
  exe="release/linux-unpacked/$(node -p "require('./package.json').name")"
  [ -x "$exe" ] || exe=$(find release/linux-unpacked -maxdepth 1 -type f -perm -u+x ! -name '*.so*' ! -name 'chrome*' | head -1)
fi
[ -n "$exe" ] && [ -x "$exe" ] || { echo "::error::Executável empacotado não encontrado"; exit 1; }
export PRUMO_APP_EXE="$PWD/$exe"
executar 'Executável empacotado (todas as telas)' empacotado "$(sessao "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo e2e --arquivo frontend/aplicativo/todas-as-telas.test.mjs --empacotado")"
unset PRUMO_APP_EXE

cd release
if [ "$alvo" = "mac" ]; then arquivos=$(ls Prumo-QA-*-mac-*.dmg); else arquivos=$(ls Prumo-QA-*-linux-*.AppImage Prumo-QA-*-linux-*.deb); fi
[ -n "$arquivos" ] || { echo "::error::Nenhum instalador gerado"; exit 1; }
for f in $arquivos; do
  if command -v sha256sum >/dev/null; then h=$(sha256sum "$f" | cut -d' ' -f1); else h=$(shasum -a 256 "$f" | cut -d' ' -f1); fi
  echo "$h *$f" > "$f.sha256"; echo "SHA-256 $f: $h"
done
cd ..

# Pacotes FINAIS: instala de verdade, abre o executável instalado e roda o E2E dentro dele. O .dmg de outra arquitetura fica BLOCKED (código 3).
validar() { executar "Pacote final: $2" "pacote-$3" "$(sessao "node backend/aplicativo/homologacao/validar-pacote-instalado.mjs --formato $1 --pacote $2")"; }
if [ "$alvo" = "mac" ]; then
  arq=$(node -p process.arch)
  validar dmg "$(ls release/Prumo-QA-*-mac-$arq.dmg)" "dmg-$arq"
else
  validar appimage "$(ls release/Prumo-QA-*-linux-*.AppImage)" appimage
  validar deb "$(ls release/Prumo-QA-*-linux-*.deb)" deb
fi
