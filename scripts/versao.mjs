// Carimba a versao publicada: web/versao.js (o que esta rodando) e
// web/versao.json (o que o servidor tem). O jogo compara os dois e se atualiza.
import { writeFileSync } from 'node:fs';
const v = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
writeFileSync(new URL('../web/versao.js', import.meta.url), `export const VERSAO = '${v}';\n`);
writeFileSync(new URL('../web/versao.json', import.meta.url), JSON.stringify({ v }) + '\n');
console.log('versao', v);
