import { CONFIG } from './conteudo.js';
import { limita } from './mundo.js';
import { gerarEncomenda } from './regras.js';

// ---------------------------------------------------------------------------
// O reducer. Evento -> mutacao do mundo. Unico lugar do motor que altera estado.
// Todo evento pode carregar `comuns` (deltas): e assim que uma acao individual
// entra automaticamente na conta coletiva da vila.
// ---------------------------------------------------------------------------

const j = (mundo, id) => mundo.jogadores[id];
const h = (mundo, id) => mundo.herdades[id];

function xp(mundo, id, n) {
  const p = j(mundo, id);
  if (p && n) p.xp = (p.xp ?? 0) + n;
}

// Contadores do dia (missoes). Jogadores de vilas antigas podem nao ter `hoje`.
function conta(mundo, id, chave) {
  const p = j(mundo, id);
  if (!p) return;
  p.hoje ??= {};
  p.hoje[chave] = (p.hoje[chave] ?? 0) + 1;
  p.missoesFeitas ??= [];
}

function creditaReputacao(mundo, de, para, n) {
  const a = j(mundo, de), b = j(mundo, para);
  if (!a || !b || de === para) return;
  a.reputacao[para] = (a.reputacao[para] ?? 0) + n;
  b.reputacao[de] = (b.reputacao[de] ?? 0) + n;
}

/** Jogadores de versoes anteriores ganham os campos novos na primeira mexida. */
export function garantirJogador(mundo, p) {
  if (!p) return;
  p.xp ??= Object.values(p.feitos ?? {}).reduce((s, n) => s + n, 0) * 2; // o que ja fez vale alguma coisa
  p.descanso ??= { machado: 0, picareta: 0 };
  p.hoje ??= {};
  p.missoesFeitas ??= [];
  p.encomendasGeradas ??= 0;
  p.encomendas ??= [];
  while (p.encomendas.length < CONFIG.encomendasAbertas) {
    p.encomendas.push(gerarEncomenda(mundo, p, p.encomendasGeradas++));
  }
  const her = h(mundo, p.herdade);
  if (her && !her.producao) her.producao = {};
}

const REDUCERS = {
  JOGADOR_ENTROU(mundo, ev, d) {
    mundo.jogadores[d.jogador.id] = d.jogador;
    const her = h(mundo, d.jogador.herdade);
    her.dono = d.jogador.id;
    her.nome = d.nomeHerdade;
    garantirJogador(mundo, d.jogador);
  },

  PLANTOU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.tiles[d.tile] = { cultura: d.cultura, progresso: 0, pedidos: d.pedidos ?? [], problema: null, plantadoEm: mundo.agora, plantadoPor: ev.ator };
    j(mundo, d.dono).inventario.moedas -= d.custoSemente;
    j(mundo, ev.ator).feitos.plantios++;
    conta(mundo, ev.ator, 'plantios');
    xp(mundo, ev.ator, d.xp);
  },

  CUIDOU(mundo, ev, d) {
    const t = h(mundo, d.herdade).tiles[d.tile];
    if (t) t.problema = null;
    conta(mundo, ev.ator, 'cuidados');
    xp(mundo, ev.ator, d.xp);
  },

  COLHEU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.tiles[d.tile] = null;
    her.fertilidade = limita(her.fertilidade - d.desgasteSolo, 0, 100);
    const dono = j(mundo, d.dono);
    dono.colheita[d.cultura] = (dono.colheita[d.cultura] ?? 0) + d.quantidade;
    dono.feitos.colheitas++;
    conta(mundo, ev.ator, 'colheitas');
    xp(mundo, d.dono, d.xp);
  },

  VENDEU(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.colheita[d.cultura] -= d.quantidade;
    if (p.colheita[d.cultura] <= 0) delete p.colheita[d.cultura];
    p.inventario.moedas += d.moedas;
    conta(mundo, ev.ator, 'vendas');
  },

  CORTOU_ARVORE(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.inventario.madeira += d.madeira;
    p.feitos.cortes++;
    (p.descanso ??= {}).machado = d.descansaAte ?? 0;
    conta(mundo, ev.ator, 'cortes');
    xp(mundo, ev.ator, d.xp);
  },

  PLANTOU_ARVORE(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.inventario.madeira -= d.custoMadeira;
    p.feitos.arvores++;
    conta(mundo, ev.ator, 'arvores');
    xp(mundo, ev.ator, d.xp);
  },

  MINEROU(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.inventario.pedra += d.pedra;
    (p.descanso ??= {}).picareta = d.descansaAte ?? 0;
    xp(mundo, ev.ator, d.xp);
  },

  CONSTRUIU(mundo, ev, d) {
    h(mundo, d.herdade).construcoes.push(d.efeito);
    const p = j(mundo, ev.ator);
    for (const [rec, qtd] of Object.entries(d.custo)) p.inventario[rec] -= qtd;
    xp(mundo, ev.ator, d.xp);
  },

  PRODUZINDO(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    for (const [k, q] of Object.entries(d.entrada)) {
      p.colheita[k] -= q;
      if (p.colheita[k] <= 0) delete p.colheita[k];
    }
    (h(mundo, d.herdade).producao ??= {})[d.maquina] = { produto: d.produto, prontoEm: d.prontoEm };
  },

  PRODUZIU(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    p.colheita[d.produto] = (p.colheita[d.produto] ?? 0) + 1;
    delete h(mundo, d.herdade).producao[d.maquina];
    conta(mundo, ev.ator, 'producoes');
    xp(mundo, ev.ator, d.xp);
  },

  ENCOMENDA_ENTREGUE(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    for (const [k, q] of Object.entries(d.itens)) {
      p.colheita[k] -= q;
      if (p.colheita[k] <= 0) delete p.colheita[k];
    }
    p.inventario.moedas += d.moedas;
    p.encomendas[d.indice] = d.nova;
    p.encomendasGeradas = (p.encomendasGeradas ?? 0) + 1;
    conta(mundo, ev.ator, 'encomendas');
    xp(mundo, ev.ator, d.xp);
  },

  CANTEIRO_COMPRADO(mundo, ev, d) {
    h(mundo, d.herdade).tiles.push(null);
    j(mundo, ev.ator).inventario.moedas -= d.preco;
  },

  DEMOLIU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.construcoes = her.construcoes.filter((e) => e !== d.efeito);
    const p = j(mundo, ev.ator);
    for (const [rec, qtd] of Object.entries(d.devolve)) p.inventario[rec] += qtd;
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
    xp(mundo, ev.ator, d.xp);
  },

  ABRACOU(mundo, ev, d) {
    const de = j(mundo, ev.ator);
    de.gestos[d.para] = mundo.tick;
    de.feitos.abracos++;
    conta(mundo, ev.ator, 'abracos');
    creditaReputacao(mundo, ev.ator, d.para, 1);
    xp(mundo, ev.ator, d.xp);
  },

  RECADO(mundo, ev, d) {
    conta(mundo, ev.ator, 'recados');
    xp(mundo, ev.ator, d.xp);
  },

  AJUDOU(mundo, ev, d) {
    j(mundo, ev.ator).feitos.ajudas++;
    conta(mundo, ev.ator, 'ajudas');
    creditaReputacao(mundo, ev.ator, d.dono, 2);
    xp(mundo, ev.ator, d.xp);
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
    conta(mundo, ev.ator, 'doacoes');
    xp(mundo, ev.ator, d.xp);
  },

  OBRA_CONCLUIDA(mundo, ev, d) {
    mundo.vila.concluidas.push(d.bonus);
    mundo.destino.marcos.push({ tick: ev.tick, texto: ev.texto });
  },

  MISSAO_CUMPRIDA(mundo, ev, d) {
    const p = j(mundo, ev.ator);
    (p.missoesFeitas ??= []).push(d.indice);
    if (d.premio.moedas) p.inventario.moedas += d.premio.moedas;
    xp(mundo, ev.ator, d.xp);
  },

  DIA_PASSOU(mundo, ev, d) {
    mundo.tick = d.tick;
    mundo.ano = d.ano;
    mundo.estacao = d.estacao;
    mundo.diaDaEstacao = d.diaDaEstacao;
    mundo.clima = d.clima;
  },

  CHUVA_MOLHOU(mundo, ev, d) {
    // Chuva do dia: resolve toda sede pendente e marca ate quando chove.
    mundo.chuvaAte = d.ate;
    for (const her of Object.values(mundo.herdades)) {
      for (const t of her.tiles) if (t && t.problema === 'sede') t.problema = null;
    }
  },

  SOLO_MUDOU(mundo, ev, d) {
    const her = h(mundo, d.herdade);
    her.fertilidade = limita(her.fertilidade + (d.fertilidade ?? 0), 0, 100);
    her.poluicao = limita(her.poluicao + (d.poluicao ?? 0), 0, 100);
  },

  // Virada do dia: zera os contadores das missoes. (Energia e legado.)
  ENERGIA_RENOVADA(mundo, ev, d) {
    for (const id of Object.keys(d.energias)) {
      const p = j(mundo, id);
      if (!p) continue;
      p.energia = p.energiaMax = CONFIG.energiaMax;
      for (const k of Object.keys(p.hoje ?? {})) p.hoje[k] = 0;
      p.missoesFeitas = [];
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

  // Legado: eventos de versoes anteriores que ainda podem estar no log.
  REGOU() {},
  CRESCEU() {},
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
  const ref = { herdade: d.herdade, tile: d.tile, para: d.para ?? d.dono, cultura: d.cultura, quantidade: d.quantidade };
  mundo.feed.push({ seq: ev.seq, tick: ev.tick, tipo: ev.tipo, ator: ev.ator, texto: ev.texto, comuns: ev.comuns, ref });
  while (mundo.feed.length > CONFIG.feedMax) mundo.feed.shift();
}
