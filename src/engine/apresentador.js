import { CULTURAS, CONSTRUCOES, OBRAS, LIMIARES, CONFIG } from './conteudo.js';
import { vizinhas, temConstrucao } from './mundo.js';
import { choveu } from './simular.js';
import { REGRAS, missoesDoDia } from './regras.js';
import { projetar, estaMadura, estaMolhada, estresseDe, prontaEm, duracaoCultura, rotuloDuracao } from './tempo.js';
import { TEMPO } from './conteudo.js';

// ---------------------------------------------------------------------------
// Camada de vitrine: transforma o estado cru no que a TELA precisa mostrar.
// A UI (o layout que vier do Stitch) le SO isto — nunca o mundo direto.
// ---------------------------------------------------------------------------

const ICONE_CULTURA = { trigo: '🌾', milho: '🌽', abobora: '🎃', arroz: '🍚', flor: '🌻' };
const ICONE_CONSTRUCAO = { agua: '🪣', poliniza: '🐝', solo: '♻️', estoque: '🏚️', ferramenta: '🔨' };
const ICONE_CLIMA = { sol: '☀️', sol_forte: '🔥', chuva: '🌧️', tempestade: '⛈️' };

export function visao(mundoCru, jogadorId, agora = mundoCru.agora) {
  // A tela ve o mundo COMO ESTA AGORA, sem esperar o proximo comando.
  const mundo = projetar(mundoCru, agora);
  const eu = mundo.jogadores[jogadorId] ?? null;
  const minha = eu ? mundo.herdades[eu.herdade] : null;

  return {
    vila: {
      nome: mundo.nome, dia: mundo.diaDaEstacao, estacao: mundo.estacao, ano: mundo.ano,
      clima: mundo.clima, iconeClima: ICONE_CLIMA[mundo.clima], rotuloClima: ROTULO_CLIMA[mundo.clima],
      tick: mundo.tick, semente: mundo.semente, dataDoDia: mundo.dataDoDia,
    },
    sinergia: sinergia(mundo),
    hud: eu && {
      id: eu.id, nome: eu.nome, sprite: eu.sprite,
      energia: eu.energia, energiaMax: eu.energiaMax,
      moedas: eu.inventario.moedas, madeira: eu.inventario.madeira, pedra: eu.inventario.pedra,
      proximaEnergiaEm: eu.energia < eu.energiaMax ? TEMPO.regenEnergia - (eu.regenResto ?? 0) : null,
      // O layout pede um segundo medidor ao lado da energia: usamos a saude da terra.
      terra: minha ? Math.max(0, minha.fertilidade - minha.poluicao) : 0,
      ...nivel(eu),
      colheita: Object.entries(eu.colheita).map(([k, v]) => ({ cultura: k, nome: CULTURAS[k].nome, icone: ICONE_CULTURA[k], qtd: v, preco: CULTURAS[k].preco })),
    },
    comuns: Object.entries(mundo.comuns).map(([chave, valor]) => ({
      chave,
      rotulo: { agua: 'Agua', floresta: 'Mata', solo: 'Terra', harmonia: 'Harmonia' }[chave],
      valor,
      pct: Math.round((valor / CONFIG.comumMax) * 100),
      estado: estadoComum(chave, valor),
    })),
    minhaHerdade: minha && herdadeView(mundo, minha),
    mapa: Object.values(mundo.herdades).map((h) => ({
      id: h.id, x: h.x, y: h.y, nome: h.nome, dono: h.dono,
      sprite: mundo.jogadores[h.dono]?.sprite ?? null,
      minha: h.dono === jogadorId,
      livre: !h.dono,
      fertilidade: h.fertilidade,
      poluicao: h.poluicao,
      plantados: h.tiles.filter(Boolean).length,
      maduros: h.tiles.filter((t) => estaMadura(t)).length,
      sedentos: h.tiles.filter((t) => t && !estaMadura(t) && !estaMolhada(t, mundo.agora)).length,
      construcoes: h.construcoes.map((e) => ({ efeito: e, icone: ICONE_CONSTRUCAO[e] })),
    })),
    // O convite social: onde a sua mao faz falta agora.
    pedidosDeAjuda: minha ? pedidos(mundo, jogadorId) : [],
    obras: Object.entries(OBRAS).map(([chave, o]) => {
      const prog = mundo.vila.obras[chave]?.progresso ?? {};
      const itens = Object.entries(o.custo).map(([rec, alvo]) => ({ recurso: rec, feito: Math.min(prog[rec] ?? 0, alvo), alvo }));
      const pct = Math.round((itens.reduce((s, i) => s + i.feito / i.alvo, 0) / itens.length) * 100);
      return { chave, nome: o.nome, texto: o.texto, itens, pct, concluida: mundo.vila.concluidas.includes(o.bonus) };
    }),
    missao: missaoAtual(mundo),
    missoesDoDia: eu ? missoesDoDia(mundo).map((m, i) => ({
      indice: i, texto: m.texto, meta: m.meta, feito: Math.min(m.meta, eu.hoje?.[m.chave] ?? 0),
      premio: m.premio, premioTexto: Object.entries(m.premio).map(([k, v]) => `+${v} ${k === 'moedas' ? 'G' : '⚡'}`).join(' '),
      cumprida: (eu.hoje?.[m.chave] ?? 0) >= m.meta, recebida: (eu.missoesFeitas ?? []).includes(i),
    })) : [],
    familia: Object.values(mundo.jogadores).map((p) => ({
      id: p.id, nome: p.nome, sprite: p.sprite, herdade: p.herdade,
      energia: p.energia, energiaMax: p.energiaMax,
      reputacao: eu ? (eu.reputacao[p.id] ?? 0) : 0,
      laco: laco(eu ? (eu.reputacao[p.id] ?? 0) : 0, p.id === jogadorId),
      feitos: p.feitos,
    })),
    presagios: mundo.destino.presagios.slice(-5).reverse(),
    marcos: mundo.destino.marcos,
    feed: mundo.feed.slice(-25).reverse().map((l) => ({
      ...l,
      autor: mundo.jogadores[l.ator]?.nome ?? 'A vila',
      sprite: mundo.jogadores[l.ator]?.sprite ?? '📜',
      quando: rotuloQuando(mundo.tick - l.tick),
      impacto: impactoTexto(l.comuns),
    })),
    catalogo: {
      culturas: Object.entries(CULTURAS).map(([k, c]) => ({ chave: k, ...c, icone: ICONE_CULTURA[k] })),
      construcoes: Object.entries(CONSTRUCOES).map(([k, b]) => ({ chave: k, ...b, icone: ICONE_CONSTRUCAO[b.efeito] })),
    },
  };
}

function herdadeView(mundo, h) {
  return {
    id: h.id, nome: h.nome, fertilidade: h.fertilidade, poluicao: h.poluicao,
    construcoes: h.construcoes.map((e) => {
      const [chave, b] = Object.entries(CONSTRUCOES).find(([, x]) => x.efeito === e) ?? [e, { nome: e, texto: '' }];
      return { efeito: e, chave, nome: b.nome, texto: b.texto, icone: ICONE_CONSTRUCAO[e] };
    }),
    vagas: CONFIG.construcoesPorHerdade - h.construcoes.length,
    proximoCanteiro: h.tiles.length < CONFIG.canteirosMax ? CONFIG.precoCanteiro[h.tiles.length - CONFIG.tilesPorHerdade] : null,
    canteiros: h.tiles.map((t, i) => {
      if (!t) return { i, vazio: true };
      const c = CULTURAS[t.cultura];
      return {
        i, vazio: false, cultura: t.cultura, nome: c.nome, icone: ICONE_CULTURA[t.cultura],
        horas: c.horas,
        progresso: Math.min(100, Math.round((t.progresso / duracaoCultura(t.cultura)) * 100)),
        pronto: estaMadura(t),
        molhada: estaMolhada(t, mundo.agora),
        sede: !estaMadura(t) && !estaMolhada(t, mundo.agora) && !choveu(mundo.clima),
        aguaAte: t.regadoAte,
        aguaRestante: Math.max(0, t.regadoAte - mundo.agora),
        prontaEm: prontaEm(t, mundo.agora),
        faltaMs: Math.max(0, duracaoCultura(t.cultura) - t.progresso),
        estresse: estresseDe(t),
        rotulo: estaMadura(t) ? 'pronta!' : prontaEm(t, mundo.agora) ? `pronta em ${rotuloDuracao(prontaEm(t, mundo.agora) - mundo.agora)}` : estaMolhada(t, mundo.agora) ? `água por ${rotuloDuracao(t.regadoAte - mundo.agora)}` : choveu(mundo.clima) ? 'na chuva ☔' : 'com sede',
        plantadoPor: t.plantadoPor,
      };
    }),
  };
}

// A familia inteira, vizinhos primeiro: ninguem deixa a vo sem agua por
// estar na outra ponta da vila.
function pedidos(mundo, jogadorId) {
  const minha = mundo.herdades[mundo.jogadores[jogadorId].herdade];
  const out = [];
  const perto = new Set(vizinhas(mundo, minha.id).map((v) => v.id));
  const todas = Object.values(mundo.herdades).sort((a, b) => (perto.has(b.id) ? 1 : 0) - (perto.has(a.id) ? 1 : 0));
  const chovendo = choveu(mundo.clima);
  for (const v of todas) {
    if (!v.dono || v.dono === jogadorId) continue;
    v.tiles.forEach((t, i) => {
      if (!t) return;
      const c = CULTURAS[t.cultura];
      if (estaMadura(t)) out.push({ herdade: v.id, dono: v.dono, tile: i, acao: 'COLHER', motivo: `${c.nome} passando do ponto em ${v.nome}` });
      else if (!estaMolhada(t, mundo.agora) && !chovendo) out.push({ herdade: v.id, dono: v.dono, tile: i, acao: 'REGAR', motivo: `${c.nome} com sede em ${v.nome}` });
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

/** Nivel do familiar: sai do que a pessoa fez, nao de XP inventado. */
function nivel(p) {
  const total = Object.values(p.feitos).reduce((s, n) => s + n, 0);
  return { nivel: 1 + Math.floor(total / 8), xp: total % 8, xpMax: 8, feitosTotal: total };
}

/** O medidor de Sinergia Familiar do topo. */
function sinergia(mundo) {
  const h = mundo.comuns.harmonia;
  let bonus = 'A vila esta em paz.';
  if (h >= LIMIARES.harmoniaAlta) bonus = '★ Todo mundo acorda com +1 de energia!';
  else if (h <= LIMIARES.harmoniaBaixa) bonus = 'Anda todo mundo emburrado: o dia rende menos.';
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
