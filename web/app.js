import { Motor } from '../src/engine/motor.js';
import { faixaDePreco } from '../src/engine/regras.js';
import { visao, acoesPossiveis, iconeDe } from '../src/engine/apresentador.js';
import { novaChave, lerChave, extrairChave } from '../src/engine/convite.js';
import { TransporteLocal, Sessao } from '../src/net/transporte.js';
import { TransporteSupabase, criarVila, acharVila } from '../src/net/supabase.js';
import { CULTURAS, CONSTRUCOES, OBRAS, PRODUTOS, PROBLEMAS, nivelDe, nomeDe, precoDe } from '../src/engine/conteudo.js';
import { dataLocal, diasPendentes, comandoDoDia } from '../src/engine/calendario.js';
import { projetar, estaMadura, duracaoCultura, rotuloDuracao } from '../src/engine/tempo.js';
import { VERSAO } from './versao.js';
import { VilaCanvas } from './vila-canvas.js';

// ---------------------------------------------------------------------------
// A tela nova: uma tela so, o mundo e a interface. Celular em pe.
// Esta camada nao conhece regra de jogo: ela pinta `visao()` e manda comandos.
// A tela antiga continua em ../web-classico/.
// ---------------------------------------------------------------------------

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

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

class TransporteSalvo extends TransporteLocal {
  constructor(chave) { super(JSON.parse(localStorage.getItem(chave) ?? '[]')); this.chaveStorage = chave; }
  async enviar(cmd) { const c = await super.enviar(cmd); localStorage.setItem(this.chaveStorage, JSON.stringify(this.log)); return c; }
}

const app = { motor: null, sessao: null, transporte: null, eu: null, chave: null, vilaId: null, online: false, cultura: 'trigo', conversaCom: null };
window.vila = app;

// Quem faz as encomendas mora na rua. A vendinha e da familia.
const LOJAS = [
  { cliente: 'a Padaria da Esquina', nome: 'Padaria', icone: '🍞' },
  { cliente: 'o Mercadinho', nome: 'Mercado', icone: '🛒' },
  { cliente: 'a Feira de Domingo', nome: 'Feira', icone: '🧺' },
  { cliente: 'a Escola', nome: 'Escola', icone: '🏫' },
  { cliente: 'o Restaurante do Zé', nome: 'Do Zé', icone: '🍲' },
  { cliente: 'a Igreja', nome: 'Igreja', icone: '⛪' },
  { cliente: 'a Pousada', nome: 'Pousada', icone: '🛏️' },
  { cliente: 'a Quermesse', nome: 'Quermesse', icone: '🎪' },
];

// --- vilas neste aparelho ----------------------------------------------------
const vilasSalvas = () => Object.keys(localStorage)
  .filter((k) => k.startsWith('vila:') && k.split(':').length === 2)
  .map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } })
  .filter((v) => v && v.chave);
const salvaVila = (v) => localStorage.setItem(`vila:${v.chave}`, JSON.stringify(v));
const chaveDaUrl = () => extrairChave(new URLSearchParams(location.search).get('chave') ?? location.hash);
const linkDeConvite = (chave) => `${location.origin}${location.pathname}?chave=${chave}`;
const mensagemDeConvite = (chave) => `Vem pra nossa vila! 🌳 Abre o link, coloca seu nome e pronto:\n${linkDeConvite(chave)}\n\n(se pedir, a chave é ${chave})`;
const linkWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

function telaEntrada() {
  const vilas = vilasSalvas();
  const convite = chaveDaUrl();
  $('entrada').hidden = false;
  $('entrada').innerHTML = `
  <div class="caixa">
    <h1>🌳 Vila Raízes</h1>
    <p class="sub">${nuvem ? 'a vila da família, entre casas' : 'só neste aparelho'}</p>
    ${vilas.length && !convite ? `<h3 style="margin:0 0 6px;font-family:'Baloo 2'">Voltar pra vila</h3>
      <div class="lista" style="margin-bottom:14px">${vilas.map((v) => `<button class="item" data-acao="abrir-vila" data-chave="${esc(v.chave)}"><span class="ic">🏡</span><span class="txt"><b>${esc(v.nome)}</b>${esc(v.chave)}</span>›</button>`).join('')}</div>` : ''}
    <h3 style="margin:0 0 6px;font-family:'Baloo 2'">${convite ? '🔑 Você foi convidado(a)!' : '🔑 Tenho uma chave'}</h3>
    <input class="campo" id="in-chave" placeholder="VILA-XXXXX-XXXXX" value="${esc(convite ?? '')}" ${convite ? 'readonly' : ''} autocapitalize="characters"/>
    <input class="campo" id="in-nome" maxlength="18" placeholder="Seu nome (ex: Vovó Rosa)" autofocus/>
    <button class="btn cheio" data-acao="usar-chave" style="margin-top:4px">Entrar na vila</button>
    <details>
      <summary>Não tenho chave — quero fundar uma vila nova</summary>
      <input class="campo" id="in-vila" placeholder="Nome da vila (ex: Vila Gomes)" style="margin-top:10px"/>
      <button class="btn cheio fraco" data-acao="fundar">Fundar</button>
    </details>
  </div>`;
}

async function fundar(nomeVila, nomeJogador) {
  const chave = novaChave();
  const semente = `${chave}-${Date.now().toString(36)}`;
  const vila = { chave, nome: nomeVila, semente, vilaId: null, eu: null };
  if (nuvem) { try { vila.vilaId = await criarVila(nuvem, { chave, nome: nomeVila, semente }); } catch (e) { return toast(e.message, 'ruim'); } }
  salvaVila(vila);
  await abrirVila(chave, nomeJogador);
}

async function usarChave(digitada, nomeJogador) {
  const lida = lerChave(extrairChave(digitada) ?? digitada);
  if (!lida.valida) return toast(lida.erro, 'ruim');
  let vila = vilasSalvas().find((v) => v.chave === lida.chave);
  if (!vila) {
    if (!nuvem) return toast('essa chave não abre nenhuma vila deste aparelho', 'ruim');
    let achada;
    try { achada = await acharVila(nuvem, lida.chave); } catch (e) { return toast(e.message, 'ruim'); }
    if (!achada) return toast('nenhuma vila com essa chave', 'ruim');
    vila = { chave: lida.chave, nome: achada.nome, semente: achada.semente, vilaId: achada.id, eu: null };
    salvaVila(vila);
  }
  await abrirVila(vila.chave, nomeJogador);
}

async function abrirVila(chave, nomeJogador) {
  const vila = vilasSalvas().find((v) => v.chave === chave);
  if (!vila) return toast('vila não encontrada', 'ruim');
  app.transporte?.fechar?.();
  app.chave = chave; app.vilaId = vila.vilaId;
  app.online = Boolean(nuvem && vila.vilaId);
  app.transporte = app.online ? new TransporteSupabase({ client: nuvem, vilaId: vila.vilaId }) : new TransporteSalvo(`vila:log:${chave}`);
  app.motor = Motor.criar({ semente: vila.semente, nome: vila.nome });
  app.eu = vila.eu;
  app.sessao = new Sessao({ motor: app.motor, transporte: app.transporte, jogadorId: app.eu ?? 'convidado', aoAtualizar: (mundo, r) => { pinta(); avisaChegada(r); } });
  try { await app.sessao.sincronizar(); } catch (e) { return toast(`não deu para carregar a vila: ${e.message}`, 'ruim'); }
  await virarDiasPendentes();
  const salvo = app.eu && app.motor.mundo.jogadores[app.eu];
  const mesmoNome = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (nomeJogador && !mesmoNome(salvo?.nome, nomeJogador)) {
    const jaExiste = Object.values(app.motor.mundo.jogadores).find((p) => mesmoNome(p.nome, nomeJogador));
    if (jaExiste) trocarDeFamiliar(jaExiste.id); else await entrarComoFamiliar(nomeJogador);
  }
  if (!app.eu || !app.motor.mundo.jogadores[app.eu]) app.eu = Object.keys(app.motor.mundo.jogadores)[0] ?? null;
  if (!app.eu) return toast('diga seu nome para entrar na vila', 'ruim');
  trocarDeFamiliar(app.eu);
  localStorage.setItem('vila:ultima', chave);
  $('entrada').hidden = true;
  if (location.search) history.replaceState(null, '', location.pathname);
  pinta();
  guia();
}

let virando = null;
async function virarDiasPendentes() {
  if (!app.sessao || virando) return virando;
  virando = (async () => {
    const hoje = dataLocal();
    if (!app.motor.mundo.dataDoDia && app.motor.mundo.jogadores[app.eu]) await app.sessao.executar({ tipo: 'ACORDAR', data: hoje });
    const datas = diasPendentes(app.motor.mundo.dataDoDia, hoje);
    for (const data of datas) { const r = await app.sessao.executar(comandoDoDia(data)); if (!r.ok) break; }
    if (datas.length) toast(datas.length === 1 ? '🌅 amanheceu na vila' : `🌅 passaram ${datas.length} dias na vila`);
  })().finally(() => { virando = null; });
  return virando;
}
setInterval(() => { if (!document.hidden) virarDiasPendentes(); }, 60000);
setInterval(() => { if (!document.hidden && app.eu && !document.querySelector('.veu')) pinta(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) virarDiasPendentes(); });

async function entrarComoFamiliar(nome) {
  const id = `${nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
  app.sessao.jogadorId = id;
  const r = await app.sessao.executar({ tipo: 'ENTRAR', por: id, nome, nomeHerdade: `Herdade ${nome}`, data: dataLocal() });
  if (!r.ok) return toast(r.erro, 'ruim');
  trocarDeFamiliar(id);
}
function trocarDeFamiliar(id) {
  app.eu = id; app.sessao.jogadorId = id;
  const vila = vilasSalvas().find((v) => v.chave === app.chave);
  if (vila) salvaVila({ ...vila, eu: id });
}

// --- render -------------------------------------------------------------------
const v_ = () => visao(app.motor.mundo, app.eu, Date.now());
const mundoAgora = () => projetar(app.motor.mundo, Date.now());
const nomeCurto = (h) => (h?.nome ?? '').replace(/^Herdade /, '');
const min = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`; };

function canteiroMeu(c) {
  if (c.vazio) return `<button class="canteiro vazio" data-acao="canteiro" data-tile="${c.i}" aria-label="canteiro vazio: plantar"></button>`;
  const cls = c.pronto ? 'pronto' : 'crescendo';
  return `<button class="canteiro ${cls}" data-acao="canteiro" data-tile="${c.i}" aria-label="${esc(c.nome)}: ${esc(c.rotulo)}">
    ${c.pronto ? c.icone : c.progresso < 40 ? '🌱' : '🌿'}
    ${c.problema ? `<span class="pede">${c.problemaIcone}</span>` : c.pronto ? '' : `<span class="tempo">${c.prontaEm ? min(c.prontaEm - app.motor.mundo.agora) : ''}</span><span class="barra"><i style="--p:${c.progresso}%"></i></span>`}
  </button>`;
}
function canteiroOutro(t, i, herdade) {
  if (!t) return `<span class="canteiro vazio"></span>`;
  const pronto = estaMadura(t);
  const p = Math.min(100, Math.round((t.progresso / duracaoCultura(t.cultura)) * 100));
  const c = CULTURAS[t.cultura];
  return `<button class="canteiro ${pronto ? 'pronto' : 'crescendo'}" data-acao="ajudar" data-herdade="${herdade}" data-tile="${i}" data-sub="${pronto ? 'COLHER' : 'CUIDAR'}" aria-label="${esc(c.nome)}">
    ${pronto ? iconeDe(t.cultura) : p < 40 ? '🌱' : '🌿'}
    ${t.problema ? `<span class="pede">${PROBLEMAS[t.problema].icone}</span>` : pronto ? '' : `<span class="barra"><i style="--p:${p}%"></i></span>`}
  </button>`;
}

function pendenciasDe(v) {
  const itens = [];
  const m = app.motor.mundo;
  v.minhaHerdade.canteiros.forEach((c) => { if (c.pronto) itens.push({ ic: c.icone, t: `${c.nome} pronto na sua horta`, vai: 'sec-minha' }); });
  v.minhaHerdade.canteiros.forEach((c) => { if (c.problema) itens.push({ ic: c.problemaIcone, t: `Sua ${c.nome.toLowerCase()} pede ${PROBLEMAS[c.problema].nome}`, vai: 'sec-minha' }); });
  v.minhaHerdade.maquinas.forEach((q) => { if (q.pronta) itens.push({ ic: q.produto.icone, t: `${q.produto.nome} pronto no ${q.nome.toLowerCase()}`, vai: 'sec-minha' }); });
  v.encomendas.forEach((e) => { if (e.pronta) itens.push({ ic: '📦', t: `${e.cliente.replace(/^(a|o) /, '')} paga ${e.moedas} 🪙 — você já tem tudo`, vai: 'sec-rua' }); });
  const porPessoa = {};
  v.pedidosDeAjuda.forEach((p) => { porPessoa[p.dono] = (porPessoa[p.dono] ?? 0) + 1; });
  Object.entries(porPessoa).forEach(([id, n]) => itens.push({ ic: '🤝', t: `${m.jogadores[id]?.nome ?? 'alguém'} precisa de você (${n})`, vai: `her-${m.jogadores[id]?.herdade}` }));
  v.missoesDoDia.forEach((x) => { if (x.cumprida && !x.recebida) itens.push({ ic: '🎁', t: `Prêmio de hoje: ${x.texto} — ${x.premioTexto}`, acao: 'cumprir-missao', indice: x.indice }); });
  const porRemetente = {};
  naoLidas().forEach((n) => { const k = n.para ? n.ator : 'todos'; porRemetente[k] = porRemetente[k] ?? { de: n.de, n: 0, para: n.para }; porRemetente[k].n++; });
  Object.entries(porRemetente).forEach(([k, x]) => itens.push({ ic: '💬', t: x.para ? `${x.de} te mandou ${x.n === 1 ? 'uma mensagem' : `${x.n} mensagens`}` : `${x.de} escreveu no mural${x.n > 1 ? ` (${x.n})` : ''}`, conversa: k }));
  v.vendinha.forEach((l) => { if (l.util && !l.minha) itens.push({ ic: '🏪', t: `${l.vendedor} vende ${l.qtd} ${l.nome.toLowerCase()} — fecha um pedido seu`, vendinha: true }); });
  return itens;
}
function naoLidas() {
  const lido = Number(localStorage.getItem(`vila:lido:${app.chave}`) ?? 0);
  return app.motor.mundo.feed.filter((l) => l.tipo === 'RECADO' && l.seq > lido && l.ator !== app.eu && (!l.ref?.para || l.ref.para === app.eu))
    .map((l) => ({ de: app.motor.mundo.jogadores[l.ator]?.nome ?? 'alguém', ator: l.ator, para: l.ref?.para }));
}
const marcaLidas = () => localStorage.setItem(`vila:lido:${app.chave}`, String(app.motor.mundo.seq));

function pinta() {
  if (!app.motor || !app.eu) return;
  const v = v_();
  const m = mundoAgora();
  const h = v.hud;
  const pend = pendenciasDe(v);
  const ajudas = v.pedidosDeAjuda.length;
  const msgs = naoLidas().length;

  $('topo').innerHTML = `
    <div class="nivel" style="--xp:${Math.round((h.xp / h.xpMax) * 100)}%" title="nível ${h.nivel}"><span>${h.nivel}</span></div>
    <button class="pill" data-acao="celeiro" title="celeiro e vendinha">🪙 ${h.moedas}</button>
    <button class="redondo empurra" data-acao="familia-config" title="convidar, avisos">👥</button>
    <button class="redondo" data-acao="pendencias" title="o que tem pra fazer">📬${pend.length ? `<b>${pend.length}</b>` : ''}</button>`;

  const mh = v.minhaHerdade;
  const prontosMeus = mh.canteiros.filter((c) => c.pronto), pedemMeus = mh.canteiros.filter((c) => c.problema);
  const meus = mh.canteiros.map(canteiroMeu).join('')
    + mh.maquinas.map((q) => `<button class="canteiro maquina" data-acao="maquina" data-maquina="${q.maquina}">${q.pronta ? q.produto.icone : q.icone}<span class="tempo">${q.pronta ? 'pronto!' : q.ocupada ? min(q.prontaEm) : q.nome.toLowerCase()}</span>${q.pronta ? '<span class="pede">✨</span>' : ''}</button>`).join('')
    + (mh.proximoCanteiro ? `<button class="canteiro compra" data-acao="comprar-canteiro" data-preco="${mh.proximoCanteiro}">＋ canteiro<br>${mh.proximoCanteiro} 🪙</button>` : '');
  const machado = h.machadoEm > 0, picareta = h.picaretaEm > 0;

  const outros = Object.values(m.herdades).filter((x) => x.dono && x.dono !== app.eu).map((x) => {
    const p = m.jogadores[x.dono];
    const precisa = x.tiles.filter((t) => t && (t.problema || estaMadura(t))).length;
    return `
      <div class="titulo" id="her-${x.id}" style="font-size:16px;margin-top:10px">
        <button data-acao="pessoa" data-quem="${x.dono}" style="display:flex;align-items:center;gap:6px;font:inherit">${p.sprite} ${esc(p.nome)}</button>
        ${precisa ? `<small style="color:var(--orange2)">precisa de você</small>` : '<small>tudo em ordem</small>'}
        ${precisa > 1 ? `<button class="chip acao" data-acao="ajudar-tudo" data-herdade="${x.id}">🤝 ajudar ${precisa}</button>` : `<button class="chip" data-acao="pessoa" data-quem="${x.dono}">❤️ 💬 🎁</button>`}
      </div>
      <div class="fazenda outra">${x.tiles.map((t, i) => canteiroOutro(t, i, x.id)).join('')}</div>`;
  }).join('');

  const obra = v.missao;
  const cenaViva = app.cena?.canvas;
  $('mundo').innerHTML = `
    <div class="titulo" id="sec-minha">🏡 Minha horta ${prontosMeus.length >= 2 ? `<button class="chip acao" data-acao="colher-tudo">🌾 colher ${prontosMeus.length}</button>` : pedemMeus.length >= 2 ? `<button class="chip acao" data-acao="cuidar-tudo">💧 cuidar ${pedemMeus.length}</button>` : `<small>toque num canteiro</small>`}${v.vila.velocidade !== 100 && prontosMeus.length < 2 && pedemMeus.length < 2 ? `<span class="chip">${v.vila.velocidade > 100 ? '⚡' : '🐌'} ${v.vila.velocidade}%</span>` : ''}</div>
    <div class="fazenda minha">${meus}</div>
    <div class="ferramentas">
      <button data-acao="cmd" data-tipo="CORTAR" class="${machado ? 'desc' : ''}"><span class="ic">🪓</span>Lenha<small>${machado ? `descansa ${min(h.machadoEm)}` : `tenho ${h.madeira}`}</small></button>
      <button data-acao="cmd" data-tipo="MINERAR" class="${picareta ? 'desc' : ''}"><span class="ic">⛏️</span>Pedra<small>${picareta ? `descansa ${min(h.picaretaEm)}` : `tenho ${h.pedra}`}</small></button>
      <button data-acao="construir"><span class="ic">🔨</span>Construir<small>${mh.vagas} vaga(s)</small></button>
      <button data-acao="celeiro"><span class="ic">🧺</span>Celeiro<small>${h.colheita.reduce((s, c) => s + c.qtd, 0)} itens</small></button>
    </div>

    <div class="titulo" id="sec-vila">🗺️ A vila <small>toque em quem quiser visitar</small></div>
    <div id="cena" style="border-radius:18px;overflow:hidden;box-shadow:var(--shadow);background:#8fae5d;line-height:0"></div>

    <div class="titulo" id="sec-rua">🛒 Quem quer comprar <small>toque na loja</small></div>
    <div class="rua">
      ${LOJAS.map((l) => {
        const enc = v.encomendas.filter((e) => e.cliente === l.cliente);
        const pronta = enc.some((e) => e.pronta);
        return `<button class="loja ${pronta ? 'pronta' : ''}" data-acao="loja" data-cliente="${esc(l.cliente)}"><span class="ic">${l.icone}</span><span class="nm">${l.nome}</span>${pronta ? '<span class="bilhete">!</span>' : enc.length ? '<span class="bilhete">📋</span>' : ''}</button>`;
      }).join('')}
      <button class="loja" data-acao="celeiro"><span class="ic">🏪</span><span class="nm">Vendinha</span>${v.vendinha.filter((l) => !l.minha).length ? `<span class="bilhete">${v.vendinha.filter((l) => !l.minha).length}</span>` : ''}</button>
    </div>

    <div class="titulo" id="sec-familia">👨‍👩‍👧 A família <small>toque pra ajudar</small><button class="chip" data-acao="familia-config">➕ convidar</button></div>
    ${outros || `<div class="cartaz"><span class="ic">🌱</span><span class="txt"><b>Só você por enquanto</b>Manda o convite pra família. Sozinho o jogo é metade.</span><button class="btn" data-acao="familia-config">Convidar</button></div>`}

    <div class="titulo" id="sec-obra">🏗️ Obra da vila</div>
    ${obra ? `<button class="cartaz" data-acao="obra"><span class="ic">${{ ponte: '🌉', praca: '⛲', acude: '💧', escola: '🏫' }[obra.chave] ?? '🏗️'}</span><span class="txt"><b>${esc(obra.nome)} — ${obra.pct}% pronta</b>${esc(obra.chamada)} Depois: ${esc(obra.texto)}<span class="barrao"><i style="--p:${obra.pct}%"></i></span></span><span class="btn fraco">Doar</span></button>`
      : `<div class="cartaz"><span class="ic">🏆</span><span class="txt"><b>Todas as obras prontas</b>${v.obras.map((o) => o.nome).join(', ')}. Isso é raro.</span></div>`}
    ${v.obras.filter((o) => o.concluida).length ? `<p class="mini" style="margin:6px 4px 0">🏆 Prontas: ${v.obras.filter((o) => o.concluida).map((o) => `${o.nome} (${o.texto.toLowerCase().replace(/\.$/, '')})`).join(' · ')}</p>` : ''}
    <div class="titulo" id="sec-feed">📜 Últimas da vila</div>
    <div class="lista">${v.feed.slice(0, 8).map((l) => `<div class="item" style="padding:8px 12px"><span class="ic" style="font-size:22px">${l.sprite}</span><span class="txt" style="font-size:13px"><b style="font-size:13px">${esc(l.autor)} <span class="mini">· ${esc(l.quando)}</span></b>${esc(l.texto)}${l.impacto ? ` <span class="mini">→ ${esc(l.impacto)}</span>` : ''}</span></div>`).join('')}</div>
    <p class="mini" style="margin:14px 4px 0;text-align:center">Vila ${esc(v.vila.nome)} · ${esc(v.vila.estacao)}, dia ${v.vila.dia} · ${v.vila.iconeClima} ${esc(v.vila.rotuloClima)} · 💧${v.comuns.find((c) => c.chave === 'agua').valor} 🌳${v.comuns.find((c) => c.chave === 'floresta').valor} ❤️${v.comuns.find((c) => c.chave === 'harmonia').valor}</p>`;

  if (!app.cena) app.cena = new VilaCanvas($('cena'), { aoClicar: cliqueNoMapa });
  else $('cena').replaceChildren(cenaViva);
  app.cena.atualizar(v, m);

  $('rodape').innerHTML = `
    <button data-acao="vai" data-alvo="sec-minha"><span class="ic">🏡</span>Horta${v.minhaHerdade.canteiros.some((c) => c.pronto || c.problema) ? `<b>${v.minhaHerdade.canteiros.filter((c) => c.pronto || c.problema).length}</b>` : ''}</button>
    <button data-acao="vai" data-alvo="sec-familia"><span class="ic">👨‍👩‍👧</span>Família${ajudas ? `<b>${ajudas}</b>` : ''}</button>
    <button data-acao="conversa"><span class="ic">💬</span>Conversa${msgs ? `<b>${msgs}</b>` : ''}</button>`;
}

// O mapa devolve o toque traduzido: mesma acao dos botoes.
function cliqueNoMapa(alvo) {
  const m = app.motor.mundo;
  if (alvo.rio) return toast(`💧 rio da vila: ${m.comuns.agua}/100 de água`);
  if (alvo.poco) return folhaObra();
  if (alvo.loja) return alvo.loja === 'vendinha' ? folhaCeleiro() : folhaLoja(alvo.loja);
  const h = m.herdades[alvo.herdade];
  if (!h) return;
  if (!h.dono) return toast('terra livre — manda a chave pra alguém da família');
  if (h.dono === app.eu) return $('sec-minha').scrollIntoView({ block: 'start', behavior: 'smooth' });
  const el = $(`her-${h.id}`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// --- folhas (uma decisao por vez) --------------------------------------------
function folha(html) {
  fecha();
  const veu = document.createElement('div'); veu.className = 'veu';
  veu.innerHTML = `<div class="folha"><button class="fechar" data-acao="fecha" aria-label="fechar">✕</button>${html}</div>`;
  $('phone').appendChild(veu);
  veu.addEventListener('click', (e) => { if (e.target === veu) fecha(); });
  return veu;
}
const fecha = () => { document.querySelector('.veu')?.remove(); };

function folhaPlantar(tile) {
  const v = v_();
  const vazios = v.minhaHerdade.canteiros.filter((c) => c.vazio).length;
  folha(`<h2>O que plantar?</h2><p>Toque na semente. Ela cresce sozinha, mesmo com o jogo fechado.</p>
    ${vazios > 1 ? `<button class="btn cheio" data-acao="plantar-tudo" data-cultura="${app.cultura}" style="margin:0 0 12px">${iconeDe(app.cultura)} Plantar ${esc(nomeDe(app.cultura).toLowerCase())} nos ${vazios} vazios</button>` : ''}
    <div class="cartoes tres">${v.catalogo.culturas.map((c) => `<button class="cartao ${c.liberada ? '' : 'bloq'}" data-acao="plantar" data-tile="${tile}" data-cultura="${c.chave}" ${c.liberada ? '' : 'disabled'}>
      <span class="ic">${c.icone}</span><span class="nm">${esc(c.nome)}</span>
      <span class="dt">${c.liberada ? `${c.minutos >= 60 ? `${Math.round(c.minutos / 60)} h` : `${c.minutos} min`} · ${c.semente} 🪙${c.daEstacao ? '' : ' · fora de estação'}` : `🔒 nível ${c.nivel}`}</span></button>`).join('')}</div>`);
}

function folhaLoja(cliente) {
  const v = v_();
  const loja = LOJAS.find((l) => l.cliente === cliente);
  const minhas = v.encomendas.filter((e) => e.cliente === cliente);
  folha(`<h2>${loja.icone} ${esc(cliente.replace(/^(a|o) /, ''))}</h2>
    ${minhas.length ? minhas.map((e) => `
      <p style="margin-bottom:6px">Quer:</p>
      <div class="lista">${e.itens.map((i) => `<div class="item"><span class="ic">${i.icone}</span><span class="txt"><b>${i.qtd} ${esc(i.nome.toLowerCase())}</b>você tem ${i.tenho}</span>${i.ok ? '✅' : `<span style="font-weight:900;color:var(--orange2)">faltam ${i.qtd - i.tenho}</span>`}</div>`).join('')}</div>
      <p style="margin-top:10px">Paga <b>${e.moedas} 🪙</b> e ${e.xp} ✨ — 50% a mais que vender na feira.</p>
      ${e.pronta ? `<button class="btn cheio" data-acao="entregar" data-indice="${e.indice}">📦 Entregar e receber ${e.moedas} 🪙</button>`
        : e.itens.filter((i) => !i.ok).map((i) => CULTURAS[i.chave]
          ? (CULTURAS[i.chave].nivel <= v.hud.nivel
            ? `<button class="btn cheio fraco" data-acao="plantar-falta" data-cultura="${i.chave}" data-qtd="${i.qtd - i.tenho}">${i.icone} Plantar ${esc(i.nome.toLowerCase())} agora (${CULTURAS[i.chave].minutos} min)</button>`
            : `<p class="mini">${i.icone} ${esc(i.nome)} abre no nível ${CULTURAS[i.chave].nivel}.</p>`)
          : PRODUTOS[i.chave]
            ? `<button class="btn cheio fraco" data-acao="maquina" data-maquina="${PRODUTOS[i.chave].maquina}">${i.icone} Fazer ${esc(i.nome.toLowerCase())} no ${esc(CONSTRUCOES[PRODUTOS[i.chave].maquina].nome.toLowerCase())}</button>`
            : '').join('')}`).join('<hr style="border:0;border-top:2px solid var(--paper2);margin:14px 0">')
      : `<p>Não tem pedido pra você agora. Quando tiver, aparece um 📋 em cima da loja. Pedido que você já consegue entregar fica amarelo com "!".</p>`}`);
}

function folhaCeleiro() {
  const v = v_();
  const reservado = {};
  for (const e of v.encomendas) for (const i of e.itens) reservado[i.chave] = Math.max(reservado[i.chave] ?? 0, i.qtd);
  folha(`<h2>🏪 Vendinha da família</h2><p>O que os outros puseram à venda. Comprar ajuda a fechar um pedido — e o dinheiro vai pro parente.</p>
    <div class="lista">${v.vendinha.filter((l) => !l.minha).map((l) => `<div class="item ${l.util ? '' : ''}"><span class="ic">${l.icone}</span><span class="txt"><b>${l.qtd} ${esc(l.nome.toLowerCase())}</b>de ${esc(l.vendedor)}${l.util ? ' · <span style="color:var(--good)">fecha um pedido seu</span>' : ''}</span><button class="btn" data-acao="comprar" data-de="${l.de}" data-lote="${l.lote}" ${l.possoPagar ? '' : 'disabled'}>${l.preco} 🪙</button></div>`).join('') || '<p>Nada à venda agora.</p>'}</div>
    ${v.vendinha.some((l) => l.minha) ? `<h3>À venda por você</h3><div class="lista">${v.vendinha.filter((l) => l.minha).map((l) => `<div class="item"><span class="ic">${l.icone}</span><span class="txt"><b>${l.qtd} ${esc(l.nome.toLowerCase())}</b>por ${l.preco} 🪙</span><button class="btn fraco" data-acao="retirar" data-lote="${l.lote}">Tirar</button></div>`).join('')}</div>` : ''}
    <h3>Seu celeiro <span class="mini">· ${v.hud.moedas} 🪙 no bolso</span></h3>
    <div class="lista">${v.hud.colheita.map((c) => `<div class="item"><span class="ic">${c.icone}</span><span class="txt"><b>${c.qtd} ${esc(c.nome.toLowerCase())}</b>${reservado[c.cultura] ? `guarda ${Math.min(c.qtd, reservado[c.cultura])} pra um pedido · ` : ''}feira paga ${c.preco} 🪙 cada</span>
      <button class="btn fraco" data-acao="anunciar" data-item="${c.cultura}" title="pôr na vendinha por 1,5x">Vender pra família</button>
      <button class="btn fraco" data-acao="vender" data-item="${c.cultura}" data-qtd="${Math.max(0, c.qtd - (reservado[c.cultura] ?? 0))}">Feira</button></div>`).join('') || '<p>Celeiro vazio. Colhe alguma coisa primeiro.</p>'}</div>
    <p class="mini" style="margin-top:10px">Vender pra família põe na vendinha por 1,5× o preço da feira (${v.minhaVendinha.lotes}/${v.minhaVendinha.maximo} lotes). "Feira" vende na hora pelo preço de feira, guardando o que seus pedidos precisam.</p>`);
}

function folhaConversa(com) {
  const v = v_();
  const m = app.motor.mundo;
  const outros = v.familia.filter((f) => f.id !== app.eu);
  const para = com && outros.some((f) => f.id === com) ? com : null;
  app.conversaCom = para;
  const conversa = m.feed.filter((l) => l.tipo === 'RECADO' && (para
    ? (l.ator === app.eu && l.ref?.para === para) || (l.ator === para && l.ref?.para === app.eu)
    : !l.ref?.para)).slice(-15);
  const quem = para ? outros.find((f) => f.id === para) : null;
  const pendentes = naoLidas().filter((n) => (para ? !(n.para && n.ator === para) : !!n.para));
  marcaLidas();
  folha(`<h2>💬 ${para ? `Conversa com ${esc(quem.nome)}` : 'Mural da família'}</h2>
    <div class="quem"><button class="${!para ? 'on' : ''}" data-acao="conversa" data-com="">📣 Todos${pendentes.some((n) => !n.para) ? ' 🔴' : ''}</button>
      ${outros.map((f) => `<button class="${para === f.id ? 'on' : ''}" data-acao="conversa" data-com="${f.id}">${f.sprite} ${esc(f.nome)}${pendentes.some((n) => n.para && n.ator === f.id) ? ' 🔴' : ''}</button>`).join('')}</div>
    <div class="conversa" id="conversa">${conversa.map((l) => { const meu = l.ator === app.eu; const texto = l.texto.replace(/^[^:]+: "/, '').replace(/"$/, ''); return `<div class="balao ${meu ? 'meu' : ''}">${meu ? '' : `<small>${esc(m.jogadores[l.ator]?.nome ?? '')}</small>`}${esc(texto)}</div>`; }).join('') || `<p>${para ? `Nenhum recado entre vocês ainda. Só ${esc(quem.nome)} vê o que você escrever aqui.` : 'Nada no mural ainda. Todo mundo da vila lê o que for escrito aqui.'}</p>`}</div>
    <div class="linha"><input id="in-recado" maxlength="140" placeholder="${para ? `Escreve pra ${esc(quem.nome)}…` : 'Fala com todo mundo…'}" autocomplete="off"/><button class="btn" data-acao="recado" data-para="${para ?? ''}">Enviar</button></div>
    ${para ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn fraco" data-acao="abracar" data-para="${para}">❤️ Abraço</button><button class="btn fraco" data-acao="presente-lista" data-para="${para}">🎁 Presente</button></div>` : ''}`);
  const c = $('conversa'); if (c) c.scrollTop = c.scrollHeight;
  pinta();
}

function folhaPessoa(id) {
  const v = v_();
  const f = v.familia.find((x) => x.id === id);
  const m = app.motor.mundo;
  const her = m.herdades[m.jogadores[id]?.herdade];
  const pedidos = v.pedidosDeAjuda.filter((p) => p.dono === id);
  folha(`<h2>${f.sprite} ${esc(f.nome)} <span class="mini">nível ${f.nivel}</span></h2>
    <p>Laço com você: ${esc(f.laco)}.${pedidos.length ? ` Precisa de você em ${pedidos.length} canteiro(s).` : ' A horta está em ordem.'}</p>
    ${pedidos.length > 1 ? `<button class="btn cheio" data-acao="ajudar-tudo" data-herdade="${her.id}" style="margin:0 0 12px">🤝 Ajudar em tudo (${pedidos.length})</button>` : ''}
    <div class="lista">
      <button class="item" data-acao="abracar" data-para="${id}"><span class="ic">❤️</span><span class="txt"><b>Mandar um abraço</b>+1 harmonia pra vila toda</span></button>
      <button class="item" data-acao="conversa" data-com="${id}"><span class="ic">💬</span><span class="txt"><b>Conversar</b>só vocês dois veem</span></button>
      <button class="item" data-acao="presente-lista" data-para="${id}"><span class="ic">🎁</span><span class="txt"><b>Dar um presente</b>do seu celeiro ou madeira</span></button>
    </div>`);
}

function folhaPresente(para) {
  const v = v_();
  const nome = v.familia.find((f) => f.id === para)?.nome ?? '';
  folha(`<h2>🎁 Presente pra ${esc(nome)}</h2><p>Vai direto pro celeiro dela. Cria laço e ela fica sabendo na hora.</p>
    <div class="lista">
      ${v.hud.colheita.map((c) => `<button class="item" data-acao="presentear" data-para="${para}" data-recurso="colheita" data-item="${c.cultura}" data-qtd="${Math.min(c.qtd, 3)}"><span class="ic">${c.icone}</span><span class="txt"><b>${Math.min(c.qtd, 3)} ${esc(c.nome.toLowerCase())}</b>você tem ${c.qtd}</span>›</button>`).join('')}
      ${v.hud.madeira >= 3 ? `<button class="item" data-acao="presentear" data-para="${para}" data-recurso="madeira" data-qtd="3"><span class="ic">🪵</span><span class="txt"><b>3 madeiras</b>você tem ${v.hud.madeira}</span>›</button>` : ''}
      ${v.hud.pedra >= 3 ? `<button class="item" data-acao="presentear" data-para="${para}" data-recurso="pedra" data-qtd="3"><span class="ic">🪨</span><span class="txt"><b>3 pedras</b>você tem ${v.hud.pedra}</span>›</button>` : ''}
    </div>${!v.hud.colheita.length && v.hud.madeira < 3 ? '<p>Nada pra dar agora — colhe ou corta lenha primeiro.</p>' : ''}`);
}

function folhaPendencias() {
  const v = v_();
  const itens = pendenciasDe(v);
  const missoes = v.missoesDoDia;
  folha(`<h2>📬 Pra fazer agora</h2><p>Toque num item e ele te leva lá.</p>
    <div class="lista">${itens.map((x, i) => `<button class="item" data-acao="pendencia" data-i="${i}"><span class="ic">${x.ic}</span><span class="txt">${esc(x.t)}</span>›</button>`).join('') || '<p>Tudo feito. Planta mais alguma coisa? 🌱</p>'}</div>
    <h3>Desafios de hoje <span class="mini">· novos à meia-noite</span></h3>
    <div class="lista">${missoes.map((x) => `<div class="item ${x.recebida ? 'apagado' : ''}"><span class="ic">${x.recebida ? '✅' : x.cumprida ? '🎁' : '⬜'}</span><span class="txt"><b>${esc(x.texto)}</b>${x.recebida ? 'feito' : `${x.feito}/${x.meta} · ${esc(x.premioTexto)}`}</span>${x.cumprida && !x.recebida ? `<button class="btn" data-acao="cumprir-missao" data-indice="${x.indice}">Receber</button>` : ''}</div>`).join('')}</div>`);
  app.pendencias = itens;
}

function folhaObra() {
  const v = v_();
  const m = v.missao;
  if (!m) return folha('<h2>🏆 Obras prontas</h2><p>A família terminou tudo. Isso é raro.</p>');
  folha(`<h2>🏗️ ${esc(m.nome)} — ${m.pct}%</h2><p>${esc(m.texto)} É obra de todo mundo: cada um dá o que tem.</p>
    <div class="lista">${m.itens.map((i) => { const tenho = i.recurso === 'moedas' ? v.hud.moedas : v.hud[i.recurso] ?? 0; const dar = Math.min(tenho, i.falta); return `<div class="item"><span class="ic">${{ madeira: '🪵', pedra: '🪨', moedas: '🪙' }[i.recurso]}</span><span class="txt"><b>${i.recurso}: ${i.feito}/${i.alvo}</b>${i.falta ? `faltam ${i.falta} · você tem ${tenho}` : 'completo ✅'}</span>${dar > 0 ? `<button class="btn" data-acao="doar" data-obra="${m.chave}" data-recurso="${i.recurso}" data-qtd="${dar}">Doar ${dar}</button>` : ''}</div>`; }).join('')}</div>
    ${v.obras.filter((o) => !o.concluida && o.chave !== m.chave).length ? `<p class="mini" style="margin-top:10px">Depois: ${v.obras.filter((o) => !o.concluida && o.chave !== m.chave).map((o) => `${o.nome} (${o.texto.toLowerCase()})`).join(' · ')}</p>` : ''}`);
}

function folhaConstruir() {
  const v = v_();
  folha(`<h2>🔨 Construir na horta</h2><p>${v.minhaHerdade.vagas} vaga(s). Cada benfeitoria muda alguma coisa pra você ou pros vizinhos.</p>
    <div class="lista">${v.catalogo.construcoes.map((b) => {
      const [r] = acoesPossiveis(app.motor.mundo, app.eu, [{ tipo: 'CONSTRUIR', construcao: b.chave }]);
      const tem = v.minhaHerdade.construcoes.some((c) => c.chave === b.chave);
      return `<div class="item ${r.habilitado ? '' : 'apagado'}"><span class="ic">${b.icone}</span><span class="txt"><b>${esc(b.nome)} ${tem ? '✅' : b.liberada ? '' : `🔒 nível ${b.nivel}`}</b>${esc(b.texto)}<br><span class="mini">${Object.entries(b.custo).map(([k, q]) => `${q} ${k}`).join(' · ')}${r.habilitado ? '' : ` · ${esc(r.motivo)}`}</span></span>${r.habilitado ? `<button class="btn" data-acao="cmd" data-tipo="CONSTRUIR" data-construcao="${b.chave}">Fazer</button>` : ''}</div>`;
    }).join('')}</div>`);
}

function folhaMaquina(maquina) {
  const v = v_();
  const q = v.minhaHerdade.maquinas.find((x) => x.maquina === maquina);
  if (!q) return;
  folha(`<h2>${q.icone} ${esc(q.nome)}</h2><p>${q.pronta ? `${q.produto.nome} pronto — pega aí.` : q.ocupada ? `Fazendo ${q.produto.nome.toLowerCase()}, pronto em ${min(q.prontaEm)}.` : 'Livre. Escolhe o que fazer:'}</p>
    ${q.pronta ? `<button class="btn cheio" data-acao="cmd" data-tipo="RECOLHER" data-maquina="${maquina}">✨ Pegar ${esc(q.produto.nome.toLowerCase())}</button>` : ''}
    ${!q.ocupada ? `<div class="lista">${q.receitas.map((r) => `<div class="item ${r.podeFazer ? '' : 'apagado'}"><span class="ic">${r.icone}</span><span class="txt"><b>${esc(r.nome)}</b>${esc(r.entradaTexto)} · ${r.minutos} min · vale ${r.preco} 🪙</span>${r.podeFazer ? `<button class="btn" data-acao="cmd" data-tipo="PRODUZIR" data-produto="${r.chave}">Fazer</button>` : ''}</div>`).join('')}</div>` : ''}`);
}

function folhaAnunciar(item) {
  const v = v_();
  const c = v.hud.colheita.find((x) => x.cultura === item);
  if (!c) return;
  const qtd = Math.min(c.qtd, 20);
  const [mn, mx] = faixaDePreco(item, qtd);
  const justo = Math.min(mx, Math.round(c.preco * qtd * 1.5));
  folha(`<h2>${c.icone} Vender ${esc(c.nome.toLowerCase())} pra família</h2><p>Você tem ${c.qtd}. Feira paga ${c.preco} 🪙 cada; pra família dá pra pedir até ${c.preco * 2}. Quem comprar vê na hora.</p>
    <div class="lista">
      <button class="item" data-acao="anuncia" data-item="${item}" data-qtd="${qtd}" data-preco="${mn}"><span class="ic">🤝</span><span class="txt"><b>${qtd} por ${mn} 🪙</b>preço de feira — puro favor</span>›</button>
      <button class="item" data-acao="anuncia" data-item="${item}" data-qtd="${qtd}" data-preco="${justo}"><span class="ic">⚖️</span><span class="txt"><b>${qtd} por ${justo} 🪙</b>justo: 1,5× a feira</span>›</button>
      <button class="item" data-acao="anuncia" data-item="${item}" data-qtd="${qtd}" data-preco="${mx}"><span class="ic">💰</span><span class="txt"><b>${qtd} por ${mx} 🪙</b>teto: 2× a feira</span>›</button>
    </div>`);
}

function folhaFamiliaConfig() {
  const v = v_();
  const outrosNomes = v.familia.filter((f) => f.id !== app.eu);
  folha(`<h2>👥 A família</h2>
    <p>Quem tem a chave entra na vila de qualquer aparelho. Manda pra quem falta:</p>
    <div class="chave">${esc(app.chave)}</div>
    <a class="btn cheio zap" style="display:block;text-align:center;text-decoration:none;color:#fff;margin-top:0" href="${linkWhatsApp(mensagemDeConvite(app.chave))}" target="_blank" rel="noopener">📲 Convidar pelo WhatsApp</a>
    <button class="btn cheio fraco" data-acao="copiar" data-texto="${esc(linkDeConvite(app.chave))}">Copiar link</button>
    <h3>Na vila</h3>
    <div class="lista">${v.familia.map((f) => `<div class="item"><span class="ic">${f.sprite}</span><span class="txt"><b>${esc(f.nome)}${f.id === app.eu ? ' (você)' : ''}</b>nível ${f.nivel}${f.id !== app.eu ? ` · laço ${esc(f.laco)}` : ''}</span>${f.id !== app.eu ? `<button class="btn fraco" data-acao="trocar" data-quem="${f.id}" title="jogar como esta pessoa neste aparelho">Jogar como</button>` : ''}</div>`).join('')}</div>
    <h3>Avisos</h3>
    <div class="lista">
      ${'Notification' in window && Notification.permission !== 'denied' ? `<button class="item" data-acao="sino"><span class="ic">${sinoLigado() ? '🔔' : '🔕'}</span><span class="txt"><b>${sinoLigado() ? 'Avisos ligados' : 'Ligar avisos'}</b>recado, abraço, presente e planta pronta, mesmo com o jogo em outra aba</span></button>` : ''}
      <button class="item" data-acao="trocar-vila"><span class="ic">🔁</span><span class="txt"><b>Trocar de vila</b>voltar pra tela de entrada</span></button>
      <button class="item" data-acao="guia-de-novo"><span class="ic">👋</span><span class="txt"><b>Ver o guia de novo</b>os primeiros passos</span></button>
      <a class="item" href="../web-classico/" style="text-decoration:none;color:inherit"><span class="ic">🕹️</span><span class="txt"><b>Tela clássica</b>a versão antiga, 8-bit</span></a>
    </div>
    <p class="mini" style="margin-top:10px">versão ${VERSAO}${app.online ? ' · entre casas' : ' · só neste aparelho'}</p>`);
}

// --- feedback -----------------------------------------------------------------
function toast(t, tipo = '', aoClicar = null) {
  const d = document.createElement(aoClicar ? 'button' : 'div');
  d.className = `toast ${tipo}`; d.textContent = aoClicar ? `${t} ›` : t;
  if (aoClicar) d.onclick = () => { d.remove(); aoClicar(); };
  $('phone').appendChild(d);
  setTimeout(() => d.remove(), aoClicar ? 9000 : 2600);
}
function moeda(x, y, n) {
  if (!n) return;
  const ph = $('phone').getBoundingClientRect();
  const d = document.createElement('div'); d.className = 'moeda'; d.textContent = `+${n} 🪙`;
  d.style.left = `${x - ph.left - 30}px`; d.style.top = `${y - ph.top - 20}px`;
  $('phone').appendChild(d); setTimeout(() => d.remove(), 1000);
}

async function manda(cmd, ev) {
  const antes = app.motor.mundo.jogadores[app.eu];
  const nivelAntes = nivelDe(antes?.xp ?? 0), moedasAntes = antes?.inventario.moedas ?? 0;
  const r = await app.sessao.executar({ ...cmd, data: dataLocal() });
  if (!r.ok) { toast(r.erro, 'ruim'); return r; }
  pinta();
  const depois = app.motor.mundo.jogadores[app.eu];
  const ganho = (depois?.inventario.moedas ?? 0) - moedasAntes;
  if (ganho > 0 && ev) moeda(ev.clientX, ev.clientY, ganho);
  const nv = nivelDe(depois?.xp ?? 0);
  if (nv > nivelAntes) {
    const novidades = [...Object.values(CULTURAS).filter((c) => c.nivel === nv).map((c) => c.nome), ...Object.values(CONSTRUCOES).filter((b) => b.nivel === nv).map((b) => b.nome)];
    setTimeout(() => toast(`⬆ Nível ${nv}!${novidades.length ? ` Liberou: ${novidades.join(', ')}` : ''}`, 'bom'), 400);
  }
  guiaAvanca(cmd.tipo);
  return r;
}
async function mandaVarios(cmds, seVazio) {
  if (!cmds.length) return toast(seVazio);
  let feitos = 0;
  for (const c of cmds) { const r = await manda(c); if (!r.ok) break; feitos++; }
  return feitos;
}

// --- toques -------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const d = alvo.dataset;
  const v = app.motor && app.eu ? v_() : null;
  const acoes = {
    'usar-chave': () => { const nome = $('in-nome').value.trim(); if (!nome) return toast('diga seu nome primeiro', 'ruim'); usarChave($('in-chave').value, nome); },
    'abrir-vila': () => abrirVila(d.chave, $('in-nome')?.value.trim() || null),
    fundar: () => { const vila = $('in-vila').value.trim(), nome = $('in-nome').value.trim(); const k = extrairChave(vila); if (k) return usarChave(k, nome); if (!vila || !nome) return toast('preencha o nome da vila e o seu', 'ruim'); fundar(vila, nome); },
    fecha, vai: () => { fecha(); $(d.alvo)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },

    canteiro: () => {
      const c = v.minhaHerdade.canteiros[Number(d.tile)];
      if (c.vazio) return folhaPlantar(c.i);
      if (c.pronto) return manda({ tipo: 'COLHER', tile: c.i }, e).then((r) => r.ok && toast(`${c.icone} colheu ${c.nome.toLowerCase()} · foi pro celeiro`, 'bom'));
      if (c.problema) return manda({ tipo: 'CUIDAR', tile: c.i }, e).then((r) => r.ok && toast(`${c.problemaIcone} cuidou · voltou a crescer`, 'bom'));
      toast(`${c.nome} pronta em ${min(c.prontaEm - app.motor.mundo.agora)} — planta em outro canteiro enquanto isso`);
    },
    plantar: async () => { app.cultura = d.cultura; fecha(); const r = await manda({ tipo: 'PLANTAR', tile: Number(d.tile), cultura: d.cultura }, e); if (r.ok) toast(`${iconeDe(d.cultura)} ${nomeDe(d.cultura)} plantado · pronto em ${CULTURAS[d.cultura].minutos} min`, 'bom'); },
    'plantar-tudo': async () => { fecha(); const vazios = v.minhaHerdade.canteiros.filter((c) => c.vazio); const n = await mandaVarios(vazios.map((c) => ({ tipo: 'PLANTAR', tile: c.i, cultura: d.cultura })), 'nenhum canteiro vazio'); if (n) toast(`${iconeDe(d.cultura)} plantou em ${n} canteiro(s)`, 'bom'); },
    'colher-tudo': async () => { const n = await mandaVarios(v.minhaHerdade.canteiros.filter((c) => c.pronto).map((c) => ({ tipo: 'COLHER', tile: c.i })), 'nada maduro'); if (n) toast(`🌾 colheu ${n} canteiro(s) · foi pro celeiro`, 'bom'); },
    'cuidar-tudo': async () => { const n = await mandaVarios(v.minhaHerdade.canteiros.filter((c) => c.problema).map((c) => ({ tipo: 'CUIDAR', tile: c.i })), 'ninguém pedindo'); if (n) toast(`💧 cuidou de ${n} planta(s)`, 'bom'); },
    'plantar-falta': async () => {
      fecha(); app.cultura = d.cultura;
      const vazios = v.minhaHerdade.canteiros.filter((c) => c.vazio);
      const rende = Math.max(1, CULTURAS[d.cultura].rende);
      const precisa = Math.min(vazios.length, Math.ceil(Number(d.qtd) / rende));
      if (!vazios.length) return toast('sem canteiro vazio — colhe alguma coisa primeiro');
      const n = await mandaVarios(vazios.slice(0, precisa).map((c) => ({ tipo: 'PLANTAR', tile: c.i, cultura: d.cultura })), '');
      if (n) { toast(`${iconeDe(d.cultura)} plantou ${n} · pronto em ${CULTURAS[d.cultura].minutos} min`, 'bom'); $('sec-minha').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    },
    'comprar-canteiro': () => manda({ tipo: 'COMPRAR_CANTEIRO' }, e).then((r) => r.ok && toast('＋ canteiro novo!', 'bom')),
    ajudar: async () => {
      const m = mundoAgora(); const t = m.herdades[d.herdade]?.tiles[Number(d.tile)]; const dono = m.jogadores[m.herdades[d.herdade]?.dono]?.nome ?? 'alguém';
      if (t && !t.problema && !estaMadura(t)) return toast(`${CULTURAS[t.cultura].nome} de ${dono} está bem — pronta em ${min(duracaoCultura(t.cultura) - t.progresso)}`);
      const r = await manda({ tipo: 'AJUDAR', herdade: d.herdade, tile: Number(d.tile), acao: d.sub }, e);
      if (r.ok) toast(d.sub === 'COLHER' ? `🌾 colheu pra ${dono} · +5 ✨ · +harmonia` : `🤝 cuidou da planta de ${dono} · +5 ✨`, 'bom');
    },
    'ajudar-tudo': async () => { fecha(); const m = mundoAgora(); const h = m.herdades[d.herdade]; const cmds = h.tiles.map((t, i) => t && (estaMadura(t) || t.problema) ? { tipo: 'AJUDAR', herdade: h.id, tile: i, acao: estaMadura(t) ? 'COLHER' : 'CUIDAR' } : null).filter(Boolean); const n = await mandaVarios(cmds, 'nada pra ajudar aqui agora'); if (n) toast(`🤝 ajudou em ${n} canteiro(s)`, 'bom'); },
    loja: () => folhaLoja(d.cliente),
    entregar: async () => { fecha(); const r = await manda({ tipo: 'CUMPRIR_ENCOMENDA', indice: Number(d.indice) }, e); if (r.ok) toast('📦 entregue! o dinheiro já está com você', 'bom'); },
    celeiro: folhaCeleiro,
    vender: async () => { const q = Number(d.qtd); if (!q) return toast('isso está guardado pra um pedido seu — entrega vale mais'); const r = await manda({ tipo: 'VENDER', cultura: d.item, quantidade: q }, e); if (r.ok) { toast(`vendeu ${q} na feira`, 'bom'); folhaCeleiro(); } },
    anunciar: () => folhaAnunciar(d.item),
    anuncia: async () => { const r = await manda({ tipo: 'ANUNCIAR', item: d.item, quantidade: Number(d.qtd), preco: Number(d.preco) }); if (r.ok) { toast('🏪 na vendinha · a família vê na hora', 'bom'); folhaCeleiro(); } },
    comprar: async () => { const r = await manda({ tipo: 'COMPRAR', de: d.de, lote: Number(d.lote) }); if (r.ok) { toast('comprou · foi pro seu celeiro', 'bom'); folhaCeleiro(); } },
    retirar: async () => { const r = await manda({ tipo: 'RETIRAR', lote: Number(d.lote) }); if (r.ok) folhaCeleiro(); },
    pessoa: () => folhaPessoa(d.quem),
    abracar: async () => { fecha(); const r = await manda({ tipo: 'ABRACAR', para: d.para }); if (r.ok) toast('❤️ abraço mandado · +1 harmonia', 'bom'); },
    'presente-lista': () => folhaPresente(d.para),
    presentear: async () => { fecha(); const cmd = d.recurso === 'colheita' ? { tipo: 'PRESENTEAR', para: d.para, recurso: 'colheita', item: d.item, quantidade: Number(d.qtd) } : { tipo: 'PRESENTEAR', para: d.para, recurso: d.recurso, quantidade: Number(d.qtd) }; const r = await manda(cmd); if (r.ok) { toast('🎁 presente entregue', 'bom'); ofereceZap(`${v.hud.nome} te deixou um presente na ${app.motor.mundo.nome}!`); } },
    conversa: () => folhaConversa(d.com || null),
    recado: async () => { const t = $('in-recado').value.trim(); if (!t) return toast('escreve alguma coisa'); const r = await manda({ tipo: 'RECADO', texto: t, para: d.para || undefined }); if (r.ok) { folhaConversa(d.para || null); ofereceZap(`${v.hud.nome} te deixou um recado na ${app.motor.mundo.nome}: "${t}"`); } },
    pendencias: folhaPendencias,
    pendencia: () => { const x = app.pendencias?.[Number(d.i)]; if (!x) return; fecha(); if (x.conversa) return folhaConversa(x.conversa === 'todos' ? null : x.conversa); if (x.vendinha) return folhaCeleiro(); if (x.acao === 'cumprir-missao') return manda({ tipo: 'CUMPRIR_MISSAO', indice: x.indice }, e); $(x.vai)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    'cumprir-missao': async () => { const r = await manda({ tipo: 'CUMPRIR_MISSAO', indice: Number(d.indice) }, e); if (r.ok) { toast('🎁 prêmio recebido', 'bom'); folhaPendencias(); } },
    obra: folhaObra,
    doar: async () => { const r = await manda({ tipo: 'DOAR', obra: d.obra, recursos: { [d.recurso]: Number(d.qtd) } }); if (r.ok) { toast(`doou ${d.qtd} ${d.recurso} · a vila agradece`, 'bom'); folhaObra(); } },
    construir: folhaConstruir,
    maquina: () => folhaMaquina(d.maquina),
    cmd: async () => {
      const cmd = { tipo: d.tipo }; if (d.construcao) cmd.construcao = d.construcao; if (d.produto) cmd.produto = d.produto; if (d.maquina) cmd.maquina = d.maquina;
      const antes = v.hud;
      const r = await manda(cmd, e);
      if (!r.ok) return;
      const dep = v_().hud;
      if (d.tipo === 'CORTAR') toast(`🪓 +${dep.madeira - antes.madeira} madeira`, 'bom');
      else if (d.tipo === 'MINERAR') toast(`⛏️ +${dep.pedra - antes.pedra} pedra`, 'bom');
      else if (d.tipo === 'CONSTRUIR') { fecha(); toast(`🔨 ${CONSTRUCOES[d.construcao].nome} pronto!`, 'bom'); }
      else if (d.tipo === 'PRODUZIR') { fecha(); toast(`${iconeDe(d.produto)} fazendo ${nomeDe(d.produto).toLowerCase()}`, 'bom'); }
      else if (d.tipo === 'RECOLHER') { fecha(); toast('✨ pegou · foi pro celeiro', 'bom'); }
    },
    'familia-config': folhaFamiliaConfig,
    copiar: async () => { try { await navigator.clipboard.writeText(d.texto); toast('copiado', 'bom'); } catch { toast(d.texto); } },
    trocar: () => { trocarDeFamiliar(d.quem); fecha(); pinta(); toast(`agora você é ${app.motor.mundo.jogadores[d.quem]?.nome}`); },
    'trocar-vila': () => { localStorage.removeItem('vila:ultima'); app.transporte?.fechar?.(); fecha(); telaEntrada(); },
    'guia-de-novo': () => { fecha(); localStorage.setItem('vila:guia', '0'); guia(); },
    sino: async () => {
      if (sinoLigado()) { localStorage.setItem('vila:sino', 'off'); toast('🔕 avisos desligados'); return folhaFamiliaConfig(); }
      const p = await Notification.requestPermission();
      if (p === 'granted') { localStorage.setItem('vila:sino', 'on'); toast('🔔 combinado', 'bom'); try { new Notification(app.motor.mundo.nome, { body: 'Quando alguém falar com você, aparece aqui.', icon: ICONE_NOTIF }); } catch {} }
      else toast('sem permissão — dá pra ligar nas configurações do navegador', 'ruim');
      folhaFamiliaConfig();
    },
  };
  await acoes[d.acao]?.();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'in-recado') document.querySelector('.folha [data-acao="recado"]')?.click();
  if (e.key === 'Enter' && (e.target.id === 'in-nome' || e.target.id === 'in-chave')) document.querySelector('[data-acao="usar-chave"]')?.click();
  if (e.key === 'Escape') fecha();
});

// --- guia dos primeiros minutos ------------------------------------------------
const PASSOS = [
  { t: 'Bem-vindo(a)! Toque num canteiro com + pra plantar.', alvo: () => document.querySelector('.minha .canteiro.vazio'), avanca: 'PLANTAR' },
  { t: 'Agora ela cresce sozinha. Quando brilhar, toque pra colher.', alvo: () => document.querySelector('.minha .canteiro.pronto'), avanca: 'COLHER' },
  { t: 'Alguém da família precisa de você? Planta com 💧🐛🌿 ou brilhando na horta deles: toque pra ajudar.', alvo: () => document.querySelector('.outra .canteiro .pede')?.closest('.canteiro') ?? document.querySelector('.outra .canteiro.pronto'), avanca: 'AJUDAR' },
  { t: 'Loja amarela com "!" = pedido que você já consegue entregar. Toque nela.', alvo: () => document.querySelector('.loja.pronta'), avanca: 'CUMPRIR_ENCOMENDA' },
  { t: 'É isso: plantar, colher, ajudar, entregar. Quando tiver algo pra fazer, o 📬 lá em cima avisa.', alvo: () => document.querySelector('[data-acao="pendencias"]') },
];
const passoGuia = () => Number(localStorage.getItem('vila:guia') ?? 0);
function guia() {
  document.querySelector('.guia')?.remove(); document.querySelector('.mao')?.remove();
  let n = passoGuia(); if (!app.eu || !PASSOS[n]) return;
  // Primeira vez sem canteiro vazio mas com planta pronta? O passo certo e o de colher.
  if (n === 0 && !PASSOS[0].alvo() && PASSOS[1].alvo()) { n = 1; localStorage.setItem('vila:guia', '1'); }
  const p = PASSOS[n];
  const g = document.createElement('div'); g.className = 'guia';
  g.innerHTML = `<span class="ic">👋</span><span>${p.t}</span><button id="pular">${n === PASSOS.length - 1 ? 'Valeu' : 'Pular'}</button>`;
  $('phone').appendChild(g);
  $('pular').onclick = () => { localStorage.setItem('vila:guia', String(n === PASSOS.length - 1 ? 99 : n + 1)); guia(); };
  const alvo = p.alvo(); if (!alvo) return;
  const r0 = alvo.getBoundingClientRect(), ph0 = $('phone').getBoundingClientRect();
  if (r0.top < ph0.top + 60 || r0.bottom > ph0.bottom - 200) alvo.scrollIntoView({ block: 'center', behavior: 'instant' });
  setTimeout(() => {
    const r = alvo.getBoundingClientRect(), ph = $('phone').getBoundingClientRect();
    const m = document.createElement('div'); m.className = 'mao'; m.textContent = '👆';
    m.style.left = `${r.left - ph.left + r.width / 2 - 10}px`; m.style.top = `${r.top - ph.top + r.height / 2 + 6}px`;
    $('phone').appendChild(m);
  }, 250);
}
function guiaAvanca(tipo) {
  const n = passoGuia(); const p = PASSOS[n];
  if (p && p.avanca === tipo) { localStorage.setItem('vila:guia', String(n + 1)); setTimeout(guia, 700); }
  else if (p && !document.querySelector('.mao')) setTimeout(guia, 700); // o alvo pode ter aparecido agora
}

// --- avisos de fora da tela ----------------------------------------------------
const ICONE_NOTIF = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#7cb342"/><text x="32" y="46" font-size="40" text-anchor="middle">🌳</text></svg>');
const tituloBase = document.title;
let naoLidos = 0;
const sinoLigado = () => 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem('vila:sino') !== 'off';
const ultimoAviso = new Map();
function avisaChegada(r) {
  if (!r?.eventos?.length || !app.eu) return;
  const m = app.motor.mundo;
  const nomeDe_ = (id) => m.jogadores[id]?.nome ?? 'alguém';
  const minha = m.jogadores[app.eu]?.herdade;
  for (const ev of r.eventos) {
    if (ev.ator === app.eu) continue;
    const d = ev.dados ?? {};
    let texto = null, abre = null;
    if (ev.tipo === 'RECADO') { if (d.para && d.para !== app.eu) continue; texto = `💬 ${d.para ? ev.texto.replace(/ → [^:]+:/, ' → você:') : ev.texto}`; abre = () => folhaConversa(d.para ? ev.ator : null); }
    else if (ev.tipo === 'ABRACOU' && d.para === app.eu) { texto = `❤️ ${nomeDe_(ev.ator)} te mandou um abraço`; abre = () => folhaPessoa(ev.ator); }
    else if (ev.tipo === 'PRESENTEOU' && d.para === app.eu) { texto = `🎁 ${ev.texto}`; abre = () => folhaPessoa(ev.ator); }
    else if (ev.tipo === 'COMPROU' && d.de === app.eu) texto = `💰 ${ev.texto}`;
    else if (ev.tipo === 'ANUNCIOU') { texto = `🏪 ${ev.texto}`; abre = folhaCeleiro; }
    else if ((ev.tipo === 'CUIDOU' || ev.tipo === 'COLHEU') && d.herdade === minha) {
      const k = `horta:${ev.ator}`; if (Date.now() - (ultimoAviso.get(k) ?? 0) < 5 * 60e3) continue; ultimoAviso.set(k, Date.now());
      texto = `🤝 ${nomeDe_(ev.ator)} está cuidando da sua horta`;
    }
    else if (ev.tipo === 'JOGADOR_ENTROU') texto = `🏠 ${nomeDe_(ev.ator)} chegou na vila!`;
    else if (ev.tipo === 'OBRA_CONCLUIDA') texto = `🏆 ${ev.texto}`;
    if (!texto) continue;
    notifica(texto, abre);
  }
}
function notifica(texto, abre) {
  if (document.hidden) {
    naoLidos++; document.title = `(${naoLidos}) ${tituloBase}`;
    if (sinoLigado()) { try { const n = new Notification(app.motor.mundo.nome ?? 'Vila', { body: texto, icon: ICONE_NOTIF, tag: 'vila' }); n.onclick = () => { window.focus(); n.close(); abre?.(); }; } catch {} }
  } else { toast(texto, 'bom', abre); if (sinoLigado()) plim(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { naoLidos = 0; document.title = tituloBase; } });
function plim() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [990, 0.09]].forEach(([f, t]) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.08); });
  } catch {}
}
const prontasAvisadas = new Set();
setInterval(() => {
  if (!app.motor || !app.eu) return;
  const v = v_();
  const novas = v.minhaHerdade.canteiros.filter((c) => c.pronto && !prontasAvisadas.has(`${c.i}:${c.nome}`));
  for (const c of v.minhaHerdade.canteiros) if (!c.pronto) prontasAvisadas.delete(`${c.i}:${c.nome}`);
  if (!novas.length) return;
  for (const c of novas) prontasAvisadas.add(`${c.i}:${c.nome}`);
  if (document.hidden) notifica(`🌾 ${novas.length === 1 ? `${novas[0].nome} pronto` : `${novas.length} canteiros prontos`} na sua horta`);
}, 20000);
function ofereceZap(mensagem) {
  const a = document.createElement('a');
  a.href = linkWhatsApp(`${mensagem}\n${linkDeConvite(app.chave)}`); a.target = '_blank'; a.rel = 'noopener';
  a.className = 'toast'; a.style.background = '#25d366'; a.style.textDecoration = 'none'; a.style.bottom = '160px';
  a.textContent = '📲 avisar no WhatsApp';
  $('phone').appendChild(a); setTimeout(() => a.remove(), 10000);
}

// --- atualizacao sozinha ---------------------------------------------------------
let atualizando = false;
async function conferirVersao() {
  if (atualizando || !navigator.onLine) return;
  try {
    const r = await fetch(`./versao.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (!v || v === VERSAO) return;
    atualizando = true;
    toast('🆕 vila atualizada — recarregando…');
    const urls = new Set([location.href.split('#')[0], ...performance.getEntriesByType('resource').map((x) => x.name)]);
    await Promise.allSettled([...urls].filter((u) => /\.(js|html|css)(\?|$)/.test(u)).map((u) => fetch(u, { cache: 'reload' })));
    const tenta = () => { if (!document.querySelector('.veu') && document.activeElement?.tagName !== 'INPUT') location.reload(); else setTimeout(tenta, 5000); };
    tenta();
  } catch {}
}
setInterval(conferirVersao, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
setTimeout(conferirVersao, 3000);

// --- vai ------------------------------------------------------------------------
telaEntrada();
{
  const ultima = localStorage.getItem('vila:ultima');
  if (!chaveDaUrl() && ultima && vilasSalvas().some((x) => x.chave === ultima)) abrirVila(ultima, null);
}
