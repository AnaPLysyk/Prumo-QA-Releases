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
const contar = (nome) => {
  const encontrado = linhas.map((l) => new RegExp(`^# ${nome} (\\d+)\\s*$`).exec(l)).filter(Boolean).pop();
  return encontrado ? Number(encontrado[1]) : null;
};
const seguro = (texto) => texto.replace(/[\r\n%]/g, ' ').replace(/[A-Za-z]:[\\/][^\s'"]*|\/(?:home|Users|Applications|opt|tmp|var)\/[^\s'"]*/g, '<caminho>').slice(0, 160);
const falhas = linhas.map((l) => /^\s*not ok \d+ - (.+)$/.exec(l)).filter(Boolean).map((m) => seguro(m[1])).slice(0, 15);
const partes = [`${rotulo}: ${codigo === 0 ? 'PASS' : 'FAIL'} (código ${codigo})`];
for (const nome of ['tests', 'pass', 'fail', 'skipped']) {
  const valor = contar(nome);
  if (valor !== null) partes.push(`${nome}=${valor}`);
}
console.log(partes.join(' · '));
for (const nome of falhas) console.log(`  não passou: ${nome}`);
if (codigo !== 0) console.log('  O log completo contém código privado e não é exibido aqui; ele só sai cifrado, se PRUMO_LOG_SENHA existir.');
