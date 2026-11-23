/**
 * Resumo PÚBLICO de uma etapa que roda código privado no repositório público de distribuição.
 * Os logs de um repositório público são abertos a qualquer pessoa: o log completo da etapa nunca vai ao console.
 * Este script lê o arquivo de log (TAP do node:test ou saída comum) e imprime só o que é seguro: rótulo, código de saída,
 * contagem de testes e o NOME dos testes que falharam. Nunca imprime mensagem de erro, pilha, caminho, diff ou trecho de código.
 * Uso: node resumo-seguro.mjs <saida.log> <rótulo> <código-de-saída>
 */
import fs from 'node:fs';

const [arquivo, rotulo = 'Etapa', codigoTexto = '1'] = process.argv.slice(2);
const codigo = Number(codigoTexto);
const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/) : [];
// O node:test usa dois formatos: TAP ("# tests 10") e o reporter legÃ­vel
// ("â„¹ tests 10"). Ambos sÃ£o contados sem expor a saÃ­da privada.
const contarReporter = (nome) => {
  const valores = linhas.filter((linha) => {
    const texto = linha.trim();
    return texto.startsWith(`# ${nome} `) || texto.startsWith(`${String.fromCodePoint(0x2139)} ${nome} `) || texto.startsWith(`i ${nome} `);
  }).map((linha) => Number(linha.trim().split(/\s+/).at(-1))).filter(Number.isFinite);
  return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
};
const contar = (nome) => {
  const valores = linhas.map((l) => new RegExp(`^# ${nome} (\\d+)\\s*$`).exec(l)).filter(Boolean).map((m) => Number(m[1]));
  return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
};
const seguro = (texto) => texto.replace(/[\r\n%]/g, ' ').replace(/[A-Za-z]:[\\/][^\s'"]*|\/(?:home|Users|Applications|opt|tmp|var)\/[^\s'"]*/g, '<caminho>').slice(0, 160);
const falhas = linhas.map((l) => /^\s*not ok \d+ - (.+)$/.exec(l)).filter(Boolean).map((m) => seguro(m[1])).slice(0, 15);
const partes = [`${rotulo}: ${codigo === 0 ? 'PASS' : 'FAIL'} (código ${codigo})`];
for (const nome of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
  const valor = contar(nome) ?? contarReporter(nome);
  if (valor !== null) partes.push(`${nome}=${valor}`);
}
console.log(partes.join(' · '));
for (const nome of falhas) console.log(`  não passou: ${nome}`);
if (codigo !== 0) console.log('  Resumo público acima; detalhes privados permanecem protegidos no artefato cifrado quando PRUMO_LOG_SENHA está provisionada.');
