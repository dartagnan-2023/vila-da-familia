import { Motor } from '../src/engine/motor.js';
import { faixaDePreco } from '../src/engine/regras.js';
import { visao, acoesPossiveis } from '../src/engine/apresentador.js';
import { novaChave, lerChave, extrairChave } from '../src/engine/convite.js';
import { TransporteLocal, Sessao } from '../src/net/transporte.js';
import { TransporteSupabase, criarVila, acharVila } from '../src/net/supabase.js';
import { CULTURAS, CONSTRUCOES, OBRAS } from '../src/engine/conteudo.js';
import { VilaCanvas, LOJAS } from './vila-canvas.js';
import { VERSAO } from './versao.js';
import { dataLocal, diasPendentes, comandoDoDia } from '../src/engine/calendario.js';
import { projetar, estaMadura, rotuloDuracao } from '../src/engine/tempo.js';
import { PRODUTOS, PROBLEMAS, nivelDe, xpParaNivel, nomeDe, precoDe } from '../src/engine/conteudo.js';
import { iconeDe } from '../src/engine/apresentador.js';

// Se houver web/config.js com o projeto Supabase, o jogo e entre casas.
// Sem ele, tudo fica no aparelho (revezamento). A tela e a mesma.
const nuvem = await (async () => {
  try {
    const cfg = await import('./config.js');
    if (!cfg.SUPABASE_URL) return null;
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  } catch (e) {
    console.warn('[vila] sem nuvem, jogando no aparelho:', e.message);
    return null;
  }
})();

// ---------------------------------------------------------------------------
// A casca visual e o design system do Stitch; os numeros sao todos do motor.
// Esta camada nao conhece regra de jogo nenhuma: ela pinta `visao()` e manda
// comandos. Se uma acao nao pode acontecer, quem diz e o motor.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// O Stitch gerou os ícones como ligaduras do Material Symbols. Trocamos por
// glifos: não depende de fonte externa e combina mais com a estética 8-bit.
const ICONES = {
  monetization_on: '🪙', content_copy: '⧉', groups: '👨‍👩‍👧', bolt: '⚡', yard: '🌱',
  history_edu: '📜', inventory_2: '📦', assignment: '📋', volunteer_activism: '🤝',
  cottage: '🏠', auto_stories: '📖', key: '🔑', water_drop: '💧', agriculture: '🌾',
  spa: '🌿', carpenter: '🪓', construction: '⛏️', park: '🌳', handyman: '🔨',
  redeem: '🎁', campaign: '📣', bedtime: '🌙', forest: '🌲', terrain: '⛰️', favorite: '❤️',
};
const ICO = (n, cls = '') => `<span class="${cls}" style="font-style:normal">${ICONES[n] ?? '•'}</span>`;

// Enquanto nao existe servidor, o log mora no proprio navegador.
class TransporteSalvo extends TransporteLocal {
  constructor(chave) {
    super(JSON.parse(localStorage.getItem(chave) ?? '[]'));
    this.chaveStorage = chave;
  }
  async enviar(cmd) {
    const c = await super.enviar(cmd);
    localStorage.setItem(this.chaveStorage, JSON.stringify(this.log));
    return c;
  }
}

const app = {
  motor: null, sessao: null, transporte: null,
  eu: null, semente: null, chave: null, vilaId: null, online: false, aba: 'vila',
  ferramenta: 'regador', cultura: 'trigo', herdadeAberta: null,
};
window.vila = app; // para inspecionar no console: vila.motor.mundo, vila.cena

const SLOTS = [
  { tecla: '1', chave: 'regador',  nome: 'Cuidar tudo',    icone: 'water_drop', dica: 'Atende tudo que estiver pedindo (sede, praga, mato) na sua horta.', acao: 'cuidar-tudo' },
  { tecla: '2', chave: 'foice',    nome: 'Colher tudo',    icone: 'agriculture', dica: 'Colhe todos os seus canteiros prontos.', acao: 'colher-tudo' },
  { tecla: '3', chave: 'semente',  nome: 'Semente',        icone: 'spa', dica: 'Escolher o que plantar nos canteiros vazios.' },
  { tecla: '4', chave: 'machado',  nome: 'Madeira',        icone: 'carpenter', dica: 'Machado: +4 a 6 de madeira (mais por nível e com a mata farta), depois descansa 2 min. Tira 3 da mata comum.', cmd: { tipo: 'CORTAR' } },
  { tecla: '5', chave: 'picareta', nome: 'Pedra',          icone: 'construction', dica: 'Picareta: +3 a 5 de pedra (mais por nível), depois descansa 4 min.', cmd: { tipo: 'MINERAR' } },
  { tecla: '6', chave: 'muda',     nome: 'Reflorestar',    icone: 'park', dica: 'Planta uma muda na mata comum: gasta 1 de madeira e devolve +4 de mata.', cmd: { tipo: 'PLANTAR_ARVORE' } },
  { tecla: '7', chave: 'martelo',  nome: 'Construir',      icone: 'handyman', dica: 'Benfeitoria na sua herdade (custa madeira, pedra, moedas).', abre: 'construir' },
  { tecla: '8', chave: 'presente', nome: 'Presente',       icone: 'redeem', dica: 'Dar recurso para um parente.', abre: 'presentear' },
  { tecla: '9', chave: 'recado',   nome: 'Recado',         icone: 'campaign', dica: 'Deixar um recado no mural da família.', abre: 'recado' },
  { tecla: '0', chave: 'vender',   nome: 'Vender',         icone: 'monetization_on', dica: 'Vende o celeiro pelo preco de feira. Guarda o que as encomendas pedem: elas pagam +50%.', acao: 'vender-tudo' },
];

// --- entrada ---------------------------------------------------------------
// Cada vila conhecida por este aparelho fica em localStorage `vila:<chave>`:
// { chave, nome, semente, vilaId (so online), eu (quem sou nela) }.

const vilasSalvas = () => Object.keys(localStorage)
  .filter((k) => k.startsWith('vila:') && k.split(':').length === 2)
  .map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } })
  .filter((v) => v && v.chave);

const salvaVila = (v) => localStorage.setItem(`vila:${v.chave}`, JSON.stringify(v));

// Link de convite: a URL carrega a chave, ninguem precisa digitar nada.
const chaveDaUrl = () => extrairChave(new URLSearchParams(location.search).get('chave') ?? location.hash);
const linkDeConvite = (chave) => `${location.origin}${location.pathname}?chave=${chave}`;
const mensagemDeConvite = (chave) =>
  `Vem pra nossa vila! 🌳 Abre o link, coloca seu nome e pronto:
${linkDeConvite(chave)}

(se pedir, a chave é ${chave})`;
const linkWhatsApp = (chave) => `https://wa.me/?text=${encodeURIComponent(mensagemDeConvite(chave))}`;

function telaEntrada() {
  const vilas = vilasSalvas();
  const convite = chaveDaUrl();
  const campo = 'w-full bg-surface-dim px-gutter-sm py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md';
  $('entrada').innerHTML = `
  <div class="bg-surface-container-low p-panel-pad-lg shadow-[6px_6px_0_0_#221b08] w-full max-w-lg">
    <div class="bg-secondary px-gutter-sm py-pixel-step shadow-[2px_2px_0_0_#331200] mb-panel-pad-md flex justify-between items-end">
      <div>
        <h1 class="font-headline-md text-headline-md text-on-secondary uppercase">Vila Raízes</h1>
        <p class="font-label-sm text-label-sm text-tertiary-fixed uppercase">Edição Aldeia</p>
      </div>
      <span class="font-label-sm text-[10px] uppercase ${nuvem ? 'text-primary-fixed' : 'text-tertiary-fixed'}">${nuvem ? '● entre casas' : '○ só neste aparelho'}</span>
    </div>
    ${vilas.length && !convite ? `
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Voltar para a vila</p>
      <div class="space-y-1 mb-panel-pad-md">
        ${vilas.map((v) => `<button class="w-full text-left bg-surface-container px-gutter-sm py-pixel-step shadow-[2px_2px_0_0_#221b08] press font-label-md text-label-md uppercase flex justify-between" data-acao="abrir-vila" data-chave="${esc(v.chave)}">
          <span>${ICO('cottage', 'text-secondary text-[16px] align-middle')} ${esc(v.nome)}</span><span class="text-on-surface-variant">${esc(v.chave)}</span></button>`).join('')}
      </div>` : ''}

    <div class="bg-surface-container-highest p-gutter-sm shadow-[inset_2px_2px_0_0_#221b08] mb-panel-pad-md">
      <p class="font-label-md text-label-md uppercase text-secondary mb-1">${convite ? '🔑 Você foi convidado(a) pra uma vila' : '🔑 Recebi uma chave da família'}</p>
      <input class="${campo} mb-1 uppercase" id="in-chave" placeholder="VILA-XXXXX-XXXXX" value="${esc(convite ?? '')}" ${convite ? 'readonly' : ''}/>
      <input class="${campo} mb-gutter-xs" id="in-nome" maxlength="18" placeholder="Seu nome (ex: Vovó Rosa)" autofocus/>
      <button class="w-full bg-primary text-on-primary font-label-lg uppercase py-gutter-xs shadow-[4px_4px_0_0_#221b08] press" data-acao="usar-chave">Entrar na vila</button>
      <p class="font-body-sm text-[11px] text-on-surface-variant mt-1 leading-tight">
        ${nuvem
          ? 'A chave abre a vila de qualquer aparelho. Quem tem a chave, entra — trate como segredo da família.'
          : 'Sem <code>web/config.js</code> a chave só abre vilas guardadas <strong>neste navegador</strong>.'}
      </p>
    </div>

    <details ${vilas.length || convite ? '' : 'open'}>
      <summary class="font-label-sm text-label-sm uppercase text-on-surface-variant cursor-pointer mb-1">Não tenho chave — quero fundar uma vila nova</summary>
      <input class="${campo} mb-1" id="in-vila" maxlength="24" placeholder="Nome da vila (ex: Vila do Riacho)"/>
      <input class="${campo} mb-gutter-xs" id="in-nome-fundador" maxlength="18" placeholder="Seu nome"/>
      <button class="w-full bg-secondary text-on-secondary font-label-lg uppercase py-gutter-xs shadow-[4px_4px_0_0_#221b08] press" data-acao="fundar">Fundar a vila</button>
      <p class="font-body-sm text-[11px] text-on-surface-variant mt-1 leading-tight">Só quem vai começar a vila. Os outros entram pela chave que você manda.</p>
    </details>
  </div>`;
  $('entrada').hidden = false;
}

async function fundar(nomeVila, nomeJogador) {
  const chave = novaChave();
  const semente = `${chave}-${Date.now().toString(36)}`;
  const vila = { chave, nome: nomeVila, semente, vilaId: null, eu: null };
  if (nuvem) {
    try { vila.vilaId = await criarVila(nuvem, { chave, nome: nomeVila, semente }); }
    catch (e) { return aviso(e.message, true); }
  }
  salvaVila(vila);
  await abrirVila(chave, nomeJogador);
}

async function usarChave(digitada, nomeJogador) {
  const lida = lerChave(extrairChave(digitada) ?? digitada);
  if (!lida.valida) return aviso(lida.erro, true);
  let vila = vilasSalvas().find((v) => v.chave === lida.chave);
  if (!vila) {
    if (!nuvem) return aviso('essa chave não abre nenhuma vila deste aparelho', true);
    let achada;
    try { achada = await acharVila(nuvem, lida.chave); } catch (e) { return aviso(e.message, true); }
    if (!achada) return aviso('nenhuma vila com essa chave', true);
    vila = { chave: lida.chave, nome: achada.nome, semente: achada.semente, vilaId: achada.id, eu: null };
    salvaVila(vila);
  }
  await abrirVila(vila.chave, nomeJogador);
}

async function abrirVila(chave, nomeJogador) {
  const vila = vilasSalvas().find((v) => v.chave === chave);
  if (!vila) return aviso('vila não encontrada', true);
  app.transporte?.fechar?.();

  app.chave = chave;
  app.semente = vila.semente;
  app.vilaId = vila.vilaId;
  app.online = Boolean(nuvem && vila.vilaId);
  app.transporte = app.online
    ? new TransporteSupabase({ client: nuvem, vilaId: vila.vilaId })
    : new TransporteSalvo(`vila:log:${chave}`);
  app.motor = Motor.criar({ semente: vila.semente, nome: vila.nome });
  app.eu = vila.eu;
  app.sessao = new Sessao({ motor: app.motor, transporte: app.transporte, jogadorId: app.eu ?? 'convidado', aoAtualizar: (mundo, r) => { pinta(); avisaChegada(r); } });

  try { await app.sessao.sincronizar(); }
  catch (e) { return aviso(`não deu para carregar a vila: ${e.message}`, true); }
  await virarDiasPendentes();

  // Nome novo neste aparelho = familiar novo. Quem ja e da vila volta a ser quem era.
  const salvo = app.eu && app.motor.mundo.jogadores[app.eu];
  const mesmoNome = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (nomeJogador && !mesmoNome(salvo?.nome, nomeJogador)) {
    const jaExiste = Object.values(app.motor.mundo.jogadores).find((p) => mesmoNome(p.nome, nomeJogador));
    if (jaExiste) trocarDeFamiliar(jaExiste.id); else await entrarComoFamiliar(nomeJogador);
  }
  if (!app.eu || !app.motor.mundo.jogadores[app.eu]) app.eu = Object.keys(app.motor.mundo.jogadores)[0] ?? null;
  if (!app.eu) return aviso('diga seu nome para entrar na vila', true);
  trocarDeFamiliar(app.eu);
  localStorage.setItem('vila:ultima', chave); // recarregou? volta direto pra ca
  $('entrada').hidden = true;
  if (location.search) history.replaceState(null, '', location.pathname);
  pinta();
  if (!localStorage.getItem('vila:tutorial')) abreModal('tutorial');
  else mostrarNovidades();
}

// ---------------------------------------------------------------------------
// "Enquanto voce esteve fora": o que a familia fez POR voce e o que o mundo
// mandou desde a ultima visita. E o "obrigado" que faltava.
// ---------------------------------------------------------------------------
function novidadesDesde(seqVisto) {
  const m = app.motor.mundo;
  const eu = m.jogadores[app.eu];
  const minha = eu?.herdade;
  const nomeDe = (id) => m.jogadores[id]?.nome ?? 'alguém';
  const linhas = [];
  const contagem = {};
  let dias = 0;
  for (const l of m.feed) {
    if (l.seq <= seqVisto || l.ator === app.eu) continue;
    const r = l.ref ?? {};
    if (l.tipo === 'DIA_PASSOU') dias++;
    else if (l.tipo === 'AJUDOU') {} // a linha seguinte (cuidou/colheu) ja conta
    else if ((l.tipo === 'CUIDOU' || l.tipo === 'COLHEU') && r.herdade === minha) {
      const k = `${l.tipo}:${l.ator}`;
      contagem[k] = (contagem[k] ?? 0) + 1;
      if (contagem[k] === 1) linhas.push({ k }); // guarda o lugar; o texto vem no fim
    }
    else if (l.tipo === 'ENCOMENDA_ENTREGUE' || l.tipo === 'PRODUZIU') {}
    else if (l.tipo === 'ABRACOU' && r.para === app.eu) linhas.push({ t: `❤️ ${nomeDe(l.ator)} te mandou um abraço`, abre: { modal: 'abracar' }, dica: 'retribuir' });
    else if (l.tipo === 'ANUNCIOU') linhas.push({ t: `🏪 ${l.texto.replace(/\.$/, '')}`, abre: { aba: 'vendinha' }, dica: 'ver na vendinha' });
    else if (l.tipo === 'COMPROU' && r.para === app.eu) linhas.push(`💰 ${l.texto.replace(/\.$/, '')} — o dinheiro já está com você`);
    else if (l.tipo === 'PRESENTEOU' && r.para === app.eu) linhas.push({ t: `🎁 ${l.texto}`, abre: { modal: 'recado', para: l.ator }, dica: 'agradecer' });
    else if (l.tipo === 'RECADO' && (!r.para || r.para === app.eu)) linhas.push({ t: `💬 ${r.para ? l.texto.replace(/ → [^:]+:/, ' → você:') : l.texto}`, abre: { modal: 'recado', para: r.para ? l.ator : null }, dica: 'responder' });
    else if (l.tipo === 'JOGADOR_ENTROU') linhas.push(`🏠 ${nomeDe(l.ator)} chegou na vila!`);
    else if (l.tipo === 'OBRA_CONCLUIDA') linhas.push(`🏆 ${l.texto}`);
    else if (l.tipo === 'DESTINO') linhas.push(`🔮 ${l.texto}`);
  }
  const prontas = linhas.map((l) => {
    if (typeof l === 'string') return { t: l };
    if (l.t) return l;
    const [tipo, ator] = l.k.split(':');
    const n = contagem[l.k];
    const canteiros = n === 1 ? 'um canteiro seu' : `${n} canteiros seus`;
    return { t: tipo === 'CUIDOU' ? `🤲 ${nomeDe(ator)} cuidou de ${canteiros}` : `🌾 ${nomeDe(ator)} colheu ${canteiros}`, abre: { modal: 'abracar' }, dica: 'agradecer com um abraço' };
  });
  return { dias, linhas: prontas.slice(-10) };
}

function mostrarNovidades() {
  const vila = vilasSalvas().find((v) => v.chave === app.chave);
  const visto = vila?.vistoSeq ?? 0;
  const ultimo = app.motor.mundo.seq;
  if (vila) salvaVila({ ...vila, vistoSeq: ultimo });
  if (!visto) return; // primeira visita neste aparelho: nada a "recuperar"
  const n = novidadesDesde(visto);
  if (!n.dias && !n.linhas.length) return;
  app.novidades = n;
  abreModal('novidades');
}


// O dia vira com o relogio: quem abre primeiro depois da meia-noite manda o
// PASSAR_DIA do dia; o id `dia:AAAA-MM-DD` e unico, entao ninguem vira duas vezes.
let virando = null;
async function virarDiasPendentes() {
  if (!app.sessao || virando) return virando;
  virando = (async () => {
    const hoje = dataLocal();
    // Vila sem calendario (anterior a esta versao): carimba hoje e segue.
    if (!app.motor.mundo.dataDoDia && app.motor.mundo.jogadores[app.eu]) {
      await app.sessao.executar({ tipo: 'ACORDAR', data: hoje });
    }
    const datas = diasPendentes(app.motor.mundo.dataDoDia, hoje);
    for (const data of datas) {
      const r = await app.sessao.executar(comandoDoDia(data));
      if (!r.ok) break;
    }
    if (datas.length) aviso(datas.length === 1 ? 'amanheceu na vila' : `passaram ${datas.length} dias na vila`);
  })().finally(() => { virando = null; });
  return virando;
}
setInterval(() => { if (!document.hidden) virarDiasPendentes(); }, 60000);
setInterval(() => { if (!document.hidden && app.eu && document.getElementById('modal').hidden) pinta(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) virarDiasPendentes(); });

async function entrarComoFamiliar(nome) {
  const id = `${nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
  app.sessao.jogadorId = id;
  const r = await app.sessao.executar({ tipo: 'ENTRAR', por: id, nome, nomeHerdade: `Herdade ${nome}`, data: dataLocal() });
  if (!r.ok) return aviso(r.erro, true);
  trocarDeFamiliar(id);
}

function trocarDeFamiliar(id) {
  app.eu = id;
  app.sessao.jogadorId = id;
  const vila = vilasSalvas().find((v) => v.chave === app.chave);
  if (vila) salvaVila({ ...vila, eu: id });
  pinta();
}

// --- render ----------------------------------------------------------------

function pinta() {
  if (!app.motor || !app.eu) return;
  const v = visao(app.motor.mundo, app.eu, Date.now());
  $('topo').innerHTML = topo(v);
  $('hud').innerHTML = hud(v);
  $('caixa').innerHTML = caixaPraVoce();
  $('ecos').innerHTML = ecos(v);
  $('painel').innerHTML = painel(v);
  $('hotbar').innerHTML = hotbar(v);
  if (app.aba === 'vila') {
    if (!app.cena || !app.cena.canvas.isConnected) {
      $('palco').innerHTML = palcoVila(v);
      app.cena = new VilaCanvas($('cena'), { aoClicar: cliqueNoMundo });
    }
    app.cena.atualizar(v, projetar(app.motor.mundo, Date.now()));
    $('legenda').innerHTML = legendaVila(v);
  } else {
    $('palco').innerHTML = { herdade: palcoHerdade, destino: palcoDestino, familia: palcoFamilia }[app.aba](v);
  }
}

// O canvas devolve o clique traduzido; aqui vira a mesma acao dos botoes.
function cliqueNoMundo(alvo) {
  if (alvo.rio) return aviso(`rio comum: ${app.motor.mundo.comuns.agua}/100 de agua`);
  if (alvo.poco) return abreModal('doar');
  if (alvo.loja) { app.lojaAberta = alvo.loja; return abreModal('loja'); }
  const h = app.motor.mundo.herdades[alvo.herdade];
  if (!h.dono) return aviso('terra livre — manda a chave pra alguem da familia!');
  if (h.dono === app.eu) {
    if (alvo.canteiro != null) return usaFerramentaNoCanteiro(alvo.canteiro);
    app.aba = 'herdade'; return pinta();
  }
  app.herdadeAberta = h.id;
  abreModal('ajudar');
}

function topo(v) {
  const chave = app.chave;
  const abas = [['vila', 'Vila Principal'], ['herdade', 'Minha Herdade'], ['destino', 'Mural do Destino'], ['familia', 'Chave Familiar & Parentes']];
  return `
  <div class="min-h-20 w-full px-gutter-sm lg:px-gutter-lg py-pixel-step flex items-center justify-between gap-gutter-sm lg:gap-gutter-md flex-wrap">
    <div class="flex items-center gap-gutter-md">
      <div class="flex items-center gap-gutter-sm bg-surface-container-low px-panel-pad-sm py-pixel-step shadow-[2px_2px_0_0_#221b08]">
        <span class="text-[28px] leading-none">🌳</span>
        <div class="flex flex-col">
          <span class="font-headline-md text-headline-md text-secondary leading-none uppercase">${esc(v.vila.nome)}</span>
          <span class="font-label-sm text-label-sm text-tertiary uppercase">Edição Aldeia</span>
        </div>
      </div>
      <div class="hidden xl:flex items-center gap-gutter-xs bg-surface-dim px-panel-pad-sm py-pixel-step shadow-[inset_2px_2px_0_0_#38301b]">
        <span class="font-label-sm text-label-sm text-on-surface-variant uppercase">Chave:</span>
        <span class="font-label-md text-label-md text-on-surface select-all">${chave}</span>
        <button class="bg-tertiary-fixed text-on-tertiary-fixed px-pixel-step py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="copiar" data-texto="${linkDeConvite(chave)}" title="Copiar link de convite">${ICO('content_copy', 'text-[14px] leading-none align-middle')}</button>
      </div>
    </div>
    <nav class="flex items-center gap-gutter-xs w-full lg:w-auto order-3 lg:order-none">
      ${abas.map(([k, r]) => `<button class="font-label-md text-label-md uppercase px-gutter-sm py-pixel-step ${app.aba === k ? 'bg-primary-container text-on-primary-container shadow-[inset_0_-3px_0_0_#245107]' : 'text-on-secondary hover:bg-surface-variant hover:text-on-surface'}" data-acao="aba" data-aba="${k}">${r}</button>`).join('')}
    </nav>
    <div class="flex items-center gap-gutter-md">
      <button class="bg-surface-container-low text-secondary font-label-lg px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="tutorial" title="Como jogar">❔</button>
      ${'Notification' in window && Notification.permission !== 'denied' ? `<button class="bg-surface-container-low text-secondary font-label-lg px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#221b08] press ${sinoLigado() ? '' : 'pisca'}" data-acao="sino" title="${sinoLigado() ? 'Avisos ligados: recado, abraço, presente, planta pronta. Clique pra desligar.' : 'Quer ser avisado(a) quando a família falar com você? Clique.'}">${sinoLigado() ? '🔔' : '🔕'}</button>` : ''}
      <div class="flex items-center gap-gutter-xs bg-tertiary-fixed px-panel-pad-sm py-pixel-step shadow-[2px_2px_0_0_#221b08]">
        ${ICO('monetization_on', 'text-tertiary text-[18px]')}
        <span class="font-label-md text-label-md text-on-tertiary-fixed">${v.hud.moedas} G</span>
      </div>
      <div class="relative flex items-center">
        <div class="w-9 h-9 bg-primary flex items-center justify-center text-[20px]">${v.hud.sprite}</div>
        <span class="absolute -bottom-1 -right-2 bg-secondary-container text-on-secondary-container font-label-sm text-label-sm px-pixel-unit shadow-[1px_1px_0_0_#221b08]">Nv.${v.hud.nivel}</span>
      </div>
    </div>
  </div>`;
}

function medidor(rotulo, icone, corIcone, valor, max, cor) {
  const pct = Math.max(0, Math.min(100, Math.round((valor / max) * 100)));
  return `
  <div class="flex flex-col gap-0.5">
    <div class="flex justify-between items-center text-on-surface gap-gutter-sm">
      <span class="font-label-sm text-label-sm uppercase flex items-center gap-1">${ICO(icone, `${corIcone} text-[14px]`)} ${rotulo}</span>
      <span class="font-label-sm text-label-sm text-on-surface-variant">${valor}/${max}</span>
    </div>
    <div class="w-28 sm:w-36 h-3 bg-surface-dim shadow-[inset_2px_2px_0_0_#221b08] p-0.5">
      <div class="h-full ${cor} ${pct <= 20 ? 'pisca' : ''}" style="width:${pct}%"></div>
    </div>
  </div>`;
}

function hud(v) {
  const s = v.sinergia;
  return `
  <div class="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-gutter-sm">
    <div class="flex items-center gap-gutter-sm bg-surface-container-lowest px-gutter-sm py-pixel-step shadow-[2px_2px_0_0_#221b08]">
      <div class="w-8 h-8 bg-tertiary-fixed shadow-[1px_1px_0_0_#221b08] flex items-center justify-center text-[18px]">${v.vila.iconeClima}</div>
      <div class="flex flex-col">
        <div class="flex items-center gap-pixel-step">
          <span class="font-label-md text-label-md text-on-surface uppercase font-bold">${esc(v.vila.estacao)}, dia ${v.vila.dia}</span>
          <span class="w-1.5 h-1.5 bg-primary"></span>
          <span class="font-label-md text-label-md text-secondary">Ano ${v.vila.ano}</span>
        </div>
        <span class="font-label-sm text-label-sm text-on-surface-variant">${esc(v.vila.rotuloClima)}</span>
      </div>
    </div>

    <div class="flex items-center gap-gutter-md bg-surface-container-high px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08]">
      ${medidor(`NV ${v.hud.nivel}`, 'bolt', 'text-tertiary-container', v.hud.xp, v.hud.xpMax, 'bg-tertiary')}
      ${medidor('TERRA', 'yard', 'text-primary', v.hud.terra, 100, 'bg-primary')}
    </div>

    <div class="flex items-center gap-pixel-step bg-surface-container-low px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#221b08]" title="Bens da vila: de todo mundo. Cada rega, machadada e abraço mexe aqui.">
      ${v.comuns.map((c) => `
        <div class="flex items-center gap-1 px-pixel-step py-pixel-unit ${COR_ESTADO[c.estado]} shadow-[1px_1px_0_0_#221b08] ${c.estado === 'critico' ? 'pisca' : ''}" title="${esc(c.rotulo)} ${c.valor}/100 (de todos)">
          ${ICO(ICONE_COMUM[c.chave], 'text-[14px]')}<span class="font-label-sm text-[11px] font-bold">${c.valor}</span>
        </div>`).join('')}
    </div>

    <div class="flex items-center gap-gutter-sm bg-surface-container-low px-gutter-sm py-pixel-step shadow-[2px_2px_0_0_#221b08]">
      <div class="flex flex-col">
        <div class="flex items-center justify-between gap-gutter-sm">
          <span class="font-label-sm text-label-sm uppercase text-secondary font-bold flex items-center gap-1">${ICO('groups', 'text-secondary text-[14px]')} Sinergia Familiar</span>
          <span class="font-label-sm text-label-sm text-primary font-bold">Nv. ${s.nivel} (${s.pct}%)</span>
        </div>
        <div class="w-44 sm:w-56 h-3 bg-surface-dim shadow-[inset_2px_2px_0_0_#221b08] p-0.5 mt-0.5">
          <div class="h-full ${s.estado === 'critico' ? 'bg-error' : s.estado === 'otimo' ? 'bg-primary' : 'bg-secondary-container'}" style="width:${s.pct}%"></div>
        </div>
        <span class="font-label-sm text-[10px] ${s.estado === 'critico' ? 'text-error' : 'text-primary-container'} leading-tight mt-0.5 font-bold">${esc(s.bonus)}</span>
      </div>
    </div>
  </div>`;
}

// --- Ecos do Destino (feed) ------------------------------------------------

function ecos(v) {
  const ultimos = v.feed.slice(0, 6);
  return `
  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08] flex flex-col gap-gutter-xs">
    <div class="bg-surface-dim p-gutter-xs shadow-[inset_1px_1px_0_0_#221b08]">
      <span class="font-label-sm text-[10px] uppercase text-on-surface-variant block mb-1">Ações de afeto:</span>
      <div class="grid grid-cols-3 gap-1">
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="abracar">❤️ Abraço</button>
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="presentear">🍎 Presente</button>
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="recado">💬 Recado</button>
      </div>
    </div>
    <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200] flex items-center justify-between">
      <span class="font-headline-md text-[14px] text-on-secondary uppercase flex items-center gap-1">${ICO('history_edu', 'text-[16px]')} Ecos do Destino</span>
      <span class="w-2 h-2 bg-primary-fixed pisca"></span>
    </div>
    ${v.presagios.map((p) => presagioHtml(p)).join('')}
    <div class="space-y-1">
      ${ultimos.map((l) => ecoHtml(l)).join('')}
    </div>
    <button class="w-full bg-surface-container font-label-sm text-[10px] uppercase py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="aba" data-aba="destino">ver o mural inteiro →</button>
  </div>`;
}

function presagioHtml(p) {
  return p.chave === 'festa' ? `
        <div class="bg-primary-container p-gutter-xs shadow-[inset_1px_1px_0_0_#1b3a0f]">
          <span class="font-label-sm text-[11px] font-bold uppercase text-on-primary-container">🎉 O mundo respondeu</span>
          <p class="font-body-sm text-[12px] text-on-primary-container mt-1 leading-snug">${esc(p.texto)}</p>
        </div>` : `
        <div class="bg-error-container p-gutter-xs shadow-[inset_1px_1px_0_0_#93000a]">
          <span class="font-label-sm text-[11px] font-bold uppercase text-on-error-container">🔮 O mundo respondeu</span>
          <p class="font-body-sm text-[12px] text-on-error-container mt-1 leading-snug">${esc(p.texto)}</p>
        </div>`;
}

function ecoHtml(l) {
  return l.tipo === 'DIA_PASSOU' ? `
        <div class="flex items-center gap-1 text-on-surface-variant font-label-sm text-[10px] uppercase py-pixel-unit">
          <span class="flex-1 h-px bg-outline-variant"></span><span>${esc(l.texto.replace(/ \(ano \d+\)/, '').replace(' — ', ' · ').replace(/\.$/, ''))}</span><span class="flex-1 h-px bg-outline-variant"></span>
        </div>` : `
        <div class="bg-surface-container-highest p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">
          <div class="flex items-center justify-between text-secondary">
            <span class="font-label-sm text-[11px] font-bold uppercase">${l.sprite} ${esc(l.autor)}</span>
            <span class="font-label-sm text-[10px] text-on-surface-variant">${esc(l.quando)}</span>
          </div>
          <p class="font-body-sm text-[12px] text-on-surface mt-1 leading-snug">${esc(l.texto)}${
            l.impacto ? ` ➔ <strong class="${/−/.test(l.impacto) ? 'text-error' : 'text-primary'}">${esc(l.impacto)}</strong>` : ''}</p>
        </div>`;
}

// --- painel direito: bens comuns + missão ----------------------------------

const ICONE_COMUM = { agua: 'water_drop', floresta: 'forest', solo: 'terrain', harmonia: 'favorite' };
const COR_ESTADO = { critico: 'bg-error text-on-error', alerta: 'bg-tertiary-container text-on-tertiary', ok: 'bg-primary text-on-primary', otimo: 'bg-primary text-on-primary' };

// Um cartao de encomenda (painel e modal da loja usam o mesmo).
function encomendaHtml(e) {
  return `
        <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">
          <div class="flex items-center justify-between gap-gutter-xs">
            <span class="font-label-sm text-[10px] uppercase text-on-surface-variant">${esc(e.cliente)}</span>
            <span class="font-label-sm text-[10px] text-primary font-bold">+${e.moedas} G · +${e.xp} XP</span>
          </div>
          <div class="flex flex-wrap gap-1 mt-1">
            ${e.itens.map((i) => `<span class="font-label-sm text-[10px] px-pixel-step py-pixel-unit shadow-[1px_1px_0_0_#221b08] ${i.ok ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-dim text-on-surface-variant'}">${i.icone} ${i.qtd} ${esc(i.nome)} <span class="opacity-70">(${i.tenho})</span></span>`).join('')}
          </div>
          ${e.pronta ? `<button class="w-full mt-1 bg-primary text-on-primary font-label-sm text-[10px] uppercase py-pixel-unit shadow-[1px_1px_0_0_#221b08] press pisca" data-acao="cumprir-encomenda" data-indice="${e.indice}">Entregar</button>` : ''}
        </div>`;
}

// A lista da vendinha (painel e modal da loja usam a mesma).
function vendinhaHtml(v) {
  return `
    <div class="space-y-1">
      ${v.vendinha.length ? v.vendinha.map((l) => `
        <div class="flex items-center gap-gutter-xs bg-surface-container px-gutter-xs py-pixel-step shadow-[inset_1px_1px_0_0_#38301b] ${l.util ? 'ring-2 ring-primary-fixed-dim' : ''}">
          <span class="text-[16px]">${l.icone}</span>
          <div class="flex-1 min-w-0">
            <p class="font-label-sm text-label-sm uppercase truncate">${l.qtd}x ${esc(l.nome)} <span class="text-on-surface-variant normal-case">de ${esc(l.vendedor)}</span></p>
            <p class="font-body-sm text-[10px] text-on-surface-variant">${l.unitario} G cada · feira ${l.feira} G${l.util ? ' · <span class="text-primary font-bold">fecha uma encomenda sua</span>' : ''}</p>
          </div>
          ${l.minha
            ? `<button class="bg-surface-dim font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="retirar" data-lote="${l.lote}" title="Volta pro seu celeiro">${l.preco} G · retirar</button>`
            : `<button class="bg-primary text-on-primary font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press ${l.possoPagar ? '' : 'opacity-50'}" data-acao="comprar" data-de="${l.de}" data-lote="${l.lote}">Comprar ${l.preco} G</button>`}
        </div>`).join('') : `<p class="font-body-sm text-[12px] text-on-surface-variant">Ninguém pôs nada à venda ainda. No seu celeiro (Minha Herdade) tem o botão 🏪 pra anunciar.</p>`}
    </div>`;
}

function painel(v) {
  const prontas = v.encomendas.filter((e) => e.pronta).length;
  const lotes = v.vendinha.filter((l) => !l.minha).length;
  const receber = v.missoesDoDia.filter((m) => m.cumprida && !m.recebida).length;
  const pedidos = v.pedidosDeAjuda.length;
  const abas = [
    ['encomendas', '🚚', 'Encomendas', prontas, 'pronta(s) pra entregar'],
    ['vendinha', '🏪', 'Vendinha', lotes, 'lote(s) da família à venda'],
    ['missoes', '📋', 'Missões', receber, 'prêmio(s) pra receber'],
    ['ajuda', '🤝', 'Ajuda', pedidos, 'pedido(s) de ajuda'],
  ];
  if (!abas.some(([k]) => k === app.painelAba)) app.painelAba = 'encomendas';
  const atual = app.painelAba;
  const corpo = { encomendas: painelEncomendas, vendinha: painelVendinha, missoes: painelMissoes, ajuda: painelAjuda }[atual](v);
  return `
  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08]">
    <div class="grid grid-cols-4 gap-pixel-step mb-panel-pad-sm">
      ${abas.map(([k, ico, nome, n, dica]) => `
        <button class="relative flex flex-col items-center py-pixel-step shadow-[2px_2px_0_0_#221b08] press ${k === atual ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}" data-acao="painel-aba" data-aba="${k}" title="${n ? `${n} ${dica}` : nome}">
          <span class="text-[16px] leading-none">${ico}</span>
          <span class="font-label-sm text-[9px] uppercase mt-0.5">${nome}</span>
          ${n ? `<span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[10px] font-bold flex items-center justify-center shadow-[1px_1px_0_0_#221b08] ${k === atual ? '' : 'pisca'}">${n}</span>` : ''}
        </button>`).join('')}
    </div>
    ${corpo}
  </div>`;
}

function painelEncomendas(v) {
  return `
    <div class="flex items-center justify-between mb-1">
      <span class="font-label-md text-label-md uppercase font-bold text-secondary">🚚 Encomendas</span>
      <span class="font-label-sm text-[10px] text-on-surface-variant">pagam +50%</span>
    </div>
    <div class="space-y-1">
      ${v.encomendas.map((e) => encomendaHtml(e)).join('')}
    </div>`;
}

function painelVendinha(v) {
  return `
    <div class="flex items-center justify-between mb-1" id="vendinha">
      <span class="font-label-md text-label-md uppercase font-bold text-secondary">🏪 Vendinha da vila</span>
      <span class="font-label-sm text-[10px] text-on-surface-variant">${v.minhaVendinha ? `${v.minhaVendinha.lotes}/${v.minhaVendinha.maximo} lotes meus` : ''}</span>
    </div>
    ${vendinhaHtml(v)}
    <p class="font-body-sm text-[10px] text-on-surface-variant mt-1">Pra anunciar: Minha Herdade → Celeiro → 🏪.</p>`;
}

function painelMissoes(v) {
  const m = v.missao;
  return `
    <div class="flex items-center justify-between mb-1">
      <span class="font-label-md text-label-md uppercase font-bold text-secondary">📋 Missões de hoje</span>
      <span class="font-label-sm text-[10px] text-on-surface-variant">${v.missoesDoDia.filter((x) => x.recebida).length}/${v.missoesDoDia.length} · novas à meia-noite</span>
    </div>
    <div class="space-y-1">
      ${v.missoesDoDia.map((x) => `
        <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b] ${x.recebida ? 'opacity-60' : ''}">
          <div class="flex items-center justify-between gap-gutter-xs">
            <span class="font-label-sm text-label-sm uppercase ${x.recebida ? 'line-through' : ''}">${esc(x.texto)}</span>
            ${x.recebida ? `<span class="font-label-sm text-[10px] text-primary uppercase">✓ feito</span>`
              : x.cumprida ? `<button class="bg-primary text-on-primary font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press pisca" data-acao="cumprir-missao" data-indice="${x.indice}">Receber ${esc(x.premioTexto)}</button>`
              : `<span class="font-label-sm text-[10px] text-on-surface-variant whitespace-nowrap">${x.feito}/${x.meta} · ${esc(x.premioTexto)}</span>`}
          </div>
          <div class="w-full h-1.5 bg-surface-dim shadow-[inset_1px_1px_0_0_#221b08] mt-1"><div class="h-full ${x.cumprida ? 'bg-primary' : 'bg-secondary-container'}" style="width:${Math.round((x.feito / x.meta) * 100)}%"></div></div>
        </div>`).join('')}
    </div>

    <div class="flex items-center gap-1.5 text-secondary mt-gutter-sm mb-1">
      ${ICO('assignment', 'text-[16px]')}<span class="font-label-md text-label-md font-bold uppercase">Obras da família</span>
      <span class="font-label-sm text-[10px] text-on-surface-variant ml-auto">${v.obras.filter((o) => o.concluida).length}/${v.obras.length} prontas</span>
    </div>
    <div class="space-y-1 mb-gutter-xs">
      ${v.obras.filter((o) => o.concluida).map((o) => `
        <div class="bg-primary-fixed text-on-primary-fixed p-gutter-xs shadow-[inset_1px_1px_0_0_#245107] flex items-center gap-gutter-xs">
          <span class="text-[16px]">🏆</span>
          <div class="flex-1"><span class="font-label-sm text-label-sm uppercase font-bold">${esc(o.nome)} · pronta</span>
          <p class="font-body-sm text-[11px] leading-tight">${esc(o.texto)} Vale pra todo mundo, todo dia.</p></div>
        </div>`).join('')}
    </div>
    ${m ? `
      <p class="font-body-sm text-[12px] text-on-surface leading-tight font-bold">${esc(m.nome)} — ${esc(m.texto)}</p>
      <div class="mt-2">
        <div class="flex justify-between text-on-surface-variant font-label-sm text-[10px] mb-0.5">
          <span>Progresso coletivo</span><span class="font-bold text-primary">${m.pct}% concluído</span>
        </div>
        <div class="w-full h-3 bg-surface-dim shadow-[inset_2px_2px_0_0_#221b08] p-0.5">
          <div class="h-full bg-primary-container" style="width:${m.pct}%"></div>
        </div>
        <p class="font-label-sm text-[10px] text-error mt-1">${esc(m.chamada)}</p>
      </div>
      <button class="w-full mt-2 bg-primary text-on-primary font-label-sm text-label-sm uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="modal" data-modal="doar">Doar recursos</button>
      ${v.obras.filter((o) => !o.concluida && o.chave !== m.chave).length ? `<p class="font-label-sm text-[10px] text-on-surface-variant mt-1">Depois: ${v.obras.filter((o) => !o.concluida && o.chave !== m.chave).map((o) => esc(o.nome)).join(' · ')}</p>` : ''}
    ` : `<p class="font-body-sm text-[12px] text-primary">Todas as obras da vila estão prontas. Isso é raro.</p>`}`;
}

function painelAjuda(v) {
  const porHerdade = new Map();
  for (const p of v.pedidosDeAjuda) { if (!porHerdade.has(p.herdade)) porHerdade.set(p.herdade, []); porHerdade.get(p.herdade).push(p); }
  const nomeH = (id) => (app.motor.mundo.herdades[id]?.nome ?? '').replace(/^Herdade /, '');
  return `
    <div class="flex items-center justify-between mb-1">
      <span class="font-label-md text-label-md uppercase font-bold text-secondary">🤝 Sua mão faz falta</span>
      <span class="font-label-sm text-[10px] text-on-surface-variant">ajudar dá XP, laço e harmonia</span>
    </div>
    ${porHerdade.size ? [...porHerdade.entries()].map(([h, lista]) => `
      <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b] mb-1">
        <div class="flex items-center justify-between gap-gutter-xs mb-1">
          <span class="font-label-sm text-label-sm uppercase font-bold">${esc(nomeH(h))}</span>
          ${lista.length > 1 ? `<button class="bg-primary text-on-primary font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="ajudar-tudo" data-herdade="${h}">Ajudar em tudo (${lista.length})</button>` : ''}
        </div>
        <div class="space-y-1">
          ${lista.slice(0, 6).map((p) => `
            <button class="w-full text-left bg-surface-dim px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08] press font-body-sm text-[11px]"
              data-acao="ajudar" data-herdade="${p.herdade}" data-tile="${p.tile}" data-sub="${p.acao}">${p.icone} ${esc(p.motivo.replace(/ em Herdade .*$/, ''))}</button>`).join('')}
        </div>
      </div>`).join('')
    : `<p class="font-body-sm text-[12px] text-on-surface-variant">Ninguém precisa de nada agora. Quando uma planta de parente pedir água, praga ou passar do ponto, aparece aqui — e no mapa.</p>`}`;
}

// --- palcos ----------------------------------------------------------------

function palcoVila(v) {
  return `
  <div class="bg-surface-container-low p-pixel-step shadow-[4px_4px_0_0_#221b08]">
    <div class="shadow-[inset_2px_2px_0_0_#221b08]" id="cena"></div>
  </div>
  <div class="mt-gutter-xs" id="legenda"></div>`;
}

function legendaVila(v) {
  return `
  <div class="flex flex-wrap items-center gap-gutter-sm font-label-sm text-[10px] uppercase text-on-surface-variant">
    <span class="bg-surface-container px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08]">semente: <strong class="text-secondary">${esc(CULTURAS[app.cultura].nome)}</strong></span>
    <span>canteiro vazio planta · com sede rega · maduro colhe</span>
    <span>·</span>
    <span>clique na herdade de alguém pra ajudar</span>
    <span>·</span>
    <span>poço = doar pra obra</span>
    <span>· lojas lá embaixo = quem faz as encomendas (acende quando a sua está pronta)</span>
    ${v.pedidosDeAjuda.length ? `<span class="ml-auto bg-tertiary-fixed text-on-tertiary-fixed px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] pisca">${v.pedidosDeAjuda.length} pedido(s) de ajuda</span>` : ''}
  </div>`;
}

function palcoHerdade(v) {
  const h = v.minhaHerdade;
  const slots = h.construcoes;
  return `
  <div class="bg-surface-container-low p-panel-pad-md shadow-[4px_4px_0_0_#221b08]">
    <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200] flex items-center justify-between mb-panel-pad-md">
      <span class="font-headline-md text-[14px] text-on-secondary uppercase">${ICO('cottage', 'text-[16px] align-middle')} ${esc(h.nome)}</span>
      <span class="font-label-sm text-label-sm text-tertiary-fixed uppercase">terra ${h.fertilidade} · poluição ${h.poluicao}</span>
    </div>
    <div class="flex flex-wrap gap-gutter-lg">
      <div>
        <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Canteiros — semente: <strong class="text-secondary">${esc(CULTURAS[app.cultura].nome)}</strong> · vazio planta, com sede rega, maduro colhe</p>
        <div class="grid grid-cols-3 gap-gutter-xs w-fit chao p-gutter-xs shadow-[inset_2px_2px_0_0_#221b08]">
          ${h.canteiros.map((c) => canteiroGrande(c)).join('')}
        </div>
        ${h.proximoCanteiro != null ? `
        <button class="mt-gutter-xs w-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-label-sm uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press ${v.hud.moedas >= h.proximoCanteiro ? '' : 'opacity-50'}" data-acao="comprar-canteiro" title="A herdade cresce e todo mundo ve no mapa">
          + Abrir canteiro · ${h.proximoCanteiro} G
        </button>` : `<p class="font-label-sm text-[10px] uppercase text-on-surface-variant mt-1">herdade no tamanho máximo</p>`}
      </div>
      <div class="flex-1 min-w-[220px]">
        <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Benfeitorias</p>
        <div class="space-y-1 mb-gutter-md">
          ${slots.length ? slots.map((b) => `<div class="bg-surface-container px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08] flex items-start gap-gutter-xs">
              <div class="flex-1"><span class="font-label-sm text-label-sm uppercase">${b.icone} ${esc(b.nome)}</span><p class="font-body-sm text-[11px] text-on-surface-variant">${esc(b.texto)}</p></div>
              <button class="bg-error-container text-on-error-container font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="demolir" data-construcao="${b.chave}" title="Desmanchar e recuperar metade do material">Demolir</button>
            </div>`).join('')
            : `<p class="font-body-sm text-[12px] text-on-surface-variant">Nenhuma ainda. Construir (7) na barra de baixo.</p>`}
          <p class="font-label-sm text-[10px] uppercase text-on-surface-variant">${h.vagas > 0 ? `${h.vagas} vaga(s) livre(s)` : 'herdade cheia — demolir uma pra trocar'}</p>
        </div>
        ${h.maquinas.length ? `<p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Máquinas</p>
        <div class="space-y-1 mb-gutter-md">
          ${h.maquinas.map((mq) => `
            <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">
              <div class="flex items-center justify-between">
                <span class="font-label-sm text-label-sm uppercase">${mq.icone} ${esc(mq.nome)}</span>
                <span class="font-label-sm text-[10px] ${mq.pronta ? 'text-primary' : 'text-on-surface-variant'}">${esc(mq.rotulo)}</span>
              </div>
              ${mq.pronta ? `<button class="w-full mt-1 bg-primary text-on-primary font-label-sm text-[10px] uppercase py-pixel-unit shadow-[1px_1px_0_0_#221b08] press pisca" data-acao="recolher" data-maquina="${mq.maquina}">Recolher ${mq.produto.icone} ${esc(mq.produto.nome)}</button>`
                : mq.ocupada ? `<div class="w-full h-1.5 bg-surface-dim mt-1"><div class="h-full bg-tertiary" style="width:${Math.max(4, 100 - Math.round(mq.prontaEm / (PRODUTOS[mq.produto.chave].minutos * 60000) * 100))}%"></div></div>`
                : `<div class="flex flex-wrap gap-1 mt-1">${mq.receitas.map((r) => `<button class="bg-surface-dim font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press ${r.podeFazer ? '' : 'opacity-50'}" data-acao="produzir" data-produto="${r.chave}" title="${esc(r.entradaTexto)} · ${r.minutos} min · vende ${r.preco} G">${r.icone} ${esc(r.nome)} <span class="normal-case opacity-70">(${esc(r.entradaTexto)})</span></button>`).join('')}</div>`}
            </div>`).join('')}
        </div>` : ''}
        <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Celeiro</p>
        <div class="space-y-1">
          ${v.hud.colheita.length ? v.hud.colheita.map((c) => `
            <div class="flex items-center gap-gutter-xs bg-surface-container px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08]">
              <span class="text-[16px]">${c.icone}</span>
              <span class="font-label-sm text-label-sm uppercase flex-1">${esc(c.nome)} x${c.qtd}</span>
              <button class="bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="anunciar" data-item="${c.cultura}" title="Pôr na vendinha da vila (até 2x o preço de feira)">🏪 Anunciar</button>
              <button class="bg-primary text-on-primary font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="vender" data-cultura="${c.cultura}" data-qtd="${c.qtd}">Vender ${c.preco * c.qtd} G</button>
            </div>`).join('') : `<p class="font-body-sm text-[12px] text-on-surface-variant">Celeiro vazio.</p>`}
        </div>
        <div class="flex gap-gutter-xs mt-gutter-md font-label-sm text-label-sm uppercase">
          <span class="bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_1px_1px_0_0_#221b08]">🪵 ${v.hud.madeira}</span>
          ${v.hud.madeira < 5 ? `<span class="font-body-sm text-[10px] normal-case text-on-surface-variant self-center">madeira vem do <strong>Machado (4)</strong> na barra de baixo</span>` : ''}
          <span class="bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_1px_1px_0_0_#221b08]">🪨 ${v.hud.pedra}</span>
          <span class="bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_1px_1px_0_0_#221b08]">💰 ${v.hud.moedas}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function canteiroGrande(c) {
  const base = 'w-16 h-16 flex flex-col items-center justify-center shadow-[inset_2px_2px_0_0_#221b08] press relative';
  if (c.vazio) {
    return `<button class="${base} bg-surface-dim" data-acao="canteiro" data-tile="${c.i}">
      <span class="text-[10px] text-on-surface-variant">vazio</span></button>`;
  }
  return `<button class="${base} ${c.pronto ? 'bg-tertiary-fixed' : c.problema ? 'bg-error-container' : 'bg-primary-fixed'}" data-acao="canteiro" data-tile="${c.i}" title="${esc(c.nome)} — ${c.progresso}% · ${esc(c.rotulo)}">
    <span class="text-[22px] leading-none">${c.icone}</span>
    <span class="font-label-sm text-[8px] uppercase text-center leading-none">${c.pronto ? 'colher!' : c.problema ? `pede ${c.problema}` : esc(c.rotulo.replace('pronta em ', ''))}</span>
    <span class="absolute left-1 right-1 bottom-0.5 h-1 bg-surface-dim"><span class="block h-full ${c.pronto ? 'bg-tertiary' : 'bg-primary'}" style="width:${c.progresso}%"></span></span>
    ${c.problema ? `<span class="absolute top-0.5 right-0.5 text-[12px] pisca">${c.problemaIcone}</span>` : ''}
  </button>`;
}

function palcoDestino(v) {
  const feitos = v.familia.map((f) => ({ nome: f.nome, sprite: f.sprite, ...f.feitos }));
  const colunas = [['ajudas', 'Ajudas'], ['presentes', 'Presentes'], ['abracos', 'Abraços'], ['doacoes', 'Doações'], ['arvores', 'Mudas'], ['cortes', 'Cortes']];
  return `
  <div class="bg-surface-container-low p-panel-pad-md shadow-[4px_4px_0_0_#221b08] space-y-gutter-md">
    <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200]">
      <span class="font-headline-md text-[14px] text-on-secondary uppercase">${ICO('auto_stories', 'text-[16px] align-middle')} Mural do Destino</span>
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">O que o mundo andou mandando</p>
      ${v.presagios.length ? v.presagios.map((p) => `<div class="bg-error-container p-gutter-xs shadow-[inset_1px_1px_0_0_#93000a] mb-1"><p class="font-body-sm text-[12px] text-on-error-container">${esc(p.texto)}</p></div>`).join('')
        : `<p class="font-body-sm text-[12px] text-primary">Nada de mais. A vila está em ordem.</p>`}
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Tudo que aconteceu (últimos ${v.feed.length})</p>
      <div class="space-y-1 max-h-[60vh] overflow-y-auto pr-1">${v.feed.map((l) => ecoHtml(l)).join('')}</div>
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Marcos da família</p>
      ${v.marcos.length ? v.marcos.map((m) => `<div class="bg-primary-fixed p-gutter-xs shadow-[inset_1px_1px_0_0_#245107] mb-1"><p class="font-body-sm text-[12px] text-on-primary-fixed">🏆 ${esc(m.texto)}</p></div>`).join('')
        : `<p class="font-body-sm text-[12px] text-on-surface-variant">Nenhuma obra concluída ainda.</p>`}
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Quem fez o quê</p>
      <div class="overflow-x-auto">
        <table class="w-full font-body-sm text-[12px]">
          <thead><tr class="bg-surface-dim text-on-surface uppercase font-label-sm text-[10px]">
            <th class="text-left p-pixel-step">Familiar</th>${colunas.map(([, r]) => `<th class="p-pixel-step">${r}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${feitos.map((f) => `<tr class="odd:bg-surface-container">
              <td class="p-pixel-step font-bold">${f.sprite} ${esc(f.nome)}</td>
              ${colunas.map(([k]) => `<td class="p-pixel-step text-center">${f[k] ?? 0}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Obras da vila</p>
      <div class="grid sm:grid-cols-2 gap-gutter-xs">
        ${v.obras.map((o) => `
          <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">
            <div class="flex justify-between font-label-sm text-label-sm uppercase">
              <span>${esc(o.nome)}</span><span class="${o.concluida ? 'text-primary' : 'text-on-surface-variant'}">${o.concluida ? 'pronta' : `${o.pct}%`}</span>
            </div>
            <p class="font-body-sm text-[11px] text-on-surface-variant">${esc(o.texto)}</p>
            <div class="w-full h-2 bg-surface-dim shadow-[inset_1px_1px_0_0_#221b08] mt-1"><div class="h-full ${o.concluida ? 'bg-primary' : 'bg-primary-container'}" style="width:${o.pct}%"></div></div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function palcoFamilia(v) {
  const chave = app.chave;
  return `
  <div class="bg-surface-container-low p-panel-pad-md shadow-[4px_4px_0_0_#221b08] space-y-gutter-md">
    <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200]">
      <span class="font-headline-md text-[14px] text-on-secondary uppercase">${ICO('key', 'text-[16px] align-middle')} Chave Familiar & Parentes</span>
    </div>
    <div class="bg-surface-dim p-gutter-md shadow-[inset_2px_2px_0_0_#221b08] text-center">
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant">Mande esta chave para quem falta</p>
      <p class="font-headline-lg text-headline-lg text-secondary select-all my-1">${chave}</p>
      <div class="flex gap-gutter-xs justify-center flex-wrap">
        <a class="bg-[#25D366] text-white font-label-sm uppercase px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08] press inline-block" href="${linkWhatsApp(chave)}" target="_blank" rel="noopener">💬 Convidar pelo WhatsApp</a>
        ${navigator.share ? `<button class="bg-primary text-on-primary font-label-sm uppercase px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="compartilhar" data-chave="${chave}">Compartilhar…</button>` : ''}
        <button class="bg-surface-dim font-label-sm uppercase px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="copiar" data-texto="${linkDeConvite(chave)}">Copiar link</button>
        <button class="bg-tertiary-fixed text-on-tertiary-fixed font-label-sm uppercase px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="copiar" data-texto="${chave}">Só a chave</button>
      </div>
      <p class="font-body-sm text-[11px] text-on-surface-variant mt-1">Manda o link: quem abre já cai na vila certa, só digita o nome.</p>
      <button class="mt-gutter-xs bg-surface-container font-label-sm text-[10px] uppercase px-gutter-md py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="trocar-vila">↩ Trocar de vila</button>
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Na vila agora</p>
      <div class="grid sm:grid-cols-2 gap-gutter-xs">
        ${v.familia.map((f) => `
          <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b] flex items-center gap-gutter-xs">
            <div class="w-9 h-9 bg-secondary flex items-center justify-center text-[18px]">${f.sprite}</div>
            <div class="flex-1">
              <span class="font-label-md text-label-md uppercase">${esc(f.nome)}${f.id === app.eu ? ' (você)' : ''}</span>
              <p class="font-body-sm text-[11px] text-on-surface-variant">Laço: ${esc(f.laco)} · Nv.${f.nivel}</p>
            </div>
            ${f.id === app.eu ? `<span class="font-label-sm text-[10px] uppercase text-primary">jogando</span>` : `
              <div class="flex flex-col gap-1">
                <button class="bg-secondary-fixed font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="abracar" data-para="${f.id}">❤️ Abraçar</button>
                <button class="bg-surface-dim font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="trocar" data-quem="${f.id}">Jogar como</button>
              </div>`}
          </div>`).join('')}
      </div>
    </div>
    <div class="bg-surface-container-highest p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Adicionar familiar neste aparelho</p>
      <div class="flex gap-gutter-xs">
        <input class="flex-1 bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md" id="in-novo" maxlength="18" placeholder="Nome do parente"/>
        <button class="bg-primary text-on-primary font-label-sm uppercase px-gutter-md shadow-[2px_2px_0_0_#221b08] press" data-acao="novo-familiar">Entrar</button>
      </div>
      <p class="font-body-sm text-[11px] text-on-surface-variant mt-1">
        ${app.online ? 'Também dá para ter mais de um familiar neste aparelho — todos entram na mesma vila.' : 'Modo revezamento: todos jogam neste navegador.'}
      </p>
    </div>
  </div>`;
}

// --- hotbar ----------------------------------------------------------------

function hotbar(v) {
  const testes = SLOTS.map((s) => {
    if (!s.cmd) return { ...s, habilitado: true, motivo: null };
    const [r] = acoesPossiveis(app.motor.mundo, app.eu, [s.cmd]);
    return { ...s, habilitado: r.habilitado, motivo: r.motivo };
  });
  return `
  <div class="max-w-[1600px] mx-auto flex flex-col items-center gap-gutter-xs">
    <div class="grid grid-cols-5 sm:grid-cols-10 gap-gutter-xs w-full max-w-4xl">
      ${testes.map((s) => `
        <button class="relative w-full h-12 sm:h-14 bg-surface-container hover:bg-surface-container-lowest shadow-[inset_2px_2px_0_0_#221b08] flex items-center justify-center press group ${s.habilitado ? '' : 'opacity-40'}"
                data-acao="slot" data-slot="${s.chave}" title="${esc(s.motivo ?? s.dica)}">
          <span class="absolute top-0.5 left-1 font-label-sm text-[10px] text-on-surface-variant">${s.tecla}</span>
          <span class="flex flex-col items-center leading-none">${ICO(s.icone, 'text-secondary text-[18px] sm:text-[22px]')}<span class="font-label-sm text-[7px] sm:text-[8px] uppercase text-on-surface mt-0.5">${esc(s.nome)}</span></span>
          <span class="hidden group-hover:block absolute bottom-full mb-2 z-50 bg-surface-container-lowest p-gutter-xs shadow-[2px_2px_0_0_#221b08] w-44 pointer-events-none text-left">
            <span class="font-label-sm text-label-sm font-bold text-secondary uppercase block">${esc(s.nome)}</span>
            <span class="font-body-sm text-[10px] text-on-surface-variant">${esc(s.motivo ?? s.dica)}</span>
          </span>
        </button>`).join('')}
    </div>
    <div class="flex items-center gap-gutter-md font-label-sm text-label-sm text-on-surface-variant uppercase flex-wrap justify-center">
      <span>${v.hud.sprite} ${esc(v.hud.nome)} · Nv.${v.hud.nivel} (${v.hud.xp}/${v.hud.xpMax} XP) · 🪵${v.hud.madeira} 🪨${v.hud.pedra}</span>
      ${v.vila.velocidade !== 100 ? `<span class="${v.vila.velocidade > 100 ? 'text-primary' : 'text-error'}">crescimento ${v.vila.velocidade}%</span>` : ''}
      <span class="w-2 h-2 bg-primary"></span>
      <span>${app.online ? '● entre casas' : '○ só neste aparelho'} · hash ${app.motor.hash}</span>
    </div>
  </div>`;
}

// --- modais ----------------------------------------------------------------

function abreModal(qual) {
  const v = visao(app.motor.mundo, app.eu, Date.now());
  const outros = v.familia.filter((f) => f.id !== app.eu);
  const caixa = (titulo, corpo) => `
    <div class="bg-surface-container-low p-panel-pad-md shadow-[6px_6px_0_0_#221b08] w-full max-w-md">
      <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200] flex justify-between items-center mb-panel-pad-md">
        <span class="font-headline-md text-[14px] text-on-secondary uppercase">${titulo}</span>
        <button class="text-on-secondary font-label-lg press" data-acao="fecha-modal">✕</button>
      </div>${corpo}</div>`;

  const corpos = {
    tutorial: () => caixa('Bem-vindo(a) à vila', `
      <div class="space-y-gutter-xs font-body-sm text-[12px] text-on-surface">
        <div class="flex gap-gutter-xs bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]"><span class="text-[22px]">🌱</span><div><strong class="uppercase font-label-sm">1. Planta</strong><br>Na aba <em>Minha Herdade</em>, toque num canteiro vazio. Trigo é bom pra começar: 2 G, fica pronto em 3 dias.</div></div>
        <div class="flex gap-gutter-xs bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]"><span class="text-[22px]">💧</span><div><strong class="uppercase font-label-sm">2. Entrega encomendas</strong><br>O painel da direita pede coisas ("4 trigo + 2 milho"). Entregou, ganha 50% a mais que vender no balcão, e mais XP.</div></div>
        <div class="flex gap-gutter-xs bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]"><span class="text-[22px]">🌙</span><div><strong class="uppercase font-label-sm">3. Dois minutos</strong><br>Trigo fica pronto em 2 min e rende o dobro. Colhe, vende, replanta. Cada colheita dá XP; subir de nível abre culturas, moinho, forno.</div></div>
        <div class="flex gap-gutter-xs bg-primary-fixed p-gutter-xs shadow-[inset_1px_1px_0_0_#245107]"><span class="text-[22px]">🤝</span><div><strong class="uppercase font-label-sm">4. Cuida de alguém</strong><br>Plantas maiores pedem 💧 sede, 🐛 praga ou 🌿 mato — e param até alguém resolver. Toque na herdade de um parente e resolve pra ele: você ganha XP e a vila ganha harmonia, que faz <strong>tudo crescer mais rápido pra todo mundo</strong>.</div></div>
        <p class="font-label-sm text-[10px] uppercase text-on-surface-variant">Sem energia, sem esperar o dia virar. Madeira vem do Machado (4). Dúvida? O ❔ no topo reabre isto.</p>
      </div>
      <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="fecha-tutorial">Bora plantar</button>`),

    novidades: () => {
      const n = app.novidades ?? { dias: 0, linhas: [] };
      return caixa('Enquanto você esteve fora', `
        ${n.dias ? `<p class="font-label-sm text-label-sm uppercase text-secondary mb-1">${n.dias === 1 ? 'passou 1 dia' : `passaram ${n.dias} dias`} na vila</p>` : ''}
        <div class="space-y-1 font-body-sm text-[12px]">
          ${n.linhas.length ? n.linhas.map((l) => linhaPraVoce(l)).join('') : `<p class="text-on-surface-variant">Tudo quieto por aqui.</p>`}
        </div>
        <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="fecha-modal">Ver a vila</button>`);
    },

    semente: () => {
      const vazios = v.minhaHerdade.canteiros.filter((c) => c.vazio).length;
      const atual = v.catalogo.culturas.find((c) => c.chave === app.cultura);
      return caixa('Escolher semente', `
      ${vazios && atual ? `<button class="w-full mb-gutter-xs bg-primary text-on-primary font-label-md text-label-md uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="plantar-tudo">${atual.icone} Plantar ${esc(atual.nome)} nos ${vazios} vazios · ${vazios * atual.semente} G</button>` : ''}
      <div class="grid grid-cols-2 gap-gutter-xs">
      ${v.catalogo.culturas.map((c) => `
        <button class="bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press text-left ${app.cultura === c.chave ? 'ring-2 ring-tertiary-fixed-dim' : ''} ${c.liberada ? '' : 'opacity-50'}" data-acao="escolhe-cultura" data-cultura="${c.chave}" ${c.liberada ? '' : 'disabled'}>
          <span class="font-label-md text-label-md uppercase">${c.icone} ${esc(c.nome)} ${c.liberada ? '' : `🔒 nv ${c.nivel}`}</span>
          <p class="font-body-sm text-[11px] text-on-surface-variant">${c.minutos} min · ${c.semente} G → ${c.rende}× ${c.preco} G · +${c.xp} XP${c.daEstacao ? '' : ' · <span class="text-error">fora de estação (−30%)</span>'}</p>
        </button>`).join('')}</div>
      <p class="font-body-sm text-[11px] text-on-surface-variant mt-1">Escolher uma semente e clicar num canteiro vazio planta uma. O botão de cima planta em todos.</p>`);
    },

    construir: () => caixa('Construir na sua herdade', `<div class="space-y-gutter-xs">
      ${Object.entries(CONSTRUCOES).map(([k, b]) => {
        const [r] = acoesPossiveis(app.motor.mundo, app.eu, [{ tipo: 'CONSTRUIR', construcao: k }]);
        return `<button class="w-full text-left bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press ${r.habilitado ? '' : 'opacity-50'}" data-acao="construir" data-construcao="${k}">
          <span class="font-label-md text-label-md uppercase">${esc(b.nome)} <span class="text-on-surface-variant">nv ${b.nivel}</span></span>
          <p class="font-body-sm text-[11px] text-on-surface-variant">${esc(b.texto)}</p>
          <p class="font-label-sm text-[10px] ${r.habilitado ? 'text-primary' : 'text-error'} uppercase">${r.habilitado ? Object.entries(b.custo).map(([x, q]) => `${q} ${x}`).join(' · ') : esc(r.motivo)}</p>
        </button>`;
      }).join('')}</div>`),

    presentear: () => caixa('Dar um presente', outros.length ? `
      <div class="space-y-gutter-xs">
        ${outros.map((f) => `
          <div class="bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08]">
            <span class="font-label-md text-label-md uppercase">${f.sprite} ${esc(f.nome)}</span>
            <div class="flex gap-gutter-xs mt-1 flex-wrap">
              ${['madeira', 'pedra', 'moedas'].map((rec) => `
                <button class="bg-surface-dim font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press" data-acao="presentear" data-para="${f.id}" data-recurso="${rec}">+5 ${rec}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>` : `<p class="font-body-sm">Ninguém mais na vila ainda.</p>`),

    abracar: () => caixa('Mandar um abraço', outros.length ? `<div class="space-y-gutter-xs">
      ${outros.map((f) => `<button class="w-full text-left bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press" data-acao="abracar" data-para="${f.id}">
        <span class="font-label-md text-label-md uppercase">${f.sprite} ${esc(f.nome)}</span>
        <p class="font-body-sm text-[11px] text-on-surface-variant">Laço: ${esc(f.laco)} · +1 harmonia para a vila</p></button>`).join('')}
      </div>` : `<p class="font-body-sm">Ninguém mais na vila ainda.</p>`),

    loja: () => {
      const loja = LOJAS.find((l) => (l.chave ?? l.cliente) === app.lojaAberta);
      if (!loja) return caixa('Rua do comércio', '');
      if (loja.chave === 'vendinha') return caixa('🏪 Vendinha da vila', vendinhaHtml(v));
      const minhas = v.encomendas.filter((e) => e.cliente === loja.cliente);
      return caixa(`${loja.icone} ${esc(loja.cliente.replace(/^(a|o) /, (m) => m.toUpperCase()))}`, minhas.length ? `
        <div class="space-y-1">${minhas.map((e) => encomendaHtml(e)).join('')}</div>`
        : `<p class="font-body-sm text-[12px]">Nenhuma encomenda ${esc(loja.cliente.replace(/^(a|o) /, 'd$1 '))} pra você agora. Quando aparecer no painel de Encomendas, o prédio mostra um bilhete; pronta pra entregar, ele acende.</p>`);
    },

    anunciar: () => {
      const c = v.hud.colheita.find((x) => x.cultura === app.anunciarItem);
      if (!c) return caixa('Vendinha', `<p class="font-body-sm">Isso não está mais no seu celeiro.</p>`);
      const qtd = Math.min(c.qtd, 20);
      const [min, max] = faixaDePreco(c.cultura, qtd);
      const sugerido = Math.min(max, Math.round(c.preco * qtd * 1.5));
      return caixa(`🏪 Pôr ${esc(c.nome)} na vendinha`, `
        <p class="font-body-sm text-[12px] mb-gutter-xs">Você tem ${c.qtd}. Feira paga ${c.preco} G cada; na vendinha vale de ${c.preco} a ${c.preco * 2} G cada. A família vê na hora.</p>
        <label class="font-label-sm text-label-sm uppercase text-on-surface-variant">Quantidade (até ${qtd})</label>
        <input class="w-full bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md mb-gutter-xs" id="in-qtd" type="number" min="1" max="${qtd}" value="${qtd}" data-item="${c.cultura}"/>
        <label class="font-label-sm text-label-sm uppercase text-on-surface-variant">Preço total (<span id="faixa">${min} a ${max}</span> G)</label>
        <input class="w-full bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md mb-gutter-xs" id="in-preco" type="number" min="${min}" max="${max}" value="${sugerido}"/>
        <div class="flex gap-gutter-xs">
          <button class="flex-1 bg-surface-dim font-label-sm text-[10px] uppercase py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="preco-sugerido" data-mult="1">feira</button>
          <button class="flex-1 bg-surface-dim font-label-sm text-[10px] uppercase py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="preco-sugerido" data-mult="1.5">justo (1,5x)</button>
          <button class="flex-1 bg-surface-dim font-label-sm text-[10px] uppercase py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="preco-sugerido" data-mult="2">teto (2x)</button>
        </div>
        <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="anunciar" data-item="${c.cultura}">Anunciar</button>`);
    },

    recado: () => {
      const para = app.recadoPara && outros.some((f) => f.id === app.recadoPara) ? app.recadoPara : null;
      const m = app.motor.mundo;
      const conversa = m.feed.filter((l) => l.tipo === 'RECADO' && (para
        ? (l.ator === app.eu && l.ref?.para === para) || (l.ator === para && l.ref?.para === app.eu)
        : !l.ref?.para)).slice(-12);
      const quem = para ? outros.find((f) => f.id === para) : null;
      return caixa(para ? `💬 Conversa com ${esc(quem.nome)}` : '💬 Mural da família', `
      <div class="flex flex-wrap gap-1 mb-gutter-xs">
        <button class="font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press ${!para ? 'bg-primary text-on-primary' : 'bg-surface-container'}" data-acao="recado-para" data-para="">📣 Todos</button>
        ${outros.map((f) => `<button class="font-label-sm text-[10px] uppercase px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] press ${para === f.id ? 'bg-primary text-on-primary' : 'bg-surface-container'}" data-acao="recado-para" data-para="${f.id}">${f.sprite} ${esc(f.nome)}</button>`).join('')}
      </div>
      <div class="bg-surface-dim p-gutter-xs shadow-[inset_2px_2px_0_0_#221b08] max-h-[40vh] overflow-y-auto space-y-1 mb-gutter-xs" id="conversa">
        ${conversa.length ? conversa.map((l) => {
          const meu = l.ator === app.eu;
          const texto = l.texto.replace(/^[^:]+: "/, '').replace(/"$/, '');
          return `<div class="flex ${meu ? 'justify-end' : 'justify-start'}"><div class="max-w-[85%] px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08] ${meu ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest'}">
            ${meu ? '' : `<span class="font-label-sm text-[9px] uppercase text-secondary block">${esc(m.jogadores[l.ator]?.nome ?? '')}</span>`}
            <span class="font-body-sm text-[12px] leading-snug">${esc(texto)}</span></div></div>`;
        }).join('') : `<p class="font-body-sm text-[11px] text-on-surface-variant">${para ? `Nenhum recado entre vocês ainda. Só ${esc(quem.nome)} vê o que você escrever aqui.` : 'Nada no mural ainda. Todo mundo da vila lê o que for escrito aqui.'}</p>`}
      </div>
      <div class="flex gap-1">
        <input class="flex-1 bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md" id="in-recado" maxlength="140" placeholder="${para ? `Escreva pra ${esc(quem.nome)}…` : 'Ex: quem rega minha horta amanhã?'}" autofocus/>
        <button class="bg-primary text-on-primary font-label-md text-label-md uppercase px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="recado" data-para="${para ?? ''}">Enviar</button>
      </div>`);
    },

    doar: () => {
      const m = v.missao;
      if (!m) return caixa('Doar', `<p class="font-body-sm">Não há obra aberta.</p>`);
      return caixa(`Doar para a ${esc(m.nome)}`, `<div class="space-y-gutter-xs">
        ${m.itens.filter((i) => i.falta > 0).map((i) => {
          const tenho = v.hud[i.recurso] ?? 0;
          const qtd = Math.min(tenho, i.falta);
          return `<button class="w-full text-left bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press ${qtd ? '' : 'opacity-50'}" data-acao="doar" data-obra="${m.chave}" data-recurso="${i.recurso}" data-qtd="${qtd}">
            <span class="font-label-md text-label-md uppercase">Doar ${qtd} de ${i.recurso}</span>
            <p class="font-body-sm text-[11px] text-on-surface-variant">Faltam ${i.falta} · você tem ${tenho}</p></button>`;
        }).join('')}</div>`);
    },

    ajudar: () => {
      const h = app.motor.mundo.herdades[app.herdadeAberta];
      const dono = app.motor.mundo.jogadores[h.dono];
      const tiles = h.tiles.map((t, i) => ({ t, i })).filter((x) => x.t);
      const pendentes = tiles.filter(({ t }) => estaMadura(t) || t.problema).length;
      return caixa(`Ajudar ${esc(dono.nome)}`, tiles.length ? `
        ${pendentes > 1 ? `<button class="w-full mb-gutter-xs bg-primary text-on-primary font-label-md text-label-md uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="ajudar-tudo" data-herdade="${h.id}">🤝 Ajudar em tudo (${pendentes})</button>` : ''}
        <div class="grid grid-cols-3 gap-gutter-xs">
        ${tiles.map(({ t, i }) => {
          const pronto = estaMadura(t);
          const acao = pronto ? 'COLHER' : 'CUIDAR';
          const [r] = acoesPossiveis(app.motor.mundo, app.eu, [{ tipo: 'AJUDAR', herdade: h.id, tile: i, acao }]);
          const prob = t.problema ? PROBLEMAS[t.problema] : null;
          return `<button class="bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press ${r.habilitado ? '' : 'opacity-40'}" data-acao="ajudar" data-herdade="${h.id}" data-tile="${i}" data-sub="${acao}" title="${esc(r.motivo ?? '')}">
            <span class="text-[20px]">${pronto ? '🌾' : prob ? prob.icone : '🌱'}</span>
            <p class="font-label-sm text-[10px] uppercase">${pronto ? 'colher' : prob ? `tirar ${prob.nome}` : 'está bem'}</p>
            <p class="font-body-sm text-[10px] text-on-surface-variant">${esc(CULTURAS[t.cultura].nome)}</p></button>`;
        }).join('')}</div>
        <p class="font-body-sm text-[11px] text-on-surface-variant mt-gutter-xs">A colheita vai para o celeiro de ${esc(dono.nome)}. Você leva o laço e a harmonia.</p>`
        : `<p class="font-body-sm">Nada plantado aqui no momento.</p>`);
    },
  };

  $('modal').innerHTML = corpos[qual]();
  $('modal').hidden = false;
}

const fechaModal = () => { $('modal').hidden = true; };

function aviso(texto, ruim = false, aoClicar = null) {
  const d = document.createElement(aoClicar ? 'button' : 'div');
  d.className = `${ruim ? 'bg-error text-on-error' : 'bg-primary text-on-primary'} font-label-sm text-label-sm uppercase px-gutter-md py-pixel-step shadow-[3px_3px_0_0_#221b08] ${aoClicar ? 'press cursor-pointer' : ''}`;
  d.textContent = aoClicar ? `${texto} → abrir` : texto;
  if (aoClicar) { d.onclick = () => { d.remove(); aoClicar(); }; d.classList.add('text-[13px]', 'normal-case', 'border-4', 'border-tertiary-fixed-dim'); }
  $('avisos').appendChild(d);
  setTimeout(() => d.remove(), aoClicar ? 12000 : 2600);
}

// --- "pra voce": o que a familia fez com voce, ate voce dizer que viu ---------
// Toast some em 3 segundos; abraco de mae nao pode sumir. Fica na tela.
const lidoChave = () => `vila:lido:${app.chave}`;
// Cada linha do "pra voce" leva pra onde da pra responder: recado abre a conversa, abraco abre o abracar.
function linhaPraVoce(l) {
  if (!l.abre) return `<div>${esc(l.t)}</div>`;
  const dados = Object.entries(l.abre).map(([k, v]) => `data-${k}="${esc(v ?? '')}"`).join(' ');
  return `<button class="block w-full text-left hover:underline press" data-acao="abre-novidade" ${dados}>${esc(l.t)} <span class="font-label-sm text-[10px] uppercase bg-tertiary-fixed text-on-tertiary-fixed px-pixel-step ml-1">→ ${esc(l.dica ?? 'abrir')}</span></button>`;
}
function caixaPraVoce() {
  if (!app.motor || !app.eu) return '';
  const lido = Number(localStorage.getItem(lidoChave()) ?? 0);
  const n = novidadesDesde(lido);
  if (!n.linhas.length) return '';
  const mostra = n.linhas.slice(-3).reverse();
  const resto = n.linhas.length - mostra.length;
  return `
  <div class="max-w-[1600px] mx-auto px-gutter-md pt-gutter-xs">
    <div class="bg-secondary text-on-secondary p-gutter-sm shadow-[6px_6px_0_0_#221b08] border-4 border-tertiary-fixed-dim flex items-start gap-gutter-sm chama" id="pra-voce">
      <span class="font-headline-md text-[15px] uppercase whitespace-nowrap"><span class="balanca">📬</span> Pra você${n.linhas.length > 1 ? ` (${n.linhas.length})` : ''}</span>
      <div class="flex-1 font-body-md text-[13px] leading-snug">
        ${mostra.map((l) => linhaPraVoce(l)).join('')}
        ${resto > 0 ? `<div class="opacity-70">e mais ${resto}…</div>` : ''}
      </div>
      <button class="bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px] uppercase px-gutter-sm py-pixel-step shadow-[2px_2px_0_0_#221b08] press whitespace-nowrap" data-acao="lido">✓ vi</button>
    </div>
  </div>`;
}

// --- atualizacao sozinha ------------------------------------------------------
// O GitHub Pages manda "guarde 10 min" e o F5 nao reconfere os modulos. Entao o
// jogo confere a versao no servidor e, quando muda, rebaixa cada arquivo que
// carregou (cache: 'reload' atualiza o cache do navegador) e recarrega.
let atualizando = false;
async function conferirVersao() {
  if (atualizando || !navigator.onLine) return;
  try {
    const r = await fetch(`./versao.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (!v || v === VERSAO) return;
    atualizando = true;
    aviso('🆕 vila atualizada — recarregando…');
    const urls = new Set([location.href.split('#')[0], ...performance.getEntriesByType('resource').map((e) => e.name)]);
    await Promise.allSettled([...urls].filter((u) => /\.(js|html|css)(\?|$)/.test(u)).map((u) => fetch(u, { cache: 'reload' })));
    const espera = () => document.getElementById('modal').hidden && document.activeElement?.tagName !== 'INPUT';
    const tenta = () => { if (espera()) location.reload(); else setTimeout(tenta, 5000); };
    tenta();
  } catch {}
}
setInterval(conferirVersao, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
setTimeout(conferirVersao, 3000);

// --- avisos de fora da tela -------------------------------------------------
// Quem esta em outra aba (ou com o jogo aberto no fundo) precisa ser chamado:
// recado, abraco, presente, compra na vendinha, ajuda na horta, planta pronta.
const ICONE_NOTIF = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#39671d"/><text x="32" y="46" font-size="40" text-anchor="middle">🌳</text></svg>');
let naoLidos = 0;
const tituloBase = document.title;
const sinoLigado = () => 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem('vila:sino') !== 'off';

function avisaChegada(r) {
  if (!r?.eventos?.length || !app.eu) return;
  const m = app.motor.mundo;
  const nomeDe = (id) => m.jogadores[id]?.nome ?? 'alguém';
  const minha = m.jogadores[app.eu]?.herdade;
  for (const ev of r.eventos) {
    if (ev.ator === app.eu) continue;
    const d = ev.dados ?? {};
    let texto = null;
    let abre = null;
    if (ev.tipo === 'RECADO') { if (d.para && d.para !== app.eu) continue; texto = `💬 ${d.para ? ev.texto.replace(/ → [^:]+:/, ' → você:') : ev.texto}`; abre = { modal: 'recado', para: d.para ? ev.ator : null }; }
    else if (ev.tipo === 'ABRACOU' && d.para === app.eu) { texto = `❤️ ${nomeDe(ev.ator)} te mandou um abraço`; abre = { modal: 'abracar' }; }
    else if (ev.tipo === 'PRESENTEOU' && d.para === app.eu) texto = `🎁 ${ev.texto}`;
    else if (ev.tipo === 'COMPROU' && d.de === app.eu) texto = `💰 ${ev.texto}`;
    else if (ev.tipo === 'ANUNCIOU') texto = `🏪 ${ev.texto}`;
    else if ((ev.tipo === 'CUIDOU' || ev.tipo === 'COLHEU') && d.herdade === minha) texto = `🤝 ${ev.texto}`;
    else if (ev.tipo === 'JOGADOR_ENTROU') texto = `🏠 ${nomeDe(ev.ator)} chegou na vila!`;
    if (!texto) continue;
    // Dez colheitas seguidas do mesmo parente = um aviso so.
    const chave = `${ev.tipo}:${ev.ator}`;
    if (ev.tipo === 'CUIDOU' || ev.tipo === 'COLHEU') {
      if (Date.now() - (ultimoAviso.get(chave) ?? 0) < 5 * 60e3) continue;
      texto = `🤝 ${nomeDe(ev.ator)} está cuidando da sua horta`;
    }
    ultimoAviso.set(chave, Date.now());
    notifica(texto, abre);
  }
}
const ultimoAviso = new Map();

function notifica(texto, abre = null) {
  const abrir = () => { if (!abre) return; if (abre.modal === 'recado') app.recadoPara = abre.para ?? null; abreModal(abre.modal); };
  if (document.hidden) {
    naoLidos++;
    document.title = `(${naoLidos}) ${tituloBase}`;
    if (sinoLigado()) {
      try { const n = new Notification(app.motor.mundo.nome ?? 'Vila Raízes', { body: `${texto}${abre ? ' — clique pra abrir' : ''}`, icon: ICONE_NOTIF, tag: 'vila' }); n.onclick = () => { window.focus(); n.close(); abrir(); }; } catch {}
    }
  } else {
    aviso(texto, false, abre ? abrir : null);
    if (sinoLigado()) plim();
  }
}

// Um "plim" curto, sem arquivo: dois tons de onda quadrada, bem 8-bit.
function plim() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [990, 0.09]].forEach(([f, t]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = f; g.gain.value = 0.04;
      o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.08);
    });
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { naoLidos = 0; document.title = tituloBase; } });

// Planta ficou pronta enquanto voce nao olhava: avisa uma vez por canteiro.
const prontasAvisadas = new Set();
setInterval(() => {
  if (!app.motor || !app.eu) return;
  const v = visao(app.motor.mundo, app.eu, Date.now());
  const novas = v.minhaHerdade.canteiros.filter((c) => c.pronto && !prontasAvisadas.has(`${c.i}:${c.nome}`));
  for (const c of v.minhaHerdade.canteiros) if (!c.pronto) prontasAvisadas.delete(`${c.i}:${c.nome}`);
  if (!novas.length) return;
  for (const c of novas) prontasAvisadas.add(`${c.i}:${c.nome}`);
  if (document.hidden) notifica(`🌾 ${novas.length === 1 ? `${novas[0].nome} pronto` : `${novas.length} canteiros prontos`} na sua horta`);
}, 20000);

// O jogo nao tem o telefone de ninguem: quem manda o recado leva o link pro zap.
function ofereceZap(mensagem) {
  const texto = `${mensagem}\n${linkDeConvite(app.chave)}`;
  const d = document.createElement('a');
  d.href = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  d.target = '_blank'; d.rel = 'noopener';
  d.className = 'bg-[#25D366] text-white font-label-sm text-label-sm uppercase px-gutter-md py-pixel-step shadow-[3px_3px_0_0_#221b08] press inline-block';
  d.textContent = '📲 avisar no WhatsApp que tem recado';
  $('avisos').appendChild(d);
  setTimeout(() => d.remove(), 12000);
}

// --- comandos --------------------------------------------------------------

async function manda(cmd) {
  const nivelAntes = nivelDe(app.motor.mundo.jogadores[app.eu]?.xp ?? 0);
  const r = await app.sessao.executar({ ...cmd, data: dataLocal() });
  if (!r.ok) return aviso(r.erro, true);
  pinta();
  confirma();
  festejaNivel(nivelAntes);
}

// Varios comandos de uma vez (colher tudo, plantar tudo): para no primeiro erro,
// pinta uma vez so e festeja o nivel no fim.
async function mandaVarios(cmds, seVazio) {
  if (!cmds.length) return aviso(seVazio, true);
  const nivelAntes = nivelDe(app.motor.mundo.jogadores[app.eu]?.xp ?? 0);
  let feitos = 0;
  for (const cmd of cmds) {
    const r = await app.sessao.executar({ ...cmd, data: dataLocal() });
    if (!r.ok) { aviso(r.erro, true); break; }
    feitos++;
  }
  pinta();
  if (feitos) confirma();
  festejaNivel(nivelAntes);
}

// O modal de ajuda fica aberto enquanto tiver o que fazer na horta do parente.
function reabreAjudar(herdade) {
  const h = app.motor.mundo.herdades[herdade];
  const resta = h.tiles.some((t) => t && (estaMadura(t) || t.problema));
  if (resta) { app.herdadeAberta = herdade; abreModal('ajudar'); } else fechaModal();
}

// "✓ regou trigo · −1 agua": o ultimo ato meu, com o que ele custou/deu pra vila.
function confirma() {
  const l = visao(app.motor.mundo, app.eu, Date.now()).feed.find((x) => x.ator === app.eu);
  if (!l) return;
  const verbo = l.texto.replace(/^.*? (plantou|regou|capinou|tirou a praga de|colheu|derrubou|tirou|construiu|desmanchou|deu|mandou|foi ajudar|doou|vendeu|pos|comprou|entregou|cumpriu|abriu)/, '$1').split(' em ')[0].split(' (')[0];
  aviso(`✓ ${verbo}${l.impacto ? ` · ${l.impacto}` : ''}`);
}

// Subiu de nivel? Festa. Compara antes/depois de cada comando.
function festejaNivel(antes) {
  const p = app.motor.mundo.jogadores[app.eu];
  const depois = nivelDe(p?.xp ?? 0);
  if (depois <= antes) return;
  const novidades = [...Object.entries(CULTURAS).filter(([, c]) => c.nivel === depois).map(([, c]) => c.nome), ...Object.entries(CONSTRUCOES).filter(([, b]) => b.nivel === depois).map(([, b]) => b.nome)];
  aviso(`⬆ NÍVEL ${depois}!${novidades.length ? ` Desbloqueou: ${novidades.join(', ')}` : ''}`);
}

// Canteiro vazio planta a semente escolhida, maduro colhe, o resto rega.
// A hotbar so muda QUAL semente; ninguem precisa "equipar regador".
function usaFerramentaNoCanteiro(tile) {
  const c = visao(app.motor.mundo, app.eu, Date.now()).minhaHerdade.canteiros[tile];
  if (c.vazio) return manda({ tipo: 'PLANTAR', tile, cultura: app.cultura });
  if (c.pronto) return manda({ tipo: 'COLHER', tile });
  if (c.problema) return manda({ tipo: 'CUIDAR', tile });
  aviso(`${c.nome}: ${c.rotulo}`);
}

// --- eventos ---------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const d = alvo.dataset;
  const acoes = {
    fundar: () => {
      const vila = $('in-vila').value.trim(), nome = $('in-nome-fundador').value.trim() || $('in-nome').value.trim();
      // Colou a chave no campo errado? Entao e convidado, nao fundador.
      const chaveNoNome = extrairChave(vila);
      if (chaveNoNome) return usarChave(chaveNoNome, nome);
      if (!vila || !nome) return aviso('preencha o nome da vila e o seu', true);
      fundar(vila, nome);
    },
    'abrir-vila': () => abrirVila(d.chave, $('in-nome')?.value.trim() || null),
    'trocar-vila': () => { localStorage.removeItem('vila:ultima'); app.transporte?.fechar?.(); telaEntrada(); window.scrollTo(0, 0); },
    'usar-chave': () => {
      const nome = $('in-nome').value.trim();
      if (!nome) return aviso('diga seu nome primeiro', true);
      usarChave($('in-chave').value, nome);
    },
    'novo-familiar': () => {
      const nome = $('in-novo').value.trim();
      if (!nome) return aviso('escreva o nome', true);
      entrarComoFamiliar(nome);
    },
    aba: () => { app.aba = d.aba; pinta(); },
    trocar: () => trocarDeFamiliar(d.quem),
    compartilhar: () => navigator.share({ title: 'Vila Raízes', text: mensagemDeConvite(d.chave), url: linkDeConvite(d.chave) }).catch(() => {}),
    copiar: () => { navigator.clipboard?.writeText(d.texto); aviso(d.texto.startsWith('http') ? 'link de convite copiado' : 'chave copiada'); },
    slot: () => {
      const s = SLOTS.find((x) => x.chave === d.slot);
      if (s.cmd) return manda(s.cmd);
      if (s.abre) return abreModal(s.abre);
      if (s.acao) return acoes[s.acao]();
      app.ferramenta = s.chave;
      if (s.chave === 'semente') abreModal('semente');
      pinta();
    },
    modal: () => { if (d.item) app.anunciarItem = d.item; abreModal(d.modal); },
    'fecha-modal': fechaModal,
    'fecha-tutorial': () => { localStorage.setItem('vila:tutorial', '1'); fechaModal(); app.aba = 'herdade'; pinta(); },
    tutorial: () => abreModal('tutorial'),
    'painel-aba': () => { app.painelAba = d.aba; pinta(); },
    'abre-novidade': () => {
      fechaModal();
      if (d.aba) { app.aba = 'vila'; app.painelAba = d.aba; pinta(); document.getElementById('painel')?.scrollIntoView({ block: 'nearest' }); }
      if (d.modal === 'recado') { app.recadoPara = d.para || null; abreModal('recado'); }
      else if (d.modal) abreModal(d.modal);
    },
    lido: () => { localStorage.setItem(lidoChave(), String(app.motor.mundo.seq)); pinta(); },
    sino: async () => {
      // O navegador so deixa PEDIR permissao; desligar e escolha do jogo, guardada aqui.
      if (sinoLigado()) { localStorage.setItem('vila:sino', 'off'); aviso('🔕 avisos desligados'); return pinta(); }
      const p = await Notification.requestPermission();
      if (p === 'granted') {
        localStorage.setItem('vila:sino', 'on');
        aviso('🔔 combinado: aviso quando a família falar com você');
        try { new Notification('Vila Raízes', { body: 'Assim que alguém te mandar recado, abraço ou presente, aparece aqui.', icon: ICONE_NOTIF }); } catch {}
      } else aviso('sem permissão pra avisar — dá pra ligar nas configurações do navegador', true);
      pinta();
    },
    'escolhe-cultura': () => { app.cultura = d.cultura; app.ferramenta = 'semente'; fechaModal(); pinta(); },
    canteiro: () => usaFerramentaNoCanteiro(Number(d.tile)),
    'abrir-herdade': () => {
      if (app.motor.mundo.herdades[d.herdade].dono === app.eu) { app.aba = 'herdade'; return pinta(); }
      app.herdadeAberta = d.herdade;
      abreModal('ajudar');
    },
    ajudar: async () => { await manda({ tipo: 'AJUDAR', herdade: d.herdade, tile: Number(d.tile), acao: d.sub }); reabreAjudar(d.herdade); },
    'ajudar-tudo': async () => {
      const h = app.motor.mundo.herdades[d.herdade];
      const cmds = h.tiles.map((t, i) => t && (estaMadura(t) || t.problema) ? { tipo: 'AJUDAR', herdade: h.id, tile: i, acao: estaMadura(t) ? 'COLHER' : 'CUIDAR' } : null).filter(Boolean);
      await mandaVarios(cmds, 'nada pra ajudar aqui agora');
      reabreAjudar(d.herdade);
    },
    'plantar-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu, Date.now()).minhaHerdade.canteiros.filter((x) => x.vazio);
      fechaModal();
      await mandaVarios(c.map((x) => ({ tipo: 'PLANTAR', tile: x.i, cultura: app.cultura })), 'nenhum canteiro vazio');
    },
    abracar: async () => { fechaModal(); await manda({ tipo: 'ABRACAR', para: d.para }); },
    presentear: async () => {
      await manda({ tipo: 'PRESENTEAR', para: d.para, recurso: d.recurso, quantidade: 5 });
      const quem = app.motor.mundo.jogadores[d.para]?.nome ?? 'alguém';
      ofereceZap(`${app.motor.mundo.jogadores[app.eu]?.nome} te deixou um presente na ${app.motor.mundo.nome ?? 'vila'}, ${quem}!`);
    },
    recado: async () => {
      const t = $('in-recado').value;
      if (!t.trim()) return aviso('escreva alguma coisa', true);
      const para = d.para || undefined;
      const r = await app.sessao.executar({ tipo: 'RECADO', texto: t, para, data: dataLocal() });
      if (!r.ok) return aviso(r.erro, true);
      pinta(); abreModal('recado'); // a conversa continua aberta, com a mensagem nova
      const nomePara = para ? app.motor.mundo.jogadores[para]?.nome : null;
      ofereceZap(`${app.motor.mundo.jogadores[app.eu]?.nome} te deixou um recado na ${app.motor.mundo.nome ?? 'vila'}${nomePara ? `, ${nomePara}` : ''}: "${t.trim()}"`);
    },
    'recado-para': () => { app.recadoPara = d.para || null; abreModal('recado'); },
    'preco-sugerido': () => {
      const qtd = Number($('in-qtd').value) || 1;
      const item = $('in-qtd').dataset.item;
      const [min, max] = faixaDePreco(item, qtd);
      $('in-preco').value = Math.max(min, Math.min(max, Math.round(precoDe(item) * qtd * Number(d.mult))));
      $('faixa').textContent = `${min} a ${max}`;
    },
    anunciar: async () => {
      const quantidade = Number($('in-qtd').value), preco = Number($('in-preco').value);
      const r = await app.sessao.executar({ tipo: 'ANUNCIAR', item: d.item, quantidade, preco, data: dataLocal() });
      if (!r.ok) return aviso(r.erro, true);
      fechaModal(); pinta(); confirma();
    },
    comprar: () => manda({ tipo: 'COMPRAR', de: d.de, lote: Number(d.lote) }),
    retirar: () => manda({ tipo: 'RETIRAR', lote: Number(d.lote) }),
    construir: async () => { fechaModal(); await manda({ tipo: 'CONSTRUIR', construcao: d.construcao }); },
    doar: async () => { fechaModal(); await manda({ tipo: 'DOAR', obra: d.obra, recursos: { [d.recurso]: Number(d.qtd) } }); },
    vender: () => manda({ tipo: 'VENDER', cultura: d.cultura, quantidade: Number(d.qtd) }),
    'cuidar-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu, Date.now()).minhaHerdade.canteiros.filter((x) => x.problema);
      await mandaVarios(c.map((x) => ({ tipo: 'CUIDAR', tile: x.i })), 'ninguém está pedindo nada');
    },
    produzir: () => manda({ tipo: 'PRODUZIR', produto: d.produto }),
    recolher: () => manda({ tipo: 'RECOLHER', maquina: d.maquina }),
    'cumprir-encomenda': () => manda({ tipo: 'CUMPRIR_ENCOMENDA', indice: Number(d.indice) }),
    'colher-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu, Date.now()).minhaHerdade.canteiros.filter((x) => x.pronto);
      await mandaVarios(c.map((x) => ({ tipo: 'COLHER', tile: x.i })), 'nada maduro ainda');
    },
    'vender-tudo': async () => {
      const v = visao(app.motor.mundo, app.eu, Date.now());
      if (!v.hud.colheita.length) return aviso('celeiro vazio — nada pra vender', true);
      // Encomenda pronta? Entregar vale mais que vender: avisa e nao mexe no celeiro.
      const pronta = v.encomendas.find((e) => e.pronta);
      if (pronta) return aviso(`📦 entrega a encomenda de ${pronta.cliente} primeiro (+${pronta.moedas} G, paga +50%)`, true);
      // Reserva o que alguma encomenda ainda pede.
      const reservado = {};
      for (const e of v.encomendas) for (const i of e.itens) reservado[i.chave] = Math.max(reservado[i.chave] ?? 0, i.qtd);
      let guardou = [];
      for (const item of v.hud.colheita) {
        const qtd = item.qtd - Math.min(item.qtd, reservado[item.cultura] ?? 0);
        if (qtd < item.qtd) guardou.push(`${item.qtd - qtd} ${item.nome.toLowerCase()}`);
        if (qtd > 0) await manda({ tipo: 'VENDER', cultura: item.cultura, quantidade: qtd });
      }
      if (guardou.length) aviso(`guardei ${guardou.join(', ')} pra encomenda`);
    },
    'comprar-canteiro': () => manda({ tipo: 'COMPRAR_CANTEIRO' }),
    'cumprir-missao': () => manda({ tipo: 'CUMPRIR_MISSAO', indice: Number(d.indice) }),
    demolir: () => { if (confirm('Desmanchar? Volta metade do material.')) manda({ tipo: 'DEMOLIR', construcao: d.construcao }); },
  };
  acoes[d.acao]?.();
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'in-recado' && e.key === 'Enter') return document.querySelector('#modal [data-acao="recado"]')?.click();
  if (e.target.tagName === 'INPUT' || !app.eu) return;
  if (e.key === 'Escape') return fechaModal();
  const s = SLOTS.find((x) => x.tecla === e.key);
  if (!s) return;
  if (s.cmd) return manda(s.cmd);
  if (s.abre) return abreModal(s.abre);
  if (s.acao) return document.querySelector(`[data-acao="slot"][data-slot="${s.chave}"]`)?.click();
  app.ferramenta = s.chave;
  pinta();
});

telaEntrada();
{
  const ultima = localStorage.getItem('vila:ultima');
  if (!chaveDaUrl() && ultima && vilasSalvas().some((v) => v.chave === ultima)) abrirVila(ultima, null);
}
