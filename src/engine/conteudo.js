// ---------------------------------------------------------------------------
// Todo o balanceamento vive aqui. Mexer nestes numeros muda o jogo inteiro
// sem tocar em uma linha de logica.
// ---------------------------------------------------------------------------

export const CONFIG = {
  diasPorEstacao: 12,
  energiaMax: 10,
  comumMax: 100,
  tilesPorHerdade: 9,
  construcoesPorHerdade: 3,
  feedMax: 300,
};

export const ESTACOES = ['Primavera', 'Verao', 'Outono', 'Inverno'];

export const CULTURAS = {
  trigo:   { nome: 'Trigo',   dias: 3, agua: 2, solo: 1, semente: 2,  preco: 7,  estacoes: ['Primavera', 'Verao'] },
  milho:   { nome: 'Milho',   dias: 4, agua: 3, solo: 2, semente: 3,  preco: 11, estacoes: ['Verao'] },
  abobora: { nome: 'Abobora', dias: 6, agua: 4, solo: 3, semente: 5,  preco: 20, estacoes: ['Outono'] },
  arroz:   { nome: 'Arroz',   dias: 5, agua: 7, solo: 2, semente: 4,  preco: 16, estacoes: ['Primavera', 'Verao'] },
  flor:    { nome: 'Flor',    dias: 2, agua: 1, solo: 0, semente: 1,  preco: 4,  estacoes: ESTACOES, poliniza: true, harmonia: 1 },
};

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
