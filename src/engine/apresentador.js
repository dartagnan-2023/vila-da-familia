import {
  CULTURAS, PRODUTOS, CONSTRUCOES, OBRAS, LIMIARES, CONFIG, PROBLEMAS, TEMPO,
  nivelDe, xpParaNivel, precoDe, nomeDe,
} from './conteudo.js';
import { vizinhas, temConstrucao } from './mundo.js';
import { REGRAS, missoesDoDia } from './regras.js';
import { projetar, estaMadura, prontaEm, duracaoCultura, rotuloDuracao, velocidade } from './tempo.js';

// ---------------------------------------------------------------------------
// Camada de vitrine: transforma o estado cru no que a TELA precisa mostrar.
// A UI le SO isto — nunca o mundo direto.
// ---------------------------------------------------------------------------

const ICONE_ITEM = { trigo: '🌾', milho: '🌽', abobora: '🎃', arroz: '🍚', flor: '🌻', cenoura: '🥕', cafe: '☕', farinha: '🫓', pao: '🍞', bolo: '🍰' };
const ICONE_CONSTRUCAO = { agua: '🪣', poliniza: '🐝', solo: '♻️', estoque: '🏚️', ferramenta: '🔨', moinho: '🌀', forno: '🔥' };
const ICONE_CLIMA = { sol: '☀️', sol_forte: '🔥', chuva: '🌧️', tempestade: '⛈️' };
export const iconeDe = (chave) => ICONE_ITEM[chave] ?? '📦';

export function visao(mundoCru, jogadorId, agora = mundoCru.agora) {
  // A tela ve o mundo COMO ESTA AGORA, sem esperar o proximo comando.
  const mundo = projetar(mundoCru, agora);
  const eu = mundo.jogadores[jogadorId] ?? null;
  const minha = eu ? mundo.herdades[eu.herdade] : null;
  const nv = eu ? nivelDe(eu.xp ?? 0) : 1;

  return {
    vila: {
      nome: mundo.nome, dia: mundo.diaDaEstacao, estacao: mundo.estacao, ano: mundo.ano,
      clima: mundo.clima, iconeClima: ICONE_CLIMA[mundo.clima], rotuloClima: ROTULO_CLIMA[mundo.clima],
      tick: mundo.tick, semente: mundo.semente, dataDoDia: mundo.dataDoDia, agora: mundo.agora,
      velocidade: Math.round(velocidade(mundo) * 100),
    },
    sinergia: sinergia(mundo),
    hud: eu && {
      id: eu.id, nome: eu.nome, sprite: eu.sprite,
      nivel: nv, xp: (eu.xp ?? 0) - xpParaNivel(nv), xpMax: xpParaNivel(nv + 1) - xpParaNivel(nv), xpTotal: eu.xp ?? 0,
      moedas: eu.inventario.moedas, madeira: eu.inventario.madeira, pedra: eu.inventario.pedra,
      terra: minha ? Math.max(0, minha.fertilidade - minha.poluicao) : 0,
      machadoEm: Math.max(0, (eu.descanso?.machado ?? 0) - mundo.agora),
      picaretaEm: Math.max(0, (eu.descanso?.picareta ?? 0) - mundo.agora),
      colheita: Object.entries(eu.colheita).map(([k, v]) => ({ cultura: k, nome: nomeDe(k), icone: iconeDe(k), qtd: v, preco: precoDe(k) })),
      // legado (a tela antiga lia isto)
      energia: 0, energiaMax: 0,
    },
    comuns: Object.entries(mundo.comuns).map(([chave, valor]) => ({
      chave,
      rotulo: { agua: 'Agua', floresta: 'Mata', solo: 'Terra', harmonia: 'Harmonia' }[chave],
      valor,
      pct: Math.round((valor / CONFIG.comumMax) * 100),
      estado: estadoComum(chave, valor),
    })),
    minhaHerdade: minha && herdadeView(mundo, minha, eu),
    mapa: Object.values(mundo.herdades).map((h) => ({
      id: h.id, x: h.x, y: h.y, nome: h.nome, dono: h.dono,
      sprite: mundo.jogadores[h.dono]?.sprite ?? null,
      minha: h.dono === jogadorId,
      livre: !h.dono,
      fertilidade: h.fertilidade,
      poluicao: h.poluicao,
      plantados: h.tiles.filter(Boolean).length,
      maduros: h.tiles.filter((t) => estaMadura(t)).length,
      pedindo: h.tiles.filter((t) => t?.problema).length,
      construcoes: h.construcoes.map((e) => ({ efeito: e, icone: ICONE_CONSTRUCAO[e] })),
    })),
    // O convite social: onde a sua mao faz falta agora.
    pedidosDeAjuda: minha ? pedidos(mundo, jogadorId) : [],
    encomendas: eu ? (eu.encomendas ?? []).map((e, i) => ({
      indice: i, cliente: e.cliente, moedas: e.moedas, xp: e.xp,
      itens: Object.entries(e.itens).map(([k, q]) => ({ chave: k, nome: nomeDe(k), icone: iconeDe(k), qtd: q, tenho: eu.colheita[k] ?? 0, ok: (eu.colheita[k] ?? 0) >= q })),
      pronta: Object.entries(e.itens).every(([k, q]) => (eu.colheita[k] ?? 0) >= q),
    })) : [],
    obras: Object.entries(OBRAS).map(([chave, o]) => {
      const prog = mundo.vila.obras[chave]?.progresso ?? {};
      const itens = Object.entries(o.custo).map(([rec, alvo]) => ({ recurso: rec, feito: Math.min(prog[rec] ?? 0, alvo), alvo }));
      const pct = Math.round((itens.reduce((s, i) => s + i.feito / i.alvo, 0) / itens.length) * 100);
      return { chave, nome: o.nome, texto: o.texto, itens, pct, concluida: mundo.vila.concluidas.includes(o.bonus) };
    }),
    missao: missaoAtual(mundo),
    missoesDoDia: eu ? missoesDoDia(mundo).map((m, i) => ({
      indice: i, texto: m.texto, meta: m.meta, feito: Math.min(m.meta, eu.hoje?.[m.chave] ?? 0),
      premio: m.premio, premioTexto: `+${m.premio.moedas} G`,
      cumprida: (eu.hoje?.[m.chave] ?? 0) >= m.meta, recebida: (eu.missoesFeitas ?? []).includes(i),
    })) : [],
    familia: Object.values(mundo.jogadores).map((p) => ({
      id: p.id, nome: p.nome, sprite: p.sprite, herdade: p.herdade,
      nivel: nivelDe(p.xp ?? 0),
      reputacao: eu ? (eu.reputacao[p.id] ?? 0) : 0,
      laco: laco(eu ? (eu.reputacao[p.id] ?? 0) : 0, p.id === jogadorId),
      feitos: p.feitos,
    })),
    presagios: presagiosDoDia(mundo),
    marcos: mundo.destino.marcos,
    feed: agruparFeed(mundo).slice(-25).reverse().map((l) => ({
      ...l,
      autor: mundo.jogadores[l.ator]?.nome ?? 'A vila',
      sprite: mundo.jogadores[l.ator]?.sprite ?? '📜',
      quando: rotuloQuando(mundo.tick - l.tick),
      impacto: impactoTexto(l.comuns),
    })),
    catalogo: {
      culturas: Object.entries(CULTURAS).map(([k, c]) => ({ chave: k, ...c, icone: iconeDe(k), liberada: c.nivel <= nv, daEstacao: c.estacoes.includes(mundo.estacao) })),
      construcoes: Object.entries(CONSTRUCOES).map(([k, b]) => ({ chave: k, ...b, icone: ICONE_CONSTRUCAO[b.efeito], liberada: b.nivel <= nv })),
      produtos: Object.entries(PRODUTOS).map(([k, p]) => ({ chave: k, ...p, icone: iconeDe(k), entradaTexto: Object.entries(p.entrada).map(([i, q]) => `${q} ${nomeDe(i).toLowerCase()}`).join(' + ') })),
    },
  };
}

function herdadeView(mundo, h, eu) {
  return {
    id: h.id, nome: h.nome, fertilidade: h.fertilidade, poluicao: h.poluicao,
    construcoes: h.construcoes.map((e) => {
      const [chave, b] = Object.entries(CONSTRUCOES).find(([, x]) => x.efeito === e) ?? [e, { nome: e, texto: '' }];
      return { efeito: e, chave, nome: b.nome, texto: b.texto, icone: ICONE_CONSTRUCAO[e] };
    }),
    vagas: CONFIG.construcoesPorHerdade - h.construcoes.length,
    proximoCanteiro: h.tiles.length < CONFIG.canteirosMax ? CONFIG.precoCanteiro[h.tiles.length - CONFIG.tilesPorHerdade] : null,
    canteiros: h.tiles.map((t, i) => canteiroView(mundo, t, i)),
    // As maquinas: o que esta fazendo, quando fica pronto, o que da pra por.
    maquinas: ['moinho', 'forno'].filter((m) => h.construcoes.includes(m)).map((m) => {
      const em = h.producao?.[m];
      const receitas = Object.entries(PRODUTOS).filter(([, p]) => p.maquina === m).map(([k, p]) => ({
        chave: k, nome: p.nome, icone: iconeDe(k), minutos: p.minutos, preco: p.preco,
        entradaTexto: Object.entries(p.entrada).map(([i, q]) => `${q} ${nomeDe(i).toLowerCase()}`).join(' + '),
        podeFazer: Object.entries(p.entrada).every(([i, q]) => (eu.colheita[i] ?? 0) >= q),
      }));
      return {
        maquina: m, nome: CONSTRUCOES[m].nome, icone: ICONE_CONSTRUCAO[m],
        ocupada: !!em,
        produto: em ? { chave: em.produto, nome: nomeDe(em.produto), icone: iconeDe(em.produto) } : null,
        pronta: !!em && em.prontoEm <= mundo.agora,
        prontaEm: em ? Math.max(0, em.prontoEm - mundo.agora) : null,
        rotulo: !em ? 'livre' : em.prontoEm <= mundo.agora ? `${nomeDe(em.produto)} pronto!` : `${nomeDe(em.produto)} em ${rotuloDuracao(em.prontoEm - mundo.agora)}`,
        receitas,
      };
    }),
  };
}

function canteiroView(mundo, t, i) {
  if (!t) return { i, vazio: true };
  const c = CULTURAS[t.cultura];
  const total = duracaoCultura(t.cultura);
  const pronta = estaMadura(t);
  const quando = prontaEm(t, mundo);
  const prob = t.problema ? PROBLEMAS[t.problema] : null;
  return {
    i, vazio: false, cultura: t.cultura, nome: c.nome, icone: iconeDe(t.cultura),
    minutos: c.minutos,
    progresso: Math.min(100, Math.round((t.progresso / total) * 100)),
    pronto: pronta,
    problema: t.problema,
    problemaIcone: prob?.icone ?? null,
    prontaEm: quando,
    rotulo: pronta ? 'pronta!'
      : prob ? `pede ${prob.nome} ${prob.icone}`
      : quando ? `pronta em ${rotuloDuracao(quando - mundo.agora)}` : 'crescendo',
    plantadoPor: t.plantadoPor,
  };
}

// A familia inteira, vizinhos primeiro: ninguem deixa a vo sem agua por
// estar na outra ponta da vila.
function pedidos(mundo, jogadorId) {
  const minha = mundo.herdades[mundo.jogadores[jogadorId].herdade];
  const out = [];
  const perto = new Set(vizinhas(mundo, minha.id).map((v) => v.id));
  const todas = Object.values(mundo.herdades).sort((a, b) => (perto.has(b.id) ? 1 : 0) - (perto.has(a.id) ? 1 : 0));
  for (const v of todas) {
    if (!v.dono || v.dono === jogadorId) continue;
    v.tiles.forEach((t, i) => {
      if (!t) return;
      const c = CULTURAS[t.cultura];
      if (t.problema) out.push({ herdade: v.id, dono: v.dono, tile: i, acao: 'CUIDAR', icone: PROBLEMAS[t.problema].icone, motivo: `${c.nome} com ${PROBLEMAS[t.problema].nome} em ${v.nome}` });
      else if (estaMadura(t)) out.push({ herdade: v.id, dono: v.dono, tile: i, acao: 'COLHER', icone: '🌾', motivo: `${c.nome} passando do ponto em ${v.nome}` });
    });
  }
  return out.slice(0, 8);
}

function estadoComum(chave, valor) {
  if (chave === 'harmonia') {
    if (valor >= LIMIARES.harmoniaAlta) return 'otimo';
    if (valor <= LIMIARES.harmoniaBaixa) return 'critico';
    return 'ok';
  }
  const limiar = { agua: LIMIARES.secaAgua, floresta: LIMIARES.desmatamento, solo: LIMIARES.soloExausto }[chave];
  if (valor <= limiar) return 'critico';
  if (valor <= limiar * 1.6) return 'alerta';
  return 'ok';
}

/** A obra coletiva mais adiantada que ainda falta: o painel "Missao Familiar". */
function missaoAtual(mundo) {
  const abertas = Object.entries(OBRAS)
    .filter(([, o]) => !mundo.vila.concluidas.includes(o.bonus))
    .map(([chave, o]) => {
      const prog = mundo.vila.obras[chave]?.progresso ?? {};
      const itens = Object.entries(o.custo).map(([rec, alvo]) => ({
        recurso: rec, feito: Math.min(prog[rec] ?? 0, alvo), alvo, falta: Math.max(0, alvo - (prog[rec] ?? 0)),
      }));
      const pct = Math.round((itens.reduce((s, i) => s + i.feito / i.alvo, 0) / itens.length) * 100);
      return { chave, nome: o.nome, texto: o.texto, itens, pct };
    })
    .sort((a, b) => b.pct - a.pct);
  const m = abertas[0];
  if (!m) return null;
  const falta = m.itens.filter((i) => i.falta > 0);
  return {
    ...m,
    chamada: falta.length
      ? `Faltam ${falta.map((i) => `${i.falta} de ${i.recurso}`).join(' e ')} para a familia terminar.`
      : 'Pronta para ser concluida!',
  };
}

const ROTULO_CLIMA = { sol: 'Sol firme', sol_forte: 'Sol rachando', chuva: 'Chuva boa', tempestade: 'Temporal' };
const ROTULO_COMUM = { agua: 'agua', floresta: 'mata', solo: 'terra', harmonia: 'harmonia' };

/** "-2 agua - +2 harmonia": o que aquela atitude tirou ou deu para todo mundo. */
function impactoTexto(comuns) {
  if (!comuns) return null;
  const partes = Object.entries(comuns)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v > 0 ? '+' : '−'}${Math.abs(v)} ${ROTULO_COMUM[k] ?? k}`);
  return partes.length ? partes.join(' · ') : null;
}

/** O medidor de Sinergia Familiar do topo: agora e a velocidade de tudo. */
function sinergia(mundo) {
  const h = mundo.comuns.harmonia;
  const v = Math.round((velocidade(mundo) - 1) * 100);
  let bonus = v > 0 ? `★ Tudo cresce ${v}% mais rapido para todo mundo!` : v < 0 ? `Tudo cresce ${-v}% mais devagar. Abraço e ajuda resolvem.` : 'A vila esta em paz.';
  if (mundo.comuns.agua < LIMIARES.secaAgua) bonus = 'Rio seco: tudo murcha. Replantem a mata.';
  return { valor: h, pct: h, nivel: 1 + Math.floor(h / 20), bonus, estado: estadoComum('harmonia', h) };
}

const rotuloQuando = (dias) => (dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `ha ${dias} dias`);

const laco = (rep, souEu) => {
  if (souEu) return 'voce';
  if (rep >= 10) return 'inseparaveis';
  if (rep >= 6) return 'muito proximos';
  if (rep >= 3) return 'proximos';
  if (rep >= 1) return 'se falam';
  return 'distantes';
};

/** Botoes da tela: ja vem com habilitado/motivo, sem a UI precisar saber as regras. */
export function acoesPossiveis(mundo, jogadorId, comandos) {
  return comandos.map((cmd) => {
    const c = { ...cmd, por: jogadorId };
    const regra = REGRAS[c.tipo];
    const erro = regra ? regra.valida(mundo, c) : 'comando desconhecido';
    return { comando: c, habilitado: !erro, motivo: erro ?? null };
  });
}

// Nove "Pipo plantou trigo" seguidos viram "Pipo plantou 9x trigo". O mural
// e para ler o dia da familia, nao para contar cliques.
const AGRUPAVEIS = { PLANTOU: 'plantou', COLHEU: 'colheu', CUIDOU: 'cuidou de' };
export function agruparFeed(mundo) {
  const out = [];
  for (const l of mundo.feed) {
    if (l.tipo === 'AJUDOU') continue; // a linha seguinte (cuidou/colheu) ja diz onde
    const ult = out[out.length - 1];
    const mesmoBloco = ult && ult.tipo === l.tipo && ult.ator === l.ator && AGRUPAVEIS[l.tipo]
      && ult.ref?.herdade && ult.ref.herdade === l.ref?.herdade;
    if (!mesmoBloco) { out.push({ ...l, itens: [l] }); continue; }
    ult.itens.push(l);
    ult.seq = l.seq; ult.tick = l.tick;
    ult.comuns = somaComuns(ult.comuns, l.comuns);
    ult.texto = textoAgrupado(mundo, ult);
  }
  return out;
}

function textoAgrupado(mundo, l) {
  const quem = mundo.jogadores[l.ator]?.nome ?? 'Alguem';
  const onde = mundo.herdades[l.ref.herdade]?.nome ?? 'a horta';
  const porCultura = {};
  for (const i of l.itens) {
    const c = i.ref?.cultura;
    if (c) porCultura[c] = (porCultura[c] ?? 0) + (l.tipo === 'COLHEU' ? (i.ref.quantidade ?? 1) : 1);
  }
  const partes = Object.entries(porCultura).map(([c, n]) => `${n}x ${nomeDe(c).toLowerCase()}`);
  const coisa = partes.length ? partes.join(' e ') : `${l.itens.length} canteiros`;
  return `${quem} ${AGRUPAVEIS[l.tipo]} ${coisa} em ${onde}.`;
}

const somaComuns = (a, b) => {
  if (!a && !b) return undefined;
  const r = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) r[k] = (r[k] ?? 0) + v;
  return r;
};

// So o que o mundo disse na ULTIMA virada: presagio velho e noticia velha.
function presagiosDoDia(mundo) {
  const lista = mundo.destino.presagios;
  if (!lista.length) return [];
  const ultimoTick = lista[lista.length - 1].tick;
  const vistos = new Set();
  // Humor da vila e vivo: se a familia ja se acertou, o "emburrado" da manha caducou.
  const aindaVale = (p) => (p.chave !== 'discordia' || mundo.comuns.harmonia <= LIMIARES.harmoniaBaixa)
    && (p.chave !== 'festa' || mundo.comuns.harmonia >= LIMIARES.harmoniaAlta);
  return lista.filter((p) => p.tick === ultimoTick && aindaVale(p) && !vistos.has(p.chave) && vistos.add(p.chave)).reverse();
}
