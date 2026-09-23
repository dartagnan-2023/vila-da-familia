import {
  CULTURAS, PRODUTOS, CONSTRUCOES, OBRAS, CONFIG, SPRITES, TEMPO, PROBLEMAS, MISSOES, XP,
  nivelDe, precoDe, nomeDe, xpDe, VENDINHA, EMOCOES,
} from './conteudo.js';
import { criarJogador, herdadeDe, herdadeLivre, vizinhas, temConstrucao, obraConcluida } from './mundo.js';
import { rngPara } from './rng.js';
import { estaMadura, duracaoProduto, rotuloDuracao } from './tempo.js';

// ---------------------------------------------------------------------------
// Regras: comando -> (validacao) -> lista de eventos.
// Nenhuma regra muta o mundo; quem muta e o reducer em aplicar.js.
//
// Nao existe energia. O que limita e: tempo (a planta demora), semente
// (custa moeda), canteiro (sao poucos) e o descanso das ferramentas.
// ---------------------------------------------------------------------------

const nome = (mundo, id) => mundo.jogadores[id]?.nome ?? id;
const nivel = (p) => nivelDe(p?.xp ?? 0);

function alvo(mundo, cmd) {
  return cmd.herdade ? mundo.herdades[cmd.herdade] : herdadeDe(mundo, cmd.por);
}

function checaBase(mundo, cmd) {
  if (!mundo.jogadores[cmd.por]) return 'jogador não está na vila';
  return null;
}

/** Faixa de preco permitida na vendinha para `qtd` unidades de `item`. */
export function faixaDePreco(item, qtd) {
  const base = precoDe(item) * qtd;
  return [Math.ceil(base * VENDINHA.precoMin), Math.floor(base * VENDINHA.precoMax)];
}

/** Quantos lotes essa pessoa pode ter na vendinha. */
export function lotesDe(mundo, p) {
  const her = mundo.herdades[p.herdade];
  return VENDINHA.lotes + (her && temConstrucao(her, 'estoque') ? VENDINHA.lotesCeleiro : 0);
}

/** Quanto rende uma colheita: aqui entram fertilidade, vizinhos e harmonia. */
function rendimento(mundo, her, tile) {
  const c = CULTURAS[tile.cultura];
  let base = c.rende + (obraConcluida(mundo, 'sabedoria') ? 1 : 0);
  let mult = 0.7 + 0.3 * (her.fertilidade / 100);
  if (vizinhas(mundo, her.id).some((v) => temConstrucao(v, 'poliniza'))) mult += 0.15;
  mult -= her.poluicao / 200;
  mult += c.estacoes.includes(mundo.estacao) ? 0.1 : -0.3;
  return Math.max(1, Math.round(base * Math.max(0.2, mult)));
}

function custoAgua(her, cultura) {
  const c = CULTURAS[cultura];
  const fator = temConstrucao(her, 'agua') ? 0.5 : 1;
  return Math.max(1, Math.round(c.agua * fator));
}

/** Descanso do machado/picareta: o unico "cansaco" que sobrou. */
function descansoDe(mundo, p, ferramenta) {
  const base = ferramenta === 'machado' ? TEMPO.descansoMachado : TEMPO.descansoPicareta;
  const her = mundo.herdades[p.herdade];
  return her && temConstrucao(her, 'ferramenta') ? base / 2 : base;
}

function ferramentaDescansando(mundo, p, ferramenta) {
  const ate = p.descanso?.[ferramenta] ?? 0;
  if (ate > mundo.agora) return `${ferramenta === 'machado' ? 'o machado' : 'a picareta'} descansa por mais ${rotuloDuracao(ate - mundo.agora)}`;
  return null;
}

// Pedidos que a planta vai fazer, sorteados na hora de plantar (deterministico).
function pedidosDaPlanta(mundo, cultura, herdadeId, tile) {
  const c = CULTURAS[cultura];
  if (c.minutos < TEMPO.pedidoMinimoMinutos) return [];
  const rnd = rngPara(mundo.semente, mundo.seq, `pedidos:${herdadeId}:${tile}`);
  const tipos = Object.keys(PROBLEMAS);
  const out = [{ em: TEMPO.pontosDePedido[0], tipo: tipos[Math.floor(rnd() * tipos.length)] }];
  if (rnd() < TEMPO.chanceSegundoPedido) out.push({ em: TEMPO.pontosDePedido[1], tipo: tipos[Math.floor(rnd() * tipos.length)] });
  return out;
}

// --- acoes reutilizaveis (usadas direto ou via AJUDAR) ----------------------

function eventoCuidar(mundo, { her, tile, ator }) {
  const t = her.tiles[tile];
  const prob = PROBLEMAS[t.problema];
  const gasto = prob.agua ? custoAgua(her, t.cultura) : 0;
  return {
    tipo: 'CUIDOU',
    ator,
    dados: { herdade: her.id, tile, problema: t.problema, dono: her.dono, xp: XP.cuidar },
    comuns: gasto ? { agua: -gasto } : null,
    texto: `${nome(mundo, ator)} ${prob.verbo} ${CULTURAS[t.cultura].nome.toLowerCase()} em ${her.nome}${gasto ? ` (-${gasto} de agua comum)` : ''}.`,
  };
}

function eventoColher(mundo, { her, tile, ator }) {
  const t = her.tiles[tile];
  const c = CULTURAS[t.cultura];
  const qtd = rendimento(mundo, her, t);
  return {
    tipo: 'COLHEU',
    ator,
    dados: { herdade: her.id, tile, dono: her.dono, cultura: t.cultura, quantidade: qtd, desgasteSolo: c.solo, xp: c.xp },
    comuns: { solo: -Math.round(c.solo / 2), ...(c.harmonia ? { harmonia: c.harmonia } : {}) },
    texto: `${nome(mundo, ator)} colheu ${qtd}x ${c.nome} em ${her.nome}.`,
  };
}

const temNoCeleiro = (p, itens) => Object.entries(itens).every(([k, q]) => (p.colheita[k] ?? 0) >= q);

// --- catalogo de comandos --------------------------------------------------

export const REGRAS = {
  ENTRAR: {
    valida(mundo, cmd) {
      if (mundo.jogadores[cmd.por]) return 'esse familiar já entrou';
      if (!herdadeLivre(mundo)) return 'a vila está lotada';
      if (!cmd.nome) return 'informe o nome';
      return null;
    },
    emite(mundo, cmd, rnd) {
      const her = herdadeLivre(mundo);
      const jogador = criarJogador({
        id: cmd.por, nome: cmd.nome,
        sprite: cmd.sprite ?? SPRITES[Math.floor(rnd() * SPRITES.length)],
        herdade: her.id,
      });
      const nomeHerdade = cmd.nomeHerdade ?? `Herdade ${cmd.nome}`;
      return [{
        tipo: 'JOGADOR_ENTROU',
        ator: cmd.por,
        dados: { jogador, nomeHerdade },
        comuns: { harmonia: 3 },
        texto: `${cmd.nome} chegou na vila e fincou a bandeira em ${nomeHerdade}.`,
      }];
    },
  },

  PLANTAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = alvo(mundo, cmd);
      const p = mundo.jogadores[cmd.por];
      if (!her) return 'herdade inexistente';
      if (her.dono !== cmd.por) return 'essa herdade não é sua';
      const c = CULTURAS[cmd.cultura];
      if (!c) return 'cultura desconhecida';
      if (nivel(p) < c.nivel) return `${c.nome} abre no nível ${c.nivel}`;
      if (cmd.tile == null || cmd.tile < 0 || cmd.tile >= her.tiles.length) return 'canteiro invalido';
      if (her.tiles[cmd.tile]) return 'canteiro ocupado';
      if (p.inventario.moedas < c.semente) return `semente custa ${c.semente} G`;
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const c = CULTURAS[cmd.cultura];
      return [{
        tipo: 'PLANTOU',
        ator: cmd.por,
        dados: {
          herdade: her.id, tile: cmd.tile, cultura: cmd.cultura, dono: her.dono, custoSemente: c.semente, xp: XP.plantar,
          pedidos: pedidosDaPlanta(mundo, cmd.cultura, her.id, cmd.tile),
        },
        comuns: c.poliniza ? { harmonia: 1 } : null,
        texto: `${nome(mundo, cmd.por)} plantou ${c.nome.toLowerCase()} em ${her.nome}.`,
      }];
    },
  },

  // A planta pediu (sede/praga/mato) e alguem atende. Na propria herdade.
  CUIDAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = alvo(mundo, cmd);
      if (!her || her.dono !== cmd.por) return 'essa herdade não é sua';
      const t = her.tiles[cmd.tile];
      if (!t) return 'não há nada plantado aí';
      if (!t.problema) return estaMadura(t) ? 'já está pronta — é só colher' : 'essa planta está bem';
      if (PROBLEMAS[t.problema].agua && mundo.comuns.agua < custoAgua(her, t.cultura)) return 'o rio comum secou';
      return null;
    },
    emite(mundo, cmd) {
      return [eventoCuidar(mundo, { her: alvo(mundo, cmd), tile: cmd.tile, ator: cmd.por })];
    },
  },
  // Nome antigo no log: continua valendo como CUIDAR.
  REGAR: {
    valida(mundo, cmd) { return REGRAS.CUIDAR.valida(mundo, cmd); },
    emite(mundo, cmd) { return REGRAS.CUIDAR.emite(mundo, cmd); },
  },

  COLHER: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = alvo(mundo, cmd);
      if (!her || her.dono !== cmd.por) return 'essa herdade não é sua';
      const t = her.tiles[cmd.tile];
      if (!t) return 'não há nada plantado aí';
      if (!estaMadura(t)) return 'ainda não está no ponto';
      return null;
    },
    emite(mundo, cmd) {
      return [eventoColher(mundo, { her: alvo(mundo, cmd), tile: cmd.tile, ator: cmd.por })];
    },
  },

  // O comando que define o jogo: trabalhar na terra do outro.
  AJUDAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = mundo.herdades[cmd.herdade];
      if (!her || !her.dono) return 'herdade sem dono';
      if (her.dono === cmd.por) return 'na sua propria terra isso se chama trabalho';
      const acao = cmd.acao === 'REGAR' ? 'CUIDAR' : cmd.acao;
      if (!['CUIDAR', 'COLHER'].includes(acao)) return 'só dá para ajudar cuidando ou colhendo';
      const t = her.tiles[cmd.tile];
      if (!t) return 'não há nada plantado aí';
      if (acao === 'CUIDAR' && !t.problema) return 'essa planta está bem';
      if (acao === 'CUIDAR' && PROBLEMAS[t.problema].agua && mundo.comuns.agua < custoAgua(her, t.cultura)) return 'o rio comum secou';
      if (acao === 'COLHER' && !estaMadura(t)) return 'ainda não está no ponto';
      return null;
    },
    emite(mundo, cmd) {
      const her = mundo.herdades[cmd.herdade];
      const acao = cmd.acao === 'REGAR' ? 'CUIDAR' : cmd.acao;
      const ato = acao === 'CUIDAR'
        ? eventoCuidar(mundo, { her, tile: cmd.tile, ator: cmd.por })
        : eventoColher(mundo, { her, tile: cmd.tile, ator: cmd.por });
      return [
        {
          tipo: 'AJUDOU',
          ator: cmd.por,
          dados: { herdade: her.id, dono: her.dono, acao, xp: XP.ajudar },
          comuns: { harmonia: 2 },
          texto: `${nome(mundo, cmd.por)} foi ajudar ${nome(mundo, her.dono)} em ${her.nome}.`,
        },
        ato,
      ];
    },
  },

  // Nao faz nada no mundo: existe para levar a data/hora local para o log.
  ACORDAR: {
    valida(mundo, cmd) { return checaBase(mundo, cmd); },
    emite() { return []; },
  },

  ABRACAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      if (!mundo.jogadores[cmd.para]) return 'esse familiar não está na vila';
      if (cmd.para === cmd.por) return 'abraço em si mesmo não conta';
      if (mundo.jogadores[cmd.por].gestos?.[cmd.para] === mundo.tick) return 'já abraçou essa pessoa hoje';
      return null;
    },
    emite(mundo, cmd) {
      return [{
        tipo: 'ABRACOU',
        ator: cmd.por,
        dados: { para: cmd.para, xp: XP.abraco },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} mandou um abraço para ${nome(mundo, cmd.para)}.`,
      }];
    },
  },

  // O jogo pergunta, a pessoa responde com uma batida. Vira dado, vira mudanca.
  SENTIR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      if (!EMOCOES[cmd.emocao]) return 'escolha como você se sentiu';
      if ((cmd.texto ?? '').length > 200) return 'texto muito longo (máx 200)';
      return null;
    },
    emite(mundo, cmd) {
      const e = EMOCOES[cmd.emocao];
      const texto = (cmd.texto ?? '').trim().slice(0, 200);
      const sobre = (cmd.sobre ?? '').slice(0, 40);
      return [{
        tipo: 'SENTIU',
        ator: cmd.por,
        dados: { emocao: cmd.emocao, sobre, texto, xp: XP.sentir },
        texto: texto ? `${nome(mundo, cmd.por)}: ${e.icone} "${texto}"` : `${nome(mundo, cmd.por)} reagiu ${e.icone}${sobre ? ` a ${sobre}` : ''}.`,
      }];
    },
  },

  RECADO: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const t = (cmd.texto ?? '').trim();
      if (!t) return 'escreva alguma coisa';
      if (t.length > 140) return 'recado muito longo (max 140)';
      if (cmd.para && !mundo.jogadores[cmd.para]) return 'esse familiar não está na vila';
      if (cmd.para === cmd.por) return 'recado pra si mesmo não vale';
      return null;
    },
    emite(mundo, cmd) {
      const t = cmd.texto.trim().slice(0, 140);
      return [{
        tipo: 'RECADO',
        ator: cmd.por,
        dados: { texto: t, para: cmd.para || undefined, xp: XP.recado },
        texto: cmd.para ? `${nome(mundo, cmd.por)} → ${nome(mundo, cmd.para)}: "${t}"` : `${nome(mundo, cmd.por)}: "${t}"`,
      }];
    },
  },

  CORTAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      if (mundo.comuns.floresta <= 0) return 'não sobrou nenhuma árvore';
      return ferramentaDescansando(mundo, mundo.jogadores[cmd.por], 'machado');
    },
    emite(mundo, cmd, rnd) {
      const p = mundo.jogadores[cmd.por];
      // 4 a 6, mais 1 a cada 4 niveis, mais 1 se a mata esta farta (>= 80).
      const madeira = Math.min(12, 4 + Math.floor(rnd() * 3) + Math.floor(nivel(p) / 4) + (mundo.comuns.floresta >= 80 ? 1 : 0));
      return [{
        tipo: 'CORTOU_ARVORE',
        ator: cmd.por,
        dados: { madeira, xp: XP.cortar, descansaAte: mundo.agora + descansoDe(mundo, p, 'machado') },
        comuns: { floresta: -3 },
        texto: `${nome(mundo, cmd.por)} derrubou árvores e levou ${madeira} de madeira (-3 de floresta).`,
      }];
    },
  },

  PLANTAR_ARVORE: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      if (mundo.jogadores[cmd.por].inventario.madeira < 1) return 'precisa de 1 de madeira para as mudas';
      return null;
    },
    emite(mundo, cmd) {
      return [{
        tipo: 'PLANTOU_ARVORE',
        ator: cmd.por,
        dados: { custoMadeira: 1, xp: XP.arvore },
        comuns: { floresta: 4, harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} plantou mudas na mata comum (+4 de floresta).`,
      }];
    },
  },

  MINERAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      return ferramentaDescansando(mundo, mundo.jogadores[cmd.por], 'picareta');
    },
    emite(mundo, cmd, rnd) {
      const p = mundo.jogadores[cmd.por];
      const pedra = Math.min(10, 3 + Math.floor(rnd() * 3) + Math.floor(nivel(mundo.jogadores[cmd.por]) / 5));
      return [{
        tipo: 'MINEROU',
        ator: cmd.por,
        dados: { pedra, xp: XP.minerar, descansaAte: mundo.agora + descansoDe(mundo, p, 'picareta') },
        comuns: { solo: -1 },
        texto: `${nome(mundo, cmd.por)} tirou ${pedra} de pedra da encosta.`,
      }];
    },
  },

  CONSTRUIR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = alvo(mundo, cmd);
      const p = mundo.jogadores[cmd.por];
      if (!her || her.dono !== cmd.por) return 'essa herdade não é sua';
      const b = CONSTRUCOES[cmd.construcao];
      if (!b) return 'construção desconhecida';
      if (nivel(p) < b.nivel) return `${b.nome} abre no nível ${b.nivel}`;
      if (her.construcoes.includes(b.efeito)) return 'já existe uma dessas aqui';
      if (her.construcoes.length >= CONFIG.construcoesPorHerdade) return 'a herdade está cheia';
      for (const [rec, qtd] of Object.entries(b.custo)) {
        if ((p.inventario[rec] ?? 0) < qtd) return `faltam ${qtd - (p.inventario[rec] ?? 0)} de ${rec}`;
      }
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const b = CONSTRUCOES[cmd.construcao];
      return [{
        tipo: 'CONSTRUIU',
        ator: cmd.por,
        dados: { herdade: her.id, efeito: b.efeito, custo: b.custo, xp: XP.construir },
        comuns: b.poluicao ? { harmonia: -1 } : { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} construiu ${b.nome} em ${her.nome}. ${b.texto}`,
      }];
    },
  },

  // --- producao: o segundo loop -------------------------------------------
  PRODUZIR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = herdadeDe(mundo, cmd.por);
      const prod = PRODUTOS[cmd.produto];
      if (!prod) return 'produto desconhecido';
      if (!her.construcoes.includes(prod.maquina)) return `precisa de ${CONSTRUCOES[prod.maquina].nome}`;
      if (her.producao?.[prod.maquina]) return `${CONSTRUCOES[prod.maquina].nome} ja está ocupado`;
      if (!temNoCeleiro(mundo.jogadores[cmd.por], prod.entrada)) {
        return `precisa de ${Object.entries(prod.entrada).map(([k, q]) => `${q} ${nomeDe(k).toLowerCase()}`).join(' + ')}`;
      }
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const prod = PRODUTOS[cmd.produto];
      return [{
        tipo: 'PRODUZINDO',
        ator: cmd.por,
        dados: { herdade: her.id, maquina: prod.maquina, produto: cmd.produto, entrada: prod.entrada, prontoEm: mundo.agora + duracaoProduto(cmd.produto) },
        texto: `${nome(mundo, cmd.por)} pos ${prod.nome.toLowerCase()} para fazer no ${CONSTRUCOES[prod.maquina].nome.toLowerCase()}.`,
      }];
    },
  },

  RECOLHER: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = herdadeDe(mundo, cmd.por);
      const em = her.producao?.[cmd.maquina];
      if (!em) return 'não tem nada nessa máquina';
      if (em.prontoEm > mundo.agora) return `fica pronto em ${rotuloDuracao(em.prontoEm - mundo.agora)}`;
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const em = her.producao[cmd.maquina];
      return [{
        tipo: 'PRODUZIU',
        ator: cmd.por,
        dados: { herdade: her.id, maquina: cmd.maquina, produto: em.produto, xp: xpDe(em.produto) },
        texto: `${nome(mundo, cmd.por)} tirou ${nomeDe(em.produto).toLowerCase()} do ${CONSTRUCOES[cmd.maquina].nome.toLowerCase()}.`,
      }];
    },
  },

  // --- encomendas: o objetivo de curto prazo --------------------------------
  CUMPRIR_ENCOMENDA: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const p = mundo.jogadores[cmd.por];
      const enc = p.encomendas?.[cmd.indice];
      if (!enc) return 'encomenda inexistente';
      if (!temNoCeleiro(p, enc.itens)) return 'ainda faltam itens no celeiro';
      return null;
    },
    emite(mundo, cmd) {
      const p = mundo.jogadores[cmd.por];
      const enc = p.encomendas[cmd.indice];
      const nova = gerarEncomenda(mundo, p, p.encomendasGeradas);
      return [{
        tipo: 'ENCOMENDA_ENTREGUE',
        ator: cmd.por,
        dados: { indice: cmd.indice, cliente: enc.cliente, itens: enc.itens, moedas: enc.moedas, xp: enc.xp, nova },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} entregou a encomenda de ${enc.cliente} (+${enc.moedas} G, +${enc.xp} XP).`,
      }];
    },
  },

  COMPRAR_CANTEIRO: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = herdadeDe(mundo, cmd.por);
      if (her.tiles.length >= CONFIG.canteirosMax) return 'a herdade ja está no tamanho máximo';
      const preco = CONFIG.precoCanteiro[her.tiles.length - CONFIG.tilesPorHerdade];
      if (mundo.jogadores[cmd.por].inventario.moedas < preco) return `custa ${preco} moedas`;
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const preco = CONFIG.precoCanteiro[her.tiles.length - CONFIG.tilesPorHerdade];
      return [{
        tipo: 'CANTEIRO_COMPRADO',
        ator: cmd.por,
        dados: { herdade: her.id, preco },
        texto: `${nome(mundo, cmd.por)} abriu mais um canteiro em ${her.nome} (${preco} moedas).`,
      }];
    },
  },

  CUMPRIR_MISSAO: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const missao = missoesDoDia(mundo)[cmd.indice];
      if (!missao) return 'missao inexistente';
      const p = mundo.jogadores[cmd.por];
      if ((p.missoesFeitas ?? []).includes(cmd.indice)) return 'premio ja recebido hoje';
      if ((p.hoje?.[missao.chave] ?? 0) < missao.meta) return 'ainda não cumpriu';
      return null;
    },
    emite(mundo, cmd) {
      const missao = missoesDoDia(mundo)[cmd.indice];
      return [{
        tipo: 'MISSAO_CUMPRIDA',
        ator: cmd.por,
        dados: { indice: cmd.indice, premio: missao.premio, xp: XP.missao },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} cumpriu a missao "${missao.texto}" (+${missao.premio.moedas} G).`,
      }];
    },
  },

  DEMOLIR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const her = alvo(mundo, cmd);
      if (!her || her.dono !== cmd.por) return 'essa herdade não é sua';
      const b = CONSTRUCOES[cmd.construcao];
      if (!b) return 'construção desconhecida';
      if (!her.construcoes.includes(b.efeito)) return 'não tem isso na sua herdade';
      if (her.producao?.[b.efeito]) return 'tem coisa fazendo aí dentro — recolha antes';
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const b = CONSTRUCOES[cmd.construcao];
      const devolve = Object.fromEntries(Object.entries(b.custo).map(([r, q]) => [r, Math.floor(q / 2)]));
      return [{
        tipo: 'DEMOLIU',
        ator: cmd.por,
        dados: { herdade: her.id, efeito: b.efeito, devolve },
        texto: `${nome(mundo, cmd.por)} desmanchou ${b.nome} em ${her.nome} e recuperou ${resumo(devolve)}.`,
      }];
    },
  },

  VENDER: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const p = mundo.jogadores[cmd.por];
      if (!precoDe(cmd.cultura)) return 'item desconhecido';
      if (!(cmd.quantidade > 0)) return 'quantidade inválida';
      if ((p.colheita[cmd.cultura] ?? 0) < cmd.quantidade) return 'você não tem essa quantidade';
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const bonus = temConstrucao(her, 'estoque') ? 1.2 : 1;
      const moedas = Math.round(precoDe(cmd.cultura) * cmd.quantidade * bonus);
      return [{
        tipo: 'VENDEU',
        ator: cmd.por,
        dados: { cultura: cmd.cultura, quantidade: cmd.quantidade, moedas },
        texto: `${nome(mundo, cmd.por)} vendeu ${cmd.quantidade}x ${nomeDe(cmd.cultura)} por ${moedas} moedas.`,
      }];
    },
  },

  // --- vendinha: o que sobra de um vira a encomenda do outro ---------------
  ANUNCIAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const p = mundo.jogadores[cmd.por];
      const base = precoDe(cmd.item);
      if (!base) return 'item desconhecido';
      const qtd = Number(cmd.quantidade), preco = Number(cmd.preco);
      if (!(qtd > 0 && qtd <= VENDINHA.qtdMax && Number.isInteger(qtd))) return `quantidade de 1 a ${VENDINHA.qtdMax}`;
      if ((p.colheita[cmd.item] ?? 0) < qtd) return 'você não tem essa quantidade';
      const [min, max] = faixaDePreco(cmd.item, qtd);
      if (!(preco >= min && preco <= max && Number.isInteger(preco))) return `preco entre ${min} e ${max} G`;
      if ((p.vendinha ?? []).length >= lotesDe(mundo, p)) return 'sua vendinha está cheia — retire ou espere vender';
      return null;
    },
    emite(mundo, cmd) {
      const p = mundo.jogadores[cmd.por];
      const qtd = Number(cmd.quantidade), preco = Number(cmd.preco);
      return [{
        tipo: 'ANUNCIOU',
        ator: cmd.por,
        dados: { lote: p.vendinhaSeq ?? 0, item: cmd.item, qtd, preco, xp: XP.anunciar },
        texto: `${nome(mundo, cmd.por)} pos ${qtd}x ${nomeDe(cmd.item)} na vendinha por ${preco} G.`,
      }];
    },
  },

  RETIRAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const p = mundo.jogadores[cmd.por];
      if (!(p.vendinha ?? []).some((l) => l.id === Number(cmd.lote))) return 'esse lote já saiu da vendinha';
      return null;
    },
    emite(mundo, cmd) {
      const l = mundo.jogadores[cmd.por].vendinha.find((x) => x.id === Number(cmd.lote));
      return [{ tipo: 'RETIROU', ator: cmd.por, dados: { lote: l.id, item: l.item, qtd: l.qtd }, texto: null }];
    },
  },

  COMPRAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const de = mundo.jogadores[cmd.de];
      if (!de) return 'esse familiar não está na vila';
      if (cmd.de === cmd.por) return 'comprar de si mesmo não vale — retire o lote';
      const l = (de.vendinha ?? []).find((x) => x.id === Number(cmd.lote));
      if (!l) return 'já vendido — alguém chegou antes';
      if (mundo.jogadores[cmd.por].inventario.moedas < l.preco) return `faltam ${l.preco - mundo.jogadores[cmd.por].inventario.moedas} G`;
      return null;
    },
    emite(mundo, cmd) {
      const l = mundo.jogadores[cmd.de].vendinha.find((x) => x.id === Number(cmd.lote));
      return [{
        tipo: 'COMPROU',
        ator: cmd.por,
        dados: { de: cmd.de, para: cmd.de, lote: l.id, item: l.item, qtd: l.qtd, preco: l.preco, xp: XP.comprar },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} comprou ${l.qtd}x ${nomeDe(l.item)} de ${nome(mundo, cmd.de)} por ${l.preco} G.`,
      }];
    },
  },

  PRESENTEAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const de = mundo.jogadores[cmd.por];
      if (!mundo.jogadores[cmd.para]) return 'esse familiar não está na vila';
      if (cmd.para === cmd.por) return 'presentear a si mesmo não vale';
      if (!(cmd.quantidade > 0)) return 'quantidade inválida';
      if (cmd.recurso === 'colheita') {
        if ((de.colheita[cmd.item] ?? 0) < cmd.quantidade) return 'você não tem isso no celeiro';
      } else if ((de.inventario[cmd.recurso] ?? 0) < cmd.quantidade) {
        return 'você não tem esse recurso';
      }
      return null;
    },
    emite(mundo, cmd) {
      const que = cmd.recurso === 'colheita' ? nomeDe(cmd.item) : cmd.recurso;
      return [{
        tipo: 'PRESENTEOU',
        ator: cmd.por,
        dados: { para: cmd.para, recurso: cmd.recurso, item: cmd.item, quantidade: cmd.quantidade, xp: XP.presente },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} deu ${cmd.quantidade}x ${que} para ${nome(mundo, cmd.para)}.`,
      }];
    },
  },

  DOAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const obra = OBRAS[cmd.obra];
      if (!obra) return 'obra desconhecida';
      if (mundo.vila.concluidas.includes(obra.bonus)) return 'essa obra já ficou pronta';
      const inv = mundo.jogadores[cmd.por].inventario;
      const rec = cmd.recursos ?? {};
      if (!Object.keys(rec).length) return 'doe alguma coisa';
      for (const [k, qtd] of Object.entries(rec)) {
        if (!(qtd > 0)) return 'quantidade inválida';
        if (!(k in obra.custo)) return `${k} não serve para essa obra`;
        if ((inv[k] ?? 0) < qtd) return `você não tem ${qtd} de ${k}`;
      }
      return null;
    },
    emite(mundo, cmd) {
      const obra = OBRAS[cmd.obra];
      const atual = mundo.vila.obras[cmd.obra]?.progresso ?? {};
      const eventos = [{
        tipo: 'DOOU',
        ator: cmd.por,
        dados: { obra: cmd.obra, recursos: cmd.recursos, xp: XP.doar },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} doou ${resumo(cmd.recursos)} para a ${obra.nome} da vila.`,
      }];
      const pronto = Object.entries(obra.custo).every(
        ([rec, alvo]) => (atual[rec] ?? 0) + (cmd.recursos[rec] ?? 0) >= alvo
      );
      if (pronto) {
        eventos.push({
          tipo: 'OBRA_CONCLUIDA',
          ator: cmd.por,
          dados: { obra: cmd.obra, bonus: obra.bonus },
          comuns: { harmonia: 10 },
          texto: `A ${obra.nome} ficou pronta! ${obra.texto}`,
        });
      }
      return eventos;
    },
  },
};

const resumo = (rec) => Object.entries(rec).map(([k, v]) => `${v} de ${k}`).join(' e ');

/** As 3 missoes de hoje: sorteio deterministico por semente + dia. */
export function missoesDoDia(mundo) {
  const rnd = rngPara(mundo.semente, mundo.tick, 'missoes');
  const sorteadas = [...MISSOES];
  for (let i = sorteadas.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [sorteadas[i], sorteadas[j]] = [sorteadas[j], sorteadas[i]];
  }
  const out = [];
  for (const m of sorteadas) {
    if (out.some((o) => o.chave === m.chave)) continue;
    out.push(m);
    if (out.length === 3) break;
  }
  return out;
}

export const CLIENTES = ['a Padaria da Esquina', 'o Mercadinho', 'a Feira de Domingo', 'a Escola', 'o Restaurante do Zé', 'a Igreja', 'a Pousada', 'a Quermesse'];

/**
 * Uma encomenda para este jogador: pede o que ele JA consegue produzir no
 * nivel atual, paga 50% acima do preco de balcao, mais XP.
 */
export function gerarEncomenda(mundo, p, n) {
  const rnd = rngPara(mundo.semente, n, `encomenda:${p.id}`);
  const nv = nivel(p);
  const her = mundo.herdades[p.herdade];
  const opcoes = Object.keys(CULTURAS).filter((k) => CULTURAS[k].nivel <= nv);
  for (const [k, prod] of Object.entries(PRODUTOS)) if (her?.construcoes.includes(prod.maquina)) opcoes.push(k);
  const quantos = 1 + Math.floor(rnd() * Math.min(3, opcoes.length));
  const itens = {};
  for (let i = 0; i < quantos; i++) {
    const k = opcoes[Math.floor(rnd() * opcoes.length)];
    const base = CULTURAS[k] ? 2 + Math.floor(rnd() * 5) : 1 + Math.floor(rnd() * 2);
    itens[k] = (itens[k] ?? 0) + base;
  }
  const valor = Object.entries(itens).reduce((s, [k, q]) => s + precoDe(k) * q, 0);
  const xp = Object.entries(itens).reduce((s, [k, q]) => s + xpDe(k) * q, XP.encomendaBase);
  return { id: n, cliente: CLIENTES[Math.floor(rnd() * CLIENTES.length)], itens, moedas: Math.round(valor * 1.5), xp };
}

export { rendimento, custoAgua };
