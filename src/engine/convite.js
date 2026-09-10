import { fnv1a } from './rng.js';

// ---------------------------------------------------------------------------
// Chave de convite: "VILA-K7M2Q-3XR9T".
// Base32 de Crockford (sem I, L, O, U — ninguem confunde 0 com O no WhatsApp),
// 8 caracteres de sorteio (32^8 ≈ 1 trilhao) + 2 de verificacao.
// A chave E o segredo da vila: quem tem, entra. O servidor troca a chave pelo
// id da vila e pelo log; o digito verificador so poupa uma ida ao servidor
// quando alguem digita errado.
// ---------------------------------------------------------------------------

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TAMANHO = 8;

const paraBase32 = (n, tamanho) => {
  let s = '';
  for (let i = 0; i < tamanho; i++) {
    s = ALFABETO[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
};

const digitos = (corpo) => paraBase32(fnv1a(corpo + '|vila') % (32 ** 2), 2);

// Tira o prefixo ANTES de normalizar: senao o "VILA" vira "V11A" na traducao.
const normaliza = (chave) =>
  String(chave).toUpperCase().replace(/[\s-]/g, '').replace(/^VILA/, '')
    .replace(/I|L/g, '1').replace(/O/g, '0').replace(/U/g, 'V');

const formata = (bruto) => `VILA-${bruto.slice(0, 5)}-${bruto.slice(5)}`;

/** Sorteia a chave de uma vila nova. Aceita um gerador para testes. */
export function novaChave(rnd = Math.random) {
  let corpo = '';
  for (let i = 0; i < TAMANHO; i++) corpo += ALFABETO[Math.floor(rnd() * 32)];
  return formata(corpo + digitos(corpo));
}

/** Confere formato e digito; devolve a chave canonica para bater no servidor. */
export function lerChave(chave) {
  const s = normaliza(chave ?? '');
  if (s.length !== TAMANHO + 2) return { valida: false, erro: 'a chave tem 10 caracteres' };
  const corpo = s.slice(0, TAMANHO);
  if (digitos(corpo) !== s.slice(TAMANHO)) {
    return { valida: false, erro: 'chave invalida — confira se digitou certo' };
  }
  return { valida: true, chave: formata(s) };
}
