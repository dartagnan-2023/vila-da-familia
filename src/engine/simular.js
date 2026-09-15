import { CONFIG, ESTACOES, CULTURAS, LIMIARES } from './conteudo.js';
import { rngPara, sorte, escolhe } from './rng.js';
import { vizinhas, temConstrucao, obraConcluida } from './mundo.js';

// ---------------------------------------------------------------------------
// A virada do dia. Roda igual em qualquer maquina a partir da mesma semente.
// E o momento em que o mundo cobra a conta do que a familia fez ontem.
// ---------------------------------------------------------------------------

const CHANCE_CHUVA = { Primavera: 0.5, Verao: 0.25, Outono: 0.4, Inverno: 0.35 };

/** Chuva de verdade: dispensa regar. */
export const choveu = (clima) => clima === 'chuva' || clima === 'tempestade';

export function passarDia(mundo) {
  const eventos = [];
  const tick = mundo.tick + 1;
  const estacao = ESTACOES[Math.floor(tick / CONFIG.diasPorEstacao) % ESTACOES.length];
  const ano = 1 + Math.floor(tick / (CONFIG.diasPorEstacao * ESTACOES.length));
  const diaDaEstacao = 1 + (tick % CONFIG.diasPorEstacao);

  // 1. Clima — floresta em pe puxa chuva; floresta derrubada traz seca.
  const rndClima = rngPara(mundo.semente, tick, 'clima');
  const pChuva = CHANCE_CHUVA[estacao] + (mundo.comuns.floresta - 50) / 300;
  let clima = 'sol';
  if (rndClima() < pChuva) clima = rndClima() < 0.2 ? 'tempestade' : 'chuva';
  else if (estacao === 'Verao' && rndClima() < 0.35) clima = 'sol_forte';

  const chuvaBase = { sol: 3, sol_forte: -3, chuva: 10, tempestade: 14 }[clima];
  const multAcude = obraConcluida(mundo, 'agua') ? 1.5 : 1;
  // A mata em pe alimenta a nascente: sem floresta, o rio nao se recupera.
  const nascente = Math.round(mundo.comuns.floresta / 10);
  const deltaComuns = { agua: Math.round(chuvaBase * (chuvaBase > 0 ? multAcude : 1)) + nascente };

  // A terra se refaz sozinha se houver mata segurando — e composteira ajuda.
  const composteiras = Object.values(mundo.herdades).filter((h) => temConstrucao(h, 'solo')).length;
  deltaComuns.solo = (mundo.comuns.floresta > 50 ? 1 : 0) + composteiras;
  // Mata rala nao segura o barranco: tempestade vira erosao.
  if (clima === 'tempestade' && mundo.comuns.floresta < LIMIARES.desmatamento) deltaComuns.solo -= 4;
  deltaComuns.floresta = mundo.comuns.floresta < CONFIG.comumMax ? 1 : 0;

  let harmonia = -1; // sem convivencia, a vila esfria sozinha
  if (obraConcluida(mundo, 'harmonia')) harmonia += 3;
  deltaComuns.harmonia = harmonia;

  eventos.push({
    tipo: 'DIA_PASSOU',
    ator: null,
    dados: { tick, ano, estacao, diaDaEstacao, clima },
    comuns: deltaComuns,
    texto: `Dia ${diaDaEstacao} de ${estacao} (ano ${ano}) — ${rotuloClima(clima)}.`,
  });

  // 2. Lavouras crescem em tempo real (tempo.js). O dia so cuida da chuva:
  // se o dia que nasce e de chuva, todo canteiro fica molhado ate amanha.
  const seca = mundo.comuns.agua < LIMIARES.secaAgua;
  if (choveu(clima) && mundo.agora) {
    eventos.push({ tipo: 'CHUVA_MOLHOU', ator: null, dados: { ate: mundo.agora + 24 * 3600e3 }, texto: null });
  }

  // 3. Terra: composteira cura, forja do vizinho contamina, pousio descansa.
  for (const her of Object.values(mundo.herdades)) {
    if (!her.dono) continue;
    let fert = 2, pol = 0; // a terra se refaz todo dia
    if (temConstrucao(her, 'solo')) fert += 3;
    if (her.tiles.every((t) => !t)) fert += 2; // pousio
    const forjasVizinhas = vizinhas(mundo, her.id).filter((v) => temConstrucao(v, 'ferramenta')).length;
    pol += forjasVizinhas > 0 ? forjasVizinhas : -1;
    if (pol > 0) fert -= 1;
    if (fert === 0 && pol === 0) continue;
    eventos.push({
      tipo: 'SOLO_MUDOU',
      ator: null,
      dados: { herdade: her.id, fertilidade: fert, poluicao: pol },
      texto: forjasVizinhas > 0 && her.poluicao < 90
        ? `A fumaca das forjas vizinhas assentou sobre ${her.nome}.`
        : null,
    });
  }

  // 4. Destino: limiares dos comuns viram acontecimento para todo mundo.
  eventos.push(...presagios(mundo, tick, { seca, clima }));

  // 5. Energia do proximo dia — resultado direto de como a familia se tratou.
  const energias = {};
  for (const p of Object.values(mundo.jogadores)) {
    let max = CONFIG.energiaMax;
    if (obraConcluida(mundo, 'energia')) max += 1;
    if (mundo.comuns.harmonia >= LIMIARES.harmoniaAlta) max += 1;
    if (mundo.comuns.harmonia <= LIMIARES.harmoniaBaixa) max -= 1;
    if (Object.values(p.reputacao).some((v) => v >= 6)) max += 1; // lacos fortes
    energias[p.id] = Math.max(3, max);
  }
  if (Object.keys(energias).length) {
    eventos.push({
      tipo: 'ENERGIA_RENOVADA',
      ator: null,
      dados: { energias },
      texto: null,
    });
  }

  return eventos;
}

function presagios(mundo, tick, { seca, clima }) {
  const out = [];
  const rnd = rngPara(mundo.semente, tick, 'destino');

  if (seca) {
    out.push(presagio('seca', `O rio comum baixou. As plantas de todo mundo murcham.`));
  }
  if (mundo.comuns.floresta < LIMIARES.desmatamento) {
    out.push(presagio('desmatamento', `A mata comum esta rala — as chuvas andam sumindo.`));
  }
  if (mundo.comuns.solo < LIMIARES.soloExausto && sorte(rnd, 0.25)) {
    const alvo = escolhe(rnd, Object.keys(CULTURAS).filter((k) => k !== 'flor'));
    out.push({
      ...presagio('praga', `Praga na terra cansada: as lavouras de ${CULTURAS[alvo].nome.toLowerCase()} se perderam.`),
      dados: { chave: 'praga', pragaEm: [alvo] },
    });
  }
  if (mundo.comuns.harmonia >= LIMIARES.harmoniaAlta) {
    out.push(presagio('festa', `A vila esta em festa. Tudo cresce mais rapido para todo mundo.`));
  } else if (mundo.comuns.harmonia <= LIMIARES.harmoniaBaixa) {
    out.push(presagio('discordia', `Anda todo mundo emburrado. Tudo cresce mais devagar.`));
  }
  if (clima === 'tempestade' && mundo.comuns.floresta < LIMIARES.desmatamento) {
    out.push(presagio('erosao', `A enxurrada levou parte da terra boa da vila.`));
  }
  return out;
}

const presagio = (chave, texto) => ({ tipo: 'DESTINO', ator: null, dados: { chave }, texto });

const rotuloClima = (c) =>
  ({ sol: 'sol firme', sol_forte: 'sol rachando', chuva: 'chuva boa', tempestade: 'temporal' }[c]);
