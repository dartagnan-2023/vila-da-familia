// ---------------------------------------------------------------------------
// Todo o balanceamento vive aqui. Mexer nestes numeros muda o jogo inteiro
// sem tocar em uma linha de logica.
//
// Referencia de ritmo (ver docs/ESTUDO-JOGABILIDADE.md): Hay Day comeca com
// trigo em 2 minutos e nao tem energia. O limite e tempo, semente e canteiro.
// ---------------------------------------------------------------------------

const MIN = 60_000, HORA = 60 * MIN;

export const CONFIG = {
  diasPorEstacao: 12,
  energiaMax: 10,               // legado: energia nao limita mais nada
  comumMax: 100,
  tilesPorHerdade: 9,
  canteirosMax: 12,             // 9 de nascenca + ate 3 comprados
  precoCanteiro: [60, 90, 120], // o 10o, o 11o e o 12o
  construcoesPorHerdade: 3,
  feedMax: 300,
  encomendasAbertas: 3,
};

export const ESTACOES = ['Primavera', 'Verao', 'Outono', 'Inverno'];

// `minutos`: tempo de relogio ate ficar pronta. `rende`: unidades por colheita.
// `nivel`: quando desbloqueia. `xp`: ao colher. Curva copiada do Hay Day.
export const CULTURAS = {
  trigo:   { nome: 'Trigo',   minutos: 2,   nivel: 1,  xp: 1,  rende: 2, semente: 1,  preco: 2,  agua: 1, solo: 0, estacoes: ESTACOES },
  flor:    { nome: 'Flor',    minutos: 3,   nivel: 2,  xp: 2,  rende: 1, semente: 2,  preco: 4,  agua: 1, solo: 0, estacoes: ESTACOES, poliniza: true, harmonia: 1 },
  milho:   { nome: 'Milho',   minutos: 5,   nivel: 3,  xp: 3,  rende: 2, semente: 2,  preco: 4,  agua: 2, solo: 0, estacoes: ['Primavera', 'Verao', 'Outono'] },
  cenoura: { nome: 'Cenoura', minutos: 10,  nivel: 4,  xp: 5,  rende: 2, semente: 3,  preco: 6,  agua: 2, solo: 1, estacoes: ['Primavera', 'Outono', 'Inverno'] },
  abobora: { nome: 'Abobora', minutos: 30,  nivel: 5,  xp: 12, rende: 1, semente: 6,  preco: 20, agua: 3, solo: 2, estacoes: ['Verao', 'Outono'] },
  arroz:   { nome: 'Arroz',   minutos: 60,  nivel: 7,  xp: 20, rende: 2, semente: 8,  preco: 18, agua: 5, solo: 2, estacoes: ['Primavera', 'Verao'] },
  cafe:    { nome: 'Cafe',    minutos: 240, nivel: 10, xp: 60, rende: 1, semente: 20, preco: 90, agua: 3, solo: 3, estacoes: ['Outono', 'Inverno'] },
};

// Cadeia de producao: o segundo loop. "Sempre tem algo no forno".
export const PRODUTOS = {
  farinha: { nome: 'Farinha', maquina: 'moinho', entrada: { trigo: 2 },   minutos: 3,  xp: 3,  preco: 6 },
  pao:     { nome: 'Pao',     maquina: 'forno',  entrada: { farinha: 2 }, minutos: 5,  xp: 6,  preco: 16 },
  bolo:    { nome: 'Bolo',    maquina: 'forno',  entrada: { farinha: 2, milho: 2 }, minutos: 12, xp: 15, preco: 40 },
};

export const CONSTRUCOES = {
  moinho:      { nome: 'Moinho',      nivel: 3, custo: { madeira: 10, moedas: 40 }, efeito: 'moinho',     texto: 'Moi trigo em farinha (3 min). Farinha vale 3x o trigo.' },
  forno:       { nome: 'Forno',       nivel: 5, custo: { madeira: 15, pedra: 5, moedas: 80 }, efeito: 'forno', texto: 'Assa pao (5 min) e bolo (12 min) com farinha.' },
  poco:        { nome: 'Poco',        nivel: 2, custo: { madeira: 8,  moedas: 20 }, efeito: 'agua',      texto: 'Cuidar da sede consome metade da agua comum.' },
  colmeia:     { nome: 'Colmeia',     nivel: 4, custo: { madeira: 6,  moedas: 15 }, efeito: 'poliniza',  texto: '+15% de colheita para as herdades VIZINHAS.' },
  composteira: { nome: 'Composteira', nivel: 3, custo: { madeira: 5,  moedas: 10 }, efeito: 'solo',      texto: 'Recupera 2 de fertilidade por dia.' },
  celeiro:     { nome: 'Celeiro',     nivel: 6, custo: { madeira: 12, moedas: 30 }, efeito: 'estoque',   texto: '+20% no preco de venda.' },
  forja:       { nome: 'Forja',       nivel: 8, custo: { madeira: 14, pedra: 10, moedas: 40 }, efeito: 'ferramenta', poluicao: 2, texto: 'Machado e picareta descansam na metade do tempo, mas polui os vizinhos.' },
};

// Obras coletivas: ninguem conclui sozinho. E o contrato social do jogo.
export const OBRAS = {
  ponte:    { nome: 'Ponte',   custo: { madeira: 40, pedra: 20 },  bonus: 'velocidade', texto: 'Tudo cresce 10% mais rapido para TODOS.' },
  praca:    { nome: 'Praca',   custo: { madeira: 25, moedas: 100 }, bonus: 'harmonia',   texto: '+2 de harmonia por dia.' },
  acude:    { nome: 'Acude',   custo: { pedra: 35, moedas: 60 },   bonus: 'agua',       texto: 'A agua comum recarrega 50% mais rapido.' },
  escola:   { nome: 'Escola',  custo: { madeira: 30, pedra: 15, moedas: 80 }, bonus: 'sabedoria', texto: 'Colheitas rendem +1 unidade.' },
};

// XP por acao que nao e colheita nem producao.
export const XP = {
  plantar: 1, cuidar: 1, ajudar: 5, cortar: 2, minerar: 2, arvore: 4,
  construir: 10, doar: 3, presente: 2, abraco: 1, recado: 1, encomendaBase: 5, missao: 5,
};
/** XP acumulado necessario para estar no nivel n: 10, 30, 60, 100, 150... */
export const xpParaNivel = (n) => 5 * (n - 1) * n;
export function nivelDe(xp) {
  let n = 1;
  while (xpParaNivel(n + 1) <= xp) n++;
  return n;
}

export const TEMPO = {
  hora: HORA,
  minuto: MIN,
  descansoMachado: 3 * MIN,     // sem energia, a ferramenta e o limite
  descansoPicareta: 5 * MIN,
  // A planta pede ajuda (sede/praga/mato) e PARA ate alguem resolver.
  // So culturas de 10 min ou mais; nos pontos abaixo do crescimento.
  pedidoMinimoMinutos: 10,
  pontosDePedido: [0.4, 0.75],
  chanceSegundoPedido: 0.5,
};

export const PROBLEMAS = {
  sede:  { nome: 'sede',  icone: '💧', verbo: 'regou', agua: true },
  praga: { nome: 'praga', icone: '🐛', verbo: 'tirou a praga de' },
  mato:  { nome: 'mato',  icone: '🌿', verbo: 'capinou' },
};

// Missoes do dia: 3 sorteadas por dia (semente + dia), iguais para todos.
export const MISSOES = [
  { chave: 'cuidados',   meta: 3, texto: 'Cuide de 3 plantas',       premio: { moedas: 8 } },
  { chave: 'plantios',   meta: 6, texto: 'Plante 6 canteiros',       premio: { moedas: 6 } },
  { chave: 'colheitas',  meta: 8, texto: 'Colha 8 canteiros',        premio: { moedas: 12 } },
  { chave: 'ajudas',     meta: 1, texto: 'Ajude um parente',         premio: { moedas: 10 } },
  { chave: 'ajudas',     meta: 3, texto: 'Ajude 3 vezes',            premio: { moedas: 25 } },
  { chave: 'abracos',    meta: 2, texto: 'Abrace 2 pessoas',         premio: { moedas: 6 } },
  { chave: 'cortes',     meta: 2, texto: 'Corte lenha 2 vezes',      premio: { moedas: 8 } },
  { chave: 'arvores',    meta: 1, texto: 'Replante a mata',          premio: { moedas: 12 } },
  { chave: 'doacoes',    meta: 1, texto: 'Doe para a obra da vila',  premio: { moedas: 10 } },
  { chave: 'vendas',     meta: 3, texto: 'Venda 3 vezes',            premio: { moedas: 8 } },
  { chave: 'recados',    meta: 1, texto: 'Deixe um recado no mural', premio: { moedas: 4 } },
  { chave: 'encomendas', meta: 1, texto: 'Entregue uma encomenda',   premio: { moedas: 15 } },
  { chave: 'producoes',  meta: 2, texto: 'Produza 2 vezes',          premio: { moedas: 10 } },
];

// Limiares de destino: quando um comum cruza a linha, o mundo inteiro sente.
export const LIMIARES = {
  secaAgua: 25,
  desmatamento: 30,
  soloExausto: 30,
  harmoniaBaixa: 20,
  harmoniaAlta: 80,
};

export const SPRITES = ['🧑‍🌾', '👩‍🌾', '🧓', '👴', '👦', '👧', '🧔', '👵'];

/** Preco de venda de qualquer item do celeiro (cultura ou produto). */
export const precoDe = (chave) => CULTURAS[chave]?.preco ?? PRODUTOS[chave]?.preco ?? 0;
export const nomeDe = (chave) => CULTURAS[chave]?.nome ?? PRODUTOS[chave]?.nome ?? chave;
export const xpDe = (chave) => CULTURAS[chave]?.xp ?? PRODUTOS[chave]?.xp ?? 0;
