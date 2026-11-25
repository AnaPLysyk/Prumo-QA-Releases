/**
 * Divide a regressão do Lab em fatias de áreas para rodar em jobs paralelos, sem perder nenhum teste.
 * A lista vem do próprio Lab (--listar): cada arquivo de teste pertence a exatamente uma área "<camada>/<módulo>", e cada área
 * vai para exatamente uma fatia; módulo novo entra sozinho, então nunca fica sem cobertura. Atribuição gulosa por peso
 * (janela do Electron custa mais que backend), determinística para o mesmo conjunto de testes.
 *
 * Uso (dentro de "codigo"): node fatia-regressao.mjs <fatia 1..N> <total N>   — imprime as áreas da fatia, separadas por espaço.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PESO = { frontend: 4, backend: 1 };

/** Recebe a lista de testes ("backend/abuso/x.test.mjs") e devolve as áreas de cada uma das N fatias. */
export function dividirEmFatias(lista, total) {
  if (!Number.isInteger(total) || total < 1 || total > 12) throw new Error('FATIAS_INVALIDAS');
  const areas = new Map();
  for (const teste of lista) {
    const m = /^(backend|frontend)\/([a-z-]+)\/[a-z0-9._-]+\.test\.mjs$/.exec(String(teste));
    if (!m) throw new Error('TESTE_FORA_DO_PADRAO: ' + String(teste).slice(0, 80));
    const area = `${m[1]}/${m[2]}`;
    areas.set(area, (areas.get(area) ?? 0) + PESO[m[1]]);
  }
  const fatias = Array.from({ length: total }, () => ({ peso: 0, areas: [] }));
  for (const [area, peso] of [...areas].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const menor = fatias.reduce((x, y) => (y.peso < x.peso ? y : x));
    menor.peso += peso; menor.areas.push(area);
  }
  return fatias.map((f) => f.areas.sort());
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const fatia = Number(process.argv[2]); const total = Number(process.argv[3]);
  if (!Number.isInteger(fatia) || fatia < 1 || fatia > total) { console.error('Uso: fatia-regressao.mjs <fatia 1..N> <total N>'); process.exit(2); }
  const r = spawnSync(process.execPath, ['tmp/lab/automacao/prumo-qa/executar.mjs', '--qa', '.', '--tipo', 'regressao', '--listar'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('Não foi possível listar a regressão do Lab.'); process.exit(1); }
  const lista = JSON.parse(r.stdout.trim().split('\n').at(-1));
  if (!Array.isArray(lista) || !lista.length) { console.error('A regressão do Lab veio vazia.'); process.exit(1); }
  console.log(dividirEmFatias(lista, total)[fatia - 1].join(' '));
}
