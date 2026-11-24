/**
 * Resumo PÚBLICO de uma etapa que roda código privado no repositório público de distribuição.
 * Os logs de um repositório público são abertos a qualquer pessoa: o log completo da etapa nunca vai ao console.
 * Este script lê o arquivo de log (TAP ou spec do node:test, ou saída comum) e imprime só o que é seguro: rótulo,
 * código de saída, contagem de testes e o NOME dos testes que falharam. Nunca imprime mensagem de erro, pilha,
 * caminho, diff ou trecho de código. O Node ≥22 imprime spec por padrão mesmo sem TTY: sem ler esse formato o
 * resumo saía mudo (só rótulo e código), que foi o que aconteceu na homologação da v2.23.7.
 * Uso: node resumo-seguro.mjs <saida.log> <rótulo> <código-de-saída>
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const argumentos = process.argv.slice(2);
if (argumentos[0] === '--validar-resultado') {
  const [, resultadoArquivo, atestadoArquivo, versao, codigoSha, labSha, plataforma, jobId = ''] = argumentos;
  const casoClaude = 'e2e/frontend/aplicativo/claude-code-delegacao-real.test.mjs';
  const falhar = (mensagem) => { console.error(`Evidência externa inválida: ${mensagem}`); process.exit(1); };
  if (!resultadoArquivo || !atestadoArquivo || !/^\d+\.\d+\.\d+$/.test(versao) || !/^[0-9a-f]{40}$/.test(codigoSha) || !/^[0-9a-f]{40}$/.test(labSha)) falhar('parâmetros');
  let resultado;
  try { resultado = JSON.parse(fs.readFileSync(resultadoArquivo, 'utf8')); } catch { falhar('resultado ausente ou ilegível'); }
  const casos = Array.isArray(resultado?.cases) ? resultado.cases : [];
  const caso = casos.find((item) => item?.id === casoClaude);
  if (!caso) falhar('caso Claude Code ausente');
  if (casos.some((item) => item?.status === 'FAIL')) falhar('falha genuína presente');
  if (casos.some((item) => !['PASS', 'BLOCKED'].includes(item?.status))) falhar('resultado incompleto ou estado obrigatório não aprovado');
  const bloqueados = casos.filter((item) => item?.status === 'BLOCKED');
  if (bloqueados.some((item) => item.id !== casoClaude || !String(item.evidence ?? '').includes('CLAUDE_CODE_UNAVAILABLE'))) falhar('BLOCKED não autorizado');
  if (new Set(casos.map((item) => item?.id)).size !== casos.length) falhar('casos duplicados');
  if (!['PASS', 'BLOCKED'].includes(caso.status)) falhar('status não aprovado');
  if (caso.status === 'BLOCKED' && !String(caso.evidence ?? '').includes('CLAUDE_CODE_UNAVAILABLE')) falhar('motivo BLOCKED ausente');
  if (caso.status === 'PASS' && bloqueados.length) falhar('há BLOCKED junto com PASS do Claude');
  const rastreabilidade = String(caso.evidence ?? '').split('\n').find((linha) => linha.startsWith('rastreabilidade '));
  let metadados;
  try { metadados = rastreabilidade ? JSON.parse(rastreabilidade.slice('rastreabilidade '.length)) : null; } catch { metadados = null; }
  if (!metadados || metadados.versao !== versao || metadados.codigo_sha !== codigoSha || metadados.lab_sha !== labSha || metadados.plataforma !== plataforma) falhar('rastreabilidade divergente ou incompleta');
  const conteudo = fs.readFileSync(resultadoArquivo);
  const atestado = {
    schema: 'prumo-claude-attestation/v1',
    source: 'runner',
    versao,
    status: caso.status,
    reason: caso.status === 'BLOCKED' ? 'CLAUDE_CODE_UNAVAILABLE' : null,
    caseId: casoClaude,
    codigo_sha: codigoSha,
    lab_sha: labSha,
    plataforma,
    jobId,
    resultado_sha256: crypto.createHash('sha256').update(conteudo).digest('hex')
  };
  fs.writeFileSync(atestadoArquivo, JSON.stringify(atestado));
  console.log(`Evidência externa ${caso.status}: ${plataforma}`);
  process.exit(caso.status === 'BLOCKED' ? 3 : 0);
}

const [arquivo, rotulo = 'Etapa', codigoTexto = '1'] = argumentos;
const codigo = Number(codigoTexto);
const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/) : [];
let resultadoEstruturado = null;
if (process.env.PRUMO_RESULT_FILE && fs.existsSync(process.env.PRUMO_RESULT_FILE)) {
  try { resultadoEstruturado = JSON.parse(fs.readFileSync(process.env.PRUMO_RESULT_FILE, 'utf8')); } catch { resultadoEstruturado = null; }
}
const estadosEstruturados = Array.isArray(resultadoEstruturado?.cases) ? resultadoEstruturado.cases.map((item) => item?.status) : [];
const falhaEstruturadaDoResultado = estadosEstruturados.includes('FAIL');
const bloqueioEstruturadoDoResultado = estadosEstruturados.includes('BLOCKED');
const contarReporter = (nome) => {
  const valores = linhas.filter((linha) => {
    const texto = linha.trim();
    return texto.startsWith(`# ${nome} `) || texto.startsWith(`${String.fromCodePoint(0x2139)} ${nome} `) || texto.startsWith(`i ${nome} `);
  }).map((linha) => Number(linha.trim().split(/\s+/).at(-1))).filter(Number.isFinite);
  return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
};
const contar = (nome) => {
  // TAP: "# tests 12" · spec: "ℹ tests 12" (cada lote do runner privado imprime o próprio bloco; somam-se todos).
  const valores = linhas.map((l) => new RegExp(`^(?:#|ℹ) ${nome} (\\d+)\\s*$`).exec(l)).filter(Boolean).map((m) => Number(m[1]));
  return valores.length ? valores.reduce((a, b) => a + b) : null;
};
const seguro = (texto) => texto
  .replace(/[\r\n%]/g, ' ')
  .replace(/https?:\/\/[^\s'"]+/gi, '<url>')
  .replace(/[A-Za-z]:[\\/][^\s'"]*|\/(?:home|Users|Applications|opt|tmp|var)\/[^\s'"]*/g, '<caminho>')
  .replace(/\b(?:bearer|token|secret|senha|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '<redigido>')
  .replace(/\b[0-9a-f]{32,}\b/gi, '<valor>')
  .slice(0, 160);
// TAP: "not ok 1 - nome" · spec: "✖ nome (12.3ms)" — a linha "✖ failing tests:" é cabeçalho, e "⚠" é TODO.
const falhasTap = linhas.map((l) => /^\s*not ok \d+ - (.+)$/.exec(l)).filter(Boolean).map((m) => m[1]);
const falhasSpec = linhas
  .map((l) => /^\s*✖ (?!failing tests:)(.+?)(?: \(\d+(?:\.\d+)?m?s\))?\s*$/.exec(l))
  .filter(Boolean)
  .map((m) => m[1]);
const falhas = [...new Set([...falhasTap, ...falhasSpec].map(seguro))].slice(0, 15);
const marcadorClaude = linhas.some((linha) => /^\s*#\s*LAB_BLOCKED:\s*CLAUDE_CODE_UNAVAILABLE\s*$/.test(linha));
const falhaEstruturada = falhas.length > 0 || linhas.some((linha) => /^(?:#|ℹ) fail [1-9]\d*\s*$/.test(linha.trim())) || falhaEstruturadaDoResultado;
const bloqueado = codigo === 3 && (marcadorClaude || bloqueioEstruturadoDoResultado) && !falhaEstruturada;
const estado = codigo === 0 && !marcadorClaude && !bloqueioEstruturadoDoResultado && !falhaEstruturada ? 'PASS' : bloqueado ? 'BLOCKED' : 'FAIL';
const partes = [`${rotulo}: ${estado} (código ${codigo})`];
for (const nome of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
  const valorBruto = contar(nome) ?? contarReporter(nome);
  const valor = valorBruto;
  if (valor !== null) partes.push(`${nome}=${valor}`);
}
if (bloqueado) partes.push('blocked=1 · approved_pass=0');
console.log(partes.join(' · '));
for (const nome of falhas) console.log(`  não passou: ${nome}`);
if (estado !== 'PASS') console.log('  O log completo contém código privado e não é exibido aqui; ele só sai cifrado, se a chave autorizada existir.');
