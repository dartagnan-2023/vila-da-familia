// O corpo do Pipo: ele cuida da vila sozinho, sem gastar um centavo de API.
// Tudo aqui é regra escrita à mão — o motor decide o que vale, como pra qualquer um.
//
//   npm run pipo:rotina -- VILA-XXXXX-XXXXX            uma passada
//   npm run pipo:rotina -- VILA-XXXXX-XXXXX --vigiar   fica morando lá (5 em 5 min)
//   ... --seco                                          mostra o que faria
//   ... --caixa                                         só lista o que chegou pro Pipo
//
// E ele é o olho: tudo que a família fala com ele, reclama ou sente fica em
// `.pipo-caixa.jsonl` — é por ali que a conversa chega em quem mexe no jogo.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { abrirVila, enviar } from './vila-remota.mjs';
import { visao } from '../src/engine/apresentador.js';
import { projetar, estaMadura } from '../src/engine/tempo.js';
import { CULTURAS, EMOCOES, nivelDe, precoDe } from '../src/engine/conteudo.js';

const args = process.argv.slice(2);
const chave = args.find((a) => a.startsWith('VILA-'));
const vigiar = args.includes('--vigiar');
const seco = args.includes('--seco');
const soCaixa = args.includes('--caixa');
const INTERVALO = 5 * 60e3;
const MAX_ACOES = 12;          // teto por passada: o Pipo não vira trator
const NOME_PIPO = 'Pipo';

if (!chave) { console.error('uso: npm run pipo:rotina -- VILA-XXXXX-XXXXX [--vigiar] [--seco] [--caixa]'); process.exit(1); }

const ARQ_ESTADO = new URL('../.pipo-estado.json', import.meta.url);
const ARQ_CAIXA = new URL('../.pipo-caixa.jsonl', import.meta.url);
const leEstado = () => { try { return JSON.parse(readFileSync(ARQ_ESTADO, 'utf-8')); } catch { return { visto: 0 }; } };
const gravaEstado = (e) => writeFileSync(ARQ_ESTADO, JSON.stringify(e, null, 2));

// Palavra dura não é problema: é sinal de que alguém se importa o bastante pra reclamar.
const IRRITACAO = /\b(merda|porra|caralho|bosta|droga|lixo|odiei|odeio|horr[ií]vel|p[ée]ssimo|travou|bug|n[ãa]o funciona|imposs[ií]vel|desisto|chato|saco|cansei)\b/i;

/** Tudo que a família dirigiu ao Pipo (ou ao jogo) desde a última olhada. */
function caixaDeEntrada(mundo, euId, visto) {
  const itens = [];
  for (const l of mundo.feed) {
    if (l.seq <= visto || l.ator === euId) continue;
    const quem = mundo.jogadores[l.ator]?.nome ?? 'alguém';
    if (l.tipo === 'RECADO') {
      const texto = l.texto.replace(/^[^:]+: "/, '').replace(/"$/, '');
      const praMim = l.ref?.para === euId;
      const citado = /\bpipo\b/i.test(texto);
      if (praMim || citado || !l.ref?.para) {
        itens.push({ seq: l.seq, tipo: praMim ? 'recado-pra-mim' : citado ? 'citou-o-pipo' : 'mural',
          quem, texto, urgente: IRRITACAO.test(texto) });
      }
    } else if (l.tipo === 'SENTIU') {
      const s = (mundo.sentimentos ?? []).find((x) => x.seq === l.seq);
      if (s) itens.push({ seq: l.seq, tipo: 'reacao', quem, emocao: s.emocao, icone: EMOCOES[s.emocao]?.icone,
        sobre: s.sobre, texto: s.texto, urgente: EMOCOES[s.emocao]?.cor === 'ruim' });
    } else if (l.tipo === 'JOGADOR_ENTROU') {
      itens.push({ seq: l.seq, tipo: 'chegou', quem, texto: `${quem} entrou na vila pela primeira vez` });
    }
  }
  return itens;
}

/** O que plantar: o que a família está precisando pra fechar pedido. */
function melhorSemente(v, mundo, eu) {
  const nv = nivelDe(eu.xp ?? 0);
  const querem = {};
  for (const p of Object.values(mundo.jogadores)) {
    for (const e of p.encomendas ?? []) {
      for (const [item, qtd] of Object.entries(e.itens)) {
        if (CULTURAS[item] && CULTURAS[item].nivel <= nv) querem[item] = (querem[item] ?? 0) + qtd - (p.colheita[item] ?? 0);
      }
    }
  }
  const candidatos = Object.entries(querem).filter(([, falta]) => falta > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .filter((k) => CULTURAS[k].semente <= eu.inventario.moedas);
  // Nada pedido? Trigo: barato, rápido, sempre serve.
  return candidatos[0] ?? (CULTURAS.trigo.semente <= eu.inventario.moedas ? 'trigo' : null);
}

/** A lista do que fazer agora, em ordem de quem precisa mais. */
function tarefas(motor, euId) {
  const agora = Date.now();
  const m = projetar(motor.mundo, agora);
  const v = visao(motor.mundo, euId, agora);
  const eu = m.jogadores[euId];
  const minha = m.herdades[eu.herdade];
  const fila = [];

  // 1. Quem está pedindo socorro vem antes de tudo — inclusive antes da minha horta.
  for (const p of v.pedidosDeAjuda.filter((x) => x.acao === 'CUIDAR')) {
    fila.push({ cmd: { tipo: 'AJUDAR', herdade: p.herdade, tile: p.tile, acao: 'CUIDAR' }, conta: `socorro: ${p.motivo}` });
  }
  // 2. Minha própria horta pedindo.
  minha.tiles.forEach((t, i) => { if (t?.problema) fila.push({ cmd: { tipo: 'CUIDAR', tile: i }, conta: `cuidei do meu ${t.cultura}` }); });
  // 3. Colher o meu que está pronto.
  minha.tiles.forEach((t, i) => { if (t && estaMadura(t)) fila.push({ cmd: { tipo: 'COLHER', tile: i }, conta: `colhi meu ${t.cultura}` }); });
  // 4. Salvar o que ia passar do ponto na horta dos outros.
  for (const p of v.pedidosDeAjuda.filter((x) => x.acao === 'COLHER')) {
    fila.push({ cmd: { tipo: 'AJUDAR', herdade: p.herdade, tile: p.tile, acao: 'COLHER' }, conta: `salvei: ${p.motivo}` });
  }
  // 5. Replantar o que ficou vazio, com o que a família precisa.
  const semente = melhorSemente(v, m, eu);
  if (semente) {
    minha.tiles.forEach((t, i) => { if (!t) fila.push({ cmd: { tipo: 'PLANTAR', tile: i, cultura: semente }, conta: `plantei ${semente}` }); });
  }
  // 6. Sobra de madeira/pedra vai pra obra da vila.
  if (v.missao) {
    for (const i of v.missao.itens.filter((x) => x.falta > 0)) {
      const tenho = i.recurso === 'moedas' ? eu.inventario.moedas - 20 : (eu.inventario[i.recurso] ?? 0) - 10;
      const dar = Math.min(tenho, i.falta);
      if (dar > 0) fila.push({ cmd: { tipo: 'DOAR', obra: v.missao.chave, recursos: { [i.recurso]: dar } }, conta: `doei ${dar} ${i.recurso} pra ${v.missao.nome}` });
    }
  }
  // 7. Lenha e pedra quando a ferramenta descansou e a mata aguenta.
  if (!v.hud.machadoEm && m.comuns.floresta >= 60 && eu.inventario.madeira < 40) fila.push({ cmd: { tipo: 'CORTAR' }, conta: 'cortei lenha' });
  if (!v.hud.machadoEm && m.comuns.floresta < 60 && eu.inventario.madeira >= 2) fila.push({ cmd: { tipo: 'PLANTAR_ARVORE' }, conta: 'plantei mudas (a mata estava baixa)' });
  if (!v.hud.picaretaEm && eu.inventario.pedra < 30) fila.push({ cmd: { tipo: 'MINERAR' }, conta: 'tirei pedra' });
  // 8. O que sobra no celeiro e alguém precisa vai pra vendinha por preço de feira.
  const lotes = (eu.vendinha ?? []).length;
  if (lotes < 3) {
    for (const [item, qtd] of Object.entries(eu.colheita)) {
      const precisam = Object.values(m.jogadores).some((p) => p.id !== euId && (p.encomendas ?? []).some((e) => e.itens[item] && (p.colheita[item] ?? 0) < e.itens[item]));
      if (precisam && qtd >= 4) {
        fila.push({ cmd: { tipo: 'ANUNCIAR', item, quantidade: Math.min(qtd, 10), preco: Math.min(qtd, 10) * precoDe(item) }, conta: `pus ${Math.min(qtd, 10)} ${item} na vendinha (alguém precisa)` });
        break;
      }
    }
  }
  // 9. Dinheiro curto? Vende o que ninguém pediu.
  if (eu.inventario.moedas < 10) {
    for (const [item, qtd] of Object.entries(eu.colheita)) {
      if (qtd >= 5) { fila.push({ cmd: { tipo: 'VENDER', cultura: item, quantidade: qtd }, conta: `vendi ${qtd} ${item} (tava sem moeda)` }); break; }
    }
  }
  return fila;
}

async function passada() {
  const { vila, motor } = await abrirVila(chave);
  const eu = Object.values(motor.mundo.jogadores).find((p) => p.nome === NOME_PIPO);
  if (!eu) { console.error(`O ${NOME_PIPO} não está nessa vila. Entre uma vez com esse nome pelo jogo.`); return; }

  const estado = leEstado();
  const caixa = caixaDeEntrada(motor.mundo, eu.id, estado.visto ?? 0);
  const marca = new Date().toLocaleString('pt-BR');

  if (caixa.length) {
    console.log(`\n📬 CHEGOU PRO PIPO (${caixa.length}):`);
    for (const i of caixa) {
      const linha = i.tipo === 'reacao'
        ? `${i.icone} ${i.quem} reagiu${i.sobre ? ` a ${i.sobre}` : ''}${i.texto ? `: "${i.texto}"` : ''}`
        : `${i.quem}: "${i.texto}"`;
      console.log(`  ${i.urgente ? '🔥' : '·'} [${i.tipo}] ${linha}`);
      if (!seco) appendFileSync(ARQ_CAIXA, JSON.stringify({ quando: marca, vila: vila.nome, ...i }) + '\n');
    }
    console.log('  (guardado em .pipo-caixa.jsonl — é o que sobe pro cérebro)');
  } else if (soCaixa) console.log('\n📭 nada novo pro Pipo.');

  if (soCaixa) { if (!seco) gravaEstado({ ...estado, visto: motor.mundo.seq }); return; }

  const fila = tarefas(motor, eu.id).slice(0, MAX_ACOES);
  console.log(`\n🌱 ${marca} · ${vila.nome} · ${fila.length ? `${fila.length} coisa(s) pra fazer` : 'nada a fazer, a vila está em dia'}`);
  let feitas = 0;
  for (const t of fila) {
    if (seco) { console.log(`   (seco) ${t.conta}`); continue; }
    const r = await enviar(vila, motor, { ...t.cmd, por: eu.id, data: new Date().toISOString().slice(0, 10) });
    if (r.ok) { console.log(`   ✓ ${t.conta}`); feitas++; }
    else console.log(`   – ${t.conta}: ${r.erro}`);
  }
  if (!seco) gravaEstado({ ...estado, visto: motor.mundo.seq, ultima: marca, feitas });
}

await passada();
if (vigiar) {
  console.log(`\n(o Pipo fica morando aqui: nova passada a cada ${INTERVALO / 60e3} min — Ctrl+C pra parar)`);
  setInterval(() => passada().catch((e) => console.error('erro na passada:', e.message)), INTERVALO);
}
