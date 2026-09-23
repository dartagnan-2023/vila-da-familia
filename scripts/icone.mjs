// Desenha o icone do jogo (uma horta vista de cima) e grava os PNGs que o
// celular usa pra por o atalho na tela de inicio. Sem dependencia: PNG na mao.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const COR = {
  grama: [124, 179, 66], grama2: [139, 195, 74], terra: [141, 85, 36], terraEscura: [93, 58, 26],
  planta: [67, 160, 71], trigo: [255, 193, 7], tronco: [74, 37, 17], copa: [45, 76, 30], copa2: [91, 140, 62],
};

function desenha(tam) {
  const px = Buffer.alloc(tam * tam * 3);
  const u = tam / 16;
  const rect = (x, y, w, h, cor) => {
    for (let j = Math.max(0, Math.round(y)); j < Math.min(tam, Math.round(y + h)); j++) {
      for (let i = Math.max(0, Math.round(x)); i < Math.min(tam, Math.round(x + w)); i++) {
        const p = (j * tam + i) * 3;
        px[p] = cor[0]; px[p + 1] = cor[1]; px[p + 2] = cor[2];
      }
    }
  };
  rect(0, 0, tam, tam, COR.grama);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) if ((i + j) % 2) rect(i * u, j * u, u, u, COR.grama2);
  rect(2 * u, 8 * u, 12 * u, 6 * u, COR.terra);                       // canteiro
  for (let r = 0; r < 3; r++) rect(2 * u, (9 + r * 2) * u, 12 * u, u / 2, COR.terraEscura);
  for (let i = 0; i < 4; i++) {                                        // pes de trigo
    rect((3.2 + i * 3) * u, 9 * u, 0.8 * u, 4 * u, COR.planta);
    rect((2.6 + i * 3) * u, 9.6 * u, 2 * u, 0.8 * u, COR.planta);
    rect((2.8 + i * 3) * u, 7.6 * u, 1.6 * u, 1.6 * u, COR.trigo);
  }
  rect(7.2 * u, 2 * u, 1.6 * u, 3 * u, COR.tronco);                    // arvore
  rect(5.5 * u, 0.6 * u, 5 * u, 3 * u, COR.copa);
  rect(6.2 * u, 0.2 * u, 3.6 * u, 1.6 * u, COR.copa2);
  return px;
}

const crcTab = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const bloco = (tipo, dados) => {
  const t = Buffer.from(tipo, 'ascii');
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const soma = Buffer.alloc(4); soma.writeUInt32BE(crc(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, soma]);
};

function png(tam) {
  const px = desenha(tam);
  const linhas = Buffer.alloc((tam * 3 + 1) * tam);
  for (let j = 0; j < tam; j++) {
    linhas[j * (tam * 3 + 1)] = 0; // filtro "nenhum"
    px.copy(linhas, j * (tam * 3 + 1) + 1, j * tam * 3, (j + 1) * tam * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas, { level: 9 })), bloco('IEND', Buffer.alloc(0)),
  ]);
}

for (const tam of [512, 192, 180]) {
  writeFileSync(new URL(`../web/icone-${tam}.png`, import.meta.url), png(tam));
  console.log(`web/icone-${tam}.png`);
}
