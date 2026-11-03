/**
 * Executa um comando que roda código privado SEM mostrar a saída no log (os logs do repositório público são abertos).
 * A saída completa vai para PRUMO_LOGS_PRIVADOS (padrão: $RUNNER_TEMP/logs-privados)/<nome>.log; o console recebe só o resumo seguro (resumo-seguro.mjs).
 * Uso: node executar-silencioso.mjs <rótulo> <nome-do-log> "<comando completo>"   — devolve o código de saída do comando.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [rotulo, nomeDoLog, comando] = process.argv.slice(2);
const pasta = process.env.PRUMO_LOGS_PRIVADOS ?? (process.env.RUNNER_TEMP && path.join(process.env.RUNNER_TEMP, 'logs-privados'));
if (!rotulo || !nomeDoLog || !comando || !pasta) {
  console.error('Uso: [PRUMO_LOGS_PRIVADOS=<pasta>] node executar-silencioso.mjs <rótulo> <nome-do-log> "<comando>"');
  process.exit(2);
}
fs.mkdirSync(pasta, { recursive: true });
const log = path.join(pasta, `${nomeDoLog.replace(/[^\w.-]/g, '_')}.log`);
const descritor = fs.openSync(log, 'a');
const resultado = spawnSync(comando, { shell: true, stdio: ['ignore', descritor, descritor], env: process.env });
fs.closeSync(descritor);
const codigo = resultado.status ?? 1;
execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'resumo-seguro.mjs'), log, rotulo, String(codigo)], { stdio: 'inherit' });
process.exit(codigo);
