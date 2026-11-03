/**
 * Cifra (AES-256-GCM, chave derivada por scrypt) a pasta de logs privados para sair como artefato do repositório público.
 * Sem a senha (segredo PRUMO_LOG_SENHA) nada é gravado. Quem tem a senha decifra localmente.
 * Uso: PRUMO_LOG_SENHA=... node cifrar-logs.mjs cifrar <arquivo-entrada> <arquivo-saída>
 *      PRUMO_LOG_SENHA=... node cifrar-logs.mjs decifrar <arquivo-entrada> <arquivo-saída>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const [modo, entrada, saida] = process.argv.slice(2);
const senha = process.env.PRUMO_LOG_SENHA;
if (!senha) { console.log('Sem PRUMO_LOG_SENHA: os logs privados não foram guardados.'); process.exit(modo === 'cifrar' ? 0 : 2); }
if (!['cifrar', 'decifrar'].includes(modo) || !entrada || !saida) { console.error('Uso: cifrar-logs.mjs cifrar|decifrar <entrada> <saída>'); process.exit(2); }
const dados = fs.readFileSync(entrada);
const chave = (sal) => crypto.scryptSync(senha, sal, 32);
if (modo === 'cifrar') {
  const sal = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chave(sal), iv);
  const corpo = Buffer.concat([cifra.update(dados), cifra.final()]);
  fs.writeFileSync(saida, Buffer.concat([sal, iv, cifra.getAuthTag(), corpo]));
  console.log(`Logs privados cifrados: ${fs.statSync(saida).size} bytes.`);
} else {
  const sal = dados.subarray(0, 16); const iv = dados.subarray(16, 28); const etiqueta = dados.subarray(28, 44);
  const decifra = crypto.createDecipheriv('aes-256-gcm', chave(sal), iv); decifra.setAuthTag(etiqueta);
  fs.writeFileSync(saida, Buffer.concat([decifra.update(dados.subarray(44)), decifra.final()]));
}
