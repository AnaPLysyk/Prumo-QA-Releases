/**
 * Resumo PÚBLICO de uma etapa que roda código privado no repositório público de distribuição.
 * Os logs de um repositório público são abertos a qualquer pessoa: o log completo da etapa nunca vai ao console.
 * Este script lê o arquivo de log (TAP ou spec do node:test, ou saída comum) e imprime só o que é seguro: rótulo,
 * estado, código de saída, contagens e o NOME dos testes que falharam. Nunca imprime mensagem de erro, pilha,
 * caminho, diff ou trecho de código. O Node ≥22 imprime spec por padrão mesmo sem TTY: sem ler esse formato o
 * resumo saía mudo (só rótulo e código), que foi o que aconteceu na homologação da v2.23.7.
 *
 * CONTRATO DE ESTADOS (único lugar que decide; os gates só obedecem):
 *   código 0                                  → PASS, só se nada na saída ou no resultado estruturado indicar falha;
 *   código 3 na etapa "Lab e2e (...)"         → BLOCKED, só se o resultado estruturado comprovar que o ÚNICO caso bloqueado é o do
 *                                               Claude Code com motivo CLAUDE_CODE_UNAVAILABLE e nenhum caso falhou;
 *   qualquer outro código (3 fora do E2E também) → FAIL. FAIL sempre vence BLOCKED; BLOCKED nunca conta como PASS.
 * Marcadores textuais soltos no log NÃO provam bloqueio: a prova é o resultado estruturado do Lab, vinculado à versão, aos dois SHAs,
 * à plataforma e ao job desta execução.
 *
 * Uso:  node resumo-seguro.mjs <saida.log> <rótulo> <código-de-saída>
 *       node resumo-seguro.mjs --validar-resultado <resultado.json> <atestado.json> <versão> <sha-prumo> <sha-lab> <plataforma> <job>
 *       (a segunda forma sai com 0=PASS, 3=BLOCKED, 1=FAIL e grava o atestado só nos dois primeiros casos)
 *       node resumo-seguro.mjs --validar-atestados <pasta-dos-atestados> <versão> <sha-prumo> <sha-lab> <id-da-execução>
 *       (portão final antes de publicar; o atestado local autorizado, só PASS, vem em PRUMO_CLAUDE_LOCAL_ATTESTATION)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CASO_CLAUDE = 'e2e/frontend/aplicativo/claude-code-delegacao-real.test.mjs';
export const MOTIVO_CLAUDE = 'CLAUDE_CODE_UNAVAILABLE';
const ETAPA_E2E = /^Lab e2e \(/;

/** Avalia o resultado estruturado do Lab para UM candidato exato. Nunca confia no log nem em marcador solto. */
export function avaliarResultado(texto, { versao, codigoSha, labSha, plataforma, jobId }) {
  const falha = (motivo, casos = []) => ({ estado: 'FAIL', motivo, contagem: contarCasos(casos), digest: null });
  if (!/^\d+\.\d+\.\d+$/.test(versao ?? '') || !/^[0-9a-f]{40}$/.test(codigoSha ?? '') || !/^[0-9a-f]{40}$/.test(labSha ?? '') || !plataforma || !jobId) return falha('parâmetros do candidato ausentes ou inválidos');
  let resultado;
  try { resultado = JSON.parse(texto); } catch { return falha('resultado ausente ou ilegível'); }
  const casos = Array.isArray(resultado?.cases) ? resultado.cases : [];
  if (!casos.length) return falha('resultado sem casos');
  if (resultado.jobId !== jobId) return falha('job divergente', casos);
  if (!Array.isArray(resultado.ambientes) || resultado.ambientes[0]?.plataforma !== plataforma) return falha('plataforma divergente', casos);
  if (casos.some((c) => typeof c?.id !== 'string' || !c.id)) return falha('caso sem identificação', casos);
  if (new Set(casos.map((c) => c.id)).size !== casos.length) return falha('casos duplicados', casos);
  // FAIL vence tudo: nenhum BLOCKED, por legítimo que seja, esconde uma falha genuína.
  if (casos.some((c) => c.status === 'FAIL')) return falha('falha genuína presente', casos);
  if (casos.some((c) => !['PASS', 'BLOCKED'].includes(c.status))) return falha('caso não executado ou com estado desconhecido', casos);
  for (const c of casos) {
    const linha = String(c.evidence ?? '').split('\n').find((l) => l.startsWith('rastreabilidade '));
    let m = null;
    try { m = linha ? JSON.parse(linha.slice('rastreabilidade '.length)) : null; } catch { m = null; }
    if (!m || m.versao !== versao || m.codigo_sha !== codigoSha || m.lab_sha !== labSha || m.plataforma !== plataforma) return falha('rastreabilidade divergente ou ausente em ' + c.id.slice(0, 60), casos);
  }
  const claude = casos.find((c) => c.id === CASO_CLAUDE);
  if (!claude) return falha('caso do Claude Code ausente', casos);
  const bloqueados = casos.filter((c) => c.status === 'BLOCKED');
  if (bloqueados.some((c) => c.id !== CASO_CLAUDE || !String(c.evidence ?? '').includes(MOTIVO_CLAUDE))) return falha('BLOCKED não autorizado', casos);
  const digest = crypto.createHash('sha256').update(texto).digest('hex');
  return { estado: bloqueados.length ? 'BLOCKED' : 'PASS', motivo: bloqueados.length ? MOTIVO_CLAUDE : null, contagem: contarCasos(casos), digest };
}

/** Cenários E2E autorizados a aparecer pelo nome no log público (lista fechada; qualquer outro vira "<cenário fora da lista>"). */
export const CENARIOS_PUBLICOS = Object.freeze(new Set([
  'e2e/frontend/administracao/papel-da-conta-conforme-a-tela-que-a-criou.test.mjs',
  'e2e/frontend/administracao/usuario-restrito-e-revogada.test.mjs',
  'e2e/frontend/agendamentos/autorizacao-do-agendamento.test.mjs',
  'e2e/frontend/agendamentos/editor-de-fluxos-jornadas.test.mjs',
  'e2e/frontend/agendamentos/fluxo-agendado-executando.test.mjs',
  'e2e/frontend/agendamentos/persistencia-do-fluxo-agendado.test.mjs',
  'e2e/frontend/agendamentos/unica-concluida-no-dia.test.mjs',
  'e2e/frontend/aplicativo/aprendizado-agentes.test.mjs',
  'e2e/frontend/aplicativo/chat-agentes-mcp.test.mjs',
  'e2e/frontend/aplicativo/chat-dispara-execucao-real.test.mjs',
  CASO_CLAUDE,
  'e2e/frontend/aplicativo/convite-de-canal-privado.test.mjs',
  'e2e/frontend/aplicativo/pacote-instalado.test.mjs',
  'e2e/frontend/aplicativo/rastreio-adaptacao.test.mjs',
  'e2e/frontend/aplicativo/todas-as-telas.test.mjs',
  'e2e/frontend/aplicativo/validacao-entrega.test.mjs',
  'e2e/frontend/configuracoes/configuracoes-fechar-reabrir.test.mjs',
  'e2e/frontend/equipe/conversas-entre-duas-contas.test.mjs',
  'e2e/frontend/testes/executor-release-e-metricas.test.mjs'
]));
/** Códigos técnicos conhecidos (lista fechada). Só entram se aparecerem como palavra inteira; nada mais da evidência é copiado. */
export const CODIGOS_PUBLICOS = Object.freeze([
  'ERR_ASSERTION', 'ERR_TEST_FAILURE', 'ERR_MODULE_NOT_FOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EADDRINUSE',
  'SERVICE_TIMEOUT', 'CLAUDE_CODE_UNAVAILABLE', 'LAB_BLOCKED', 'LAB_CONFIRMACAO_SEM_RESPOSTA', 'LAB_CONFIRMACAO_FRAMES_TIMEOUT', 'LAB_PRUMO_NAO_COMPILADO',
  'LAB_MCP_REVOGACAO_HANDSHAKE', 'LAB_PERFIL_EXTERNO_RECUSADO', 'LAB_PASTA_NAO_VINCULADA'
]);

/**
 * Linhas públicas dos cenários NÃO aprovados do E2E: só nome da lista fechada, classificação e códigos da lista fechada.
 * Texto livre da evidência (mensagem, pilha, caminho, trecho de código, valor) nunca é copiado.
 */
export function casosNaoAprovados(texto) {
  let casos;
  try { casos = JSON.parse(texto)?.cases; } catch { return []; }
  if (!Array.isArray(casos)) return [];
  const conhecidos = new Set(CODIGOS_PUBLICOS);
  return casos.filter((c) => c && c.status !== 'PASS').slice(0, 20).map((c) => {
    const id = typeof c.id === 'string' && CENARIOS_PUBLICOS.has(c.id) ? c.id : '<cenário fora da lista>';
    const status = ['FAIL', 'BLOCKED', 'NOT_RUN'].includes(c.status) ? c.status : 'DESCONHECIDO';
    const codigos = [...new Set((String(c.evidence ?? '').replace(/^rastreabilidade .*$/m, '').match(/[A-Za-z0-9_]+/g) ?? []).filter((t) => conhecidos.has(t)))].slice(0, 3);
    return `  cenário ${status}: ${id}${codigos.length ? ` · motivo=${codigos.join(',')}` : ''}`;
  });
}

export function contarCasos(casos) {
  const por = (s) => casos.filter((c) => c?.status === s).length;
  return { tests: casos.length, pass: por('PASS'), fail: por('FAIL'), blocked: por('BLOCKED'), not_run: por('NOT_RUN') };
}

/** Decide o estado de UMA etapa a partir do código de saída, do log e (só no E2E autorizado) do resultado estruturado. */
export function decidirEtapa({ rotulo, codigo, falhaNoLog = false, avaliacao = null }) {
  if (ETAPA_E2E.test(rotulo)) {
    if (!avaliacao) return 'FAIL';
    if (avaliacao.estado === 'FAIL') return 'FAIL';
    if (codigo === 0 && avaliacao.estado === 'PASS' && !falhaNoLog) return 'PASS';
    if (codigo === 3 && avaliacao.estado === 'BLOCKED' && !falhaNoLog) return 'BLOCKED';
    return 'FAIL';
  }
  return codigo === 0 && !falhaNoLog ? 'PASS' : 'FAIL';
}

function validarResultado(argumentos) {
  const [resultadoArquivo, atestadoArquivo, versao, codigoSha, labSha, plataforma, jobId = ''] = argumentos;
  let texto = '';
  try { texto = fs.readFileSync(resultadoArquivo, 'utf8'); } catch { /* ausente: avaliarResultado reprova */ }
  const av = avaliarResultado(texto, { versao, codigoSha, labSha, plataforma, jobId });
  if (av.estado === 'FAIL') { console.error(`Evidência externa inválida: ${av.motivo}`); return 1; }
  fs.writeFileSync(atestadoArquivo, JSON.stringify({
    schema: 'prumo-claude-attestation/v1', source: 'runner', versao, status: av.estado, reason: av.motivo, caseId: CASO_CLAUDE,
    codigo_sha: codigoSha, lab_sha: labSha, plataforma, jobId, contagem: av.contagem, resultado_sha256: av.digest,
  }));
  console.log(`Evidência externa ${av.estado}: ${plataforma}`);
  return av.estado === 'BLOCKED' ? 3 : 0;
}

export const PLATAFORMAS = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'];

/** Portão final da publicação: as quatro plataformas precisam ter atestado desta execução e do mesmo candidato; sem PASS real do Claude Code, não publica. */
export function validarAtestados(atestados, { versao, codigoSha, labSha, execucao }) {
  const erros = [];
  const vistos = new Set();
  let pass = 0;
  const hex64 = /^[0-9a-f]{64}$/;
  for (const a of atestados) {
    const origem = a?.source === 'local-authorized' ? 'local' : 'runner';
    if (a?.schema !== 'prumo-claude-attestation/v1' || a.caseId !== CASO_CLAUDE || !hex64.test(a.resultado_sha256 ?? '')) { erros.push('atestado inválido'); continue; }
    if (!['PASS', 'BLOCKED'].includes(a.status) || (a.status === 'BLOCKED' ? a.reason !== MOTIVO_CLAUDE : a.reason !== null)) { erros.push('status ou motivo inválido'); continue; }
    if (a.versao !== versao || a.codigo_sha !== codigoSha || a.lab_sha !== labSha) { erros.push('atestado de outro candidato (versão ou SHA)'); continue; }
    if (origem === 'local' && a.status !== 'PASS') { erros.push('a evidência local autorizada precisa ser PASS'); continue; }
    if (origem === 'runner' && (!execucao || typeof a.jobId !== 'string' || !a.jobId.startsWith(execucao + '-'))) { erros.push('atestado de outra execução: ' + a.plataforma); continue; }
    const identidade = origem + ':' + a.plataforma;
    if (vistos.has(identidade)) { erros.push('atestado duplicado: ' + identidade); continue; }
    vistos.add(identidade);
    if (a.status === 'PASS') pass++;
  }
  for (const p of PLATAFORMAS) if (!vistos.has('runner:' + p)) erros.push('evidência ausente para ' + p);
  if (!pass) erros.push('nenhum PASS real do Claude Code (somente BLOCKED): a publicação exige um PASS no runner ou o atestado local autorizado');
  return { ok: !erros.length, erros: [...new Set(erros)], pass };
}

function validarAtestadosDaPasta([pasta, versao, codigoSha, labSha, execucao]) {
  const atestados = [];
  const erros = [];
  const ler = (texto, nome) => { try { atestados.push(JSON.parse(texto)); } catch { erros.push('atestado ilegível: ' + nome); } };
  if (pasta && fs.existsSync(pasta)) for (const nome of fs.readdirSync(pasta).filter((n) => n.endsWith('.json'))) ler(fs.readFileSync(`${pasta}/${nome}`, 'utf8'), nome);
  if (process.env.PRUMO_CLAUDE_LOCAL_ATTESTATION) ler(process.env.PRUMO_CLAUDE_LOCAL_ATTESTATION, 'local');
  const veredito = validarAtestados(atestados, { versao, codigoSha, labSha, execucao });
  erros.push(...veredito.erros);
  if (erros.length) { for (const e of erros) console.error('Publicação bloqueada: ' + e); return 1; }
  console.log(`Evidências do Claude Code validadas: ${atestados.length} atestado(s), ${veredito.pass} PASS real; BLOCKED externo aceito só onde o PASS não foi possível.`);
  return 0;
}

function resumir([arquivo, rotulo = 'Etapa', codigoTexto = '1']) {
  const codigo = Number(codigoTexto);
  const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/) : [];
  // O node:test usa dois formatos: TAP ("# tests 10") e o reporter legível ("ℹ tests 10"). Ambos são contados sem expor a saída privada.
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
  const falhas = [...new Set([...falhasTap, ...falhasSpec].map(seguro))].slice(0, 100);
  const falhaNoLog = falhas.length > 0 || linhas.some((l) => /^(?:#|ℹ) (?:fail|cancelled) [1-9]\d*\s*$/.test(l.trim()));

  // Só a etapa "Lab e2e (...)" tem resultado estruturado; nas demais o arquivo (se existir no ambiente) é ignorado.
  let avaliacao = null; let contagemEstruturada = null;
  if (ETAPA_E2E.test(rotulo)) {
    let texto = '';
    try { texto = fs.readFileSync(process.env.PRUMO_RESULT_FILE ?? '', 'utf8'); } catch { /* ausente: a etapa reprova */ }
    avaliacao = avaliarResultado(texto, {
      versao: process.env.VERSAO, codigoSha: process.env.CODIGO_SHA, labSha: process.env.LAB_SHA,
      plataforma: `${process.platform}-${process.arch}`, jobId: process.env.PRUMO_JOB_ID,
    });
    try { contagemEstruturada = contarCasos(JSON.parse(texto).cases); } catch { contagemEstruturada = null; }
  }
  const estado = decidirEtapa({ rotulo, codigo, falhaNoLog, avaliacao });
  const partes = [`${rotulo}: ${estado} (código ${codigo})`];
  if (contagemEstruturada) {
    // Contagem por caso, sem misturar com o TAP bruto: um caso BLOCKED aparece como blocked, nunca dentro de pass.
    for (const [nome, valor] of Object.entries(contagemEstruturada)) partes.push(`${nome}=${valor}`);
  } else {
    for (const nome of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
      const valor = contar(nome) ?? contarReporter(nome);
      if (valor !== null) partes.push(`${nome}=${valor}`);
    }
  }
  if (estado === 'BLOCKED') partes.push(`motivo=${MOTIVO_CLAUDE}`);
  console.log(partes.join(' · '));
  if (avaliacao && estado === 'FAIL' && avaliacao.estado === 'FAIL') console.log(`  evidência estruturada reprovada: ${seguro(avaliacao.motivo)}`);
  for (const nome of falhas) console.log(`  não passou: ${nome}`);
  if (ETAPA_E2E.test(rotulo) && estado !== 'PASS') {
    let estruturado = '';
    try { estruturado = fs.readFileSync(process.env.PRUMO_RESULT_FILE ?? '', 'utf8'); } catch { /* sem resultado: nada a detalhar */ }
    for (const linha of casosNaoAprovados(estruturado)) console.log(linha);
    const curto = (v) => (/^[0-9a-f]{40}$/.test(v ?? '') ? v.slice(0, 8) : '?');
    console.log(`  rastreio: versão=${/^\d+\.\d+\.\d+$/.test(process.env.VERSAO ?? '') ? process.env.VERSAO : '?'} · prumo=${curto(process.env.CODIGO_SHA)} · lab=${curto(process.env.LAB_SHA)} · plataforma=${process.platform}-${process.arch} · execução=${/^\d{1,20}$/.test(process.env.GITHUB_RUN_ID ?? '') ? process.env.GITHUB_RUN_ID : '?'}`);
  }
  if (estado !== 'PASS') console.log('  O log completo contém código privado e não é exibido aqui; ele só sai cifrado, se a chave pública de cifra estiver configurada.');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [primeiro, ...resto] = process.argv.slice(2);
  if (primeiro === '--validar-resultado') process.exit(validarResultado(resto));
  if (primeiro === '--validar-atestados') process.exit(validarAtestadosDaPasta(resto));
  resumir(process.argv.slice(2));
}
