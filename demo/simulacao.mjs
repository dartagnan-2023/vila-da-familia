import { Motor } from '../src/engine/motor.js';
import { visao } from '../src/engine/apresentador.js';
import { CULTURAS, OBRAS } from '../src/engine/conteudo.js';
import { estaMadura, estaMolhada } from '../src/engine/tempo.js';
const H = 3600e3; let relogio = Date.parse('2026-09-15T08:00:00Z');

// ---------------------------------------------------------------------------
// Duas familias, a MESMA semente, o mesmo numero de dias.
// A unica diferenca e como elas se tratam. O motor faz o resto.
// ---------------------------------------------------------------------------

const DIAS = 30;
const FAMILIA = ['Vo Rosa', 'Marcos', 'Lia'];

function candidatos(motor, id, estilo) {
  const mundo = motor.mundo;
  const eu = mundo.jogadores[id];
  const her = mundo.herdades[eu.herdade];
  const v = visao(mundo, id);
  const lista = [];

  her.tiles.forEach((t, i) => {
    if (estaMadura(t)) lista.push({ tipo: 'COLHER', tile: i });
  });

  if (estilo === 'junto') {
    for (const p of v.pedidosDeAjuda.slice(0, 2)) {
      lista.push({ tipo: 'AJUDAR', herdade: p.herdade, tile: p.tile, acao: p.acao });
    }
  }

  her.tiles.forEach((t, i) => {
    if (t && !estaMadura(t) && !estaMolhada(t, mundo.agora)) lista.push({ tipo: 'REGAR', tile: i });
  });

  const cultura = estilo === 'junto' && mundo.comuns.harmonia < 70 ? 'flor' : 'trigo';
  her.tiles.forEach((t, i) => { if (!t) lista.push({ tipo: 'PLANTAR', tile: i, cultura }); });

  // Cada estilo constroi o que combina com ele.
  if (estilo === 'junto') {
    lista.push({ tipo: 'CONSTRUIR', construcao: 'composteira' }, { tipo: 'CONSTRUIR', construcao: 'poco' }, { tipo: 'CONSTRUIR', construcao: 'colmeia' });
  } else {
    lista.push({ tipo: 'CONSTRUIR', construcao: 'forja' }, { tipo: 'CONSTRUIR', construcao: 'celeiro' });
  }

  if (estilo === 'sozinho') lista.push({ tipo: 'CORTAR' }, { tipo: 'MINERAR' });
  else if (mundo.comuns.floresta < 80 && eu.inventario.madeira >= 4) lista.push({ tipo: 'PLANTAR_ARVORE' });
  else lista.push({ tipo: 'CORTAR' }, { tipo: 'MINERAR' });

  return lista;
}

function jogaDia(motor, id, estilo) {
  for (let passo = 0; passo < 14; passo++) {
    const eu = motor.mundo.jogadores[id];
    if (eu.energia <= 0) break;
    const cmd = candidatos(motor, id, estilo).find(
      (c) => motor.executar({ ...c, por: id, id: `${id}:${motor.mundo.seq + 1}`, em: relogio }).ok
    );
    if (!cmd) break;
  }
  // fim de dia: vende o que tem e, se for da turma do junto, ajuda a obra
  const eu = motor.mundo.jogadores[id];
  for (const [cultura, qtd] of Object.entries({ ...eu.colheita })) {
    motor.executar({ tipo: 'VENDER', por: id, cultura, quantidade: qtd, id: `${id}:v${motor.mundo.seq + 1}` });
  }
  if (estilo === 'junto') {
    const madeira = motor.mundo.jogadores[id].inventario.madeira;
    const pedra = motor.mundo.jogadores[id].inventario.pedra;
    if (madeira >= 10) motor.executar({ tipo: 'DOAR', por: id, obra: 'ponte', recursos: { madeira: madeira - 4 }, id: `${id}:d${motor.mundo.seq + 1}` });
    if (pedra >= 5) motor.executar({ tipo: 'DOAR', por: id, obra: 'ponte', recursos: { pedra }, id: `${id}:dp${motor.mundo.seq + 1}` });
  }
}

function roda(estilo) {
  const motor = Motor.criar({ semente: 'natal-2026', nome: estilo === 'junto' ? 'Vila Junto' : 'Vila Cada-Um' });
  FAMILIA.forEach((n, i) => motor.executar({
    id: `entra-${i}`, tipo: 'ENTRAR', por: chave(n), nome: n, em: relogio, nomeHerdade: `Sitio d${n.endsWith('a') ? 'a' : 'o'} ${n.split(' ').pop()}`,
  }));
  for (let d = 0; d < DIAS; d++) {
    // Tres visitas por dia: manha, tarde e noite — e o ritmo que o jogo pede.
    for (let visita = 0; visita < 3; visita++) {
      for (const n of FAMILIA) jogaDia(motor, chave(n), estilo);
      relogio += 5 * H;
    }
    relogio += 9 * H;
    motor.executar({ tipo: 'PASSAR_DIA', id: `dia-${d}`, em: relogio });
  }
  return motor;
}

const chave = (n) => n.toLowerCase().replace(/\s+/g, '-');
const barra = (v, max = 100, larg = 20) => {
  const n = Math.round((v / max) * larg);
  return '#'.repeat(n) + '.'.repeat(larg - n);
};

function relatorio(motor, titulo) {
  const m = motor.mundo;
  const moedas = Object.values(m.jogadores).reduce((s, p) => s + p.inventario.moedas, 0);
  const ajudas = Object.values(m.jogadores).reduce((s, p) => s + p.feitos.ajudas, 0);
  const colheitas = Object.values(m.jogadores).reduce((s, p) => s + p.feitos.colheitas, 0);

  console.log(`\n=== ${titulo} — ${DIAS} dias, semente natal-2026 ===`);
  for (const [k, v] of Object.entries(m.comuns)) {
    console.log(`  ${k.padEnd(9)} ${String(v).padStart(3)} [${barra(v)}]`);
  }
  console.log(`  ---`);
  console.log(`  moedas da familia .. ${moedas}`);
  console.log(`  colheitas .......... ${colheitas}`);
  console.log(`  ajudas dadas ....... ${ajudas}`);
  console.log(`  obras prontas ...... ${m.vila.concluidas.length ? m.vila.concluidas.map((b) => Object.values(OBRAS).find((o) => o.bonus === b).nome).join(', ') : 'nenhuma'}`);
  console.log(`  energia por dia .... ${Object.values(m.jogadores).map((p) => `${p.nome}: ${p.energiaMax}`).join(' | ')}`);
  const presagios = [...new Set(m.destino.presagios.map((p) => p.chave))];
  console.log(`  o que o mundo mandou ${presagios.length ? presagios.join(', ') : 'nada de mais'}`);
  console.log(`  hash ............... ${motor.hash}`);
}

const sozinho = roda('sozinho');
const junto = roda('junto');

relatorio(sozinho, 'CADA UM POR SI');
relatorio(junto, 'JUNTOS');

console.log('\nUltimas noticias da Vila Junto:');
for (const l of visao(junto.mundo, chave(FAMILIA[0])).feed.slice(0, 8)) console.log(`  - ${l.texto}`);
console.log('');
