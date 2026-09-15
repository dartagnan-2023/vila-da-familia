// ---------------------------------------------------------------------------
// Todo o balanceamento vive aqui. Mexer nestes numeros muda o jogo inteiro
// sem tocar em uma linha de logica.
// ---------------------------------------------------------------------------

export const CONFIG = {
  diasPorEstacao: 12,
  energiaMax: 10,
  comumMax: 100,
  tilesPorHerdade: 9,
  canteirosMax: 12,            // 9 de nascenca + ate 3 comprados
  precoCanteiro: [60, 90, 120], // o 10o, o 11o e o 12o
  construcoesPorHerdade: 3,
  feedMax: 300,
};

export const ESTACOES = ['Primavera', 'Verao', 'Outono', 'Inverno'];

// O jogo roda em tempo real: `horas` e quanto tempo MOLHADA a planta precisa
// para ficar pronta. `dias` fica so como referencia legada (vilas antigas).
export const CULTURAS = {
  trigo:   { nome: 'Trigo',   horas: 2, dias: 3, agua: 2, solo: 1, semente: 2,  preco: 7,  estacoes: ['Primavera', 'Verao'] },
  milho:   { nome: 'Milho',   horas: 4, dias: 4, agua: 3, solo: 2, semente: 3,  preco: 11, estacoes: ['Verao'] },
  abobora: { nome: 'Abobora', horas: 8, dias: 6, agua: 4, solo: 3, semente: 5,  preco: 20, estacoes: ['Outono'] },
  arroz:   { nome: 'Arroz',   horas: 6, dias: 5, agua: 7, solo: 2, semente: 4,  preco: 16, estacoes: ['Primavera', 'Verao'] },
  flor:    { nome: 'Flor',    horas: 1, dias: 2, agua: 1, solo: 0, semente: 1,  preco: 4,  estacoes: ESTACOES, poliniza: true, harmonia: 1 },
};

const MIN = 60_000, HORA = 60 * MIN;
export const TEMPO = {
  hora: HORA,
  aguaDura: 4 * HORA,          // uma rega hidrata por 4h
  regenEnergia: 10 * MIN,      // +1 de energia a cada 10 min (alem da recarga cheia a meia-noite)
  secoParaEstresse: 3 * HORA,  // cada 3h sem agua = 1 ponto de estresse (menos colheita)
  remolharAntes: 60 * MIN,     // so deixa regar de novo quando falta menos de 1h de agua
};

// Missoes do dia: 3 sorteadas por dia (semente + dia), iguais para todos.
// `chave` e o contador em `jogador.hoje`.
export const MISSOES = [
  { chave: 'regas',     meta: 4, texto: 'Regue 4 canteiros',           premio: { moedas: 8 } },
  { chave: 'plantios',  meta: 3, texto: 'Plante 3 canteiros',          premio: { moedas: 6 } },
  { chave: 'colheitas', meta: 3, texto: 'Colha 3 canteiros',           premio: { moedas: 10 } },
  { chave: 'ajudas',    meta: 1, texto: 'Ajude um parente',            premio: { moedas: 10, energia: 2 } },
  { chave: 'ajudas',    meta: 3, texto: 'Ajude 3 vezes',               premio: { moedas: 20, energia: 3 } },
  { chave: 'abracos',   meta: 2, texto: 'Abrace 2 pessoas',            premio: { energia: 2 } },
  { chave: 'cortes',    meta: 2, texto: 'Corte lenha 2 vezes',         premio: { moedas: 8 } },
  { chave: 'arvores',   meta: 1, texto: 'Replante a mata',             premio: { moedas: 12 } },
  { chave: 'doacoes',   meta: 1, texto: 'Doe para a obra da vila',     premio: { moedas: 10, energia: 1 } },
  { chave: 'vendas',    meta: 1, texto: 'Venda a colheita',            premio: { energia: 2 } },
  { chave: 'recados',   meta: 1, texto: 'Deixe um recado no mural',    premio: { energia: 1 } },
];

export const CONSTRUCOES = {
  poco:        { nome: 'Poco',        custo: { madeira: 8,  moedas: 20 }, efeito: 'agua',      texto: 'Consome metade da agua comum ao regar.' },
  colmeia:     { nome: 'Colmeia',     custo: { madeira: 6,  moedas: 15 }, efeito: 'poliniza',  texto: '+15% de colheita para as herdades VIZINHAS.' },
  composteira: { nome: 'Composteira', custo: { madeira: 5,  moedas: 10 }, efeito: 'solo',      texto: 'Recupera 2 de fertilidade por dia.' },
  celeiro:     { nome: 'Celeiro',     custo: { madeira: 12, moedas: 30 }, efeito: 'estoque',   texto: '+20% no preco de venda.' },
  forja:       { nome: 'Forja',       custo: { madeira: 14, pedra: 10, moedas: 40 }, efeito: 'ferramenta', poluicao: 2, texto: 'Acoes custam -1 energia, mas polui os vizinhos.' },
};

// Obras coletivas: ninguem conclui sozinho. E o contrato social do jogo.
export const OBRAS = {
  ponte:    { nome: 'Ponte',   custo: { madeira: 40, pedra: 20 },  bonus: 'energia',  texto: '+1 energia diaria para TODOS.' },
  praca:    { nome: 'Praca',   custo: { madeira: 25, moedas: 100 }, bonus: 'harmonia', texto: '+2 de harmonia por dia.' },
  acude:    { nome: 'Acude',   custo: { pedra: 35, moedas: 60 },   bonus: 'agua',     texto: 'A agua comum recarrega 50% mais rapido.' },
  escola:   { nome: 'Escola',  custo: { madeira: 30, pedra: 15, moedas: 80 }, bonus: 'sabedoria', texto: 'Colheitas rendem +1 unidade.' },
};

export const CUSTO_ENERGIA = {
  PLANTAR: 1, REGAR: 1, COLHER: 1, CORTAR: 2, MINERAR: 2,
  PLANTAR_ARVORE: 2, CONSTRUIR: 3, AJUDAR: 2, VENDER: 0, PRESENTEAR: 0, DOAR: 0,
};

// Limiares de destino: quando um comum cruza a linha, o mundo inteiro sente.
export const LIMIARES = {
  secaAgua: 25,
  desmatamento: 30,
  soloExausto: 30,
  harmoniaBaixa: 20,
  harmoniaAlta: 80,
};

export const SPRITES = ['🧑‍🌾', '👩‍🌾', '🧓', '👴', '👦', '👧', '🧔', '👵'];
