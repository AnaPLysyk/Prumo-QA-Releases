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

const [arquivo, rotulo = 'Etapa', codigoTexto = '1'] = process.argv.slice(2);
const codigo = Number(codigoTexto);
const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/) : [];
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
const falhaEstruturada = falhas.length > 0 || linhas.some((linha) => /^(?:#|ℹ) fail [1-9]\d*\s*$/.test(linha.trim()));
const bloqueado = codigo === 3 && marcadorClaude && !falhaEstruturada;
const estado = codigo === 0 && !marcadorClaude ? 'PASS' : bloqueado ? 'BLOCKED' : 'FAIL';
const partes = [`${rotulo}: ${estado} (código ${codigo})`];
for (const nome of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
  const valorBruto = contar(nome) ?? contarReporter(nome);
  const valor = nome === 'pass' && estado !== 'PASS' ? 0 : valorBruto;
  if (valor !== null) partes.push(`${nome}=${valor}`);
}
if (bloqueado) partes.push('blocked=1');
console.log(partes.join(' · '));
for (const nome of falhas) console.log(`  não passou: ${nome}`);
if (estado !== 'PASS') console.log('  O log completo contém código privado e não é exibido aqui; ele só sai cifrado, se a chave autorizada existir.');
