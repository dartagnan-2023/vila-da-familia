// ---------------------------------------------------------------------------
// Aleatoriedade DETERMINISTICA.
// Todo cliente da familia precisa chegar exatamente ao mesmo mundo a partir da
// mesma semente + mesma sequencia de comandos. Nada de Math.random() aqui.
// ---------------------------------------------------------------------------

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Um geradorpor (semente do mundo, dia, canal) -> reproduzivel em qualquer maquina. */
export function rngPara(semente, tick, canal) {
  return mulberry32(fnv1a(`${semente}|${tick}|${canal}`));
}

export const dado = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1));
export const sorte = (rnd, p) => rnd() < p;
export const escolhe = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

/** JSON com chaves ordenadas: o hash so muda quando o ESTADO muda. */
export function jsonEstavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jsonEstavel).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jsonEstavel(v[k])).join(',') + '}';
}

/** Impressao digital do mundo. Se dois primos tem hashes diferentes, dessincronizou. */
export function hashMundo(mundo) {
  const { feed, aplicados, ...essencial } = mundo;
  return fnv1a(jsonEstavel(essencial)).toString(16).padStart(8, '0');
}
