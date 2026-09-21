import { Motor } from '../src/engine/motor.js';
import { visao, acoesPossiveis } from '../src/engine/apresentador.js';
import { novaChave, lerChave, extrairChave } from '../src/engine/convite.js';
import { TransporteLocal, Sessao } from '../src/net/transporte.js';
import { CULTURAS, PRODUTOS, TEMPO, xpParaNivel, nivelDe } from '../src/engine/conteudo.js';
import { estaMadura } from '../src/engine/tempo.js';

let passou = 0, falhou = 0;
const teste = async (nome, fn) => {
  try { await fn(); passou++; console.log(`  ok   ${nome}`); }
  catch (e) { falhou++; console.log(`  FALHA ${nome}\n        ${e.message}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg ?? 'esperado verdadeiro'); };
const igual = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? ''} esperado ${b}, veio ${a}`); };

const OPC = { semente: 'familia-2026', nome: 'Vila do Riacho' };
const T0 = Date.parse('2026-09-15T08:00:00Z');
const MIN = 60e3, H = 60 * MIN;

// O relogio do mundo anda pelo `em` dos comandos. Nos testes, cada motor
// carrega um relogio proprio e `espera()` manda um comando mudo com a hora nova.
function vilaCom(...nomes) {
  const m = Motor.criar(OPC);
  m.relogio = T0;
  nomes.forEach((n, i) => m.executar({ id: `entrar-${i}`, tipo: 'ENTRAR', por: n.toLowerCase(), nome: n, nomeHerdade: `Sitio ${n}`, em: T0 }));
  return m;
}
function espera(m, ms) {
  m.relogio += ms;
  return m.executar({ tipo: 'ACORDAR', por: Object.keys(m.mundo.jogadores)[0], id: `t${m.relogio}`, em: m.relogio });
}
const agora = (m, cmd) => ({ ...cmd, em: m.relogio });
const manda = (m, cmd) => m.executar(agora(m, cmd));
const daXp = (m, id, xp) => { m.mundo.jogadores[id].xp = xp; };

/** Deixa a planta madura, atendendo os pedidos dela pelo caminho. */
function amadurece(m, por, tile) {
  const her = m.mundo.herdades[m.mundo.jogadores[por].herdade];
  for (let guarda = 0; guarda < 12 && !estaMadura(her.tiles[tile]); guarda++) {
    espera(m, CULTURAS[her.tiles[tile].cultura].minutos * MIN);
    if (her.tiles[tile].problema) manda(m, { tipo: 'CUIDAR', por, tile });
  }
}

console.log('\nMotor da Vila\n');

await teste('entrar reserva uma herdade, aquece a harmonia e abre 3 encomendas', () => {
  const m = vilaCom('Ana');
  const j = m.mundo.jogadores.ana;
  igual(j.herdade, 'h00');
  igual(m.mundo.herdades.h00.dono, 'ana');
  igual(m.mundo.comuns.harmonia, 53);
  igual(j.encomendas.length, 3);
  ok(j.encomendas.every((e) => Object.keys(e.itens).every((k) => CULTURAS[k]?.nivel === 1)), 'nivel 1 so pede trigo');
});

await teste('a vila lota e recusa o proximo', () => {
  const m = Motor.criar({ ...OPC, grade: { l: 1, a: 1 } });
  m.executar({ tipo: 'ENTRAR', por: 'a', nome: 'Ana' });
  const r = m.executar({ tipo: 'ENTRAR', por: 'b', nome: 'Bia' });
  ok(!r.ok && /lotada/.test(r.erro), r.erro);
});

await teste('trigo: 1 G, 2 minutos, rende 2 — o loop de Hay Day', () => {
  const m = vilaCom('Ana');
  m.mundo.comuns.harmonia = 50; // velocidade neutra
  ok(manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' }).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, 29);
  igual(m.mundo.jogadores.ana.xp, 1, 'plantar da 1 xp');
  ok(!manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'milho' }).ok, 'ocupado');
  espera(m, 1 * MIN);
  ok(!manda(m, { tipo: 'COLHER', por: 'ana', tile: 0 }).ok, 'com 1 min ainda nao');
  igual(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].progresso, 50);
  ok(/pronta em 1 min/.test(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].rotulo));
  espera(m, 1 * MIN);
  const r = manda(m, { tipo: 'COLHER', por: 'ana', tile: 0 });
  ok(r.ok, r.erro);
  igual(m.mundo.jogadores.ana.colheita.trigo, 2, 'rende 2 por 1');
  igual(m.mundo.jogadores.ana.xp, 2);
  ok(manda(m, { tipo: 'VENDER', por: 'ana', cultura: 'trigo', quantidade: 2 }).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, 33, '1 G de semente virou 4 G');
});

await teste('nao tem energia: planta os 9 canteiros de uma vez', () => {
  const m = vilaCom('Ana');
  for (let i = 0; i < 9; i++) ok(manda(m, { tipo: 'PLANTAR', por: 'ana', tile: i, cultura: 'trigo' }).ok, `canteiro ${i}`);
  igual(m.mundo.jogadores.ana.inventario.moedas, 21);
});

await teste('cultura fechada abre por nivel', () => {
  const m = vilaCom('Ana');
  let r = manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'milho' });
  ok(!r.ok && /nivel 3/.test(r.erro), r.erro);
  daXp(m, 'ana', xpParaNivel(3));
  igual(nivelDe(m.mundo.jogadores.ana.xp), 3);
  ok(manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'milho' }).ok);
  igual(visao(m.mundo, 'ana').hud.nivel, 3);
  ok(visao(m.mundo, 'ana').catalogo.culturas.find((c) => c.chave === 'cafe').liberada === false);
});

await teste('planta de 10 min pede ajuda no caminho e PARA ate alguem cuidar', () => {
  const m = vilaCom('Ana');
  daXp(m, 'ana', xpParaNivel(4));
  manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'cenoura' });
  const t = m.mundo.herdades.h00.tiles[0];
  ok(t.pedidos.length >= 1 && t.pedidos[0].em === 0.4, 'primeiro pedido aos 40%');
  espera(m, 6 * MIN); // passou dos 40%
  ok(t.problema, 'deveria estar pedindo algo');
  igual(t.progresso, 0.4 * 10 * MIN, 'parou exatamente nos 40%');
  const v = visao(m.mundo, 'ana').minhaHerdade.canteiros[0];
  ok(/pede/.test(v.rotulo), v.rotulo);
  espera(m, 10 * MIN);
  igual(t.progresso, 0.4 * 10 * MIN, 'parada nao cresce');
  ok(manda(m, { tipo: 'CUIDAR', por: 'ana', tile: 0 }).ok);
  igual(t.problema, null);
  ok(!manda(m, { tipo: 'CUIDAR', por: 'ana', tile: 0 }).ok, 'nada a cuidar');
  amadurece(m, 'ana', 0);
  ok(estaMadura(t));
});

await teste('harmonia muda a velocidade de tudo — para todo mundo', () => {
  const m = vilaCom('Ana');
  m.mundo.comuns.harmonia = 100; // +20%
  manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' });
  espera(m, 100 * 1000); // 100s a 1.2x = 120s = pronto
  ok(estaMadura(m.mundo.herdades.h00.tiles[0]), 'com harmonia alta o trigo fica pronto antes');
  const m2 = vilaCom('Beto');
  m2.mundo.comuns.harmonia = 0; // -20%
  manda(m2, { tipo: 'PLANTAR', por: 'beto', tile: 0, cultura: 'trigo' });
  espera(m2, 2 * MIN);
  ok(!estaMadura(m2.mundo.herdades.h00.tiles[0]), 'com harmonia baixa, 2 min nao bastam');
  ok(/devagar/.test(visao(m2.mundo, 'beto').sinergia.bonus));
});

await teste('ajudar o vizinho: a colheita e dele, o xp e o laco sao de quem ajudou', () => {
  const m = vilaCom('Ana', 'Beto');
  daXp(m, 'beto', xpParaNivel(4));
  manda(m, { tipo: 'PLANTAR', por: 'beto', tile: 0, cultura: 'cenoura' });
  espera(m, 6 * MIN);
  ok(m.mundo.herdades.h10.tiles[0].problema, 'a cenoura do Beto pediu');
  const v = visao(m.mundo, 'ana');
  ok(v.pedidosDeAjuda.some((p) => p.herdade === 'h10' && p.acao === 'CUIDAR'), 'Ana ve o pedido');
  const xpAntes = m.mundo.jogadores.ana.xp;
  const harmoniaAntes = m.mundo.comuns.harmonia;
  const r = manda(m, { tipo: 'AJUDAR', por: 'ana', herdade: 'h10', tile: 0, acao: 'CUIDAR' });
  ok(r.ok, r.erro);
  igual(m.mundo.herdades.h10.tiles[0].problema, null);
  igual(m.mundo.jogadores.ana.xp, xpAntes + 5 + 1, 'ajudar (5) + cuidar (1)');
  igual(m.mundo.jogadores.ana.reputacao.beto, 2);
  ok(m.mundo.comuns.harmonia > harmoniaAntes);
  amadurece(m, 'beto', 0);
  ok(manda(m, { tipo: 'AJUDAR', por: 'ana', herdade: 'h10', tile: 0, acao: 'COLHER' }).ok);
  ok((m.mundo.jogadores.beto.colheita.cenoura ?? 0) > 0, 'a colheita e do dono');
  igual(m.mundo.jogadores.ana.colheita.cenoura, undefined);
});

await teste('nao da para ajudar na propria terra nem mexer na do outro sem ser convidado', () => {
  const m = vilaCom('Ana', 'Beto');
  manda(m, { tipo: 'PLANTAR', por: 'beto', tile: 0, cultura: 'trigo' });
  ok(!manda(m, { tipo: 'AJUDAR', por: 'beto', herdade: 'h10', tile: 0, acao: 'COLHER' }).ok);
  const r = manda(m, { tipo: 'COLHER', por: 'ana', herdade: 'h10', tile: 0 });
  ok(!r.ok && /nao e sua/.test(r.erro), r.erro);
});

await teste('machado derruba a mata e descansa 3 min; replantar devolve', () => {
  const m = vilaCom('Ana');
  ok(manda(m, { tipo: 'CORTAR', por: 'ana' }).ok);
  igual(m.mundo.comuns.floresta, 97);
  ok(m.mundo.jogadores.ana.inventario.madeira > 5);
  const r = manda(m, { tipo: 'CORTAR', por: 'ana' });
  ok(!r.ok && /descansa/.test(r.erro), r.erro);
  ok(visao(m.mundo, 'ana').hud.machadoEm > 0);
  espera(m, TEMPO.descansoMachado);
  ok(manda(m, { tipo: 'CORTAR', por: 'ana' }).ok, 'descansou, pode de novo');
  manda(m, { tipo: 'PLANTAR_ARVORE', por: 'ana' });
  igual(m.mundo.comuns.floresta, 98);
});

await teste('moinho e forno: trigo vira farinha vira pao, com fila e tempo', () => {
  const m = vilaCom('Ana');
  daXp(m, 'ana', xpParaNivel(5));
  m.mundo.jogadores.ana.inventario = { madeira: 40, pedra: 10, moedas: 200 };
  m.mundo.jogadores.ana.colheita = { trigo: 4 };
  ok(!manda(m, { tipo: 'PRODUZIR', por: 'ana', produto: 'farinha' }).ok, 'sem moinho nao');
  ok(manda(m, { tipo: 'CONSTRUIR', por: 'ana', construcao: 'moinho' }).ok);
  ok(manda(m, { tipo: 'PRODUZIR', por: 'ana', produto: 'farinha' }).ok);
  igual(m.mundo.jogadores.ana.colheita.trigo, 2, 'gastou 2 trigo');
  let r = manda(m, { tipo: 'PRODUZIR', por: 'ana', produto: 'farinha' });
  ok(!r.ok && /ocupado/.test(r.erro), r.erro);
  r = manda(m, { tipo: 'RECOLHER', por: 'ana', maquina: 'moinho' });
  ok(!r.ok && /pronto em/.test(r.erro), r.erro);
  ok(/Farinha em/.test(visao(m.mundo, 'ana').minhaHerdade.maquinas[0].rotulo));
  espera(m, 3 * MIN);
  ok(manda(m, { tipo: 'RECOLHER', por: 'ana', maquina: 'moinho' }).ok);
  igual(m.mundo.jogadores.ana.colheita.farinha, 1);
  manda(m, { tipo: 'PRODUZIR', por: 'ana', produto: 'farinha' }); espera(m, 3 * MIN); manda(m, { tipo: 'RECOLHER', por: 'ana', maquina: 'moinho' });
  ok(manda(m, { tipo: 'CONSTRUIR', por: 'ana', construcao: 'forno' }).ok);
  ok(manda(m, { tipo: 'PRODUZIR', por: 'ana', produto: 'pao' }).ok);
  espera(m, 5 * MIN);
  ok(manda(m, { tipo: 'RECOLHER', por: 'ana', maquina: 'forno' }).ok);
  igual(m.mundo.jogadores.ana.colheita.pao, 1);
  const moedas = m.mundo.jogadores.ana.inventario.moedas;
  manda(m, { tipo: 'VENDER', por: 'ana', cultura: 'pao', quantidade: 1 });
  igual(m.mundo.jogadores.ana.inventario.moedas, moedas + PRODUTOS.pao.preco);
});

await teste('encomenda: entrega paga 50% acima do balcao, da xp, e entra outra no lugar', () => {
  const m = vilaCom('Ana');
  const p = m.mundo.jogadores.ana;
  const enc = p.encomendas[0];
  ok(!manda(m, { tipo: 'CUMPRIR_ENCOMENDA', por: 'ana', indice: 0 }).ok, 'celeiro vazio');
  p.colheita = { ...enc.itens };
  const moedas = p.inventario.moedas, xp = p.xp;
  const r = manda(m, { tipo: 'CUMPRIR_ENCOMENDA', por: 'ana', indice: 0 });
  ok(r.ok, r.erro);
  igual(p.inventario.moedas, moedas + enc.moedas);
  igual(p.xp, xp + enc.xp);
  ok(Object.values(p.colheita).every((q) => q >= 0));
  ok(p.encomendas[0] && p.encomendas[0].id !== enc.id, 'nova encomenda no lugar');
  igual(p.encomendas.length, 3);
  const v = visao(m.mundo, 'ana');
  igual(v.encomendas.length, 3);
  ok(v.encomendas[0].itens.every((i) => 'tenho' in i));
});

await teste('colmeia do vizinho aumenta a colheita da herdade ao lado', () => {
  const colhe = (m, por) => {
    daXp(m, por, xpParaNivel(5));
    manda(m, { tipo: 'PLANTAR', por, tile: 0, cultura: 'abobora' });
    amadurece(m, por, 0);
    return manda(m, { tipo: 'COLHER', por, tile: 0 }).eventos.find((e) => e.tipo === 'COLHEU').dados.quantidade;
  };
  const sem = colhe(vilaCom('Ana', 'Beto'), 'ana');
  const m = vilaCom('Ana', 'Beto');
  daXp(m, 'beto', xpParaNivel(4));
  m.mundo.jogadores.beto.inventario.madeira = 20; m.mundo.jogadores.beto.inventario.moedas = 100;
  m.mundo.herdades.h00.fertilidade = 100;
  ok(manda(m, { tipo: 'CONSTRUIR', por: 'beto', construcao: 'colmeia' }).ok);
  ok(colhe(m, 'ana') >= sem, 'com colmeia rende pelo menos igual');
});

await teste('obra coletiva concluida acelera a vila inteira', () => {
  const m = vilaCom('Ana', 'Beto');
  m.mundo.jogadores.ana.inventario.madeira = 40;
  m.mundo.jogadores.beto.inventario.pedra = 20;
  ok(manda(m, { tipo: 'DOAR', por: 'ana', obra: 'ponte', recursos: { madeira: 40 } }).ok);
  const antes = visao(m.mundo, 'ana').vila.velocidade;
  const r = manda(m, { tipo: 'DOAR', por: 'beto', obra: 'ponte', recursos: { pedra: 20 } });
  ok(r.eventos.some((e) => e.tipo === 'OBRA_CONCLUIDA'), 'a ponte deveria ficar pronta');
  ok(visao(m.mundo, 'ana').vila.velocidade > antes, 'velocidade subiu para todos');
});

await teste('rio seco vira presagio e freia o crescimento', () => {
  const m = vilaCom('Ana');
  m.mundo.comuns.agua = 10;
  const r = m.executar({ tipo: 'PASSAR_DIA', id: 'd1', em: m.relogio });
  ok(r.eventos.some((e) => e.tipo === 'DESTINO' && e.dados.chave === 'seca'), 'esperava presagio de seca');
  ok(visao(m.mundo, 'ana').vila.velocidade < 100);
});

await teste('presente move recurso e aproxima', () => {
  const m = vilaCom('Ana', 'Beto');
  const r = manda(m, { tipo: 'PRESENTEAR', por: 'ana', para: 'beto', recurso: 'madeira', quantidade: 3 });
  ok(r.ok, r.erro);
  igual(m.mundo.jogadores.ana.inventario.madeira, 2);
  igual(m.mundo.jogadores.beto.inventario.madeira, 8);
  igual(m.mundo.jogadores.beto.reputacao.ana, 1);
  ok(!manda(m, { tipo: 'PRESENTEAR', por: 'ana', para: 'beto', recurso: 'madeira', quantidade: 99 }).ok);
});

await teste('mesmo log = mesmo mundo (determinismo, com relogio)', () => {
  const log = [
    { id: '1', tipo: 'ENTRAR', por: 'ana', nome: 'Ana', em: T0 },
    { id: '2', tipo: 'ENTRAR', por: 'beto', nome: 'Beto', em: T0 + 1000 },
    { id: '3', tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo', em: T0 + 2000 },
    { id: '5', tipo: 'CORTAR', por: 'beto', em: T0 + 3000 },
    { id: '6', tipo: 'COLHER', por: 'ana', tile: 0, em: T0 + 3 * MIN },
    { id: 'd1', tipo: 'PASSAR_DIA', em: T0 + 24 * H },
  ];
  const a = Motor.reproduzir(log, OPC);
  const b = Motor.reproduzir(log, OPC);
  igual(a.hash, b.hash, 'hashes deveriam bater');
  igual(a.mundo.jogadores.ana.colheita.trigo, 2);
  const c = Motor.reproduzir(log, { ...OPC, semente: 'outra' });
  ok(a.hash !== c.hash, 'sementes diferentes deveriam divergir');
});

await teste('comando repetido nao conta duas vezes', () => {
  const m = vilaCom('Ana');
  const cmd = { id: 'unico', tipo: 'CORTAR', por: 'ana', em: T0 };
  m.executar(cmd);
  const madeira = m.mundo.jogadores.ana.inventario.madeira;
  const r = m.executar(cmd);
  ok(r.repetido, 'deveria marcar como repetido');
  igual(m.mundo.jogadores.ana.inventario.madeira, madeira);
});

await teste('chave de convite: sorteia, le com erro de digitacao e barra chave errada', () => {
  const chave = novaChave();
  ok(/^VILA-[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(chave), chave);
  igual(lerChave(chave).chave, chave);
  const bagunçada = chave.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  igual(lerChave(bagunçada).chave, chave, 'deveria normalizar');
  ok(!lerChave(chave.slice(0, -1) + (chave.endsWith('A') ? 'B' : 'A')).valida, 'digito errado tem que barrar');
  ok(!lerChave('VILA-1234').valida);
  igual(novaChave(() => 0.5), novaChave(() => 0.5), 'com o mesmo gerador, a mesma chave');
});

await teste('chave sobrevive ao WhatsApp: travessao, aspas, texto em volta, link', () => {
  const chave = novaChave();
  igual(lerChave(chave.replace(/-/g, '–')).chave, chave, 'travessao do iOS');
  igual(lerChave(`"${chave}"`).chave, chave, 'aspas');
  igual(extrairChave(`oi mae, entra na vila com ${chave.toLowerCase()} beijo`), chave, 'no meio da mensagem');
  igual(extrairChave(`https://x.github.io/vila/web/?chave=${chave}`), chave, 'dentro do link');
  igual(extrairChave('Vila do Riacho'), null, 'nome de vila nao e chave');
});

await teste('acoesPossiveis: botao valido vem habilitado, invalido vem com motivo', () => {
  const m = vilaCom('Ana');
  const [cortar, colher, xis] = acoesPossiveis(m.mundo, 'ana', [{ tipo: 'CORTAR' }, { tipo: 'COLHER', tile: 0 }, { tipo: 'XIS' }]);
  ok(cortar.habilitado && cortar.motivo === null, `cortar deveria estar liberado: ${cortar.motivo}`);
  ok(!colher.habilitado && /nada plantado/.test(colher.motivo), colher.motivo);
  ok(!xis.habilitado && /desconhecido/.test(xis.motivo));
});

await teste('a visao entrega tudo mastigado para a tela', () => {
  const m = vilaCom('Ana', 'Beto');
  manda(m, { tipo: 'PLANTAR', por: 'beto', tile: 2, cultura: 'trigo' });
  const v = visao(m.mundo, 'ana');
  igual(v.hud.nome, 'Ana');
  igual(v.hud.nivel, 1);
  igual(v.mapa.length, 9);
  igual(v.minhaHerdade.canteiros.length, 9);
  igual(v.comuns.length, 4);
  igual(v.encomendas.length, 3);
  igual(v.missoesDoDia.length, 3);
  ok(v.catalogo.culturas.length === 7 && v.catalogo.produtos.length === 3);
  ok(v.familia.find((f) => f.id === 'beto').laco === 'distantes');
  ok(v.feed.length > 0);
});

await teste('a visao traduz o impacto de cada atitude para a tela', () => {
  const m = vilaCom('Ana', 'Beto');
  manda(m, { tipo: 'CORTAR', por: 'ana' });
  const v = visao(m.mundo, 'ana');
  const corte = v.feed.find((l) => l.tipo === 'CORTOU_ARVORE');
  igual(corte.impacto, '−3 mata', 'o feed precisa dizer o que a acao tirou do comum');
  igual(corte.autor, 'Ana');
  igual(corte.quando, 'hoje');
  igual(v.sinergia.valor, m.mundo.comuns.harmonia);
  igual(v.missao.chave, 'ponte');
  ok(v.hud.terra > 0);
});

await teste('sessao em rede: dois clientes chegam ao mesmo mundo', async () => {
  const rede = new TransporteLocal();
  const anaM = Motor.criar(OPC), betoM = Motor.criar(OPC);
  const ana = new Sessao({ motor: anaM, transporte: rede, jogadorId: 'ana' });
  const beto = new Sessao({ motor: betoM, transporte: rede, jogadorId: 'beto' });
  await ana.sincronizar(); await beto.sincronizar();
  await ana.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await beto.executar({ tipo: 'ENTRAR', nome: 'Beto' });
  await ana.executar({ tipo: 'PLANTAR', tile: 0, cultura: 'trigo' });
  await beto.executar({ tipo: 'PASSAR_DIA', id: 'dia-1' });
  igual(anaM.hash, betoM.hash, 'os dois clientes divergiram');
  igual(anaM.mundo.tick, 1);
});

await teste('recem-chegado reproduz o log e alcanca a vila', async () => {
  const rede = new TransporteLocal();
  const m1 = Motor.criar(OPC);
  const s1 = new Sessao({ motor: m1, transporte: rede, jogadorId: 'ana' });
  await s1.sincronizar();
  await s1.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await s1.executar({ tipo: 'CORTAR' });
  await s1.executar({ tipo: 'PASSAR_DIA', id: 'dia-1' });
  const m2 = Motor.criar(OPC);
  const s2 = new Sessao({ motor: m2, transporte: rede, jogadorId: 'vo' });
  await s2.sincronizar();
  igual(m1.hash, m2.hash, 'quem chegou depois deveria ver a mesma vila');
});

await teste('abraco e recado: os gestos baratos que seguram a familia', () => {
  const m = vilaCom('Ana', 'Beto');
  const antes = m.mundo.comuns.harmonia;
  ok(manda(m, { tipo: 'ABRACAR', por: 'ana', para: 'beto' }).ok);
  igual(m.mundo.comuns.harmonia, antes + 1);
  igual(m.mundo.jogadores.beto.reputacao.ana, 1);
  const r = manda(m, { tipo: 'ABRACAR', por: 'ana', para: 'beto' });
  ok(!r.ok && /hoje/.test(r.erro), r.erro);
  m.executar({ tipo: 'PASSAR_DIA', id: 'd1', em: m.relogio });
  ok(manda(m, { tipo: 'ABRACAR', por: 'ana', para: 'beto' }).ok, 'amanha pode de novo');
  ok(manda(m, { tipo: 'RECADO', por: 'beto', texto: 'quem cuida da minha horta?' }).ok);
  ok(m.mundo.feed.at(-1).texto.includes('quem cuida'), 'recado deveria entrar no feed');
  ok(!manda(m, { tipo: 'RECADO', por: 'beto', texto: '   ' }).ok);
  ok(!manda(m, { tipo: 'RECADO', por: 'beto', texto: 'x'.repeat(200) }).ok);
});

await teste('missoes do dia: 3 iguais para todos, premio uma vez, zera a meia-noite', () => {
  const m = vilaCom('Ana', 'Beto');
  const v = visao(m.mundo, 'ana');
  igual(v.missoesDoDia.length, 3);
  // A missao de plantar e a mais facil de fabricar; se nao veio hoje, ache outra que der.
  const alvo = v.missoesDoDia.find((x) => /Plante/.test(x.texto)) ?? v.missoesDoDia.find((x) => /lenha/.test(x.texto)) ?? v.missoesDoDia.find((x) => /Colha/.test(x.texto));
  ok(alvo, 'esperava plantar/lenha/colher: ' + v.missoesDoDia.map((x) => x.texto).join(' / '));
  ok(!manda(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice }).ok, 'ainda nao cumpriu');
  for (let i = 0; i < alvo.meta; i++) {
    if (/Plante/.test(alvo.texto)) manda(m, { tipo: 'PLANTAR', por: 'ana', tile: i, cultura: 'trigo' });
    else if (/lenha/.test(alvo.texto)) { manda(m, { tipo: 'CORTAR', por: 'ana' }); espera(m, TEMPO.descansoMachado); }
    else { manda(m, { tipo: 'PLANTAR', por: 'ana', tile: i, cultura: 'trigo' }); espera(m, 2 * MIN); manda(m, { tipo: 'COLHER', por: 'ana', tile: i }); }
  }
  ok(visao(m.mundo, 'ana').missoesDoDia[alvo.indice].cumprida);
  const moedas = m.mundo.jogadores.ana.inventario.moedas;
  ok(manda(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice }).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, moedas + alvo.premio.moedas);
  ok(!manda(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice }).ok, 'nao recebe duas vezes');
  ok(!manda(m, { tipo: 'CUMPRIR_MISSAO', por: 'beto', indice: alvo.indice }).ok, 'Beto nao fez nada');
  m.executar({ tipo: 'PASSAR_DIA', id: 'd1', em: m.relogio });
  igual(m.mundo.jogadores.ana.missoesFeitas.length, 0, 'novo dia, novas missoes');
});

await teste('comprar canteiro: a herdade cresce ate 12, o preco sobe', () => {
  const m = vilaCom('Ana');
  m.mundo.jogadores.ana.inventario.moedas = 50;
  let r = manda(m, { tipo: 'COMPRAR_CANTEIRO', por: 'ana' });
  ok(!r.ok && /60 moedas/.test(r.erro), r.erro);
  m.mundo.jogadores.ana.inventario.moedas = 300;
  ok(manda(m, { tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  igual(m.mundo.herdades.h00.tiles.length, 10);
  ok(manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 9, cultura: 'trigo' }).ok, 'planta no canteiro novo');
  ok(manda(m, { tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  ok(manda(m, { tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, 300 - 60 - 1 - 90 - 120);
  r = manda(m, { tipo: 'COMPRAR_CANTEIRO', por: 'ana' });
  ok(!r.ok && /maximo/.test(r.erro), r.erro);
});

await teste('demolir libera a vaga e devolve metade do material', () => {
  const m = vilaCom('Ana');
  daXp(m, 'ana', xpParaNivel(4));
  m.mundo.jogadores.ana.inventario = { madeira: 40, pedra: 0, moedas: 200 };
  for (const c of ['poco', 'colmeia', 'composteira']) ok(manda(m, { tipo: 'CONSTRUIR', por: 'ana', construcao: c }).ok, c);
  ok(!manda(m, { tipo: 'CONSTRUIR', por: 'ana', construcao: 'moinho' }).ok, 'cheia');
  const madeira = m.mundo.jogadores.ana.inventario.madeira;
  ok(manda(m, { tipo: 'DEMOLIR', por: 'ana', construcao: 'colmeia' }).ok);
  igual(m.mundo.jogadores.ana.inventario.madeira, madeira + 3, 'colmeia custa 6 de madeira, volta 3');
  ok(manda(m, { tipo: 'CONSTRUIR', por: 'ana', construcao: 'moinho' }).ok, 'abriu vaga');
});

await teste('vila antiga (sem xp, sem encomendas) ganha os campos novos ao mexer', () => {
  const m = vilaCom('Ana');
  const p = m.mundo.jogadores.ana;
  delete p.xp; delete p.encomendas; delete p.descanso; delete p.hoje;
  p.feitos.colheitas = 10;
  ok(manda(m, { tipo: 'CORTAR', por: 'ana' }).ok);
  igual(p.encomendas.length, 3);
  ok(p.xp >= 20, 'o que ja fez virou xp');
});

await teste('o calendario vem do log: primeira data funda, PASSAR_DIA avanca', async () => {
  const { diasPendentes, comandoDoDia } = await import('../src/engine/calendario.js');
  const m = Motor.criar(OPC);
  m.executar({ tipo: 'ENTRAR', por: 'ana', nome: 'Ana', data: '2026-09-10', em: T0 });
  igual(m.mundo.dataDoDia, '2026-09-10', 'fundacao');
  igual(diasPendentes('2026-09-10', '2026-09-12').join(','), '2026-09-11,2026-09-12');
  igual(diasPendentes('2026-08-01', '2026-09-12', 7).length, 7, 'no maximo 7 dias de uma vez');
  for (const d of diasPendentes(m.mundo.dataDoDia, '2026-09-12')) m.executar({ ...comandoDoDia(d), em: T0 + 1 });
  igual(m.mundo.tick, 2);
  igual(m.executar({ ...comandoDoDia('2026-09-12'), em: T0 + 2 }).repetido, true, 'mesmo dia duas vezes = ignorado');
});

await teste('vendinha: anuncia dentro da faixa, o parente compra, dinheiro e item trocam de mao', () => {
  const m = vilaCom('Ana', 'Bia');
  const ana = m.mundo.jogadores.ana, bia = m.mundo.jogadores.bia;
  ana.colheita.trigo = 10;
  ok(!manda(m, { tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 4, preco: 30 }).ok, 'acima do dobro da feira nao vale');
  ok(!manda(m, { tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 4, preco: 5 }).ok, 'abaixo da feira nao vale');
  ok(!manda(m, { tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 11, preco: 22 }).ok, 'nao tem 11');
  ok(manda(m, { tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 4, preco: 12 }).ok, 'anuncia 4 trigos por 12 (1,5x)');
  igual(ana.colheita.trigo, 6, 'saiu do celeiro');
  igual(ana.vendinha.length, 1);
  const v = visao(m.mundo, 'bia');
  igual(v.vendinha.length, 1);
  igual(v.vendinha[0].vendedor, 'Ana');
  ok(!manda(m, { tipo: 'COMPRAR', por: 'ana', de: 'ana', lote: 0 }).ok, 'nao compra de si mesma');
  const moedasBia = bia.inventario.moedas, moedasAna = ana.inventario.moedas, harm = m.mundo.comuns.harmonia;
  ok(manda(m, { tipo: 'COMPRAR', por: 'bia', de: 'ana', lote: 0 }).ok, 'bia compra');
  igual(bia.inventario.moedas, moedasBia - 12);
  igual(ana.inventario.moedas, moedasAna + 12);
  igual(bia.colheita.trigo, 4);
  igual(ana.vendinha.length, 0);
  igual(m.mundo.comuns.harmonia, harm + 1, 'comprar do parente aquece a vila');
  igual(bia.reputacao.ana, 1, 'e cria laco');
  ok(!manda(m, { tipo: 'COMPRAR', por: 'bia', de: 'ana', lote: 0 }).ok, 'lote ja vendido');
});

await teste('vendinha: 3 lotes gratis, retirar devolve ao celeiro, sem dinheiro nao compra, log reproduz igual', () => {
  const log = [];
  const m = vilaCom('Ana', 'Bia');
  log.push(...[['entrar-0', 'ana', 'Ana'], ['entrar-1', 'bia', 'Bia']].map(([id, por, nome]) => ({ id, tipo: 'ENTRAR', por, nome, nomeHerdade: `Sitio ${nome}`, em: T0 })));
  const exec = (cmd) => { const c = agora(m, { ...cmd, id: `v${log.length}` }); const r = m.executar(c); if (r.ok) log.push(c); return r; };
  const ana = m.mundo.jogadores.ana, bia = m.mundo.jogadores.bia;
  for (let i = 0; i < 10; i++) { exec({ tipo: 'PLANTAR', por: 'ana', tile: i % 9, cultura: 'trigo' }); m.relogio += 3 * MIN; exec({ tipo: 'COLHER', por: 'ana', tile: i % 9 }); }
  ok(ana.colheita.trigo >= 8, 'tem trigo');
  for (let i = 0; i < 3; i++) ok(exec({ tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 2, preco: 4 }).ok);
  ok(!exec({ tipo: 'ANUNCIAR', por: 'ana', item: 'trigo', quantidade: 2, preco: 4 }).ok, 'quarto lote nao cabe');
  const antes = ana.colheita.trigo;
  ok(exec({ tipo: 'RETIRAR', por: 'ana', lote: 1 }).ok);
  igual(ana.colheita.trigo, antes + 2, 'retirou 2 de volta');
  igual(ana.vendinha.map((l) => l.id).join(','), '0,2');
  bia.inventario.moedas = 3;
  const r = exec({ tipo: 'COMPRAR', por: 'bia', de: 'ana', lote: 0 });
  ok(!r.ok && /faltam 1 G/.test(r.erro), r.erro);
  ok(exec({ tipo: 'VENDER', por: 'bia', cultura: 'trigo', quantidade: 1 }).ok === false, 'bia nao tem trigo');
  const m2 = Motor.reproduzir(log, OPC);
  m2.mundo.jogadores.bia.inventario.moedas = 3; // mesmo ajuste manual
  igual(m2.mundo.jogadores.ana.vendinha.length, 2, 'vendinha reproduzida');
  igual(m2.hash, m.hash, 'hash igual nas duas maquinas');
});

await teste('planta madura ha pouco nao vira pedido de ajuda; depois de 10 min vira', () => {
  const m = vilaCom('Ana', 'Bia');
  manda(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' });
  espera(m, 3 * MIN);
  ok(estaMadura(m.mundo.herdades.h00.tiles[0]), 'madura');
  igual(visao(m.mundo, 'bia').pedidosDeAjuda.length, 0, 'acabou de ficar pronta: e da Ana');
  espera(m, 10 * MIN);
  igual(visao(m.mundo, 'bia').pedidosDeAjuda.length, 1, 'passou do ponto: pede');
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
