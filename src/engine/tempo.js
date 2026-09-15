import { CULTURAS, TEMPO } from './conteudo.js';

// ---------------------------------------------------------------------------
// O relogio de verdade dentro do motor.
//
// Todo comando chega com `em` (milissegundos). Antes de aplicar o comando, o
// motor avanca o mundo de `mundo.agora` ate `em`: plantas crescem enquanto
// estao molhadas, secam quando a agua acaba, energia volta aos poucos. Como
// os `em` vem do log, cada familiar reproduz exatamente o mesmo avanco.
//
// A virada do dia (PASSAR_DIA, a meia-noite) continua cuidando do que e
// diario: clima, estacao, destino, harmonia, recarga cheia de energia.
// ---------------------------------------------------------------------------

export const duracaoCultura = (cultura) => CULTURAS[cultura].horas * TEMPO.hora;

/** Aceita tiles do modelo antigo (idade em dias) sem quebrar vilas existentes. */
export function normalizaTile(t, agora) {
  if (!t || t.progresso != null) return t;
  const total = duracaoCultura(t.cultura);
  t.progresso = Math.min(total, Math.round((t.idade ?? 0) / CULTURAS[t.cultura].dias * total));
  t.regadoAte = 0;
  t.seco = (t.estresse ?? 0) * TEMPO.secoParaEstresse;
  t.plantadoEm = agora;
  delete t.idade; delete t.estresse; delete t.regadoEm; delete t.regas;
  return t;
}

/** Avanca o mundo ate `ate`. Muta. E chamado pelo motor antes de cada comando. */
export function avancarTempo(mundo, ate) {
  if (!ate) return;
  if (!mundo.agora) {
    // Primeira vez com relogio (vila anterior a esta versao): so marca a hora.
    mundo.agora = ate;
    for (const h of Object.values(mundo.herdades)) h.tiles.forEach((t) => normalizaTile(t, ate));
    return;
  }
  const de = mundo.agora;
  if (ate <= de) return;

  for (const h of Object.values(mundo.herdades)) {
    for (const t of h.tiles) {
      if (!t) continue;
      normalizaTile(t, de);
      const total = duracaoCultura(t.cultura);
      if (t.progresso >= total) continue; // madura: espera a foice
      const molhadoAte = Math.min(ate, t.regadoAte);
      if (molhadoAte > de) t.progresso = Math.min(total, t.progresso + (molhadoAte - de));
      const secoDesde = Math.max(de, t.regadoAte);
      if (ate > secoDesde && t.progresso < total) t.seco += ate - secoDesde;
    }
  }

  for (const p of Object.values(mundo.jogadores)) {
    if (p.energia >= p.energiaMax) { p.regenResto = 0; continue; }
    p.regenResto = (p.regenResto ?? 0) + (ate - de);
    const pontos = Math.floor(p.regenResto / TEMPO.regenEnergia);
    if (pontos > 0) {
      p.regenResto -= pontos * TEMPO.regenEnergia;
      p.energia = Math.min(p.energiaMax, p.energia + pontos);
      if (p.energia >= p.energiaMax) p.regenResto = 0;
    }
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

export const estaMadura = (t) => t && t.progresso != null && t.progresso >= duracaoCultura(t.cultura);
export const estaMolhada = (t, agora) => t && t.regadoAte > agora;
export const estresseDe = (t) => Math.floor((t?.seco ?? 0) / TEMPO.secoParaEstresse);

/** Quando fica pronta, se a agua atual bastar; senao null (precisa regar de novo). */
export function prontaEm(t, agora) {
  if (!t || estaMadura(t)) return null;
  const falta = duracaoCultura(t.cultura) - t.progresso;
  return t.regadoAte - agora >= falta ? agora + falta : null;
}

export const rotuloDuracao = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
};
