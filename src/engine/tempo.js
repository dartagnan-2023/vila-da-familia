import { CULTURAS, PRODUTOS, TEMPO, LIMIARES } from './conteudo.js';

// ---------------------------------------------------------------------------
// O relogio de verdade dentro do motor.
//
// Todo comando chega com `em` (milissegundos). Antes de aplicar o comando, o
// motor avanca o mundo de `mundo.agora` ate `em`: plantas crescem, maquinas
// produzem. Como os `em` vem do log, cada familiar reproduz o mesmo avanco.
//
// Uma planta cresce sozinha (nao precisa de rega). Nos pontos marcados ela
// PEDE algo — sede, praga, mato — e para ate alguem cuidar. Esse "alguem"
// pode ser um parente: e o gancho social do Colheita Feliz.
// ---------------------------------------------------------------------------

export const duracaoCultura = (cultura) => CULTURAS[cultura].minutos * TEMPO.minuto;
export const duracaoProduto = (produto) => PRODUTOS[produto].minutos * TEMPO.minuto;

/**
 * Velocidade do crescimento: o destino compartilhado sentido a cada minuto.
 * Harmonia alta = todo mundo colhe antes; baixa = todo mundo espera mais.
 */
export function velocidade(mundo) {
  const h = mundo.comuns.harmonia;
  let v = 1 + (h - 50) / 250; // 0.8 .. 1.2
  if (mundo.vila.concluidas.includes('velocidade')) v += 0.1;
  if (mundo.comuns.agua < LIMIARES.secaAgua) v -= 0.15; // rio seco: tudo murcha
  return Math.max(0.5, v);
}

/** Aceita tiles de versoes anteriores sem quebrar vilas existentes. */
export function normalizaTile(t) {
  if (!t) return t;
  if (t.pedidos == null) t.pedidos = [];
  if (t.problema === undefined) t.problema = null;
  if (t.progresso == null) t.progresso = 0;
  if (!CULTURAS[t.cultura]) t.cultura = 'trigo';
  delete t.idade; delete t.estresse; delete t.regadoEm; delete t.regas; delete t.regadoAte; delete t.seco;
  return t;
}

/** Avanca o mundo ate `ate`. Muta. E chamado pelo motor antes de cada comando. */
export function avancarTempo(mundo, ate) {
  if (!ate) return;
  if (!mundo.agora) {
    mundo.agora = ate;
    for (const h of Object.values(mundo.herdades)) h.tiles.forEach(normalizaTile);
    return;
  }
  const de = mundo.agora;
  if (ate <= de) return;
  const passou = (ate - de) * velocidade(mundo);

  for (const h of Object.values(mundo.herdades)) {
    for (const t of h.tiles) {
      if (!t) continue;
      normalizaTile(t);
      if (t.problema) continue; // parada: esperando alguem cuidar
      const total = duracaoCultura(t.cultura);
      if (t.progresso >= total) continue;
      let novo = Math.min(total, t.progresso + passou);
      // Chegou num ponto de pedido? Para ali e pede.
      const proximo = t.pedidos[0];
      if (proximo && novo >= proximo.em * total && t.progresso < proximo.em * total) {
        novo = proximo.em * total;
        t.problema = proximo.tipo;
        t.pedidos.shift();
      }
      // Ficou madura agora: guarda quando, pra saber se esta "passando do ponto".
      if (novo >= total && t.progresso < total) t.maduraEm = ate;
      t.progresso = novo;
    }
    // maquinas: prontoEm e absoluto, nao precisa avancar
  }
  mundo.agora = ate;
}

/** Copia do mundo avancada ate `agora`, sem mexer no original. Para a tela. */
export function projetar(mundo, agora) {
  if (!agora || !mundo.agora || agora <= mundo.agora) return mundo;
  const copia = structuredClone(mundo);
  avancarTempo(copia, agora);
  return copia;
}

export const estaMadura = (t) => !!t && (t.progresso ?? 0) >= duracaoCultura(t.cultura);

/** Quando fica pronta se ninguem mexer; null se esta parada pedindo ajuda. */
export function prontaEm(t, mundo) {
  if (!t || estaMadura(t) || t.problema) return null;
  const total = duracaoCultura(t.cultura);
  const proximo = t.pedidos?.[0];
  const alvo = proximo ? proximo.em * total : total;
  return mundo.agora + (alvo - t.progresso) / velocidade(mundo);
}

export const rotuloDuracao = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
};
