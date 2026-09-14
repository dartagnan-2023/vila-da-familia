import { Motor } from '../src/engine/motor.js';
import { visao, acoesPossiveis } from '../src/engine/apresentador.js';
import { novaChave, lerChave, extrairChave } from '../src/engine/convite.js';
import { TransporteLocal, Sessao } from '../src/net/transporte.js';
import { TransporteSupabase, criarVila, acharVila } from '../src/net/supabase.js';
import { CULTURAS, CONSTRUCOES, OBRAS } from '../src/engine/conteudo.js';
import { VilaCanvas } from './vila-canvas.js';
import { dataLocal, diasPendentes, comandoDoDia } from '../src/engine/calendario.js';
import { choveu } from '../src/engine/simular.js';

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
  { tecla: '1', chave: 'regador',  nome: 'Regar tudo',     icone: 'water_drop', dica: 'Rega todos os seus canteiros com sede (1 energia cada).', acao: 'regar-tudo' },
  { tecla: '2', chave: 'foice',    nome: 'Colher tudo',    icone: 'agriculture', dica: 'Colhe todos os seus canteiros maduros (1 energia cada).', acao: 'colher-tudo' },
  { tecla: '3', chave: 'semente',  nome: 'Semente',        icone: 'spa', dica: 'Escolher o que plantar nos canteiros vazios.' },
  { tecla: '4', chave: 'machado',  nome: 'Madeira',        icone: 'carpenter', dica: 'Machado: +3 a 5 de madeira por 2 de energia. Tira 3 da mata comum.', cmd: { tipo: 'CORTAR' } },
  { tecla: '5', chave: 'picareta', nome: 'Pedra',          icone: 'construction', dica: 'Picareta: +2 a 4 de pedra por 2 de energia.', cmd: { tipo: 'MINERAR' } },
  { tecla: '6', chave: 'muda',     nome: 'Replantar',      icone: 'park', dica: 'Gasta 2 de madeira e devolve +4 de mata comum.', cmd: { tipo: 'PLANTAR_ARVORE' } },
  { tecla: '7', chave: 'martelo',  nome: 'Construir',      icone: 'handyman', dica: 'Benfeitoria na sua herdade (custa madeira, pedra, moedas).', abre: 'construir' },
  { tecla: '8', chave: 'presente', nome: 'Presente',       icone: 'redeem', dica: 'Dar recurso para um parente.', abre: 'presentear' },
  { tecla: '9', chave: 'recado',   nome: 'Recado',         icone: 'campaign', dica: 'Deixar um recado no mural da família.', abre: 'recado' },
  { tecla: '0', chave: 'vender',   nome: 'Vender',         icone: 'monetization_on', dica: 'Vende tudo que esta no celeiro. O dia vira sozinho a meia-noite.', acao: 'vender-tudo' },
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
  app.sessao = new Sessao({ motor: app.motor, transporte: app.transporte, jogadorId: app.eu ?? 'convidado', aoAtualizar: pinta });

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
  let dias = 0;
  for (const l of m.feed) {
    if (l.seq <= seqVisto || l.ator === app.eu) continue;
    const r = l.ref ?? {};
    if (l.tipo === 'DIA_PASSOU') dias++;
    else if (l.tipo === 'AJUDOU' && r.para === app.eu) linhas.push(`🤝 ${nomeDe(l.ator)} foi cuidar da sua horta`);
    else if ((l.tipo === 'REGOU' || l.tipo === 'COLHEU') && r.herdade === minha) linhas.push(`${l.tipo === 'REGOU' ? '💧' : '🌾'} ${nomeDe(l.ator)} ${l.tipo === 'REGOU' ? 'regou' : 'colheu'} um canteiro seu`);
    else if (l.tipo === 'ABRACOU' && r.para === app.eu) linhas.push(`❤️ ${nomeDe(l.ator)} te mandou um abraço`);
    else if (l.tipo === 'PRESENTEOU' && r.para === app.eu) linhas.push(`🎁 ${l.texto}`);
    else if (l.tipo === 'RECADO') linhas.push(`💬 ${l.texto}`);
    else if (l.tipo === 'JOGADOR_ENTROU') linhas.push(`🏠 ${nomeDe(l.ator)} chegou na vila!`);
    else if (l.tipo === 'OBRA_CONCLUIDA') linhas.push(`🏆 ${l.texto}`);
    else if (l.tipo === 'DESTINO') linhas.push(`🔮 ${l.texto}`);
  }
  return { dias, linhas: linhas.slice(-10) };
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
  const v = visao(app.motor.mundo, app.eu);
  $('topo').innerHTML = topo(v);
  $('hud').innerHTML = hud(v);
  $('ecos').innerHTML = ecos(v);
  $('painel').innerHTML = painel(v);
  $('hotbar').innerHTML = hotbar(v);
  if (app.aba === 'vila') {
    if (!app.cena || !app.cena.canvas.isConnected) {
      $('palco').innerHTML = palcoVila(v);
      app.cena = new VilaCanvas($('cena'), { aoClicar: cliqueNoMundo });
    }
    app.cena.atualizar(v, app.motor.mundo);
    $('legenda').innerHTML = legendaVila(v);
  } else {
    $('palco').innerHTML = { herdade: palcoHerdade, destino: palcoDestino, familia: palcoFamilia }[app.aba](v);
  }
}

// O canvas devolve o clique traduzido; aqui vira a mesma acao dos botoes.
function cliqueNoMundo(alvo) {
  if (alvo.rio) return aviso(`rio comum: ${app.motor.mundo.comuns.agua}/100 de agua`);
  if (alvo.poco) return abreModal('doar');
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
        <span class="font-label-sm text-label-sm text-on-surface-variant">${esc(v.vila.rotuloClima)} · vira à meia-noite</span>
      </div>
    </div>

    <div class="flex items-center gap-gutter-md bg-surface-container-high px-gutter-md py-pixel-step shadow-[2px_2px_0_0_#221b08]">
      ${medidor('EN', 'bolt', 'text-tertiary-container', v.hud.energia, v.hud.energiaMax, 'bg-tertiary')}
      ${medidor('TERRA', 'yard', 'text-primary', v.hud.terra, 100, 'bg-primary')}
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
  return `
  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08] flex flex-col h-[560px]">
    <div class="bg-secondary px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200] flex items-center justify-between mb-panel-pad-sm">
      <span class="font-headline-md text-[14px] text-on-secondary uppercase flex items-center gap-1">${ICO('history_edu', 'text-[16px]')} Ecos do Destino</span>
      <span class="w-2 h-2 bg-primary-fixed pisca"></span>
    </div>
    <div class="flex-1 overflow-y-auto space-y-panel-pad-sm pr-1">
      ${v.presagios.map((p) => `
        <div class="bg-error-container p-gutter-xs shadow-[inset_1px_1px_0_0_#93000a]">
          <span class="font-label-sm text-[11px] font-bold uppercase text-on-error-container">🔮 O mundo respondeu</span>
          <p class="font-body-sm text-[12px] text-on-error-container mt-1 leading-snug">${esc(p.texto)}</p>
        </div>`).join('')}
      ${v.feed.map((l) => l.tipo === 'DIA_PASSOU' ? `
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
        </div>`).join('')}
    </div>
    <div class="pt-gutter-xs mt-gutter-xs bg-surface-dim p-gutter-xs shadow-[inset_1px_1px_0_0_#221b08]">
      <span class="font-label-sm text-[10px] uppercase text-on-surface-variant block mb-1">Ações de afeto:</span>
      <div class="grid grid-cols-3 gap-1">
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="abracar">❤️ Abraço</button>
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="presentear">🍎 Presente</button>
        <button class="bg-surface-container hover:bg-secondary-fixed font-label-sm text-[11px] py-pixel-step shadow-[1px_1px_0_0_#221b08] press" data-acao="modal" data-modal="recado">💬 Recado</button>
      </div>
    </div>
  </div>`;
}

// --- painel direito: bens comuns + missão ----------------------------------

const ICONE_COMUM = { agua: 'water_drop', floresta: 'forest', solo: 'terrain', harmonia: 'favorite' };
const COR_ESTADO = { critico: 'bg-error text-on-error', alerta: 'bg-tertiary-container text-on-tertiary', ok: 'bg-primary text-on-primary', otimo: 'bg-primary text-on-primary' };

function painel(v) {
  const m = v.missao;
  return `
  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08]">
    <div class="bg-tertiary-container text-on-tertiary-container px-gutter-xs py-pixel-step shadow-[2px_2px_0_0_#331200] flex items-center justify-between mb-panel-pad-sm">
      <span class="font-headline-md text-[13px] uppercase flex items-center gap-1 font-bold">${ICO('inventory_2', 'text-[16px]')} Bens da Vila</span>
      <span class="font-label-sm text-[10px]">de todos</span>
    </div>
    <div class="grid grid-cols-2 gap-gutter-xs">
      ${v.comuns.map((c) => `
        <div class="bg-surface-dim p-pixel-step shadow-[inset_1px_1px_0_0_#221b08] flex items-center gap-2" title="${c.pct}%">
          <div class="w-7 h-7 ${COR_ESTADO[c.estado]} flex items-center justify-center shadow-[1px_1px_0_0_#221b08] ${c.estado === 'critico' ? 'pisca' : ''}">${ICO(ICONE_COMUM[c.chave], 'text-[16px]')}</div>
          <div class="flex flex-col">
            <span class="font-label-sm text-[10px] text-on-surface-variant uppercase">${esc(c.rotulo)}</span>
            <span class="font-label-md text-label-md text-on-surface font-bold">${c.valor}</span>
          </div>
        </div>`).join('')}
    </div>
    <p class="font-body-sm text-[11px] text-on-surface-variant mt-gutter-xs leading-tight">
      Tudo aqui é de todo mundo. Cada rega, cada machadada e cada abraço mexe nesses números.
    </p>
  </div>

  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08]">
    <div class="flex items-center gap-1.5 text-secondary mb-1">
      ${ICO('assignment', 'text-[16px]')}<span class="font-label-md text-label-md font-bold uppercase">Missão Familiar</span>
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
    ` : `<p class="font-body-sm text-[12px] text-primary">Todas as obras da vila estão prontas. Isso é raro.</p>`}
  </div>

  ${v.pedidosDeAjuda.length ? `
  <div class="bg-surface-container-low p-panel-pad-sm shadow-[4px_4px_0_0_#221b08]">
    <div class="flex items-center gap-1.5 text-secondary mb-1">
      ${ICO('volunteer_activism', 'text-[16px]')}<span class="font-label-md text-label-md font-bold uppercase">Sua mão faz falta</span>
    </div>
    <div class="space-y-1">
      ${v.pedidosDeAjuda.slice(0, 4).map((p) => `
        <button class="w-full text-left bg-surface-container px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08] press font-body-sm text-[11px]"
          data-acao="ajudar" data-herdade="${p.herdade}" data-tile="${p.tile}" data-sub="${p.acao}">
          ${p.acao === 'REGAR' ? '💧' : '🌾'} ${esc(p.motivo)}
        </button>`).join('')}
    </div>
  </div>` : ''}`;
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
        <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Celeiro</p>
        <div class="space-y-1">
          ${v.hud.colheita.length ? v.hud.colheita.map((c) => `
            <div class="flex items-center gap-gutter-xs bg-surface-container px-gutter-xs py-pixel-step shadow-[1px_1px_0_0_#221b08]">
              <span class="text-[16px]">${c.icone}</span>
              <span class="font-label-sm text-label-sm uppercase flex-1">${esc(c.nome)} x${c.qtd}</span>
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
  return `<button class="${base} ${c.pronto ? 'bg-tertiary-fixed' : 'bg-primary-fixed'}" data-acao="canteiro" data-tile="${c.i}" title="${esc(c.nome)} — ${c.progresso}%">
    <span class="text-[22px] leading-none">${c.icone}</span>
    <span class="font-label-sm text-[9px] uppercase">${c.pronto ? 'colher!' : `${c.idade}/${c.dias}`}</span>
    ${c.sede && !c.pronto ? `<span class="absolute top-0.5 right-0.5 text-[10px]">💧</span>` : ''}
    ${c.estresse ? `<span class="absolute bottom-0.5 left-0.5 text-[10px]" title="estresse ${c.estresse}">⚠</span>` : ''}
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
    </div>
    <div>
      <p class="font-label-sm text-label-sm uppercase text-on-surface-variant mb-1">Na vila agora</p>
      <div class="grid sm:grid-cols-2 gap-gutter-xs">
        ${v.familia.map((f) => `
          <div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b] flex items-center gap-gutter-xs">
            <div class="w-9 h-9 bg-secondary flex items-center justify-center text-[18px]">${f.sprite}</div>
            <div class="flex-1">
              <span class="font-label-md text-label-md uppercase">${esc(f.nome)}${f.id === app.eu ? ' (você)' : ''}</span>
              <p class="font-body-sm text-[11px] text-on-surface-variant">Laço: ${esc(f.laco)} · ⚡${f.energia}/${f.energiaMax}</p>
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
      <span>${v.hud.sprite} ${esc(v.hud.nome)} · ⚡${v.hud.energia}/${v.hud.energiaMax} · Nv.${v.hud.nivel} (${v.hud.xp}/${v.hud.xpMax})</span>
      ${v.hud.energia === 0 ? `<span class="bg-tertiary-fixed text-on-tertiary-fixed px-gutter-xs py-pixel-unit shadow-[1px_1px_0_0_#221b08] normal-case">Por hoje é isso — a energia volta à meia-noite. Abraço e recado ainda valem!</span>` : ''}
      <span class="w-2 h-2 bg-primary"></span>
      <span>${app.online ? '● entre casas' : '○ só neste aparelho'} · hash ${app.motor.hash}</span>
    </div>
  </div>`;
}

// --- modais ----------------------------------------------------------------

function abreModal(qual) {
  const v = visao(app.motor.mundo, app.eu);
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
        <div class="flex gap-gutter-xs bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]"><span class="text-[22px]">💧</span><div><strong class="uppercase font-label-sm">2. Rega todo dia</strong><br>Toque de novo no canteiro (ou em <em>Regar tudo</em>). A água sai do rio de <strong>todo mundo</strong>. Se chover, a chuva rega por você.</div></div>
        <div class="flex gap-gutter-xs bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]"><span class="text-[22px]">🌙</span><div><strong class="uppercase font-label-sm">3. Volta amanhã</strong><br>O dia vira à meia-noite. Sua energia volta, as plantas crescem — as regadas, pelo menos.</div></div>
        <div class="flex gap-gutter-xs bg-primary-fixed p-gutter-xs shadow-[inset_1px_1px_0_0_#245107]"><span class="text-[22px]">🤝</span><div><strong class="uppercase font-label-sm">4. Cuida de alguém</strong><br>Toque na herdade de um parente no mapa e rega pra ele. A colheita é dele; o que volta pra você é harmonia — e harmonia alta dá energia extra pra <strong>todo mundo</strong>.</div></div>
        <p class="font-label-sm text-[10px] uppercase text-on-surface-variant">Madeira vem do Machado (4). Ouro vem de colher e Vender (0). Dúvida? O ❔ no topo reabre isto.</p>
      </div>
      <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="fecha-tutorial">Bora plantar</button>`),

    novidades: () => {
      const n = app.novidades ?? { dias: 0, linhas: [] };
      return caixa('Enquanto você esteve fora', `
        ${n.dias ? `<p class="font-label-sm text-label-sm uppercase text-secondary mb-1">${n.dias === 1 ? 'passou 1 dia' : `passaram ${n.dias} dias`} na vila</p>` : ''}
        <div class="space-y-1 font-body-sm text-[12px]">
          ${n.linhas.length ? n.linhas.map((l) => `<div class="bg-surface-container p-gutter-xs shadow-[inset_1px_1px_0_0_#38301b]">${esc(l)}</div>`).join('') : `<p class="text-on-surface-variant">Tudo quieto por aqui.</p>`}
        </div>
        <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="fecha-modal">Ver a vila</button>`);
    },

    semente: () => caixa('Escolher semente', `<div class="grid grid-cols-2 gap-gutter-xs">
      ${Object.entries(CULTURAS).map(([k, c]) => `
        <button class="bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press text-left ${app.cultura === k ? 'ring-2 ring-tertiary-fixed-dim' : ''}" data-acao="escolhe-cultura" data-cultura="${k}">
          <span class="font-label-md text-label-md uppercase">${esc(c.nome)}</span>
          <p class="font-body-sm text-[11px] text-on-surface-variant">${c.dias} dias · ${c.semente} G · vende ${c.preco} G<br>água ${c.agua} · ${c.estacoes.join(', ')}</p>
        </button>`).join('')}</div>`),

    construir: () => caixa('Construir na sua herdade', `<div class="space-y-gutter-xs">
      ${Object.entries(CONSTRUCOES).map(([k, b]) => {
        const [r] = acoesPossiveis(app.motor.mundo, app.eu, [{ tipo: 'CONSTRUIR', construcao: k }]);
        return `<button class="w-full text-left bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press ${r.habilitado ? '' : 'opacity-50'}" data-acao="construir" data-construcao="${k}">
          <span class="font-label-md text-label-md uppercase">${esc(b.nome)}</span>
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

    recado: () => caixa('Recado no mural', `
      <input class="w-full bg-surface-dim px-gutter-xs py-pixel-step shadow-[inset_2px_2px_0_0_#221b08] font-body-md" id="in-recado" maxlength="140" placeholder="Ex: quem rega minha horta amanhã?"/>
      <button class="w-full mt-gutter-xs bg-primary text-on-primary font-label-lg uppercase py-pixel-step shadow-[2px_2px_0_0_#221b08] press" data-acao="recado">Deixar recado</button>`),

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
      return caixa(`Ajudar ${esc(dono.nome)}`, tiles.length ? `<div class="grid grid-cols-3 gap-gutter-xs">
        ${tiles.map(({ t, i }) => {
          const pronto = t.idade >= CULTURAS[t.cultura].dias;
          const acao = pronto ? 'COLHER' : 'REGAR';
          const [r] = acoesPossiveis(app.motor.mundo, app.eu, [{ tipo: 'AJUDAR', herdade: h.id, tile: i, acao }]);
          return `<button class="bg-surface-container p-gutter-xs shadow-[1px_1px_0_0_#221b08] press ${r.habilitado ? '' : 'opacity-40'}" data-acao="ajudar" data-herdade="${h.id}" data-tile="${i}" data-sub="${acao}" title="${esc(r.motivo ?? '')}">
            <span class="text-[20px]">${pronto ? '🌾' : '💧'}</span>
            <p class="font-label-sm text-[10px] uppercase">${pronto ? 'colher' : 'regar'}</p>
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

function aviso(texto, ruim = false) {
  const d = document.createElement('div');
  d.className = `${ruim ? 'bg-error text-on-error' : 'bg-primary text-on-primary'} font-label-sm text-label-sm uppercase px-gutter-md py-pixel-step shadow-[3px_3px_0_0_#221b08]`;
  d.textContent = texto;
  $('avisos').appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

// --- comandos --------------------------------------------------------------

async function manda(cmd) {
  const r = await app.sessao.executar({ ...cmd, data: dataLocal() });
  if (!r.ok) return aviso(r.erro, true);
  pinta();
  confirma();
}

// "✓ regou trigo · −1 agua": o ultimo ato meu, com o que ele custou/deu pra vila.
function confirma() {
  const l = visao(app.motor.mundo, app.eu).feed.find((x) => x.ator === app.eu);
  if (!l) return;
  const verbo = l.texto.replace(/^.*? (plantou|regou|colheu|derrubou|tirou|construiu|desmanchou|deu|mandou|foi ajudar|doou|vendeu)/, '$1').split(' em ')[0].split(' (')[0];
  aviso(`✓ ${verbo}${l.impacto ? ` · ${l.impacto}` : ''}`);
}

// Canteiro vazio planta a semente escolhida, maduro colhe, o resto rega.
// A hotbar so muda QUAL semente; ninguem precisa "equipar regador".
function usaFerramentaNoCanteiro(tile) {
  const c = visao(app.motor.mundo, app.eu).minhaHerdade.canteiros[tile];
  if (c.vazio) return manda({ tipo: 'PLANTAR', tile, cultura: app.cultura });
  if (c.pronto) return manda({ tipo: 'COLHER', tile });
  return manda({ tipo: 'REGAR', tile });
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
    modal: () => abreModal(d.modal),
    'fecha-modal': fechaModal,
    'fecha-tutorial': () => { localStorage.setItem('vila:tutorial', '1'); fechaModal(); app.aba = 'herdade'; pinta(); },
    tutorial: () => abreModal('tutorial'),
    'escolhe-cultura': () => { app.cultura = d.cultura; app.ferramenta = 'semente'; fechaModal(); pinta(); },
    canteiro: () => usaFerramentaNoCanteiro(Number(d.tile)),
    'abrir-herdade': () => {
      if (app.motor.mundo.herdades[d.herdade].dono === app.eu) { app.aba = 'herdade'; return pinta(); }
      app.herdadeAberta = d.herdade;
      abreModal('ajudar');
    },
    ajudar: async () => { fechaModal(); await manda({ tipo: 'AJUDAR', herdade: d.herdade, tile: Number(d.tile), acao: d.sub }); },
    abracar: async () => { fechaModal(); await manda({ tipo: 'ABRACAR', para: d.para }); },
    presentear: async () => { await manda({ tipo: 'PRESENTEAR', para: d.para, recurso: d.recurso, quantidade: 5 }); },
    recado: async () => { const t = $('in-recado').value; fechaModal(); await manda({ tipo: 'RECADO', texto: t }); },
    construir: async () => { fechaModal(); await manda({ tipo: 'CONSTRUIR', construcao: d.construcao }); },
    doar: async () => { fechaModal(); await manda({ tipo: 'DOAR', obra: d.obra, recursos: { [d.recurso]: Number(d.qtd) } }); },
    vender: () => manda({ tipo: 'VENDER', cultura: d.cultura, quantidade: Number(d.qtd) }),
    'regar-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu).minhaHerdade.canteiros.filter((x) => !x.vazio && x.sede);
      if (!c.length) return aviso(choveu(app.motor.mundo.clima) ? 'esta chovendo — a chuva rega por voce' : 'nada com sede', true);
      for (const x of c) { const r = await app.sessao.executar({ tipo: 'REGAR', tile: x.i, data: dataLocal() }); if (!r.ok) { aviso(r.erro, true); break; } }
      pinta(); confirma();
    },
    'colher-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu).minhaHerdade.canteiros.filter((x) => x.pronto);
      if (!c.length) return aviso('nada maduro ainda', true);
      for (const x of c) { const r = await app.sessao.executar({ tipo: 'COLHER', tile: x.i, data: dataLocal() }); if (!r.ok) { aviso(r.erro, true); break; } }
      pinta(); confirma();
    },
    'vender-tudo': async () => {
      const c = visao(app.motor.mundo, app.eu).hud.colheita;
      if (!c.length) return aviso('celeiro vazio — nada pra vender', true);
      for (const item of c) await manda({ tipo: 'VENDER', cultura: item.cultura, quantidade: item.qtd });
    },
    'comprar-canteiro': () => manda({ tipo: 'COMPRAR_CANTEIRO' }),
    demolir: () => { if (confirm('Desmanchar? Volta metade do material.')) manda({ tipo: 'DEMOLIR', construcao: d.construcao }); },
  };
  acoes[d.acao]?.();
});

document.addEventListener('keydown', (e) => {
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
