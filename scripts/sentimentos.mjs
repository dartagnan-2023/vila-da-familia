// O que a família sentiu, lido direto do log da vila.
//
//   npm run sentir -- VILA-XXXXX-XXXXX
//
// Sai um resumo por emoção, por pessoa e por assunto, e TODO texto escrito —
// que é o que de fato vira mudança na próxima versão. Só leitura.
import { readFileSync } from 'node:fs';
import { EMOCOES } from '../src/engine/conteudo.js';

const chave = process.argv[2];
if (!chave) {
  console.error('uso: npm run sentir -- VILA-XXXXX-XXXXX');
  process.exit(1);
}

const cfg = readFileSync(new URL('../web/config.js', import.meta.url), 'utf-8');
const pega = (nome) => cfg.match(new RegExp(`${nome}\\s*=\\s*['"]([^'"]+)`))?.[1];
const URL_SB = pega('SUPABASE_URL'), KEY = pega('SUPABASE_KEY');
if (!URL_SB) { console.error('web/config.js sem SUPABASE_URL'); process.exit(1); }

const rpc = async (fn, corpo) => {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
};

const vilas = await rpc('entrar_na_vila', { p_chave: chave.toUpperCase() });
const vila = vilas[0];
if (!vila) { console.error('nenhuma vila com essa chave'); process.exit(1); }

// O log vem em páginas de 1000; lê até vir vazia.
const cmds = [];
for (let desde = 0; ; ) {
  const pagina = await rpc('ler_comandos', { p_vila: vila.id, p_desde: desde });
  if (!pagina.length) break;
  cmds.push(...pagina.map((r) => ({ ordem: r.ordem, ...r.dados })));
  desde = pagina.at(-1).ordem;
}

const nomes = {};
for (const c of cmds) if (c.tipo === 'ENTRAR') nomes[c.por] = c.nome;
const sentires = cmds.filter((c) => c.tipo === 'SENTIR');

console.log(`\n=== ${vila.nome} (${chave}) — ${cmds.length} comandos, ${sentires.length} reações ===\n`);
if (!sentires.length) {
  console.log('Ninguém reagiu ainda. O Pipo pergunta depois de entregar pedido, ajudar, subir de nível ou voltar de uns dias fora.\n');
  process.exit(0);
}

const conta = (chaveDe) => sentires.reduce((m, s) => { const k = chaveDe(s) || '—'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
const tabela = (titulo, mapa, rotulo = (k) => k) => {
  console.log(titulo);
  for (const [k, n] of Object.entries(mapa).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(rotulo(k)).padEnd(26)} ${String(n).padStart(3)}  ${'█'.repeat(n)}`);
  }
  console.log('');
};

tabela('Por emoção:', conta((s) => s.emocao), (k) => `${EMOCOES[k]?.icone ?? '·'} ${EMOCOES[k]?.nome ?? k}`);
tabela('Por pessoa:', conta((s) => nomes[s.por] ?? s.por));
tabela('Sobre o quê:', conta((s) => s.sobre));

const ruins = new Set(Object.entries(EMOCOES).filter(([, e]) => e.cor === 'ruim').map(([k]) => k));
const dor = sentires.filter((s) => ruins.has(s.emocao));
if (dor.length) {
  const alvo = {};
  for (const s of dor) { const k = s.sobre || '—'; alvo[k] = (alvo[k] ?? 0) + 1; }
  tabela('⚠ Onde dói (irritou / não entendi):', alvo);
}

const escritos = sentires.filter((s) => s.texto);
console.log(`O que escreveram (${escritos.length}):`);
for (const s of escritos) {
  console.log(`  ${EMOCOES[s.emocao]?.icone ?? '·'} ${nomes[s.por] ?? s.por} — sobre ${s.sobre || '—'}`);
  console.log(`     "${s.texto}"`);
}
console.log('');
