/**
 * Cifra logs com AES-256-GCM e protege a chave do artefato com RSA-OAEP-SHA256.
 * Novas cifragens exigem PRUMO_LOG_PUBLIC_KEY; a chave privada nunca entra no CI.
 * Artefatos legados (AES com PRUMO_LOG_SENHA) continuam decifráveis.
 * Uso: PRUMO_LOG_PUBLIC_KEY=... node cifrar-logs.mjs cifrar <entrada> <saída>
 *      PRUMO_LOG_PRIVATE_KEY_FILE=... node cifrar-logs.mjs decifrar <entrada> <saída>
 *      PRUMO_LOG_SENHA=... node cifrar-logs.mjs decifrar <legado> <saída>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const [modo, entrada, saida] = process.argv.slice(2);
const senha = process.env.PRUMO_LOG_SENHA;
if (!['cifrar', 'decifrar'].includes(modo) || !entrada || !saida) { console.error('Uso: cifrar-logs.mjs cifrar|decifrar <entrada> <saída>'); process.exit(2); }
const dados = fs.readFileSync(entrada);

const MAGICA = Buffer.from('PLOG');
const VERSAO = 2;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const rsaValida = (key) => key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
const lerChave = (valor, nome) => {
  if (!valor) throw new Error(`Falta ${nome}.`);
  const key = crypto.createPublicKey(valor);
  if (!rsaValida(key)) throw new Error(`${nome} deve ser uma chave RSA de pelo menos 2048 bits.`);
  return key;
};
const lerChavePrivada = (valor, nome) => {
  if (!valor) throw new Error(`Falta ${nome}.`);
  const key = crypto.createPrivateKey(valor);
  if (!rsaValida(key)) throw new Error(`${nome} deve ser uma chave RSA de pelo menos 2048 bits.`);
  return key;
};

if (modo === 'cifrar') {
  const publica = lerChave(process.env.PRUMO_LOG_PUBLIC_KEY, 'PRUMO_LOG_PUBLIC_KEY');
  const chave = crypto.randomBytes(KEY_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const corpo = Buffer.concat([cifra.update(dados), cifra.final()]);
  const envolvida = crypto.publicEncrypt({ key: publica, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, chave);
  const cabecalho = Buffer.alloc(MAGICA.length + 1 + 4);
  MAGICA.copy(cabecalho);
  cabecalho.writeUInt8(VERSAO, MAGICA.length);
  cabecalho.writeUInt32BE(envolvida.length, MAGICA.length + 1);
  fs.writeFileSync(saida, Buffer.concat([cabecalho, envolvida, iv, cifra.getAuthTag(), corpo]));
  console.log(`Logs privados cifrados: ${fs.statSync(saida).size} bytes.`);
} else {
  let resultado;
  if (dados.subarray(0, MAGICA.length).equals(MAGICA)) {
    if (dados.readUInt8(MAGICA.length) !== VERSAO) throw new Error('Versão do artefato não suportada.');
    const tamanho = dados.readUInt32BE(MAGICA.length + 1);
    const inicio = MAGICA.length + 1 + 4;
    const fimChave = inicio + tamanho;
    if (tamanho < 1 || dados.length < fimChave + IV_BYTES + TAG_BYTES) throw new Error('Artefato híbrido truncado.');
    const arquivoPrivada = process.env.PRUMO_LOG_PRIVATE_KEY_FILE;
    if (!arquivoPrivada) throw new Error('Falta PRUMO_LOG_PRIVATE_KEY_FILE.');
    const privada = lerChavePrivada(fs.readFileSync(arquivoPrivada, 'utf8'), 'PRUMO_LOG_PRIVATE_KEY_FILE');
    const chave = crypto.privateDecrypt({ key: privada, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dados.subarray(inicio, fimChave));
    if (chave.length !== KEY_BYTES) throw new Error('Chave AES inválida no artefato.');
    const iv = dados.subarray(fimChave, fimChave + IV_BYTES);
    const etiqueta = dados.subarray(fimChave + IV_BYTES, fimChave + IV_BYTES + TAG_BYTES);
    const decifra = crypto.createDecipheriv('aes-256-gcm', chave, iv); decifra.setAuthTag(etiqueta);
    resultado = Buffer.concat([decifra.update(dados.subarray(fimChave + IV_BYTES + TAG_BYTES)), decifra.final()]);
  } else {
    if (!senha) throw new Error('Falta PRUMO_LOG_SENHA para artefato legado.');
    if (dados.length < 44) throw new Error('Artefato legado truncado.');
    const sal = dados.subarray(0, 16); const iv = dados.subarray(16, 28); const etiqueta = dados.subarray(28, 44);
    const chave = crypto.scryptSync(senha, sal, KEY_BYTES);
    const decifra = crypto.createDecipheriv('aes-256-gcm', chave, iv); decifra.setAuthTag(etiqueta);
    resultado = Buffer.concat([decifra.update(dados.subarray(44)), decifra.final()]);
  }
  fs.writeFileSync(saida, resultado);
}
