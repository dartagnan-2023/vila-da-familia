import { Motor } from '../src/engine/motor.js';
import { visao, acoesPossiveis } from '../src/engine/apresentador.js';
import { novaChave, lerChave, extrairChave } from '../src/engine/convite.js';
import { TransporteLocal, Sessao } from '../src/net/transporte.js';
import { CULTURAS } from '../src/engine/conteudo.js';

let passou = 0, falhou = 0;
const teste = async (nome, fn) => {
  try { await fn(); passou++; console.log(`  ok   ${nome}`); }
  catch (e) { falhou++; console.log(`  FALHA ${nome}\n        ${e.message}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg ?? 'esperado verdadeiro'); };
const igual = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? ''} esperado ${b}, veio ${a}`); };

const OPC = { semente: 'familia-2026', nome: 'Vila do Riacho' };
const T0 = Date.parse('2026-09-15T08:00:00Z');
const H = 3600e3, MIN = 60e3;

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

/** Rega e espera o tempo da cultura (regando de novo se a agua nao bastar). */
function amadurece(m, por, tile) {
  const her = m.mundo.herdades[m.mundo.jogadores[por].herdade];
  let guarda = 0;
  while (!(her.tiles[tile].progresso >= CULTURAS[her.tiles[tile].cultura].horas * H) && guarda++ < 10) {
    m.executar(agora(m, { tipo: 'REGAR', por, tile, id: `rega-${por}-${tile}-${m.relogio}` }));
    espera(m, 4 * H);
  }
}

console.log('\nMotor da Vila\n');

await teste('entrar reserva uma herdade e aquece a harmonia', () => {
  const m = vilaCom('Ana');
  const j = m.mundo.jogadores.ana;
  igual(j.herdade, 'h00');
  igual(m.mundo.herdades.h00.dono, 'ana');
  igual(m.mundo.herdades.h00.nome, 'Sitio Ana');
  igual(m.mundo.comuns.harmonia, 53);
});

await teste('a vila lota e recusa o proximo', () => {
  const m = Motor.criar({ ...OPC, grade: { l: 1, a: 1 } });
  m.executar({ tipo: 'ENTRAR', por: 'a', nome: 'Ana' });
  const r = m.executar({ tipo: 'ENTRAR', por: 'b', nome: 'Bia' });
  ok(!r.ok && /lotada/.test(r.erro), r.erro);
});

await teste('plantar cobra semente, energia e recusa canteiro ocupado', () => {
  const m = vilaCom('Ana');
  igual(m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' }).ok, true);
  igual(m.mundo.jogadores.ana.inventario.moedas, 28);
  igual(m.mundo.jogadores.ana.energia, 9);
  const r = m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'milho' });
  ok(!r.ok && /ocupado/.test(r.erro), r.erro);
});

await teste('regar tira agua do bem comum e so repete quando a agua esta acabando', () => {
  const m = vilaCom('Ana');
  m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'abobora' });
  const antes = m.mundo.comuns.agua;
  m.executar(agora(m, { id: 'r1', tipo: 'REGAR', por: 'ana', tile: 0 }));
  ok(m.mundo.comuns.agua < antes, 'agua comum deveria cair');
  const r = m.executar(agora(m, { id: 'r2', tipo: 'REGAR', por: 'ana', tile: 0 }));
  ok(!r.ok && /molhada/.test(r.erro), r.erro);
  espera(m, 3 * H + 10 * MIN); // falta menos de 1h de agua: pode reforcar
  ok(m.executar(agora(m, { id: 'r3', tipo: 'REGAR', por: 'ana', tile: 0 })).ok, 'quase seca, pode regar');
});

await teste('lavoura regada amadurece em tempo real (trigo: 2h molhada)', () => {
  const m = vilaCom('Ana');
  m.executar(agora(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' }));
  m.executar(agora(m, { tipo: 'REGAR', por: 'ana', tile: 0 }));
  espera(m, 1 * H);
  ok(!m.executar(agora(m, { tipo: 'COLHER', por: 'ana', tile: 0 })).ok, 'com 1h ainda nao');
  igual(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].progresso, 50, 'metade do caminho');
  ok(/pronta em 1h/.test(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].rotulo), 'a tela diz quando fica pronta');
  espera(m, 1 * H);
  const t = m.mundo.herdades.h00.tiles[0];
  igual(t.progresso, 2 * H);
  const fertAntes = m.mundo.herdades.h00.fertilidade;
  const r = m.executar({ tipo: 'COLHER', por: 'ana', tile: 0 });
  ok(r.ok, r.erro);
  ok((m.mundo.jogadores.ana.colheita.trigo ?? 0) > 0, 'deveria ter trigo no celeiro');
  ok(m.mundo.herdades.h00.fertilidade < fertAntes, 'solo deveria desgastar');
  igual(m.mundo.herdades.h00.tiles[0], null);
});

await teste('sem agua a planta nao cresce e acumula estresse; a agua acaba em 4h', () => {
  const m = vilaCom('Ana');
  m.executar(agora(m, { tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'abobora' }));
  espera(m, 6 * H);
  const t = m.mundo.herdades.h00.tiles[0];
  igual(t.progresso, 0, 'seca nao cresce');
  igual(t.seco, 6 * H);
  igual(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].estresse, 2, '3h sem agua = 1 de estresse');
  m.executar(agora(m, { tipo: 'REGAR', por: 'ana', tile: 0 }));
  espera(m, 6 * H); // 4h de agua + 2h seca
  igual(m.mundo.herdades.h00.tiles[0].progresso, 4 * H, 'cresce so enquanto molhada');
  igual(m.mundo.herdades.h00.tiles[0].seco, 8 * H);
  ok(/sede/.test(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].rotulo));
});

await teste('chuva rega por voce: a planta cresce e regar e recusado', () => {
  const m = vilaCom('Ana');
  m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' });
  m.mundo.clima = 'chuva';
  const r = m.executar({ tipo: 'REGAR', por: 'ana', tile: 0 });
  ok(!r.ok && /chovendo/.test(r.erro), r.erro);
  igual(visao(m.mundo, 'ana').minhaHerdade.canteiros[0].sede, false, 'na chuva nao tem sede');
  // Um dia que nasce chuvoso molha todo canteiro ate o dia seguinte.
  let guarda = 0;
  do { espera(m, 24 * H); m.executar({ tipo: 'PASSAR_DIA', id: `d${m.mundo.tick + 1}`, em: m.relogio }); }
  while (!/chuva|tempestade/.test(m.mundo.clima) && guarda++ < 30);
  ok(guarda < 30, 'em 30 dias deveria chover');
  const t = m.mundo.herdades.h00.tiles[0];
  ok(t.regadoAte >= m.mundo.agora + 23 * H, 'a chuva molhou por 24h');
  m.executar(agora(m, { tipo: 'PLANTAR', por: 'ana', tile: 1, cultura: 'flor' }));
  ok(m.mundo.herdades.h00.tiles[1].regadoAte > m.mundo.agora, 'plantou na chuva: nasce molhada');
});

await teste('ajudar o vizinho: a colheita e dele, o laco e dos dois', () => {
  const m = vilaCom('Ana', 'Beto');
  m.executar(agora(m, { tipo: 'PLANTAR', por: 'beto', tile: 0, cultura: 'trigo' }));
  amadurece(m, 'beto', 0);
  const harmoniaAntes = m.mundo.comuns.harmonia;
  const r = m.executar(agora(m, { tipo: 'AJUDAR', por: 'ana', herdade: 'h10', tile: 0, acao: 'COLHER' }));
  ok(r.ok, r.erro);
  ok((m.mundo.jogadores.beto.colheita.trigo ?? 0) > 0, 'a colheita e do dono');
  igual(m.mundo.jogadores.ana.colheita.trigo, undefined);
  igual(m.mundo.jogadores.ana.reputacao.beto, 2);
  igual(m.mundo.jogadores.beto.reputacao.ana, 2);
  ok(m.mundo.comuns.harmonia > harmoniaAntes, 'harmonia deveria subir');
  igual(m.mundo.jogadores.ana.feitos.ajudas, 1);
  igual(m.mundo.jogadores.ana.energia, 8, 'ajudar custa a SUA energia');
  igual(m.mundo.jogadores.beto.energia, 10, 'e nao custa a energia de quem recebeu (ja regenerou)');
});

await teste('nao da para ajudar na propria terra nem mexer na do outro sem ser convidado', () => {
  const m = vilaCom('Ana', 'Beto');
  m.executar({ tipo: 'PLANTAR', por: 'beto', tile: 0, cultura: 'trigo' });
  ok(!m.executar({ tipo: 'AJUDAR', por: 'beto', herdade: 'h10', tile: 0, acao: 'REGAR' }).ok);
  const r = m.executar({ tipo: 'REGAR', por: 'ana', herdade: 'h10', tile: 0 });
  ok(!r.ok && /nao e sua/.test(r.erro), r.erro);
});

await teste('cortar derruba a mata comum; replantar devolve', () => {
  const m = vilaCom('Ana');
  m.executar({ id: 'c1', tipo: 'CORTAR', por: 'ana' });
  igual(m.mundo.comuns.floresta, 97);
  ok(m.mundo.jogadores.ana.inventario.madeira > 5);
  m.executar({ id: 'a1', tipo: 'PLANTAR_ARVORE', por: 'ana' });
  igual(m.mundo.comuns.floresta, 100);
});

await teste('colmeia do vizinho aumenta a colheita da herdade ao lado', () => {
  const semear = (m, por) => {
    m.executar(agora(m, { tipo: 'PLANTAR', por, tile: 0, cultura: 'trigo' }));
    amadurece(m, por, 0);
    return m.executar(agora(m, { tipo: 'COLHER', por, tile: 0 })).eventos.find((e) => e.tipo === 'COLHEU').dados.quantidade;
  };
  const semColmeia = semear(vilaCom('Ana', 'Beto'), 'ana');

  const m = vilaCom('Ana', 'Beto');
  m.mundo.jogadores.beto.inventario.madeira = 20;
  m.mundo.jogadores.beto.inventario.moedas = 100;
  ok(m.executar({ tipo: 'CONSTRUIR', por: 'beto', construcao: 'colmeia' }).ok);
  const comColmeia = semear(m, 'ana');
  ok(comColmeia > semColmeia, `esperado mais que ${semColmeia}, veio ${comColmeia}`);
});

await teste('obra coletiva concluida da energia para todo mundo', () => {
  const m = vilaCom('Ana', 'Beto');
  m.mundo.jogadores.ana.inventario.madeira = 40;
  m.mundo.jogadores.beto.inventario.pedra = 20;
  ok(m.executar({ tipo: 'DOAR', por: 'ana', obra: 'ponte', recursos: { madeira: 40 } }).ok);
  ok(!m.mundo.vila.concluidas.includes('energia'), 'ainda falta pedra');
  const r = m.executar({ tipo: 'DOAR', por: 'beto', obra: 'ponte', recursos: { pedra: 20 } });
  ok(r.eventos.some((e) => e.tipo === 'OBRA_CONCLUIDA'), 'a ponte deveria ficar pronta');
  m.passarDia();
  igual(m.mundo.jogadores.ana.energiaMax, 11);
  igual(m.mundo.jogadores.beto.energiaMax, 11);
});

await teste('rio seco vira presagio para a vila inteira', () => {
  const m = vilaCom('Ana');
  m.mundo.comuns.agua = 10;
  const r = m.passarDia();
  ok(r.eventos.some((e) => e.tipo === 'DESTINO' && e.dados.chave === 'seca'), 'esperava presagio de seca');
});

await teste('desavenca custa energia; harmonia alta devolve', () => {
  const m = vilaCom('Ana');
  m.mundo.comuns.harmonia = 5;
  m.passarDia();
  igual(m.mundo.jogadores.ana.energiaMax, 9);
  m.mundo.comuns.harmonia = 95;
  m.passarDia();
  igual(m.mundo.jogadores.ana.energiaMax, 11);
});

await teste('presente move recurso e aproxima', () => {
  const m = vilaCom('Ana', 'Beto');
  const r = m.executar({ tipo: 'PRESENTEAR', por: 'ana', para: 'beto', recurso: 'madeira', quantidade: 3 });
  ok(r.ok, r.erro);
  igual(m.mundo.jogadores.ana.inventario.madeira, 2);
  igual(m.mundo.jogadores.beto.inventario.madeira, 8);
  igual(m.mundo.jogadores.beto.reputacao.ana, 1);
  ok(!m.executar({ tipo: 'PRESENTEAR', por: 'ana', para: 'beto', recurso: 'madeira', quantidade: 99 }).ok);
});

await teste('mesmo log = mesmo mundo (determinismo)', () => {
  const log = [
    { id: '1', tipo: 'ENTRAR', por: 'ana', nome: 'Ana' },
    { id: '2', tipo: 'ENTRAR', por: 'beto', nome: 'Beto' },
    { id: '3', tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'milho' },
    { id: '4', tipo: 'REGAR', por: 'ana', tile: 0 },
    { id: '5', tipo: 'CORTAR', por: 'beto' },
    { id: 'd1', tipo: 'PASSAR_DIA' },
    { id: '6', tipo: 'AJUDAR', por: 'beto', herdade: 'h00', tile: 0, acao: 'REGAR' },
    { id: 'd2', tipo: 'PASSAR_DIA' },
  ];
  const a = Motor.reproduzir(log, OPC);
  const b = Motor.reproduzir(log, OPC);
  igual(a.hash, b.hash, 'hashes deveriam bater');
  const c = Motor.reproduzir(log, { ...OPC, semente: 'outra' });
  ok(a.hash !== c.hash, 'sementes diferentes deveriam divergir');
});

await teste('comando repetido nao conta duas vezes', () => {
  const m = vilaCom('Ana');
  const cmd = { id: 'unico', tipo: 'CORTAR', por: 'ana' };
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
  // minusculas, sem hifen, e O no lugar de 0: tudo isso a familia vai digitar
  const bagunçada = chave.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  igual(lerChave(bagunçada).chave, chave, 'deveria normalizar');
  ok(!lerChave(chave.slice(0, -1) + (chave.endsWith('A') ? 'B' : 'A')).valida, 'digito errado tem que barrar');
  ok(!lerChave('VILA-1234').valida);
  ok(novaChave() !== novaChave(), 'duas chaves iguais seria muito azar');
  const fixa = novaChave(() => 0.5);
  igual(fixa, novaChave(() => 0.5), 'com o mesmo gerador, a mesma chave');
});

await teste('acoesPossiveis: botao valido vem habilitado, invalido vem com motivo', () => {
  const m = vilaCom('Ana');
  const [cortar, regar, xis] = acoesPossiveis(m.mundo, 'ana', [{ tipo: 'CORTAR' }, { tipo: 'REGAR', tile: 0 }, { tipo: 'XIS' }]);
  ok(cortar.habilitado && cortar.motivo === null, `cortar deveria estar liberado: ${cortar.motivo}`);
  ok(!regar.habilitado && /nada plantado/.test(regar.motivo), regar.motivo);
  ok(!xis.habilitado && /desconhecido/.test(xis.motivo));
});

await teste('a visao entrega tudo mastigado para a tela', () => {
  const m = vilaCom('Ana', 'Beto');
  m.executar({ tipo: 'PLANTAR', por: 'beto', tile: 2, cultura: 'trigo' });
  const v = visao(m.mundo, 'ana');
  igual(v.hud.nome, 'Ana');
  igual(v.mapa.length, 9);
  igual(v.minhaHerdade.canteiros.length, 9);
  igual(v.comuns.length, 4);
  ok(v.pedidosDeAjuda.some((p) => p.herdade === 'h10'), 'deveria sugerir ajudar o Beto');
  ok(v.familia.find((f) => f.id === 'beto').laco === 'distantes');
  ok(v.feed.length > 0);
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
  await ana.executar({ tipo: 'REGAR', tile: 0 });
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
  ok(m.executar({ tipo: 'ABRACAR', por: 'ana', para: 'beto' }).ok);
  igual(m.mundo.comuns.harmonia, antes + 1);
  igual(m.mundo.jogadores.beto.reputacao.ana, 1);
  igual(m.mundo.jogadores.ana.energia, 10, 'abraco nao custa energia');
  const r = m.executar({ tipo: 'ABRACAR', por: 'ana', para: 'beto' });
  ok(!r.ok && /hoje/.test(r.erro), r.erro);
  m.passarDia();
  ok(m.executar({ tipo: 'ABRACAR', por: 'ana', para: 'beto' }).ok, 'amanha pode de novo');

  ok(m.executar({ tipo: 'RECADO', por: 'beto', texto: 'quem rega minha horta amanha?' }).ok);
  ok(m.mundo.feed.at(-1).texto.includes('quem rega'), 'recado deveria entrar no feed');
  ok(!m.executar({ tipo: 'RECADO', por: 'beto', texto: '   ' }).ok);
  ok(!m.executar({ tipo: 'RECADO', por: 'beto', texto: 'x'.repeat(200) }).ok);
});

await teste('a visao traduz o impacto de cada atitude para a tela', () => {
  const m = vilaCom('Ana', 'Beto');
  m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 0, cultura: 'trigo' });
  m.executar({ tipo: 'REGAR', por: 'ana', tile: 0 });
  const v = visao(m.mundo, 'ana');
  const rega = v.feed.find((l) => l.tipo === 'REGOU');
  igual(rega.impacto, '−1 agua', 'o feed precisa dizer o que a acao tirou do comum');
  igual(rega.autor, 'Ana');
  igual(rega.quando, 'hoje');
  ok(v.hud.nivel >= 1 && v.hud.xpMax === 8);
  igual(v.sinergia.valor, m.mundo.comuns.harmonia);
  igual(v.missao.chave, 'ponte');
  ok(v.missao.chamada.includes('40 de madeira'), v.missao.chamada);
  ok(v.hud.terra > 0);
});

await teste('chave sobrevive ao WhatsApp: travessao, aspas, texto em volta, link', () => {
  const chave = novaChave();
  igual(lerChave(chave.replace(/-/g, '–')).chave, chave, 'travessao do iOS');
  igual(lerChave(`"${chave}"`).chave, chave, 'aspas');
  igual(extrairChave(`oi mae, entra na vila com ${chave.toLowerCase()} beijo`), chave, 'no meio da mensagem');
  igual(extrairChave(`https://x.github.io/vila/web/?chave=${chave}`), chave, 'dentro do link');
  igual(extrairChave('Vila do Riacho'), null, 'nome de vila nao e chave');
});

await teste('comprar canteiro: a herdade cresce ate 12, o preco sobe', () => {
  const m = vilaCom('Ana');
  m.mundo.jogadores.ana.inventario.moedas = 50;
  let r = m.executar({ tipo: 'COMPRAR_CANTEIRO', por: 'ana' });
  ok(!r.ok && /60 moedas/.test(r.erro), r.erro);
  m.mundo.jogadores.ana.inventario.moedas = 300;
  ok(m.executar({ tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  igual(m.mundo.herdades.h00.tiles.length, 10);
  igual(m.mundo.jogadores.ana.inventario.moedas, 240);
  ok(m.executar({ tipo: 'PLANTAR', por: 'ana', tile: 9, cultura: 'flor' }).ok, 'planta no canteiro novo');
  ok(m.executar({ tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  ok(m.executar({ tipo: 'COMPRAR_CANTEIRO', por: 'ana' }).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, 240 - 1 - 90 - 120, 'menos a semente da flor');
  r = m.executar({ tipo: 'COMPRAR_CANTEIRO', por: 'ana' });
  ok(!r.ok && /maximo/.test(r.erro), r.erro);
  igual(visao(m.mundo, 'ana').minhaHerdade.canteiros.length, 12);
});

await teste('energia volta 1 ponto a cada 10 min, ate o maximo', () => {
  const m = vilaCom('Ana');
  m.executar(agora(m, { tipo: 'CORTAR', por: 'ana' }));
  m.executar(agora(m, { tipo: 'CORTAR', por: 'ana' }));
  igual(m.mundo.jogadores.ana.energia, 6);
  espera(m, 25 * MIN);
  igual(m.mundo.jogadores.ana.energia, 8);
  igual(visao(m.mundo, 'ana').hud.proximaEnergiaEm, 5 * MIN, 'a tela sabe quando vem o proximo');
  espera(m, 3 * H);
  igual(m.mundo.jogadores.ana.energia, 10, 'nao passa do maximo');
  igual(m.mundo.jogadores.ana.regenResto, 0);
  // a tela projeta sem esperar comando
  m.executar(agora(m, { tipo: 'CORTAR', por: 'ana' }));
  igual(visao(m.mundo, 'ana', m.relogio + 10 * MIN).hud.energia, 9, 'projecao 10 min depois');
  igual(m.mundo.jogadores.ana.energia, 8, 'sem mexer no mundo de verdade');
});

await teste('missoes do dia: 3 iguais para todos, premio uma vez por dia, zera a meia-noite', () => {
  const m = vilaCom('Ana', 'Beto');
  const v = visao(m.mundo, 'ana');
  igual(v.missoesDoDia.length, 3);
  const cortes = v.missoesDoDia.find((x) => x.texto.includes('lenha'));
  const plantios = v.missoesDoDia.find((x) => x.texto.includes('Plante'));
  const alvo = cortes ?? plantios;
  ok(alvo, 'esperava uma missao de lenha ou de plantio hoje: ' + v.missoesDoDia.map((x) => x.texto).join(' / '));
  ok(!m.executar(agora(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice })).ok, 'ainda nao cumpriu');
  for (let i = 0; i < alvo.meta; i++) {
    m.executar(agora(m, cortes ? { tipo: 'CORTAR', por: 'ana' } : { tipo: 'PLANTAR', por: 'ana', tile: i, cultura: 'flor' }));
    espera(m, 30 * MIN);
  }
  ok(visao(m.mundo, 'ana').missoesDoDia[alvo.indice].cumprida);
  const moedas = m.mundo.jogadores.ana.inventario.moedas;
  ok(m.executar(agora(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice })).ok);
  igual(m.mundo.jogadores.ana.inventario.moedas, moedas + (alvo.premio.moedas ?? 0));
  ok(!m.executar(agora(m, { tipo: 'CUMPRIR_MISSAO', por: 'ana', indice: alvo.indice })).ok, 'nao recebe duas vezes');
  ok(!m.executar(agora(m, { tipo: 'CUMPRIR_MISSAO', por: 'beto', indice: alvo.indice })).ok, 'Beto nao fez nada');
  m.executar({ tipo: 'PASSAR_DIA', id: 'd1', em: m.relogio });
  igual(m.mundo.jogadores.ana.missoesFeitas.length, 0, 'novo dia, novas missoes');
  igual(m.mundo.jogadores.ana.hoje.cortes, 0);
});

await teste('demolir libera a vaga e devolve metade do material', () => {
  const m = vilaCom('Ana');
  m.mundo.jogadores.ana.inventario.madeira = 40;
  m.mundo.jogadores.ana.inventario.moedas = 200;
  for (const c of ['poco', 'colmeia', 'composteira']) ok(m.executar({ tipo: 'CONSTRUIR', por: 'ana', construcao: c }).ok);
  ok(!m.executar({ tipo: 'CONSTRUIR', por: 'ana', construcao: 'celeiro' }).ok, 'cheia');
  const madeira = m.mundo.jogadores.ana.inventario.madeira;
  m.passarDia(); // energia
  const r = m.executar({ tipo: 'DEMOLIR', por: 'ana', construcao: 'colmeia' });
  ok(r.ok, r.erro);
  igual(m.mundo.jogadores.ana.inventario.madeira, madeira + 3, 'colmeia custa 6 de madeira, volta 3');
  ok(!m.mundo.herdades.h00.construcoes.includes('poliniza'));
  ok(m.executar({ tipo: 'CONSTRUIR', por: 'ana', construcao: 'celeiro' }).ok, 'abriu vaga');
  ok(!m.executar({ tipo: 'DEMOLIR', por: 'ana', construcao: 'forja' }).ok, 'nao tem forja');
});

await teste('o calendario vem do log: primeira data funda, PASSAR_DIA avanca', async () => {
  const { diasPendentes, comandoDoDia, dataLocal } = await import('../src/engine/calendario.js');
  const m = Motor.criar(OPC);
  m.executar({ tipo: 'ENTRAR', por: 'ana', nome: 'Ana', data: '2026-09-10' });
  igual(m.mundo.dataDoDia, '2026-09-10', 'fundacao');
  const velha = vilaCom('Beto');
  igual(velha.mundo.dataDoDia, null, 'vila antiga nao tem data');
  ok(velha.executar({ tipo: 'ACORDAR', por: 'beto', data: '2026-09-11' }).ok);
  igual(velha.mundo.dataDoDia, '2026-09-11', 'ACORDAR carimba sem mexer em nada');
  igual(velha.mundo.tick, 0);
  m.executar({ tipo: 'CORTAR', por: 'ana', data: '2026-09-12' });
  igual(m.mundo.dataDoDia, '2026-09-10', 'comando comum nao avanca o calendario');
  igual(diasPendentes('2026-09-10', '2026-09-10').length, 0);
  igual(diasPendentes('2026-09-10', '2026-09-12').join(','), '2026-09-11,2026-09-12');
  const longe = diasPendentes('2026-08-01', '2026-09-12', 7);
  igual(longe.length, 7, 'no maximo 7 dias de uma vez');
  igual(longe.at(-1), '2026-09-12', 'e o ultimo cai em hoje');
  for (const d of diasPendentes(m.mundo.dataDoDia, '2026-09-12')) m.executar(comandoDoDia(d));
  igual(m.mundo.tick, 2);
  igual(m.mundo.dataDoDia, '2026-09-12');
  igual(m.executar(comandoDoDia('2026-09-12')).repetido, true, 'mesmo dia duas vezes = ignorado');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dataLocal()));
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
