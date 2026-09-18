import { CULTURAS } from '../src/engine/conteudo.js';
import { estaMadura, duracaoCultura } from '../src/engine/tempo.js';

// ---------------------------------------------------------------------------
// O mundo desenhado. Tudo aqui e pixel art feita em codigo: nenhuma imagem
// externa, nenhuma fonte de icone. A paleta e a do DESIGN.md do Stitch.
//
// O canvas nao conhece regra: recebe `visao()` + o mundo, desenha, e devolve
// cliques ja traduzidos ("canteiro 4 da herdade h10", "casa de fulano").
// ---------------------------------------------------------------------------

const T = 16;                 // tamanho do tile em px (resolucao nativa)
const HERD = 7;               // herdade = 7x7 tiles (com cerca)
const GAP = 2;                // caminho entre herdades
const P = {
  grama: '#8fae5d', grama2: '#7a9a4a', grama3: '#a3c06e',
  caminho: '#d4b98b', caminho2: '#c4a878',
  terra: '#8b5a2b', terraMolhada: '#5e3a1a', terraSeca: '#b08a5a',
  cerca: '#a35c32', cercaEscura: '#4a2511',
  telhado: '#b84133', telhado2: '#93000a', parede: '#f5e6c8', porta: '#4a2511', janela: '#5c9ead',
  copa: '#2d4c1e', copa2: '#5b8c3e', tronco: '#4a2511',
  agua: '#5c9ead', agua2: '#7fb8c4', aguaBaixa: '#9ab3a0',
  pedra: '#72796b', pedra2: '#c2c9b8', ink: '#2b1b17', ouro: '#f4b83f',
  pele: '#f1c27d', calca: '#4a2511',
};
// A rua do comercio: quem faz as encomendas mora aqui. E a vendinha da familia.
export const LOJAS = [
  { cliente: 'a Padaria da Esquina', nome: 'PADARIA',   icone: '🍞', cor: '#f4b83f' },
  { cliente: 'o Mercadinho',         nome: 'MERCADO',   icone: '🛒', cor: '#5c9ead' },
  { cliente: 'a Feira de Domingo',   nome: 'FEIRA',     icone: '🧺', cor: '#a0d57e' },
  { cliente: 'a Escola',             nome: 'ESCOLA',    icone: '🏫', cor: '#fea776' },
  { cliente: 'o Restaurante do Zé',  nome: 'DO ZÉ',     icone: '🍲', cor: '#b84133' },
  { cliente: 'a Igreja',             nome: 'IGREJA',    icone: '⛪', cor: '#f5e6c8' },
  { cliente: 'a Pousada',            nome: 'POUSADA',   icone: '🛏️', cor: '#996d00' },
  { cliente: 'a Quermesse',          nome: 'QUERMESSE', icone: '🎪', cor: '#ff7a3d' },
  { cliente: null, chave: 'vendinha', nome: 'VENDINHA', icone: '🏪', cor: '#8f4d24' },
];
const LOJA_W = 3, LOJA_H = 4; // cada loja ocupa 3x4 tiles (placa, predio, calcada)

const ROUPAS = ['#b84133', '#5c9ead', '#f4b83f', '#5b8c3e', '#8f4d24', '#a0d57e', '#fea776', '#996d00'];
const CABELOS = ['#2b1b17', '#f5e6c8', '#8f4d24', '#4a2511', '#e7d9bb', '#221b08'];

// --- sprite do familiar (12x16), 3 frames: parado, passo 1, passo 2 ---------
const BONECO = [
  [
    '....kkkk....', '...khhhhk...', '..khhhhhhk..', '..kssssssk..', '..ksekkesk..', '..kssssssk..',
    '...kssssk...', '..kcccccck..', '.kscccccssk.', '.ksccccccsk.', '..kcccccck..', '...kppppk...',
    '...kppppk...', '...kp..pk...', '...kb..bk...', '...kk..kk...',
  ],
  [
    '....kkkk....', '...khhhhk...', '..khhhhhhk..', '..kssssssk..', '..ksekkesk..', '..kssssssk..',
    '...kssssk...', '..kcccccck..', '.kscccccssk.', '.ksccccccsk.', '..kcccccck..', '...kppppk...',
    '..kpp.kppk..', '..kp...kpk..', '..kb....bk..', '..kk....kk..',
  ],
  [
    '....kkkk....', '...khhhhk...', '..khhhhhhk..', '..kssssssk..', '..ksekkesk..', '..kssssssk..',
    '...kssssk...', '..kcccccck..', '.kscccccssk.', '.ksccccccsk.', '..kcccccck..', '...kppppk...',
    '..kppk.ppk..', '..kpk...pk..', '..kb....bk..', '..kk....kk..',
  ],
];

const cacheSprites = new Map();
function spriteBoneco(roupa, cabelo, frame) {
  const chave = `${roupa}|${cabelo}|${frame}`;
  if (cacheSprites.has(chave)) return cacheSprites.get(chave);
  const c = document.createElement('canvas');
  c.width = 12; c.height = 16;
  const g = c.getContext('2d');
  const cores = { k: P.ink, h: cabelo, s: P.pele, e: '#ffffff', c: roupa, p: P.calca, b: P.ink };
  BONECO[frame].forEach((linha, y) => [...linha].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = cores[ch]; g.fillRect(x, y, 1, 1);
  }));
  cacheSprites.set(chave, c);
  return c;
}

// Ruido deterministico por posicao: a grama nao pode "piscar" a cada frame.
const ruido = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// --- geometria -------------------------------------------------------------

function geometria(mundo) {
  const { l, a } = mundo.grade;
  const largura = GAP + l * (HERD + GAP);
  const rioAltura = 2;
  const ruaTopo = rioAltura + a * (HERD + GAP) + GAP;       // logo abaixo da ultima faixa de caminho
  const porLinha = Math.max(1, Math.floor((largura - 2) / LOJA_W));
  const linhasRua = Math.ceil(LOJAS.length / porLinha);
  const altura = ruaTopo + linhasRua * LOJA_H + 1;           // +1: fileira de mata embaixo
  return { l, a, largura, altura, rioAltura, ruaTopo, porLinha, linhasRua };
}

const posLoja = (i, geo) => ({ tx: 1 + (i % geo.porLinha) * LOJA_W, ty: geo.ruaTopo + Math.floor(i / geo.porLinha) * LOJA_H });
const indiceLoja = (chaveOuCliente) => LOJAS.findIndex((l) => l.cliente === chaveOuCliente || l.chave === chaveOuCliente);

const origemHerdade = (h, geo) => ({ tx: GAP + h.x * (HERD + GAP), ty: geo.rioAltura + GAP + h.y * (HERD + GAP) });

// Dentro da herdade: casa 2x2 em (1,1); canteiros 3x3 em (3..5, 2..4).
const tileCanteiro = (i) => ({ dx: 3 + (i % 3), dy: 2 + Math.floor(i / 3) });
const portaDaCasa = () => ({ dx: 2, dy: 3 });

// --- estado da cena (posicao dos bonecos sobrevive aos re-renders) ----------

export class VilaCanvas {
  constructor(container, { aoClicar }) {
    this.container = container;
    this.aoClicar = aoClicar;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'pointer';
    container.replaceChildren(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.bonecos = new Map(); // id -> { x, y, alvoX, alvoY, frame, passo, fala, roupa, cabelo }
    this.gotas = [];
    this.frame = 0;
    this.visao = null;
    this.mundo = null;
    this.canvas.addEventListener('click', (e) => this.#clique(e));
    this.#loop();
  }

  atualizar(visao, mundo) {
    this.visao = visao;
    this.mundo = mundo;
    const geo = geometria(mundo);
    if (this.canvas.width !== geo.largura * T) {
      this.canvas.width = geo.largura * T;
      this.canvas.height = geo.altura * T;
      this.ctx.imageSmoothingEnabled = false;
    }
    for (const p of Object.values(mundo.jogadores)) this.#alvoDe(p, geo);
  }

  // Para onde o boneco vai: o lugar do ultimo ato dele no feed.
  #alvoDe(p, geo) {
    const her = this.mundo.herdades[p.herdade];
    const casa = origemHerdade(her, geo);
    let b = this.bonecos.get(p.id);
    if (!b) {
      const n = Object.keys(this.mundo.jogadores).indexOf(p.id);
      b = { x: (casa.tx + 2) * T, y: (casa.ty + 3) * T, frame: 0, passo: 0, fala: null, falaAte: 0,
            roupa: ROUPAS[n % ROUPAS.length], cabelo: CABELOS[(n * 7 + 3) % CABELOS.length] };
      this.bonecos.set(p.id, b);
    }
    const ultimo = [...this.mundo.feed].reverse().find((l) => l.ator === p.id);
    let alvo = { tx: casa.tx + portaDaCasa().dx, ty: casa.ty + portaDaCasa().dy };
    let fala = null;
    if (ultimo && ultimo.tick === this.mundo.tick) {
      const ev = ultimo.ref ?? {};
      fala = FALAS[ultimo.tipo]?.() ?? null;
      if (ev.herdade && ev.tile != null && this.mundo.herdades[ev.herdade]) {
        const o = origemHerdade(this.mundo.herdades[ev.herdade], geo);
        const c = tileCanteiro(ev.tile);
        alvo = { tx: o.tx + c.dx, ty: o.ty + c.dy + 1 };
      } else if (ultimo.tipo === 'CORTOU_ARVORE' || ultimo.tipo === 'PLANTOU_ARVORE') {
        alvo = { tx: geo.largura - 3, ty: geo.rioAltura + 3 + (casa.ty % 5) };
      } else if (ultimo.tipo === 'MINEROU') {
        alvo = { tx: 1, ty: geo.altura - 1 };
      } else if (ultimo.tipo === 'ENCOMENDA_ENTREGUE' && indiceLoja(ev.cliente) >= 0) {
        const l = posLoja(indiceLoja(ev.cliente), geo);
        alvo = { tx: l.tx + 1, ty: l.ty + 3 };
      } else if (ultimo.tipo === 'ANUNCIOU' || ultimo.tipo === 'COMPROU' || ultimo.tipo === 'VENDEU') {
        const l = posLoja(indiceLoja('vendinha'), geo);
        alvo = { tx: l.tx + 1, ty: l.ty + 3 };
      } else if (ultimo.tipo === 'DOOU' || ultimo.tipo === 'RECADO') {
        alvo = this.#poco(geo);
        alvo = { tx: alvo.tx - 1, ty: alvo.ty + 1 };
      } else if (ev.para && this.mundo.jogadores[ev.para] && ev.para !== p.id) {
        const outra = origemHerdade(this.mundo.herdades[this.mundo.jogadores[ev.para].herdade], geo);
        alvo = { tx: outra.tx + 3, ty: outra.ty + 5 };
      }
    }
    b.alvoX = alvo.tx * T + 2;
    b.alvoY = alvo.ty * T;
    if (fala && ultimo.seq !== b.ultimoSeq) { b.ultimoSeq = ultimo.seq; b.fala = fala; b.falaAte = performance.now() + 6000; }
  }

  #poco(geo) {
    return { tx: Math.floor(geo.largura / 2), ty: geo.rioAltura + Math.floor((geo.altura - geo.rioAltura) / 2) };
  }

  #clique(e) {
    if (!this.mundo) return;
    const r = this.canvas.getBoundingClientRect();
    const esc = this.canvas.width / r.width;
    const tx = Math.floor(((e.clientX - r.left) * esc) / T);
    const ty = Math.floor(((e.clientY - r.top) * esc) / T);
    const geo = geometria(this.mundo);
    for (const h of Object.values(this.mundo.herdades)) {
      const o = origemHerdade(h, geo);
      if (tx < o.tx || ty < o.ty || tx >= o.tx + HERD || ty >= o.ty + HERD) continue;
      const dx = tx - o.tx, dy = ty - o.ty;
      const idx = dx >= 3 && dx <= 5 && dy >= 2 && dy <= 5 ? (dy - 2) * 3 + (dx - 3) : null;
      const canteiro = idx != null && idx < h.tiles.length ? idx : null;
      return this.aoClicar({ herdade: h.id, canteiro });
    }
    const poco = this.#poco(geo);
    if (Math.abs(tx - poco.tx) <= 1 && Math.abs(ty - poco.ty) <= 1) return this.aoClicar({ poco: true });
    for (let i = 0; i < LOJAS.length; i++) {
      const l = posLoja(i, geo);
      if (tx >= l.tx && tx < l.tx + LOJA_W && ty >= l.ty && ty < l.ty + LOJA_H) return this.aoClicar({ loja: LOJAS[i].chave ?? LOJAS[i].cliente });
    }
    if (ty < geo.rioAltura) return this.aoClicar({ rio: true });
  }

  #loop() {
    if (!this.canvas.isConnected && this.frame > 0) return; // aba trocou: para
    this.passo();
    requestAnimationFrame(() => this.#loop());
  }

  /** Um frame: anima e desenha. Publico para testes e para forcar redesenho. */
  passo() {
    this.frame++;
    if (this.mundo) this.#desenhar();
  }

  // --- desenho --------------------------------------------------------------

  #desenhar() {
    const { ctx, mundo, visao } = this;
    const geo = geometria(mundo);
    const c = mundo.comuns;

    // chao
    for (let ty = 0; ty < geo.altura; ty++) for (let tx = 0; tx < geo.largura; tx++) this.#grama(tx, ty);
    this.#rio(geo, c.agua);
    this.#caminhos(geo);
    this.#mata(geo, c.floresta);
    this.#pedreira(geo);
    this.#pocoDesenho(geo, c.agua);

    for (const h of Object.values(mundo.herdades)) this.#herdade(h, geo);
    this.#rua(geo);

    // bonecos: quem esta mais embaixo desenha por cima
    const lista = [...this.bonecos.entries()].sort((a, b) => a[1].y - b[1].y);
    for (const [id, b] of lista) this.#boneco(id, b);
    for (const [id, b] of lista) this.#fala(id, b);

    if (mundo.clima === 'chuva' || mundo.clima === 'tempestade') this.#chuva(geo, mundo.clima === 'tempestade');
    if (mundo.clima === 'sol_forte') this.#calor(geo);
    if (c.harmonia >= 80 && this.frame % 4 === 0) this.#confete(geo);
  }

  #grama(tx, ty) {
    const { ctx } = this;
    ctx.fillStyle = P.grama;
    ctx.fillRect(tx * T, ty * T, T, T);
    const r = ruido(tx, ty);
    ctx.fillStyle = r % 3 === 0 ? P.grama2 : P.grama3;
    ctx.fillRect(tx * T + (r % 13), ty * T + ((r >> 4) % 13), 2, 1);
    ctx.fillRect(tx * T + ((r >> 8) % 14), ty * T + ((r >> 12) % 14), 1, 2);
  }

  #rio(geo, agua) {
    const { ctx } = this;
    const nivel = Math.max(0.25, agua / 100);
    const altura = Math.round(geo.rioAltura * T * nivel);
    ctx.fillStyle = P.aguaBaixa;
    ctx.fillRect(0, 0, geo.largura * T, geo.rioAltura * T);
    ctx.fillStyle = agua < 25 ? '#8aa8a8' : P.agua;
    ctx.fillRect(0, geo.rioAltura * T - altura, geo.largura * T, altura);
    ctx.fillStyle = P.agua2;
    for (let x = 0; x < geo.largura * T; x += 12) {
      const y = geo.rioAltura * T - altura + 3 + Math.round(Math.sin((x + this.frame * 2) / 9) * 2);
      if (y > 0) ctx.fillRect(x + (this.frame >> 2) % 12, y, 5, 1);
    }
    // margem
    ctx.fillStyle = P.caminho;
    ctx.fillRect(0, geo.rioAltura * T - 2, geo.largura * T, 2);
  }

  #caminhos(geo) {
    const { ctx } = this;
    const faixa = (tx, ty, w, h) => {
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
        ctx.fillStyle = P.caminho; ctx.fillRect(x * T, y * T, T, T);
        const r = ruido(x, y);
        ctx.fillStyle = P.caminho2; ctx.fillRect(x * T + (r % 12), y * T + ((r >> 5) % 12), 3, 2);
      }
    };
    for (let i = 0; i <= geo.l; i++) faixa(i * (HERD + GAP), geo.rioAltura, GAP, geo.altura - geo.rioAltura);
    for (let j = 0; j <= geo.a; j++) faixa(0, geo.rioAltura + j * (HERD + GAP), geo.largura, GAP);
  }

  #mata(geo, floresta) {
    // Arvores na faixa direita e inferior; quantas, depende da mata comum.
    const vagas = [];
    const naRua = (tx, ty) => ty >= geo.ruaTopo && ty < geo.altura - 1 && tx >= 1 && tx < 1 + geo.porLinha * LOJA_W;
    for (let ty = geo.rioAltura; ty < geo.altura; ty++) for (const tx of [geo.largura - 1, geo.largura - 2]) if (!naRua(tx, ty)) vagas.push([tx, ty]);
    for (let tx = 2; tx < geo.largura - 2; tx++) vagas.push([tx, geo.altura - 1]);
    const n = Math.round(vagas.length * (floresta / 100));
    vagas.forEach(([tx, ty], i) => {
      if ((ruido(tx, ty) % vagas.length) < n) this.#arvore(tx * T + (ruido(ty, tx) % 5), ty * T);
    });
  }

  #arvore(x, y) {
    const { ctx } = this;
    ctx.fillStyle = P.tronco; ctx.fillRect(x + 6, y + 10, 3, 6);
    ctx.fillStyle = P.copa; ctx.fillRect(x + 2, y + 3, 11, 9);
    ctx.fillStyle = P.copa2; ctx.fillRect(x + 4, y + 1, 7, 4); ctx.fillRect(x + 3, y + 5, 4, 3);
    ctx.fillStyle = P.ink; ctx.fillRect(x + 2, y + 12, 11, 1);
  }

  #pedreira(geo) {
    const { ctx } = this;
    const x = 0, y = (geo.altura - 1) * T;
    ctx.fillStyle = P.pedra; ctx.fillRect(x + 2, y + 6, 12, 10);
    ctx.fillStyle = P.pedra2; ctx.fillRect(x + 4, y + 8, 4, 3); ctx.fillRect(x + 9, y + 11, 3, 2);
    ctx.fillStyle = P.ink; ctx.fillRect(x + 2, y + 15, 12, 1);
  }

  #pocoDesenho(geo, agua) {
    const { ctx } = this;
    const p = this.#poco(geo);
    const x = p.tx * T, y = p.ty * T;
    ctx.fillStyle = P.caminho; ctx.fillRect(x - T, y - T, 3 * T, 3 * T);
    ctx.fillStyle = P.pedra; ctx.fillRect(x + 1, y + 6, 14, 9);
    ctx.fillStyle = agua < 25 ? P.aguaBaixa : P.agua; ctx.fillRect(x + 4, y + 8, 8, 4);
    ctx.fillStyle = P.tronco; ctx.fillRect(x + 2, y, 2, 8); ctx.fillRect(x + 12, y, 2, 8);
    ctx.fillStyle = P.telhado; ctx.fillRect(x, y - 2, 16, 3);
    ctx.fillStyle = P.ink; ctx.fillRect(x + 1, y + 14, 14, 1);
  }

  #herdade(h, geo) {
    const { ctx, mundo } = this;
    const o = origemHerdade(h, geo);
    const X = o.tx * T, Y = o.ty * T;
    if (!h.dono) {
      // terra livre: pasto com placa
      ctx.fillStyle = P.grama3; ctx.fillRect(X + T, Y + T, (HERD - 2) * T, (HERD - 2) * T);
      this.#placa(X + 3 * T, Y + 3 * T, 'LIVRE');
      return;
    }
    const eu = this.visao?.hud?.id === h.dono;
    // cerca
    ctx.fillStyle = eu ? P.ouro : P.cerca;
    for (let i = 0; i < HERD; i++) {
      ctx.fillRect(X + i * T + 6, Y + 4, 3, 8); ctx.fillRect(X + i * T + 6, Y + (HERD - 1) * T + 4, 3, 8);
      ctx.fillRect(X + 6, Y + i * T + 4, 3, 8); ctx.fillRect(X + (HERD - 1) * T + 6, Y + i * T + 4, 3, 8);
    }
    ctx.fillStyle = eu ? '#c48a10' : P.cercaEscura;
    ctx.fillRect(X + 6, Y + 8, HERD * T - 12, 2); ctx.fillRect(X + 6, Y + (HERD - 1) * T + 8, HERD * T - 12, 2);
    ctx.fillRect(X + 6, Y + 8, 2, HERD * T - 12); ctx.fillRect(X + (HERD - 1) * T + 6, Y + 8, 2, HERD * T - 12);
    // poluicao: fumaca assentada sobre a herdade
    if (h.poluicao > 20) {
      ctx.fillStyle = `rgba(66,73,60,${Math.min(0.45, h.poluicao / 200)})`;
      ctx.fillRect(X + T, Y + T, (HERD - 2) * T, (HERD - 2) * T);
    }
    this.#casa(X + T, Y + T, eu);
    h.tiles.forEach((t, i) => {
      const c = tileCanteiro(i);
      this.#canteiro(X + c.dx * T, Y + c.dy * T, t, h, mundo);
    });
    // benfeitorias em (1,4) (1,5) (2,5)
    const lugares = [[1, 4], [1, 5], [2, 5]];
    h.construcoes.forEach((efeito, i) => {
      const [dx, dy] = lugares[i] ?? [2, 4];
      this.#benfeitoria(X + dx * T, Y + dy * T, efeito);
    });
    // nome
    this.#etiqueta(X + HERD * T / 2, Y - 3, (h.nome ?? '').replace(/^Herdade /, ''), eu);
  }

  #casa(x, y, eu) {
    const { ctx } = this;
    ctx.fillStyle = P.parede; ctx.fillRect(x + 2, y + 12, 28, 18);
    ctx.fillStyle = P.telhado; ctx.fillRect(x, y + 4, 32, 10);
    ctx.fillStyle = P.telhado2; ctx.fillRect(x, y + 12, 32, 2); ctx.fillRect(x + 4, y + 2, 24, 3);
    ctx.fillStyle = P.porta; ctx.fillRect(x + 20, y + 20, 7, 10);
    ctx.fillStyle = P.janela; ctx.fillRect(x + 6, y + 18, 7, 6);
    ctx.fillStyle = P.ink; ctx.fillRect(x + 2, y + 30, 28, 1); ctx.fillRect(x + 9, y + 18, 1, 6); ctx.fillRect(x + 6, y + 21, 7, 1);
    // chamine com fumaca
    ctx.fillStyle = P.pedra; ctx.fillRect(x + 24, y - 2, 4, 6);
    ctx.fillStyle = 'rgba(245,230,200,.7)';
    const f = (this.frame >> 3) % 4;
    ctx.fillRect(x + 25 - f, y - 5 - f * 2, 3, 2);
    if (eu) { ctx.fillStyle = P.ouro; ctx.fillRect(x + 14, y - 6, 2, 8); ctx.fillRect(x + 16, y - 6, 6, 4); }
  }

  #canteiro(x, y, t, h, mundo) {
    const { ctx } = this;
    const fert = h.fertilidade;
    ctx.fillStyle = t && !t.problema ? P.terraMolhada : fert < 40 ? P.terraSeca : P.terra;
    ctx.fillRect(x + 1, y + 1, 14, 14);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    for (let s = 3; s < 14; s += 4) ctx.fillRect(x + 1, y + s, 14, 1);
    if (!t) return;
    const c = CULTURAS[t.cultura];
    const prog = Math.min(1, (t.progresso ?? 0) / duracaoCultura(t.cultura));
    const cor = { trigo: '#f4b83f', milho: '#f9bc43', abobora: '#fea776', arroz: '#a0d57e', flor: '#ffdbca' }[t.cultura];
    const balanco = Math.round(Math.sin((this.frame + x) / 14));
    if (prog < 0.34) {
      ctx.fillStyle = P.copa2; ctx.fillRect(x + 7, y + 9, 2, 4); ctx.fillRect(x + 5 + balanco, y + 8, 2, 2);
    } else if (prog < 1) {
      ctx.fillStyle = P.copa2; ctx.fillRect(x + 7, y + 5, 2, 9);
      ctx.fillRect(x + 4 + balanco, y + 7, 3, 2); ctx.fillRect(x + 9 + balanco, y + 9, 3, 2);
    } else {
      ctx.fillStyle = P.copa2; ctx.fillRect(x + 7, y + 6, 2, 8);
      ctx.fillStyle = cor; ctx.fillRect(x + 4 + balanco, y + 2, 8, 6);
      ctx.fillStyle = P.ouro; ctx.fillRect(x + 12, y + 1 + ((this.frame >> 4) % 2), 2, 2);
    }
    // A planta esta pedindo: marca piscando (gota azul, praga vermelha, mato verde).
    if (t.problema && (this.frame >> 4) % 2 === 0) {
      ctx.fillStyle = { sede: P.agua, praga: '#b84133', mato: '#2d4c1e' }[t.problema] ?? P.ouro;
      ctx.fillRect(x + 11, y + 1, 4, 4);
      ctx.fillStyle = P.parede; ctx.fillRect(x + 12, y + 2, 1, 1);
    }
  }

  #benfeitoria(x, y, efeito) {
    const { ctx } = this;
    if (efeito === 'agua') { // poco
      ctx.fillStyle = P.pedra; ctx.fillRect(x + 3, y + 7, 10, 8); ctx.fillStyle = P.agua; ctx.fillRect(x + 5, y + 9, 6, 3);
      ctx.fillStyle = P.telhado; ctx.fillRect(x + 2, y + 2, 12, 3);
    } else if (efeito === 'poliniza') { // colmeia
      ctx.fillStyle = P.ouro; ctx.fillRect(x + 4, y + 6, 8, 9); ctx.fillStyle = P.ink;
      ctx.fillRect(x + 4, y + 9, 8, 1); ctx.fillRect(x + 4, y + 12, 8, 1);
      const bx = x + 8 + Math.round(Math.cos(this.frame / 7) * 6), by = y + 3 + Math.round(Math.sin(this.frame / 5) * 2);
      ctx.fillRect(bx, by, 2, 1);
    } else if (efeito === 'solo') { // composteira
      ctx.fillStyle = P.tronco; ctx.fillRect(x + 3, y + 7, 10, 8); ctx.fillStyle = P.terraMolhada; ctx.fillRect(x + 5, y + 5, 6, 4);
    } else if (efeito === 'estoque') { // celeiro
      ctx.fillStyle = P.cerca; ctx.fillRect(x + 2, y + 6, 12, 9); ctx.fillStyle = P.telhado2; ctx.fillRect(x + 1, y + 3, 14, 4);
    } else if (efeito === 'moinho') {
      ctx.fillStyle = P.parede; ctx.fillRect(x + 5, y + 6, 6, 9); ctx.fillStyle = P.telhado; ctx.fillRect(x + 4, y + 4, 8, 3);
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1; const a = this.frame / 20; ctx.beginPath();
      for (let k = 0; k < 4; k++) { const ang = a + k * Math.PI / 2; ctx.moveTo(x + 8, y + 6); ctx.lineTo(x + 8 + Math.cos(ang) * 6, y + 6 + Math.sin(ang) * 6); }
      ctx.stroke();
    } else if (efeito === 'forno') {
      ctx.fillStyle = P.pedra; ctx.fillRect(x + 3, y + 6, 10, 9); ctx.fillStyle = '#ff7a3d'; ctx.fillRect(x + 6, y + 10, 4, 3);
      ctx.fillStyle = P.telhado2; ctx.fillRect(x + 5, y + 3, 6, 3);
    } else if (efeito === 'ferramenta') { // forja
      ctx.fillStyle = P.pedra; ctx.fillRect(x + 3, y + 6, 10, 9); ctx.fillStyle = '#ff7a3d'; ctx.fillRect(x + 6, y + 10, 4, 3);
      ctx.fillStyle = 'rgba(66,73,60,.8)'; ctx.fillRect(x + 6 - ((this.frame >> 2) % 5), y - ((this.frame >> 2) % 5), 4, 3);
    }
  }

  // A rua: cada cliente das encomendas e um predinho; o meu pedido pronto acende a loja.
  #rua(geo) {
    const { ctx, visao } = this;
    const minhas = visao?.encomendas ?? [];
    // calcada continua
    for (let li = 0; li < geo.linhasRua; li++) {
      const ty = geo.ruaTopo + li * LOJA_H + 3;
      for (let tx = 0; tx < geo.largura - 2; tx++) {
        ctx.fillStyle = P.caminho; ctx.fillRect(tx * T, ty * T, T, T);
        const r = ruido(tx, ty); ctx.fillStyle = P.caminho2; ctx.fillRect(tx * T + (r % 12), ty * T + ((r >> 5) % 12), 3, 2);
      }
    }
    LOJAS.forEach((loja, i) => {
      const p = posLoja(i, geo);
      const x = p.tx * T, y = p.ty * T;
      const enc = loja.cliente ? minhas.filter((e) => e.cliente === loja.cliente) : [];
      const pronta = enc.some((e) => e.pronta);
      const pendente = enc.length > 0;
      const vendinha = loja.chave === 'vendinha';
      const lotes = vendinha ? (visao?.vendinha?.length ?? 0) : 0;
      // predio 44x30 dentro de 48x64
      const bx = x + 2, by = y + T + 2;
      ctx.fillStyle = loja.cor; ctx.fillRect(bx, by + 8, 44, 22);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(bx, by + 28, 44, 2);
      ctx.fillStyle = P.telhado2; ctx.fillRect(bx - 2, by + 2, 48, 8);
      ctx.fillStyle = P.telhado; ctx.fillRect(bx, by, 44, 3);
      if (loja.cliente === 'a Igreja') { ctx.fillStyle = P.parede; ctx.fillRect(bx + 19, by - 10, 6, 12); ctx.fillStyle = P.ink; ctx.fillRect(bx + 21, by - 14, 2, 7); ctx.fillRect(bx + 19, by - 12, 6, 2); }
      if (vendinha) { ctx.fillStyle = P.parede; for (let k = 0; k < 44; k += 8) ctx.fillRect(bx + k, by + 2, 4, 8); }
      ctx.fillStyle = P.porta; ctx.fillRect(bx + 18, by + 18, 8, 12);
      ctx.fillStyle = P.janela; ctx.fillRect(bx + 5, by + 15, 8, 7); ctx.fillRect(bx + 31, by + 15, 8, 7);
      ctx.fillStyle = P.ink; ctx.fillRect(bx + 5, by + 18, 8, 1); ctx.fillRect(bx + 31, by + 18, 8, 1);
      // letreiro com o icone
      ctx.font = '10px serif'; ctx.textAlign = 'center'; ctx.fillStyle = P.ink;
      ctx.fillText(loja.icone, bx + 22, by + 1);
      // estado do meu pedido: pronta acende e pisca; pendente mostra o bilhete
      if (pronta) {
        ctx.fillStyle = (this.frame >> 3) % 2 ? P.ouro : '#ffdea8';
        ctx.fillRect(bx - 3, by - 1, 50, 2); ctx.fillRect(bx - 3, by + 30, 50, 2); ctx.fillRect(bx - 3, by - 1, 2, 33); ctx.fillRect(bx + 45, by - 1, 2, 33);
        ctx.fillStyle = P.ouro; ctx.fillRect(bx + 36, by - 12 + ((this.frame >> 3) % 2), 8, 9);
        ctx.fillStyle = P.ink; ctx.font = 'bold 8px "Space Mono", monospace'; ctx.fillText('!', bx + 40, by - 4 + ((this.frame >> 3) % 2));
      } else if (pendente) {
        ctx.fillStyle = P.parede; ctx.fillRect(bx + 37, by - 8, 7, 8);
        ctx.fillStyle = P.ink; ctx.fillRect(bx + 38, by - 6, 5, 1); ctx.fillRect(bx + 38, by - 4, 5, 1); ctx.fillRect(bx + 38, by - 2, 3, 1);
      }
      if (vendinha && lotes) {
        ctx.fillStyle = P.ouro; ctx.fillRect(bx + 36, by - 10, 9, 9);
        ctx.fillStyle = P.ink; ctx.font = 'bold 7px "Space Mono", monospace'; ctx.fillText(String(lotes), bx + 40.5, by - 3);
      }
      this.#etiqueta(x + (LOJA_W * T) / 2, y + LOJA_H * T - 5, loja.nome, pronta);
    });
  }

  #placa(x, y, texto) {
    const { ctx } = this;
    ctx.fillStyle = P.tronco; ctx.fillRect(x + 7, y + 6, 2, 10);
    ctx.fillStyle = P.parede; ctx.fillRect(x - 6, y, 28, 8);
    ctx.fillStyle = P.ink; ctx.font = '6px "Space Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(texto, x + 8, y + 6);
  }

  #etiqueta(cx, y, texto, destaque) {
    const { ctx } = this;
    ctx.font = 'bold 7px "Space Mono", monospace'; ctx.textAlign = 'center';
    const w = ctx.measureText(texto).width + 6;
    ctx.fillStyle = destaque ? P.ouro : P.parede; ctx.fillRect(cx - w / 2, y - 8, w, 9);
    ctx.fillStyle = P.ink; ctx.fillRect(cx - w / 2, y + 1, w, 1);
    ctx.fillText(texto.toUpperCase(), cx, y - 1);
  }

  #boneco(id, b) {
    const { ctx } = this;
    // anda em L: primeiro x, depois y
    const v = 0.9;
    let andando = false;
    if (Math.abs(b.alvoX - b.x) > v) { b.x += Math.sign(b.alvoX - b.x) * v; andando = true; }
    else if (Math.abs(b.alvoY - b.y) > v) { b.y += Math.sign(b.alvoY - b.y) * v; andando = true; }
    else { b.x = b.alvoX; b.y = b.alvoY; }
    if (andando) { b.passo++; b.frame = 1 + ((b.passo >> 3) % 2); } else b.frame = 0;
    const bob = !andando && (this.frame >> 4) % 2 === 0 ? 0 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 15, 8, 2);
    ctx.drawImage(spriteBoneco(b.roupa, b.cabelo, b.frame), Math.round(b.x), Math.round(b.y) - bob);
    if (this.visao?.hud?.id === id) {
      ctx.fillStyle = P.ouro; ctx.fillRect(Math.round(b.x) + 5, Math.round(b.y) - 6 + ((this.frame >> 3) % 2), 2, 2);
    }
  }

  #fala(id, b) {
    const { ctx, mundo } = this;
    const nome = mundo.jogadores[id]?.nome ?? id;
    ctx.font = '6px "Space Mono", monospace'; ctx.textAlign = 'center';
    const mostraFala = b.fala && performance.now() < b.falaAte;
    const texto = mostraFala ? b.fala : nome;
    const w = ctx.measureText(texto).width + 6;
    const x = Math.round(b.x) + 6, y = Math.round(b.y) - 10;
    ctx.fillStyle = mostraFala ? P.parede : 'rgba(43,27,23,.75)';
    ctx.fillRect(x - w / 2, y - 7, w, 9);
    if (mostraFala) { ctx.fillStyle = P.parede; ctx.fillRect(x - 1, y + 2, 2, 2); }
    ctx.fillStyle = mostraFala ? P.ink : P.parede;
    ctx.fillText(texto, x, y);
  }

  #chuva(geo, forte) {
    const { ctx } = this;
    if (this.gotas.length < (forte ? 90 : 40)) this.gotas.push({ x: Math.random() * geo.largura * T, y: -5, v: 3 + Math.random() * 2 });
    ctx.fillStyle = forte ? 'rgba(92,158,173,.9)' : 'rgba(127,184,196,.8)';
    for (const g of this.gotas) { g.y += g.v; g.x -= 0.5; ctx.fillRect(g.x, g.y, 1, 4); }
    this.gotas = this.gotas.filter((g) => g.y < geo.altura * T);
    ctx.fillStyle = 'rgba(56,48,27,.12)'; ctx.fillRect(0, 0, geo.largura * T, geo.altura * T);
  }

  #calor(geo) {
    this.ctx.fillStyle = 'rgba(244,184,63,.10)';
    this.ctx.fillRect(0, 0, geo.largura * T, geo.altura * T);
  }

  #confete(geo) {
    const { ctx } = this;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = ROUPAS[(i + this.frame) % ROUPAS.length];
      ctx.fillRect((ruido(i, this.frame >> 2) % (geo.largura * T)), ((this.frame * 3 + i * 40) % (geo.altura * T)), 2, 2);
    }
  }
}

// O que o boneco diz sobre o ultimo ato do dia (curto: cabe no balao).
const FALAS = {
  PLANTOU: () => 'plantando...',
  REGOU: () => 'regando 💧',
  COLHEU: () => 'colhendo!',
  CORTOU_ARVORE: () => 'cortando lenha',
  PLANTOU_ARVORE: () => 'plantando mudas',
  MINEROU: () => 'na pedreira',
  CONSTRUIU: () => 'construindo',
  AJUDOU: () => 'dando uma mão',
  PRESENTEOU: () => 'levando presente',
  ABRACOU: () => 'abraço!',
  DOOU: () => 'doando pra obra',
  RECADO: () => 'deixou recado',
  VENDEU: () => 'vendendo',
  ENCOMENDA_ENTREGUE: () => 'entregando 📦',
  ANUNCIOU: () => 'na vendinha',
  COMPROU: () => 'comprando',
  JOGADOR_ENTROU: () => 'cheguei!',
};
