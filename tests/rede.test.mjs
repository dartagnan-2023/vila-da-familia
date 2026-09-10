import { Motor } from '../src/engine/motor.js';
import { Sessao } from '../src/net/transporte.js';
import { TransporteSupabase } from '../src/net/supabase.js';

// ---------------------------------------------------------------------------
// Um Supabase de mentira, fiel ao que importa: ordem contigua por vila,
// reenvio devolve a mesma ordem, e um Realtime que pode perder ou atrasar
// broadcasts. Se o transporte sobrevive a isto, sobrevive a internet da vovo.
// ---------------------------------------------------------------------------

function servidorFalso({ perdeBroadcast = () => false } = {}) {
  const vilas = {};
  const canais = new Map(); // nome -> Set de ouvintes

  const client = {
    async rpc(fn, args) {
      const vila = (vilas[args.p_vila] ??= { proxima: 1, comandos: [] });
      if (fn === 'ler_comandos') {
        return { data: vila.comandos.filter((c) => c.ordem > (args.p_desde ?? 0)).slice(0, 2000)
          .map((c) => ({ ordem: c.ordem, id: c.id, dados: c.dados })) };
      }
      if (fn === 'enviar_comando') {
        const cmd = args.p_cmd;
        const existe = vila.comandos.find((c) => c.id === cmd.id);
        if (existe) return { data: existe.ordem };
        const { ordem: _, ...dados } = cmd;
        const linha = { ordem: vila.proxima++, id: cmd.id, dados };
        vila.comandos.push(linha);
        return { data: linha.ordem };
      }
      return { error: { message: `rpc desconhecida ${fn}` } };
    },
    channel(nome) {
      const ouvintes = canais.get(nome) ?? canais.set(nome, new Set()).get(nome);
      let meu = null;
      const canal = {
        on(_tipo, _filtro, fn) { meu = fn; return canal; },
        subscribe() { ouvintes.add(meu); return canal; },
        async send({ payload }) {
          for (const fn of ouvintes) {
            if (fn === meu || perdeBroadcast(payload)) continue;
            setTimeout(() => fn({ payload }), 0);
          }
        },
      };
      return canal;
    },
    removeChannel(canal) { for (const s of canais.values()) s.delete(canal); },
  };
  return { client, vilas };
}

const tique = () => new Promise((r) => setTimeout(r, 5));
const OPC = { semente: 'rede-2026', nome: 'Vila da Rede' };

let passou = 0, falhou = 0;
const teste = async (nome, fn) => {
  try { await fn(); passou++; console.log(`  ok   ${nome}`); }
  catch (e) { falhou++; console.log(`  FALHA ${nome}\n        ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m ?? 'esperado verdadeiro'); };
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ''} esperado ${b}, veio ${a}`); };

function casa(client, vilaId, quem) {
  const motor = Motor.criar(OPC);
  const transporte = new TransporteSupabase({ client, vilaId, intervaloPoll: 1e9 });
  const sessao = new Sessao({ motor, transporte, jogadorId: quem });
  return { motor, transporte, sessao };
}

console.log('\nTransporte entre casas\n');

await teste('duas casas, broadcast normal: mesmo hash', async () => {
  const { client } = servidorFalso();
  const a = casa(client, 'v1', 'ana'), b = casa(client, 'v1', 'beto');
  await a.sessao.sincronizar(); await b.sessao.sincronizar();
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await b.sessao.executar({ tipo: 'ENTRAR', nome: 'Beto' });
  await a.sessao.executar({ tipo: 'CORTAR' });
  await tique();
  igual(a.motor.hash, b.motor.hash);
  igual(a.transporte.ultima, 3);
});

await teste('quem envia ve o proprio comando aplicado antes do await voltar', async () => {
  const { client } = servidorFalso();
  const a = casa(client, 'v1', 'ana');
  await a.sessao.sincronizar();
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  ok(a.motor.mundo.jogadores.ana, 'o ENTRAR ja deveria estar no mundo');
});

await teste('ordem e por vila: a segunda vila comeca do 1', async () => {
  const { client } = servidorFalso();
  const a = casa(client, 'v1', 'ana'), c = casa(client, 'v2', 'carla');
  await a.sessao.sincronizar(); await c.sessao.sincronizar();
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await a.sessao.executar({ tipo: 'CORTAR' });
  await c.sessao.executar({ tipo: 'ENTRAR', nome: 'Carla' });
  igual(c.transporte.ultima, 1);
  ok(c.motor.mundo.jogadores.carla, 'Carla deveria estar na vila 2');
  ok(!c.motor.mundo.jogadores.ana, 'Ana nao e da vila 2');
});

await teste('broadcast perdido: o poll (recuperar) traz o que faltou', async () => {
  let perde = true;
  const { client } = servidorFalso({ perdeBroadcast: () => perde });
  const a = casa(client, 'v1', 'ana'), b = casa(client, 'v1', 'beto');
  await a.sessao.sincronizar(); await b.sessao.sincronizar();
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await tique();
  ok(!b.motor.mundo.jogadores.ana, 'sem broadcast, Beto ainda nao sabe');
  await b.transporte.recuperar();
  ok(b.motor.mundo.jogadores.ana, 'depois do poll, sabe');
  igual(a.motor.hash, b.motor.hash);
  perde = false;
});

await teste('broadcast que pula um numero manda buscar o buraco no banco', async () => {
  let perde = false;
  const { client } = servidorFalso({ perdeBroadcast: () => perde });
  const a = casa(client, 'v1', 'ana'), b = casa(client, 'v1', 'beto');
  await a.sessao.sincronizar(); await b.sessao.sincronizar();
  perde = true;  // o ENTRAR da Ana se perde no caminho
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  perde = false; // o CORTAR chega: ordem 2 sem a 1
  await a.sessao.executar({ tipo: 'CORTAR' });
  await tique(); await tique();
  igual(b.transporte.ultima, 2, 'Beto deveria ter recuperado a 1 e aplicado a 2');
  igual(a.motor.hash, b.motor.hash);
});

await teste('quem chega depois reproduz o log e alcanca', async () => {
  const { client } = servidorFalso();
  const a = casa(client, 'v1', 'ana');
  await a.sessao.sincronizar();
  await a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' });
  await a.sessao.executar({ tipo: 'PLANTAR', tile: 0, cultura: 'flor' });
  await a.sessao.executar({ tipo: 'PASSAR_DIA', id: 'dia-1' });
  const vo = casa(client, 'v1', 'vo');
  await vo.sessao.sincronizar();
  igual(vo.motor.hash, a.motor.hash);
  igual(vo.motor.mundo.tick, 1);
});

await teste('reenvio do mesmo comando nao duplica nem gasta ordem', async () => {
  const { client, vilas } = servidorFalso();
  const a = casa(client, 'v1', 'ana');
  await a.sessao.sincronizar();
  const cmd = { tipo: 'ENTRAR', nome: 'Ana', id: 'fixo', por: 'ana' };
  const r1 = await a.transporte.enviar(cmd);
  const r2 = await a.transporte.enviar(cmd);
  igual(r1.ordem, r2.ordem);
  igual(vilas.v1.comandos.length, 1);
  igual(Object.keys(a.motor.mundo.jogadores).length, 1);
});

await teste('duas casas mandando ao mesmo tempo terminam iguais', async () => {
  const { client } = servidorFalso();
  const a = casa(client, 'v1', 'ana'), b = casa(client, 'v1', 'beto');
  await a.sessao.sincronizar(); await b.sessao.sincronizar();
  await Promise.all([
    a.sessao.executar({ tipo: 'ENTRAR', nome: 'Ana' }),
    b.sessao.executar({ tipo: 'ENTRAR', nome: 'Beto' }),
  ]);
  await Promise.all([
    a.sessao.executar({ tipo: 'CORTAR' }),
    b.sessao.executar({ tipo: 'MINERAR' }),
    a.sessao.executar({ tipo: 'CORTAR' }),
  ]);
  await tique(); await tique();
  igual(a.motor.hash, b.motor.hash, 'concorrencia nao pode dessincronizar');
  igual(a.transporte.ultima, 5);
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
