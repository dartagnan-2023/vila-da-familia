// O corpo do Pipo: ele cuida da vila sozinho, sem gastar um centavo de API.
// Tudo aqui é regra escrita à mão — o motor decide o que vale, como pra qualquer um.
//
//   npm run pipo:rotina -- VILA-XXXXX-XXXXX            uma passada
//   npm run pipo:rotina -- VILA-XXXXX-XXXXX --vigiar   fica morando lá (5 em 5 min)
//   ... --seco                                          mostra o que faria
//   ... --caixa                                         só lista o que chegou pro Pipo
//
// E ele é o olho: tudo que a família fala com ele, reclama ou sente fica em
// `.pipo-caixa.jsonl` — é por ali que a conversa chega em quem mexe no jogo.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { abrirVila, enviar } from './vila-remota.mjs';
import { visao } from '../src/engine/apresentador.js';
import { projetar, estaMadura } from '../src/engine/tempo.js';
import { CULTURAS, PRODUTOS, EMOCOES, nivelDe, precoDe, FEIRA } from '../src/engine/conteudo.js';
import { dataLocal, diasPendentes, comandoDoDia } from '../src/engine/calendario.js';

const args = process.argv.slice(2);
const chave = args.find((a) => a.startsWith('VILA-'));
const vigiar = args.includes('--vigiar');
const seco = args.includes('--seco');
const soCaixa = args.includes('--caixa');
const INTERVALO = 5 * 60e3;
const MAX_ACOES = 12;          // teto por passada: o Pipo não vira trator
const MAX_DIA = 60;            // teto por dia: a vila é da família, ele só mora lá
// Das 41 doações que a vila recebeu, 40 foram dele: as sete obras acabaram antes
// da família chegar, e o Leandro escreveu "já fez tudo pela vila, eu abandonaria".
// O Pipo ajuda a empurrar, nunca termina.
const TETO_OBRA = 0.5;         // ele para de doar quando a obra passa da metade
const GUARDA_ACIMA = 300;      // só guarda o que de fato sobra (antes era 120: virou ioiô)
const NOME_PIPO = 'Pipo';

if (!chave) { console.error('uso: npm run pipo:rotina -- VILA-XXXXX-XXXXX [--vigiar] [--seco] [--caixa]'); process.exit(1); }

const ARQ_ESTADO = new URL('../.pipo-estado.json', import.meta.url);
const ARQ_CAIXA = new URL('../.pipo-caixa.jsonl', import.meta.url);
const leEstado = () => { try { return JSON.parse(readFileSync(ARQ_ESTADO, 'utf-8')); } catch { return { visto: 0 }; } };
const gravaEstado = (e) => writeFileSync(ARQ_ESTADO, JSON.stringify(e, null, 2));

// Palavra dura não é problema: é sinal de que alguém se importa o bastante pra reclamar.
const IRRITACAO = /\b(merda|porra|caralho|bosta|droga|lixo|odiei|odeio|horr[ií]vel|p[ée]ssimo|travou|bug|n[ãa]o funciona|imposs[ií]vel|desisto|chato|saco|cansei)\b/i;

/** Tudo que a família dirigiu ao Pipo (ou ao jogo) desde a última olhada. */
function caixaDeEntrada(mundo, euId, visto) {
  const itens = [];
  for (const l of mundo.feed) {
    if (l.seq <= visto || l.ator === euId) continue;
    const quem = mundo.jogadores[l.ator]?.nome ?? 'alguém';
    if (l.tipo === 'RECADO') {
      const texto = l.texto.replace(/^[^:]+: "/, '').replace(/"$/, '');
      const praMim = l.ref?.para === euId;
      const citado = /\bpipo\b/i.test(texto);
      if (praMim || citado || !l.ref?.para) {
        itens.push({ seq: l.seq, tipo: praMim ? 'recado-pra-mim' : citado ? 'citou-o-pipo' : 'mural',
          quem, texto, urgente: IRRITACAO.test(texto) });
      }
    } else if (l.tipo === 'SENTIU') {
      const s = (mundo.sentimentos ?? []).find((x) => x.seq === l.seq);
      if (s) itens.push({ seq: l.seq, tipo: 'reacao', quem, emocao: s.emocao, icone: EMOCOES[s.emocao]?.icone,
        sobre: s.sobre, texto: s.texto, urgente: EMOCOES[s.emocao]?.cor === 'ruim' });
    } else if (l.tipo === 'JOGADOR_ENTROU') {
      itens.push({ seq: l.seq, tipo: 'chegou', quem, texto: `${quem} entrou na vila pela primeira vez` });
    }
  }
  return itens;
}

/** Alguém da família está esperando esse item pra fechar um pedido? */
function pedidoDaFamilia(mundo, eu, item) {
  return Object.values(mundo.jogadores).some((p) => (p.encomendas ?? []).some((e) => e.itens[item] && (p.colheita[item] ?? 0) < e.itens[item]));
}

/** Produto de forno/moinho que alguém da família está esperando. */
function produtoPedido(mundo, euId) {
  const falta = {};
  for (const p of Object.values(mundo.jogadores)) {
    for (const e of p.encomendas ?? []) {
      for (const [item, qtd] of Object.entries(e.itens)) {
        if (PRODUTOS[item]) falta[item] = (falta[item] ?? 0) + qtd - (p.colheita[item] ?? 0);
      }
    }
  }
  return Object.entries(falta).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Quem apareceu nas últimas 24h. A horta de quem está voltando vem primeiro. */
function quemVoltou(mundo, log) {
  const corte = Date.now() - 24 * 3600e3;
  return new Set(log.filter((c) => c.em > corte && c.por).map((c) => c.por));
}

/** O que plantar: o que a família está precisando pra fechar pedido. */
function melhorSemente(v, mundo, eu) {
  const nv = nivelDe(eu.xp ?? 0);
  const querem = {};
  for (const p of Object.values(mundo.jogadores)) {
    for (const e of p.encomendas ?? []) {
      for (const [item, qtd] of Object.entries(e.itens)) {
        if (CULTURAS[item] && CULTURAS[item].nivel <= nv) querem[item] = (querem[item] ?? 0) + qtd - (p.colheita[item] ?? 0);
      }
    }
  }
  const rioBaixo = mundo.comuns.agua < 25;
  const candidatos = Object.entries(querem).filter(([, falta]) => falta > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .filter((k) => CULTURAS[k].semente <= eu.inventario.moedas)
    .filter((k) => !rioBaixo || CULTURAS[k].agua <= 2);   // rio seco: nada de arroz/café
  // Nada pedido? Trigo: barato, rápido, sempre serve.
  return candidatos[0] ?? (CULTURAS.trigo.semente <= eu.inventario.moedas ? 'trigo' : null);
}

/** A lista do que fazer agora, em ordem de quem precisa mais. */
function tarefas(motor, euId, log = []) {
  const agora = Date.now();
  const m = projetar(motor.mundo, agora);
  const v = visao(motor.mundo, euId, agora);
  const eu = m.jogadores[euId];
  const minha = m.herdades[eu.herdade];
  const fila = [];
  const voltaram = quemVoltou(m, log);

  // O rio é de todos: regar cobra dele. Com o rio baixo o Pipo só tira praga e
  // mato (de graça) e deixa a água pra quem plantou — e vai cuidar da nascente.
  const rioBaixo = m.comuns.agua < 25;
  const podeCuidar = (tipo) => !rioBaixo || tipo !== 'sede';

  // 1. Quem está pedindo socorro vem antes de tudo — inclusive antes da minha
  // horta. E dentro disso, a horta de quem voltou a jogar vem primeiro: é a
  // pessoa que ainda pode ver a gentileza acontecer.
  const socorros = v.pedidosDeAjuda.filter((x) => x.acao === 'CUIDAR')
    .sort((a, b) => Number(voltaram.has(m.herdades[b.herdade]?.dono)) - Number(voltaram.has(m.herdades[a.herdade]?.dono)));
  for (const p of socorros) {
    const t = m.herdades[p.herdade]?.tiles[p.tile];
    if (!podeCuidar(t?.problema)) continue;
    fila.push({ cmd: { tipo: 'AJUDAR', herdade: p.herdade, tile: p.tile, acao: 'CUIDAR' }, conta: `socorro: ${p.motivo}` });
  }
  // 2. Minha própria horta pedindo.
  minha.tiles.forEach((t, i) => { if (t?.problema && podeCuidar(t.problema)) fila.push({ cmd: { tipo: 'CUIDAR', tile: i }, conta: `cuidei do meu ${t.cultura}` }); });
  // 3. Colher o meu que está pronto — mas não se já estou muito à frente.
  const naFrenteAgora = nivelDe(eu.xp ?? 0) > Math.max(...Object.values(m.jogadores).filter((p) => p.id !== euId).map((p) => nivelDe(p.xp ?? 0)), 1) + 5;
  if (!naFrenteAgora) minha.tiles.forEach((t, i) => { if (t && estaMadura(t)) fila.push({ cmd: { tipo: 'COLHER', tile: i }, conta: `colhi meu ${t.cultura}` }); });
  // 4. Salvar o que ia passar do ponto na horta dos outros — mas deixando
  // trabalho pra quem chegar. Horta com pouca coisa madura ele não encosta:
  // uma vila onde tudo já foi feito é uma vila sem motivo pra abrir.
  for (const p of v.pedidosDeAjuda.filter((x) => x.acao === 'COLHER')) {
    const dele = m.herdades[p.herdade];
    const maduras = dele?.tiles.filter((t) => t && estaMadura(t)).length ?? 0;
    if (maduras <= 2 && voltaram.has(dele?.dono)) continue;   // ela volta hoje e colhe
    fila.push({ cmd: { tipo: 'AJUDAR', herdade: p.herdade, tile: p.tile, acao: 'COLHER' }, conta: `salvei: ${p.motivo}` });
  }
  // 5. Replantar o que ficou vazio — mas o Pipo não corre na frente da família.
  // Se ele já está muito acima de quem mais joga, só planta o que é pedido.
  const maiorHumano = Math.max(...Object.values(m.jogadores).filter((p) => p.id !== euId).map((p) => nivelDe(p.xp ?? 0)), 1);
  const naFrente = nivelDe(eu.xp ?? 0) > maiorHumano + 5;
  const semente = melhorSemente(v, m, eu);
  if (semente && !(naFrente && !pedidoDaFamilia(m, eu, semente))) {
    minha.tiles.forEach((t, i) => { if (!t) fila.push({ cmd: { tipo: 'PLANTAR', tile: i, cultura: semente }, conta: `plantei ${semente}` }); });
  }
  // 6. Sobra de madeira/pedra vai pra obra da vila — até a metade, e nunca o
  // tijolo que fecha. A obra é da família: ele empurra, eles terminam.
  if (v.missao && v.missao.pct < TETO_OBRA * 100) {
    for (const i of v.missao.itens.filter((x) => x.falta > 0)) {
      const tenho = i.recurso === 'moedas' ? eu.inventario.moedas - 20 : (eu.inventario[i.recurso] ?? 0) - 10;
      const ateAMetade = Math.max(0, Math.floor(i.alvo * TETO_OBRA) - i.feito);
      const dar = Math.min(tenho, i.falta - 1, ateAMetade);
      if (dar > 0) fila.push({ cmd: { tipo: 'DOAR', obra: v.missao.chave, recursos: { [i.recurso]: dar } }, conta: `doei ${dar} ${i.recurso} pra ${v.missao.nome} (até a metade — o resto é de vocês)` });
    }
  }
  // 7. Lenha e pedra quando a ferramenta descansou e a mata aguenta.
  // Mata em pé = nascente e chuva. Rio baixo? Plantar árvore é a dança da chuva.
  if ((rioBaixo || m.comuns.floresta < 80) && eu.inventario.madeira >= 2) {
    fila.push({ cmd: { tipo: 'PLANTAR_ARVORE' }, conta: `plantei mudas (${rioBaixo ? 'o rio está seco' : 'a mata estava baixa'})` });
  }
  if (!v.hud.machadoEm && !rioBaixo && m.comuns.floresta >= 70 && eu.inventario.madeira < 40) fila.push({ cmd: { tipo: 'CORTAR' }, conta: 'cortei lenha' });
  if (!v.hud.picaretaEm && eu.inventario.pedra < 30) fila.push({ cmd: { tipo: 'MINERAR' }, conta: 'tirei pedra' });
  // 7b. Benfeitoria que a vila precisa: poço (metade da água) e composteira (solo).
  const temPoco = minha.construcoes.includes('agua'), temComposteira = minha.construcoes.includes('solo');
  const vaga = minha.construcoes.length < 3;
  const temMoinho = minha.construcoes.includes('moinho'), temForno = minha.construcoes.includes('forno');
  if (vaga && !temPoco && eu.inventario.madeira >= 8 && eu.inventario.moedas >= 20) fila.push({ cmd: { tipo: 'CONSTRUIR', construcao: 'poco' }, conta: 'construí um poço (gasta metade da água)' });
  else if (vaga && !temComposteira && eu.inventario.madeira >= 5 && eu.inventario.moedas >= 10) fila.push({ cmd: { tipo: 'CONSTRUIR', construcao: 'composteira' }, conta: 'construí uma composteira (devolve terra)' });
  // A família pede farinha, pão e bolo nas encomendas e ninguém tinha forno.
  else if (vaga && !temMoinho && eu.inventario.madeira >= 10 && eu.inventario.moedas >= 40 && nivelDe(eu.xp ?? 0) >= 3) fila.push({ cmd: { tipo: 'CONSTRUIR', construcao: 'moinho' }, conta: 'construí um moinho (trigo vira farinha)' });
  else if (vaga && temMoinho && !temForno && eu.inventario.madeira >= 15 && eu.inventario.pedra >= 5 && eu.inventario.moedas >= 80 && nivelDe(eu.xp ?? 0) >= 5) fila.push({ cmd: { tipo: 'CONSTRUIR', construcao: 'forno' }, conta: 'construí um forno (pão e bolo)' });

  // 7d. A cadeia de produção: tirar o que ficou pronto e botar mais pra rodar.
  for (const [maquina, em] of Object.entries(minha.producao ?? {})) {
    if (em.prontoEm <= m.agora) fila.push({ cmd: { tipo: 'RECOLHER', maquina }, conta: `tirei ${em.produto} do ${maquina}` });
  }
  for (const produto of produtoPedido(m, euId)) {
    const prod = PRODUTOS[produto];
    if (!minha.construcoes.includes(prod.maquina) || minha.producao?.[prod.maquina]) continue;
    if (!Object.entries(prod.entrada).every(([k, q]) => (eu.colheita[k] ?? 0) >= q)) continue;
    fila.push({ cmd: { tipo: 'PRODUZIR', produto }, conta: `botei ${produto} pra fazer (alguém pediu)` });
  }

  // 7c. Quem não tem madeira não constrói nada. Se eu tenho de sobra, divido —
  // começando por quem está mais atrás, que é quem mais precisa de um empurrão.
  const atrasados = Object.values(m.jogadores)
    .filter((p) => p.id !== euId)
    .sort((a, b) => nivelDe(a.xp ?? 0) - nivelDe(b.xp ?? 0));
  if (eu.inventario.madeira >= 12) {
    for (const p of atrasados) {
      const dele = m.herdades[p.herdade];
      if (p.inventario.madeira >= 5 || dele.construcoes.length >= 3) continue;
      fila.push({ cmd: { tipo: 'PRESENTEAR', para: p.id, recurso: 'madeira', quantidade: 5 }, conta: `dei 5 madeiras pro ${p.nome} (ele não tinha nenhuma)` });
      break;
    }
  }
  // Quem está no nível 1 sem moeda não consegue nem comprar semente: trava ali
  // e não volta mais. Um punhado de moeda resolve — e é o que o caixa é.
  if (eu.inventario.moedas >= 60) {
    const travado = atrasados.find((p) => nivelDe(p.xp ?? 0) <= 2 && p.inventario.moedas < 40);
    if (travado) fila.push({ cmd: { tipo: 'PRESENTEAR', para: travado.id, recurso: 'moedas', quantidade: 30 }, conta: `dei 30 G pro ${travado.nome} (nível ${nivelDe(travado.xp ?? 0)}, sem moeda pra semente)` });
  }

  // 8. O que sobra no celeiro e alguém precisa vai pra vendinha por preço de feira.
  const lotes = (eu.vendinha ?? []).length;
  const anunciado = {};
  if (lotes < 3) {
    for (const [item, qtd] of Object.entries(eu.colheita)) {
      const precisam = Object.values(m.jogadores).some((p) => p.id !== euId && (p.encomendas ?? []).some((e) => e.itens[item] && (p.colheita[item] ?? 0) < e.itens[item]));
      if (precisam && qtd >= 4) {
        anunciado[item] = Math.min(qtd, 10);
        fila.push({ cmd: { tipo: 'ANUNCIAR', item, quantidade: Math.min(qtd, 10), preco: Math.min(qtd, 10) * precoDe(item) }, conta: `pus ${Math.min(qtd, 10)} ${item} na vendinha (alguém precisa)` });
        break;
      }
    }
  }
  // 9. Dinheiro curto? Vende o que ninguém pediu.
  if (eu.inventario.moedas < 10) {
    for (const [item, total] of Object.entries(eu.colheita)) {
      const qtd = total - (anunciado[item] ?? 0); // o que foi pra vendinha já saiu do celeiro
      if (qtd >= 5) { fila.push({ cmd: { tipo: 'VENDER', cultura: item, quantidade: qtd }, conta: `vendi ${qtd} ${item} (tava sem moeda)` }); break; }
    }
  }
  // 10. O caixa da família. Ele GUARDA o que sobra de verdade e NUNCA pega: o
  // caixa é pra quem precisa, e ele sempre consegue mais vendendo o que colheu.
  // (Antes guardava tudo acima de 120, gastava em semente, sacava os 20 do dia
  //  e repetia — um ioiô que enchia o mural e deixava o caixa sendo cofre dele.)
  const sobra = eu.inventario.moedas - GUARDA_ACIMA;
  if (sobra >= 50) fila.push({ cmd: { tipo: 'GUARDAR', moedas: sobra }, conta: `guardei ${sobra} G no caixa da família` });
  return fila;
}

async function passada() {
  const { vila, log, motor } = await abrirVila(chave);
  const eu = Object.values(motor.mundo.jogadores).find((p) => p.nome === NOME_PIPO);
  if (!eu) { console.error(`O ${NOME_PIPO} não está nessa vila. Entre uma vez com esse nome pelo jogo.`); return; }

  // Sem virada de dia a vila congela: água, terra e mata só se refazem aí. Quem
  // abre o jogo vira o dia; se ninguém abriu, o Pipo vira — ele mora lá.
  const hoje = dataLocal();
  for (const data of diasPendentes(motor.mundo.dataDoDia, hoje)) {
    const r = await enviar(vila, motor, comandoDoDia(data));
    if (r.ok) console.log(`   🌅 amanheceu: ${data}`);
    else break;
  }

  const estado = leEstado();
  const caixa = caixaDeEntrada(motor.mundo, eu.id, estado.visto ?? 0);
  const marca = new Date().toLocaleString('pt-BR');

  if (caixa.length) {
    console.log(`\n📬 CHEGOU PRO PIPO (${caixa.length}):`);
    for (const i of caixa) {
      const linha = i.tipo === 'reacao'
        ? `${i.icone} ${i.quem} reagiu${i.sobre ? ` a ${i.sobre}` : ''}${i.texto ? `: "${i.texto}"` : ''}`
        : `${i.quem}: "${i.texto}"`;
      console.log(`  ${i.urgente ? '🔥' : '·'} [${i.tipo}] ${linha}`);
      if (!seco) appendFileSync(ARQ_CAIXA, JSON.stringify({ quando: marca, vila: vila.nome, ...i }) + '\n');
    }
    console.log('  (guardado em .pipo-caixa.jsonl — é o que sobe pro cérebro)');
  } else if (soCaixa) console.log('\n📭 nada novo pro Pipo.');

  if (soCaixa) { if (!seco) gravaEstado({ ...estado, visto: motor.mundo.seq }); return; }

  // Teto do dia: a vila é da família. Ele ajuda, não toca o lugar sozinho.
  const hojeStr = new Date().toISOString().slice(0, 10);
  const feitasHoje = estado.dia === hojeStr ? (estado.feitasHoje ?? 0) : 0;
  // No ensaio o teto nao vale: nada e enviado, e a graca e justamente VER.
  const sobra = seco ? MAX_ACOES : Math.max(0, MAX_DIA - feitasHoje);
  if (!sobra) { console.log(`
😴 ${marca} · o Pipo já fez as ${MAX_DIA} do dia. Amanhã tem mais.`); if (!seco) gravaEstado({ ...estado, visto: motor.mundo.seq, dia: hojeStr, feitasHoje }); return; }
  const fila = tarefas(motor, eu.id, log).slice(0, Math.min(MAX_ACOES, sobra));
  console.log(`\n🌱 ${marca} · ${vila.nome} · ${fila.length ? `${fila.length} coisa(s) pra fazer` : 'nada a fazer, a vila está em dia'}`);
  let feitas = 0;
  for (const t of fila) {
    if (seco) { console.log(`   (seco) ${t.conta}`); continue; }
    const r = await enviar(vila, motor, { ...t.cmd, por: eu.id, data: new Date().toISOString().slice(0, 10) });
    if (r.ok) { console.log(`   ✓ ${t.conta}`); feitas++; }
    else console.log(`   – ${t.conta}: ${r.erro}`);
  }
  if (!seco) gravaEstado({ ...estado, visto: motor.mundo.seq, ultima: marca, feitas, dia: hojeStr, feitasHoje: feitasHoje + feitas });
}

await passada();
if (vigiar) {
  console.log(`\n(o Pipo fica morando aqui: nova passada a cada ${INTERVALO / 60e3} min — Ctrl+C pra parar)`);
  setInterval(() => passada().catch((e) => console.error('erro na passada:', e.message)), INTERVALO);
}
