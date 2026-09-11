// ---------------------------------------------------------------------------
// O dia da vila vira com o relogio de verdade, uma vez por dia.
//
// Nao existe cron: cada cliente, ao abrir, compara a data do ultimo dia
// virado (guardada no proprio mundo, vinda do log) com a data de hoje e envia
// um PASSAR_DIA por dia que falta, com id `dia:AAAA-MM-DD`. O id e unico por
// vila, entao dois primos abrindo juntos nao viram o mesmo dia duas vezes.
// ---------------------------------------------------------------------------

export const FUSO = 'America/Sao_Paulo';

/** 'AAAA-MM-DD' no fuso da familia, independente de onde o aparelho esteja. */
export function dataLocal(d = new Date(), fuso = FUSO) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const somaDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Datas que faltam virar entre `ultima` (exclusiva) e `hoje` (inclusiva).
 * Sumiu por muito tempo? Viram no maximo `max` dias e o calendario pula
 * direto para hoje — a vila envelhece, mas nao precisa reviver um mes inteiro.
 */
export function diasPendentes(ultima, hoje, max = 7) {
  if (!ultima || !hoje || ultima >= hoje) return [];
  const datas = [];
  let d = ultima;
  while (d < hoje && datas.length < max) {
    d = somaDias(d, 1);
    datas.push(d);
  }
  if (datas.at(-1) !== hoje) datas[datas.length - 1] = hoje;
  return datas;
}

export const comandoDoDia = (data) => ({ tipo: 'PASSAR_DIA', id: `dia:${data}`, data });
