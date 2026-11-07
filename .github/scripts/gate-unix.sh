#!/usr/bin/env bash
# Gate de macOS (arm64 e Intel) e Linux no repositório PÚBLICO de distribuição: os mesmos comandos de
# .github/workflows/multiplataforma.yml do repositório privado (smoke, integração, E2E, instaladores, executável empacotado e
# validação dos pacotes finais), cada um com a saída fora do log público (executar-silencioso.mjs).
# Uso (dentro da pasta "codigo"): bash gate-unix.sh mac|linux
set -uo pipefail
alvo="${1:?Uso: gate-unix.sh mac|linux}"
silencioso="$GITHUB_WORKSPACE/publico/.github/scripts/executar-silencioso.mjs"
executar() { node "$silencioso" "$1" "$2" "$3" || exit $?; }
# Linux: janela no Xvfb e cofre do GNOME destravado numa sessão D-Bus própria, como numa área de trabalho real.
sessao() {
  if [ "$alvo" = "linux" ]; then
    printf '%s' "dbus-run-session -- bash -c \"printf '' | gnome-keyring-daemon --unlock --components=secrets >/dev/null && xvfb-run -a -s '-screen 0 1440x900x24' $1\""
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
executar 'Tipos' typecheck 'npm run typecheck'
executar 'Compilação' build 'npm run build'
executar 'Testes de plataforma' plataforma 'node --test --test-concurrency=1 testes/unitario/backend/aplicativo/multiplataforma.test.mjs testes/unitario/backend/testes/aprovacao-multiplataforma.test.mjs'
executar 'Conexões pelo navegador (GitHub App e Jira OAuth)' conexoes 'node --test --test-concurrency=1 testes/unitario/backend/projetos/autorizacao-no-servidor.test.mjs testes/unitario/backend/projetos/autorizacao-pelo-navegador.test.mjs testes/unitario/backend/projetos/cliente-do-servico-de-autorizacao.test.mjs testes/unitario/backend/projetos/contas-oauth.test.mjs'
for tipo in smoke integracao e2e; do
  executar "Lab $tipo ($alvo $(node -p process.arch))" "lab-$tipo" "$(sessao "node tmp/lab/automacao/prumo-qa/executar.mjs --qa . --tipo $tipo")"
done
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
