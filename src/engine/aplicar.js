import { CONFIG } from './conteudo.js';
import { limita } from './mundo.js';

// ---------------------------------------------------------------------------
// O reducer. Evento -> mutacao do mundo. Unico lugar do motor que altera estado.
// Todo evento pode carregar `comuns` (deltas): e assim que uma acao individual
// entra automaticamente na conta coletiva da vila.
// ---------------------------------------------------------------------------

const j = (mundo, id) => mundo.jogadores[id];
const h = (mundo, id) => mundo.herdades[id];

function gastaEnergia(mundo, id, custo) {
  const p = j(mundo, id);
  if (p) p.energia = Math.max(0, p.energia - (custo ?? 0));
}

function creditaReputacao(mundo, de, para, n) {
  const a = j(mundo, de), b = j(mundo, para);
  if (!a || !b || de === para) return;
  a.reputacao[para] = (a.reputacao[para] ?? 0) + n;
  b.reputacao[de] = (b.reputacao[de] ?? 0) + n;
}

const REDUCERS = {
  JOGADOR_ENTROU(mundo, ev, d) {
    mundo.jogadores[d.jogador.id] = d.jogador;
    const her = h(mundo, d.jogador.herdade);
    her.dono = d.jogador.id;
    her.nome = d.nomeHerdade;
  },

  PLANTOU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.tiles[d.tile] = { cultura: d.cultura, idade: 0, regas: 0, estresse: 0, regadoEm: -1, plantadoPor: ev.ator };
    j(mundo, d.dono).inventario.moedas -= d.custoSemente;
    j(mundo, ev.ator).feitos.plantios++;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  REGOU(mundo, ev, d) {
    const t = h(mundo, d.herdade).tiles[d.tile];
    if (t) { t.regas++; t.regadoEm = mundo.tick; }
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  COLHEU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.tiles[d.tile] = null;
    her.fertilidade = limita(her.fertilidade - d.desgasteSolo, 0, 100);
    const dono = j(mundo, d.dono);
    dono.colheita[d.cultura] = (dono.colheita[d.cultura] ?? 0) + d.quantidade;
    dono.feitos.colheitas++;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  VENDEU(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.colheita[d.cultura] -= d.quantidade;
    if (p.colheita[d.cultura] <= 0) delete p.colheita[d.cultura];
    p.inventario.moedas += d.moedas;
  },

  CORTOU_ARVORE(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.inventario.madeira += d.madeira;
    p.feitos.cortes++;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  PLANTOU_ARVORE(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.inventario.madeira -= d.custoMadeira;
    p.feitos.arvores++;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  MINEROU(mundo, ev, d) {
    j(mundo, ev.ator).inventario.pedra += d.pedra;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  CONSTRUIU(mundo, ev, d) {
    h(mundo, d.herdade).construcoes.push(d.efeito);
    const p = j(mundo, ev.ator);
    for (const [rec, qtd] of Object.entries(d.custo)) p.inventario[rec] -= qtd;
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  PRESENTEOU(mundo, ev, d) {
    const de = j(mundo, ev.ator), para = j(mundo, d.para);
    if (d.recurso === 'colheita') {
      de.colheita[d.item] -= d.quantidade;
      if (de.colheita[d.item] <= 0) delete de.colheita[d.item];
      para.colheita[d.item] = (para.colheita[d.item] ?? 0) + d.quantidade;
    } else {
      de.inventario[d.recurso] -= d.quantidade;
      para.inventario[d.recurso] += d.quantidade;
    }
    de.feitos.presentes++;
    creditaReputacao(mundo, ev.ator, d.para, 1);
  },

  ABRACOU(mundo, ev, d) {
    const de = j(mundo, ev.ator);
    de.gestos[d.para] = mundo.tick;
    de.feitos.abracos++;
    creditaReputacao(mundo, ev.ator, d.para, 1);
  },

  RECADO(mundo, ev, d) {
    // O recado nao muda numero nenhum: ele existe para virar feed.
  },

  AJUDOU(mundo, ev, d) {
    j(mundo, ev.ator).feitos.ajudas++;
    creditaReputacao(mundo, ev.ator, d.dono, 2);
    gastaEnergia(mundo, ev.ator, d.energia);
  },

  DOOU(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    const obra = (mundo.vila.obras[d.obra] ??= { progresso: {} });
    for (const [rec, qtd] of Object.entries(d.recursos)) {
      p.inventario[rec] -= qtd;
      obra.progresso[rec] = (obra.progresso[rec] ?? 0) + qtd;
      mundo.vila.doado[rec] = (mundo.vila.doado[rec] ?? 0) + qtd;
    }
    p.feitos.doacoes++;
  },

  OBRA_CONCLUIDA(mundo, ev, d) {
    mundo.vila.concluidas.push(d.bonus);
    mundo.destino.marcos.push({ tick: ev.tick, texto: ev.texto });
  },

  DIA_PASSOU(mundo, ev, d) {
    mundo.tick = d.tick;
    mundo.ano = d.ano;
    mundo.estacao = d.estacao;
    mundo.diaDaEstacao = d.diaDaEstacao;
    mundo.clima = d.clima;
  },

  CRESCEU(mundo, ev, d) {
    const t = h(mundo, d.herdade).tiles[d.tile];
    if (!t) return;
    t.idade += d.crescimento;
    t.estresse += d.estresse;
  },

  SOLO_MUDOU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.fertilidade = limita(her.fertilidade + (d.fertilidade ?? 0), 0, 100);
    her.poluicao = limita(her.poluicao + (d.poluicao ?? 0), 0, 100);
  },

  ENERGIA_RENOVADA(mundo, ev, d) {
    for (const [id, valor] of Object.entries(d.energias)) {
      const p = j(mundo, id);
      if (p) { p.energiaMax = valor; p.energia = valor; }
    }
  },

  DESTINO(mundo, ev, d) {
    mundo.destino.presagios.push({ tick: ev.tick, chave: d.chave, texto: ev.texto });
    if (mundo.destino.presagios.length > 50) mundo.destino.presagios.shift();
    if (d.pragaEm) {
      for (const her of Object.values(mundo.herdades)) {
        her.tiles = her.tiles.map((t) => (t && d.pragaEm.includes(t.cultura) ? null : t));
      }
    }
  },
};

export function aplicar(mundo, ev) {
  if (ev.comuns) {
    for (const [k, delta] of Object.entries(ev.comuns)) {
      mundo.comuns[k] = limita((mundo.comuns[k] ?? 0) + delta, 0, CONFIG.comumMax);
    }
  }
  const fn = REDUCERS[ev.tipo];
  if (!fn) throw new Error(`evento sem reducer: ${ev.tipo}`);
  fn(mundo, ev, ev.dados ?? {});
}

export function registrarFeed(mundo, ev) {
  const d = ev.dados ?? {};
  // `ref` diz ONDE o ato aconteceu: e o que a tela usa para mandar o boneco ate la.
  const ref = { herdade: d.herdade, tile: d.tile, para: d.para ?? d.dono };
  mundo.feed.push({ seq: ev.seq, tick: ev.tick, tipo: ev.tipo, ator: ev.ator, texto: ev.texto, comuns: ev.comuns, ref });
  while (mundo.feed.length > CONFIG.feedMax) mundo.feed.shift();
}
