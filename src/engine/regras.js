import { CULTURAS, CONSTRUCOES, OBRAS, CUSTO_ENERGIA, CONFIG, SPRITES } from './conteudo.js';
import { criarJogador, herdadeDe, herdadeLivre, vizinhas, temConstrucao, obraConcluida } from './mundo.js';

// ---------------------------------------------------------------------------
// Regras: comando -> (validacao) -> lista de eventos.
// Nenhuma regra muta o mundo; quem muta e o reducer em aplicar.js.
// Cada evento declara seu impacto nos comuns, porque no fim das contas o jogo
// inteiro e sobre isso: o que eu faco hoje aparece na colheita do meu irmao.
// ---------------------------------------------------------------------------

const nome = (mundo, id) => mundo.jogadores[id]?.nome ?? id;

function energiaDe(mundo, tipo, herdade) {
  const base = CUSTO_ENERGIA[tipo] ?? 0;
  if (base === 0) return 0;
  return herdade && temConstrucao(herdade, 'ferramenta') ? Math.max(1, base - 1) : base;
}

function alvo(mundo, cmd) {
  return cmd.herdade ? mundo.herdades[cmd.herdade] : herdadeDe(mundo, cmd.por);
}

function checaBase(mundo, cmd, { energia = 0 } = {}) {
  const p = mundo.jogadores[cmd.por];
  if (!p) return 'jogador nao esta na vila';
  if (p.energia < energia) return `energia insuficiente (precisa de ${energia})`;
  return null;
}

/** Quanto rende uma colheita: aqui entram fertilidade, vizinhos e harmonia. */
function rendimento(mundo, her, tile) {
  const c = CULTURAS[tile.cultura];
  let base = 2 + (obraConcluida(mundo, 'sabedoria') ? 1 : 0);
  let mult = 0.6 + 0.4 * (her.fertilidade / 100);
  if (vizinhas(mundo, her.id).some((v) => temConstrucao(v, 'poliniza'))) mult += 0.15;
  mult -= her.poluicao / 200;
  mult -= Math.min(0.5, tile.estresse * 0.1);
  mult += c.estacoes.includes(mundo.estacao) ? 0.2 : -0.2;
  mult += (mundo.comuns.harmonia - 50) / 250;
  return Math.max(1, Math.round(base * Math.max(0.2, mult)));
}

function custoAgua(her, cultura) {
  const c = CULTURAS[cultura];
  const fator = temConstrucao(her, 'agua') ? 0.5 : 1;
  return Math.max(1, Math.round(c.agua * fator * 0.6));
}

// --- acoes reutilizaveis (usadas direto ou via AJUDAR) ----------------------

function eventoRegar(mundo, { her, tile, ator, energia }) {
  const t = her.tiles[tile];
  const gasto = custoAgua(her, t.cultura);
  return {
    tipo: 'REGOU',
    ator,
    dados: { herdade: her.id, tile, energia },
    comuns: { agua: -gasto },
    texto: `${nome(mundo, ator)} regou ${CULTURAS[t.cultura].nome.toLowerCase()} em ${her.nome} (-${gasto} de agua comum).`,
  };
}

function eventoColher(mundo, { her, tile, ator, energia }) {
  const t = her.tiles[tile];
  const c = CULTURAS[t.cultura];
  const qtd = rendimento(mundo, her, t);
  return {
    tipo: 'COLHEU',
    ator,
    dados: { herdade: her.id, tile, dono: her.dono, cultura: t.cultura, quantidade: qtd, desgasteSolo: c.solo, energia },
    comuns: { solo: -Math.round(c.solo / 2), ...(c.harmonia ? { harmonia: c.harmonia } : {}) },
    texto: `${nome(mundo, ator)} colheu ${qtd}x ${c.nome} em ${her.nome}.`,
  };
}

// --- catalogo de comandos --------------------------------------------------

export const REGRAS = {
  ENTRAR: {
    valida(mundo, cmd) {
      if (mundo.jogadores[cmd.por]) return 'esse familiar ja entrou';
      if (!herdadeLivre(mundo)) return 'a vila esta lotada';
      if (!cmd.nome) return 'informe o nome';
      return null;
    },
    emite(mundo, cmd, rnd) {
      const her = herdadeLivre(mundo);
      const jogador = criarJogador({
        id: cmd.por,
        nome: cmd.nome,
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
      const her = alvo(mundo, cmd);
      const p = mundo.jogadores[cmd.por];
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'PLANTAR', her) });
      if (erro) return erro;
      if (!her) return 'herdade inexistente';
      if (her.dono !== cmd.por) return 'essa herdade nao e sua';
      if (!CULTURAS[cmd.cultura]) return 'cultura desconhecida';
      if (cmd.tile == null || cmd.tile < 0 || cmd.tile >= CONFIG.tilesPorHerdade) return 'canteiro invalido';
      if (her.tiles[cmd.tile]) return 'canteiro ocupado';
      if (p.inventario.moedas < CULTURAS[cmd.cultura].semente) return 'moedas insuficientes para a semente';
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const c = CULTURAS[cmd.cultura];
      return [{
        tipo: 'PLANTOU',
        ator: cmd.por,
        dados: { herdade: her.id, tile: cmd.tile, cultura: cmd.cultura, dono: her.dono, custoSemente: c.semente, energia: energiaDe(mundo, 'PLANTAR', her) },
        comuns: c.poliniza ? { harmonia: 1 } : null,
        texto: `${nome(mundo, cmd.por)} plantou ${c.nome.toLowerCase()} em ${her.nome}.`,
      }];
    },
  },

  REGAR: {
    valida(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'REGAR', her) });
      if (erro) return erro;
      if (!her || her.dono !== cmd.por) return 'essa herdade nao e sua';
      const t = her.tiles[cmd.tile];
      if (!t) return 'nao ha nada plantado ai';
      if (t.regadoEm === mundo.tick) return 'ja foi regado hoje';
      if (mundo.comuns.agua < custoAgua(her, t.cultura)) return 'o poco comum secou';
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      return [eventoRegar(mundo, { her, tile: cmd.tile, ator: cmd.por, energia: energiaDe(mundo, 'REGAR', her) })];
    },
  },

  COLHER: {
    valida(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'COLHER', her) });
      if (erro) return erro;
      if (!her || her.dono !== cmd.por) return 'essa herdade nao e sua';
      const t = her.tiles[cmd.tile];
      if (!t) return 'nao ha nada plantado ai';
      if (t.idade < CULTURAS[t.cultura].dias) return 'ainda nao esta no ponto';
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      return [eventoColher(mundo, { her, tile: cmd.tile, ator: cmd.por, energia: energiaDe(mundo, 'COLHER', her) })];
    },
  },

  // O comando que define o jogo: trabalhar na terra do outro.
  AJUDAR: {
    valida(mundo, cmd) {
      const minha = herdadeDe(mundo, cmd.por);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'AJUDAR', minha) });
      if (erro) return erro;
      const her = mundo.herdades[cmd.herdade];
      if (!her || !her.dono) return 'herdade sem dono';
      if (her.dono === cmd.por) return 'na sua propria terra isso se chama trabalho';
      if (!['REGAR', 'COLHER'].includes(cmd.acao)) return 'so da para ajudar regando ou colhendo';
      const t = her.tiles[cmd.tile];
      if (!t) return 'nao ha nada plantado ai';
      if (cmd.acao === 'REGAR' && t.regadoEm === mundo.tick) return 'ja foi regado hoje';
      if (cmd.acao === 'REGAR' && mundo.comuns.agua < custoAgua(her, t.cultura)) return 'o poco comum secou';
      if (cmd.acao === 'COLHER' && t.idade < CULTURAS[t.cultura].dias) return 'ainda nao esta no ponto';
      return null;
    },
    emite(mundo, cmd) {
      const minha = herdadeDe(mundo, cmd.por);
      const her = mundo.herdades[cmd.herdade];
      const energia = energiaDe(mundo, 'AJUDAR', minha);
      const acao = cmd.acao === 'REGAR'
        ? eventoRegar(mundo, { her, tile: cmd.tile, ator: cmd.por, energia: 0 })
        : eventoColher(mundo, { her, tile: cmd.tile, ator: cmd.por, energia: 0 });
      return [
        {
          tipo: 'AJUDOU',
          ator: cmd.por,
          dados: { herdade: her.id, dono: her.dono, acao: cmd.acao, energia },
          comuns: { harmonia: 2 },
          texto: `${nome(mundo, cmd.por)} foi ajudar ${nome(mundo, her.dono)} em ${her.nome}.`,
        },
        acao,
      ];
    },
  },

  // Gestos que nao custam energia: o barato que segura a familia junta.
  ABRACAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      if (!mundo.jogadores[cmd.para]) return 'esse familiar nao esta na vila';
      if (cmd.para === cmd.por) return 'abraco em si mesmo nao conta';
      if (mundo.jogadores[cmd.por].gestos?.[cmd.para] === mundo.tick) return 'ja abracou essa pessoa hoje';
      return null;
    },
    emite(mundo, cmd) {
      return [{
        tipo: 'ABRACOU',
        ator: cmd.por,
        dados: { para: cmd.para },
        comuns: { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} mandou um abraco para ${nome(mundo, cmd.para)}.`,
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
      return null;
    },
    emite(mundo, cmd) {
      return [{
        tipo: 'RECADO',
        ator: cmd.por,
        dados: { texto: cmd.texto.trim().slice(0, 140) },
        texto: `${nome(mundo, cmd.por)}: "${cmd.texto.trim().slice(0, 140)}"`,
      }];
    },
  },

  CORTAR: {
    valida(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'CORTAR', her) });
      if (erro) return erro;
      if (mundo.comuns.floresta <= 0) return 'nao sobrou nenhuma arvore';
      return null;
    },
    emite(mundo, cmd, rnd) {
      const her = herdadeDe(mundo, cmd.por);
      const madeira = 3 + Math.floor(rnd() * 3);
      return [{
        tipo: 'CORTOU_ARVORE',
        ator: cmd.por,
        dados: { madeira, energia: energiaDe(mundo, 'CORTAR', her) },
        comuns: { floresta: -3 },
        texto: `${nome(mundo, cmd.por)} derrubou arvores e levou ${madeira} de madeira (-3 de floresta).`,
      }];
    },
  },

  PLANTAR_ARVORE: {
    valida(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'PLANTAR_ARVORE', her) });
      if (erro) return erro;
      if (mundo.jogadores[cmd.por].inventario.madeira < 2) return 'precisa de 2 de madeira para as mudas';
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      return [{
        tipo: 'PLANTOU_ARVORE',
        ator: cmd.por,
        dados: { custoMadeira: 2, energia: energiaDe(mundo, 'PLANTAR_ARVORE', her) },
        comuns: { floresta: 4, harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} plantou mudas na mata comum (+4 de floresta).`,
      }];
    },
  },

  MINERAR: {
    valida(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      return checaBase(mundo, cmd, { energia: energiaDe(mundo, 'MINERAR', her) });
    },
    emite(mundo, cmd, rnd) {
      const her = herdadeDe(mundo, cmd.por);
      const pedra = 2 + Math.floor(rnd() * 3);
      return [{
        tipo: 'MINEROU',
        ator: cmd.por,
        dados: { pedra, energia: energiaDe(mundo, 'MINERAR', her) },
        comuns: { solo: -1 },
        texto: `${nome(mundo, cmd.por)} tirou ${pedra} de pedra da encosta.`,
      }];
    },
  },

  CONSTRUIR: {
    valida(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const erro = checaBase(mundo, cmd, { energia: energiaDe(mundo, 'CONSTRUIR', her) });
      if (erro) return erro;
      if (!her || her.dono !== cmd.por) return 'essa herdade nao e sua';
      const b = CONSTRUCOES[cmd.construcao];
      if (!b) return 'construcao desconhecida';
      if (her.construcoes.includes(b.efeito)) return 'ja existe uma dessas aqui';
      if (her.construcoes.length >= CONFIG.construcoesPorHerdade) return 'a herdade esta cheia';
      const inv = mundo.jogadores[cmd.por].inventario;
      for (const [rec, qtd] of Object.entries(b.custo)) {
        if ((inv[rec] ?? 0) < qtd) return `faltam ${qtd - (inv[rec] ?? 0)} de ${rec}`;
      }
      return null;
    },
    emite(mundo, cmd) {
      const her = alvo(mundo, cmd);
      const b = CONSTRUCOES[cmd.construcao];
      return [{
        tipo: 'CONSTRUIU',
        ator: cmd.por,
        dados: { herdade: her.id, efeito: b.efeito, custo: b.custo, energia: energiaDe(mundo, 'CONSTRUIR', her) },
        comuns: b.poluicao ? { harmonia: -1 } : { harmonia: 1 },
        texto: `${nome(mundo, cmd.por)} construiu ${b.nome} em ${her.nome}. ${b.texto}`,
      }];
    },
  },

  VENDER: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const p = mundo.jogadores[cmd.por];
      if (!CULTURAS[cmd.cultura]) return 'cultura desconhecida';
      if ((p.colheita[cmd.cultura] ?? 0) < cmd.quantidade) return 'voce nao tem essa quantidade';
      return null;
    },
    emite(mundo, cmd) {
      const her = herdadeDe(mundo, cmd.por);
      const c = CULTURAS[cmd.cultura];
      const bonus = temConstrucao(her, 'estoque') ? 1.2 : 1;
      const moedas = Math.round(c.preco * cmd.quantidade * bonus);
      return [{
        tipo: 'VENDEU',
        ator: cmd.por,
        dados: { cultura: cmd.cultura, quantidade: cmd.quantidade, moedas },
        texto: `${nome(mundo, cmd.por)} vendeu ${cmd.quantidade}x ${c.nome} por ${moedas} moedas.`,
      }];
    },
  },

  PRESENTEAR: {
    valida(mundo, cmd) {
      const erro = checaBase(mundo, cmd);
      if (erro) return erro;
      const de = mundo.jogadores[cmd.por];
      if (!mundo.jogadores[cmd.para]) return 'esse familiar nao esta na vila';
      if (cmd.para === cmd.por) return 'presentear a si mesmo nao vale';
      if (!(cmd.quantidade > 0)) return 'quantidade invalida';
      if (cmd.recurso === 'colheita') {
        if ((de.colheita[cmd.item] ?? 0) < cmd.quantidade) return 'voce nao tem isso no celeiro';
      } else if ((de.inventario[cmd.recurso] ?? 0) < cmd.quantidade) {
        return 'voce nao tem esse recurso';
      }
      return null;
    },
    emite(mundo, cmd) {
      const que = cmd.recurso === 'colheita' ? CULTURAS[cmd.item].nome : cmd.recurso;
      return [{
        tipo: 'PRESENTEOU',
        ator: cmd.por,
        dados: { para: cmd.para, recurso: cmd.recurso, item: cmd.item, quantidade: cmd.quantidade },
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
      if (mundo.vila.concluidas.includes(obra.bonus)) return 'essa obra ja ficou pronta';
      const inv = mundo.jogadores[cmd.por].inventario;
      const rec = cmd.recursos ?? {};
      if (!Object.keys(rec).length) return 'doe alguma coisa';
      for (const [k, qtd] of Object.entries(rec)) {
        if (!(qtd > 0)) return 'quantidade invalida';
        if (!(k in obra.custo)) return `${k} nao serve para essa obra`;
        if ((inv[k] ?? 0) < qtd) return `voce nao tem ${qtd} de ${k}`;
      }
      return null;
    },
    emite(mundo, cmd) {
      const obra = OBRAS[cmd.obra];
      const atual = mundo.vila.obras[cmd.obra]?.progresso ?? {};
      const eventos = [{
        tipo: 'DOOU',
        ator: cmd.por,
        dados: { obra: cmd.obra, recursos: cmd.recursos },
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

export { rendimento, custoAgua, energiaDe };
