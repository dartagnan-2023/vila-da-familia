// ---------------------------------------------------------------------------
// O Pipo vai atrás das pessoas.
//
// Até aqui o jogo esperava alguém abrir. Os números diziam o resto: nas últimas
// 300 linhas do feed, o Pipo aparecia 174 vezes, o Leandro 104, a Jéssica 13 e
// a Juliana nenhuma — e a Jéssica tinha deixado "amei o jogo" na caixinha. Não
// era falta de jogo, era falta de chamado.
//
//   npm run pipo:avisar -- VILA-XXXXX-XXXXX           manda de verdade
//   npm run pipo:avisar -- VILA-XXXXX-XXXXX --ensaio  só mostra o que mandaria
//   npm run pipo:avisar -- VILA-XXXXX-XXXXX --para jessica --texto "..."
//
// Cada aviso é sobre a horta DAQUELA pessoa, com o número dela. "Sua planta
// está pronta" é spam; "teu bolo saiu do forno e a encomenda fecha valendo
// 80 G" é um motivo. Zero API: quem escreve é a regra abaixo.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import webpush from 'web-push';
import { rpc, abrirVila } from './vila-remota.mjs';
import { visao } from '../src/engine/apresentador.js';
import { projetar } from '../src/engine/tempo.js';
import { nivelDe } from '../src/engine/conteudo.js';

const CHAVES = new URL('../.pipo-vapid.json', import.meta.url);
const ESTADO = new URL('../.pipo-avisos.json', import.meta.url);
const JOGO = 'https://dartagnan-2023.github.io/vila-da-familia/web/';
const HORA = 3600e3, DIA = 24 * HORA;
const SILENCIO = 6 * HORA;   // ninguém merece dois toques na mesma manhã

const args = process.argv.slice(2);
const chave = args.find((a) => a.startsWith('VILA-'))?.toUpperCase();
const ensaio = args.includes('--ensaio');
const opcao = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

if (!chave) {
  console.error('uso: npm run pipo:avisar -- VILA-XXXXX-XXXXX [--ensaio] [--para nome --texto "..."]');
  process.exit(1);
}
if (!existsSync(CHAVES)) {
  console.error('faltam as chaves VAPID (.pipo-vapid.json). Gere com:');
  console.error(`  node -e "require('fs').writeFileSync('.pipo-vapid.json', JSON.stringify(require('web-push').generateVAPIDKeys(),null,2))"`);
  console.error('e ponha a publicKey em web/config.js (VAPID_PUBLICA).');
  process.exit(1);
}
const vapid = JSON.parse(readFileSync(CHAVES, 'utf-8'));
webpush.setVapidDetails('mailto:vila@bhseletronica.com.br', vapid.publicKey, vapid.privateKey);

const lidos = () => { try { return JSON.parse(readFileSync(ESTADO, 'utf-8')); } catch { return {}; } };
const grava = (o) => { try { writeFileSync(ESTADO, JSON.stringify(o, null, 2)); } catch {} };

// ---------------------------------------------------------------------------
// O que vale um toque no ombro. Um por pessoa, o mais forte — e só se for algo
// que ELA pode resolver agora. A ordem aqui é a ordem de urgência.
//
// O quando vem do LOG (cada comando carrega `em`), não do feed: as linhas do
// feed guardam o tick do calendário, não a hora do relógio.
// ---------------------------------------------------------------------------
function motivoPara(mundo, p, log, agora) {
  const v = visao(mundo, p.id);
  const her = mundo.herdades[p.herdade];
  const recentes = (ms) => log.filter((c) => c.em && agora - c.em < ms);

  // 1. Dinheiro na mesa: encomenda fechada esperando só o toque de entregar.
  const pronta = v.encomendas.find((e) => e.pronta);
  if (pronta) return { tag: 'encomenda', titulo: `${p.nome}, tem dinheiro parado 🪙`, corpo: `A encomenda d${pronta.cliente.startsWith('a ') ? '' : 'o '}${pronta.cliente.replace(/^a /, 'a ')} está fechada: ${pronta.moedas} G e ${pronta.xp} XP esperando você entregar.` };

  // 2. Alguém cuidou da horta dela enquanto ela não estava. É o jogo
  // funcionando — ela tem que saber, senão a gentileza passa em branco.
  const ajuda = recentes(12 * HORA).reverse().find((c) => c.tipo === 'AJUDAR' && c.herdade === her.id && c.por !== p.id);
  if (ajuda) {
    const quem = mundo.jogadores[ajuda.por]?.nome ?? 'Alguém';
    return { tag: 'ajuda', titulo: `${quem} passou na sua horta 🤝`, corpo: `${quem} cuidou do que estava pedindo socorro enquanto você não estava. Vale um abraço.` };
  }

  // 3. Recado sem resposta. Conversa parada é relação parada.
  const recado = recentes(DIA).reverse().find((c) => c.tipo === 'RECADO' && c.para === p.id && c.por !== p.id);
  if (recado) return { tag: 'recado', titulo: `${mundo.jogadores[recado.por]?.nome ?? 'Alguém'} falou com você 💬`, corpo: recado.texto };

  // 4. A horta dela parou e só ela pode destravar.
  const sos = her.tiles.filter((t) => t?.problema).length;
  if (sos) return { tag: 'sos', titulo: `${p.nome}, sua horta pediu socorro 💧`, corpo: `${sos} planta${sos > 1 ? 's pararam' : ' parou'} de crescer esperando você. É um toque pra resolver.` };

  const madura = v.minhaHerdade.canteiros.filter((c) => c.pronto).length;
  if (madura >= 3) return { tag: 'colher', titulo: `${madura} canteiros prontos 🌾`, corpo: 'Sua horta está cheia e parada. Colhe e planta de novo — leva um minuto.' };

  // 5. Sumiu. O mais importante da lista e o mais difícil de escrever: tem que
  // soar como convite, nunca como cobrança.
  const minhaUltima = log.filter((c) => c.por === p.id && c.em).at(-1)?.em ?? 0;
  const sumidaHa = agora - minhaUltima;
  if (sumidaHa > 2 * DIA) {
    if (nivelDe(p.xp ?? 0) <= 2) {
      return { tag: 'volta', titulo: `${p.nome}, sua horta te espera 🌱`, corpo: 'Ninguém mexeu nela desde que você entrou. Se quiser, eu planto junto com você — é só abrir e falar comigo.' };
    }
    return { tag: 'volta', titulo: 'A vila sentiu sua falta 🌳', corpo: `${Math.floor(sumidaHa / DIA)} dias sem você. A obra da vila andou e tem coisa nova por aqui.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
const { motor, log } = await abrirVila(chave);
const agora = Date.now();
const mundo = projetar(motor.mundo, agora);
const inscritos = await rpc('ler_avisos', { p_chave: chave });

if (!inscritos.length) {
  console.log('ninguém ligou os avisos ainda — nada a fazer.');
  process.exit(0);
}

const visto = lidos();
const manual = opcao('para');
let mandados = 0;

for (const { jogador, inscricao } of inscritos) {
  const p = mundo.jogadores[jogador];
  if (!p) continue;
  if (manual && !p.nome.toLowerCase().startsWith(manual.toLowerCase())) continue;

  const motivo = manual && opcao('texto')
    ? { tag: 'mao', titulo: 'Pipo 👧', corpo: opcao('texto') }
    : motivoPara(mundo, p, log, agora);
  if (!motivo) { console.log(`· ${p.nome}: nada urgente`); continue; }

  const ultimo = visto[`${chave}:${jogador}`] ?? {};
  if (!manual && agora - (ultimo.em ?? 0) < SILENCIO) { console.log(`· ${p.nome}: calado (avisei há ${Math.round((agora - ultimo.em) / 60000)} min)`); continue; }
  if (!manual && ultimo.tag === motivo.tag && agora - (ultimo.em ?? 0) < DIA) { console.log(`· ${p.nome}: já avisei isso hoje (${motivo.tag})`); continue; }

  console.log(`→ ${p.nome} [${motivo.tag}]: ${motivo.titulo} — ${motivo.corpo}`);
  if (ensaio) continue;

  try {
    await webpush.sendNotification(inscricao, JSON.stringify({ ...motivo, url: `${JOGO}?chave=${chave}` }));
    visto[`${chave}:${jogador}`] = { em: agora, tag: motivo.tag };
    mandados++;
  } catch (e) {
    // 404/410 = desinstalou ou limpou o navegador. Sai da lista sem drama.
    if (e.statusCode === 404 || e.statusCode === 410) {
      await rpc('apagar_aviso', { p_chave: chave, p_jogador: jogador }).catch(() => {});
      console.log(`  (inscrição de ${p.nome} expirou — tirei da lista)`);
    } else console.log(`  (falhou pra ${p.nome}: ${e.statusCode ?? ''} ${e.message})`);
  }
}
if (!ensaio) grava(visto);
console.log(ensaio ? '\n(ensaio — nada foi enviado)' : `\n${mandados} aviso(s) entregues.`);
