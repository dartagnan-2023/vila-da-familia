import { CONFIG, ESTACOES } from './conteudo.js';

/** Cria a vila vazia. A `semente` define clima, eventos e sorteios para sempre. */
export function criarMundo({ semente = 'vila', nome = 'Nossa Vila', grade = { l: 3, a: 3 } } = {}) {
  const herdades = {};
  for (let y = 0; y < grade.a; y++) {
    for (let x = 0; x < grade.l; x++) {
      const id = `h${x}${y}`;
      herdades[id] = {
        id, x, y,
        dono: null,
        nome: null,
        fertilidade: 100,
        poluicao: 0,
        tiles: Array.from({ length: CONFIG.tilesPorHerdade }, () => null),
        construcoes: [],
      };
    }
  }
  return {
    versao: 1,
    semente,
    nome,
    tick: 0,
    ano: 1,
    estacao: ESTACOES[0],
    diaDaEstacao: 1,
    clima: 'sol',
    dataDoDia: null, // 'AAAA-MM-DD' do ultimo dia virado (vem do log)
    grade,
    herdades,
    jogadores: {},
    comuns: { agua: 100, floresta: 100, solo: 100, harmonia: 50 },
    vila: { obras: {}, concluidas: [], doado: { madeira: 0, pedra: 0, moedas: 0 } },
    destino: { presagios: [], marcos: [] },
    seq: 0,
    feed: [],
    aplicados: {},
  };
}

export function criarJogador({ id, nome, sprite, herdade }) {
  return {
    id, nome, sprite,
    herdade,
    energia: CONFIG.energiaMax,
    energiaMax: CONFIG.energiaMax,
    inventario: { madeira: 5, pedra: 0, moedas: 30 },
    colheita: {},
    reputacao: {},
    gestos: {}, // ultimo dia em que abracou cada parente
    feitos: { plantios: 0, colheitas: 0, ajudas: 0, presentes: 0, doacoes: 0, arvores: 0, cortes: 0, abracos: 0 },
  };
}

export const herdadeDe = (mundo, jogadorId) =>
  mundo.herdades[mundo.jogadores[jogadorId]?.herdade];

/** Vizinhanca ortogonal: e por aqui que a atitude de um vaza para o outro. */
export function vizinhas(mundo, herdadeId) {
  const h = mundo.herdades[herdadeId];
  if (!h) return [];
  return Object.values(mundo.herdades).filter(
    (o) => o.id !== h.id && Math.abs(o.x - h.x) + Math.abs(o.y - h.y) === 1
  );
}

export const limita = (v, min, max) => Math.max(min, Math.min(max, v));

export function herdadeLivre(mundo) {
  return Object.values(mundo.herdades).find((h) => !h.dono) ?? null;
}

export function temConstrucao(herdade, efeito) {
  return herdade.construcoes.includes(efeito);
}

export function obraConcluida(mundo, bonus) {
  return mundo.vila.concluidas.includes(bonus);
}
