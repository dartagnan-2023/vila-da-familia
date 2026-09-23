// O Pipo, morador da vila movido por IA.
//
//   npm run pipo -- VILA-XXXXX-XXXXX            uma rodada e sai
//   npm run pipo -- VILA-XXXXX-XXXXX --vigiar   fica olhando (de 15 em 15 min)
//   ... --seco                                   decide e mostra, sem mandar nada
//
// Ele joga pelas MESMAS regras: cada decisão vira comando, o motor valida, e o
// comando entra no mesmo log que o da família. Sem recurso de graça, sem atalho.
import Anthropic from '@anthropic-ai/sdk';
import { abrirVila, enviar } from './vila-remota.mjs';
import { visao } from '../src/engine/apresentador.js';
import { projetar, estaMadura } from '../src/engine/tempo.js';
import { EMOCOES } from '../src/engine/conteudo.js';

const args = process.argv.slice(2);
const chave = args.find((a) => a.startsWith('VILA-'));
const vigiar = args.includes('--vigiar');
const seco = args.includes('--seco');
const soOlhar = args.includes('--briefing');   // mostra o que o Pipo ve e sai
const NOME_PIPO = 'Pipo';
const INTERVALO = 15 * 60e3;

if (!chave) {
  console.error('uso: npm run pipo -- VILA-XXXXX-XXXXX [--vigiar] [--seco]');
  process.exit(1);
}

let cliente = null;
try { cliente = new Anthropic(); } catch { /* sem credencial: so o briefing funciona */ }

// As ações que o Pipo pode tomar. São os comandos do jogo, nada além deles.
const FERRAMENTAS = [
  {
    name: 'ajudar',
    description: 'Cuidar de uma planta que está pedindo (sede/praga/mato) ou colher uma que passou do ponto, na horta de um parente. A colheita vai pro celeiro dele. É a ação mais generosa do jogo.',
    input_schema: {
      type: 'object',
      properties: {
        herdade: { type: 'string', description: 'id da herdade, ex: h01' },
        tile: { type: 'integer', description: 'número do canteiro' },
        acao: { type: 'string', enum: ['CUIDAR', 'COLHER'] },
        porque: { type: 'string', description: 'uma linha: por que agora' },
      },
      required: ['herdade', 'tile', 'acao', 'porque'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'falar',
    description: 'Mandar um recado. Sem "para", vai pro mural e todo mundo lê. Com "para", é conversa particular. Fale como gente: curto, específico, no assunto do momento. Nunca genérico.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'até 140 caracteres, em português do Brasil' },
        para: { type: 'string', description: 'id do familiar; vazio = mural' },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'presentear',
    description: 'Dar do seu celeiro (ou madeira/pedra) pra alguém que está precisando — quem está sem semente, sem madeira pra obra, ou com pedido travado.',
    input_schema: {
      type: 'object',
      properties: {
        para: { type: 'string' },
        recurso: { type: 'string', enum: ['colheita', 'madeira', 'pedra'] },
        item: { type: 'string', description: 'se recurso=colheita, qual (trigo, milho...)' },
        quantidade: { type: 'integer' },
        porque: { type: 'string' },
      },
      required: ['para', 'recurso', 'quantidade', 'porque'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'abracar',
    description: 'Abraço: +1 de harmonia pra vila toda. Use quando alguém fez algo bonito ou está sumido.',
    input_schema: {
      type: 'object',
      properties: { para: { type: 'string' }, porque: { type: 'string' } },
      required: ['para', 'porque'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'doar',
    description: 'Doar madeira/pedra/moedas pra obra coletiva em andamento.',
    input_schema: {
      type: 'object',
      properties: {
        obra: { type: 'string' },
        recurso: { type: 'string', enum: ['madeira', 'pedra', 'moedas'] },
        quantidade: { type: 'integer' },
        porque: { type: 'string' },
      },
      required: ['obra', 'recurso', 'quantidade', 'porque'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'anunciar',
    description: 'Pôr algo do celeiro na vendinha por um preço, quando alguém da família precisa daquilo pra fechar um pedido.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string' }, quantidade: { type: 'integer' }, preco: { type: 'integer' }, porque: { type: 'string' },
      },
      required: ['item', 'quantidade', 'preco', 'porque'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'nada',
    description: 'Não fazer nada agora. Use quando a vila está em paz ou quando qualquer ação seria barulho. É uma resposta legítima e comum.',
    input_schema: {
      type: 'object',
      properties: { porque: { type: 'string' } },
      required: ['porque'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const PERSONA = `Você é o Pipo, morador da Vila Raízes — uma vila de faz de conta onde uma família de verdade (pai, irmãs, primos) cuida de hortas juntos pelo celular.

Você não é um assistente, é um vizinho. Mora na herdade do Pipo, planta, colhe e ajuda como qualquer um. Joga pelas mesmas regras: só faz o que uma pessoa faria, com o que tem no celeiro.

Seu papel na vila:
- Ser a mão que aparece quando falta gente: regar a planta que alguém esqueceu, colher o que ia passar do ponto, dar semente pra quem travou.
- Ser quem puxa conversa: notar quem sumiu, quem chegou, quem fez algo bonito. Falar curto, do jeito de quem mora ali.
- Ser a ponte entre a família e quem constrói o jogo: quando alguém reclama ou elogia (as reações 😍😂😐😤🤯💡), você responde de dentro do jogo, como se aquilo fosse a vida da vila.

Como falar: português do Brasil, familiar, direto, sem emoji em excesso, sem "olá!" nem "estou aqui para ajudar". Nada de linguagem de robô ou de atendimento. Fale do que está acontecendo AGORA, com nome e detalhe — "Juliana, teu arroz tá com sede há meia hora, molhei ele" vale mais que "posso ajudar?".

Regras de bom senso:
- No máximo 3 ações por rodada, e quase sempre menos. Silêncio é melhor que barulho.
- Não repita o que você já disse nas últimas mensagens.
- Ajude quem está longe de aparecer; quem acabou de colher não precisa de você.
- Planta madura há pouco é do dono — só colha pelo outro se estiver passando do ponto.
- Se a vila está em paz e ninguém precisa de nada, chame "nada".`;

const min = (ms) => (ms >= 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 1000)}s`);

/** O que o Pipo vê ao olhar a vila: pouco texto, muita informação. */
function briefing(motor, euId) {
  const agora = Date.now();
  const m = projetar(motor.mundo, agora);
  const v = visao(motor.mundo, euId, agora);
  const linhas = [];

  linhas.push(`VILA ${m.nome} — ${m.estacao}, dia ${m.diaDaEstacao}, ${m.clima}. Bens de todos: água ${m.comuns.agua}, mata ${m.comuns.floresta}, terra ${m.comuns.solo}, harmonia ${m.comuns.harmonia} (crescimento ${v.vila.velocidade}%).`);

  linhas.push('\nFAMÍLIA:');
  for (const p of Object.values(m.jogadores)) {
    const her = m.herdades[p.herdade];
    const plantado = her.tiles.filter(Boolean).length, vazio = her.tiles.length - plantado;
    const pedindo = her.tiles.filter((t) => t?.problema).length;
    const maduro = her.tiles.filter((t) => t && estaMadura(t)).length;
    const ultimo = [...m.feed].reverse().find((l) => l.ator === p.id);
    const quando = ultimo ? (m.tick - ultimo.tick <= 0 ? 'hoje' : `há ${m.tick - ultimo.tick} dias`) : 'nunca agiu';
    linhas.push(`- ${p.nome} (${p.id}, herdade ${her.id}) nível ${Math.max(1, Math.floor(Math.sqrt(p.xp / 5)))}, ${p.inventario.moedas} moedas. Horta: ${plantado} plantados (${maduro} maduros, ${pedindo} pedindo socorro), ${vazio} vazios. Última vez que agiu: ${quando}.${p.id === euId ? '  <<< VOCÊ' : ''}`);
  }

  if (v.pedidosDeAjuda.length) {
    linhas.push('\nPRECISANDO DE MÃO AGORA (você pode agir nestes):');
    for (const p of v.pedidosDeAjuda) linhas.push(`- herdade ${p.herdade} canteiro ${p.tile}: ${p.motivo} → ${p.acao}`);
  } else linhas.push('\nNinguém está com planta pedindo socorro agora.');

  const eu = m.jogadores[euId];
  linhas.push(`\nSEU CELEIRO: ${Object.entries(eu.colheita).map(([k, q]) => `${q} ${k}`).join(', ') || 'vazio'}. Madeira ${eu.inventario.madeira}, pedra ${eu.inventario.pedra}, moedas ${eu.inventario.moedas}.`);
  linhas.push(`SUA HORTA: ${m.herdades[eu.herdade].tiles.map((t, i) => t ? `${i}:${t.cultura}${t.problema ? '(pede ' + t.problema + ')' : estaMadura(t) ? '(pronto)' : ''}` : `${i}:vazio`).join(' ')}`);

  if (v.missao) linhas.push(`\nOBRA DA VILA: ${v.missao.nome}, ${v.missao.pct}% — ${v.missao.chamada}`);
  else linhas.push('\nOBRA DA VILA: todas prontas.');

  const sentimentos = (m.sentimentos ?? []).slice(-8);
  if (sentimentos.length) {
    linhas.push('\nO QUE A FAMÍLIA ANDOU SENTINDO (responda a isso se couber):');
    for (const s of sentimentos) {
      linhas.push(`- ${m.jogadores[s.quem]?.nome ?? s.quem}: ${EMOCOES[s.emocao]?.icone} ${EMOCOES[s.emocao]?.nome}${s.sobre ? ` sobre ${s.sobre}` : ''}${s.texto ? ` — "${s.texto}"` : ''}`);
    }
  }

  // O mural cru repete muito ("plantou trigo" x12); junta o que é igual.
  linhas.push('\nÚLTIMAS COISAS QUE ACONTECERAM:');
  const juntas = [];
  for (const l of m.feed.slice(-40)) {
    const ult = juntas.at(-1);
    if (ult && ult.texto === l.texto) ult.n++;
    else juntas.push({ texto: l.texto, n: 1 });
  }
  for (const j of juntas.slice(-14)) linhas.push(`- ${j.texto}${j.n > 1 ? ` (x${j.n})` : ''}`);

  const meus = m.feed.filter((l) => l.ator === euId && l.tipo === 'RECADO').slice(-4);
  if (meus.length) {
    linhas.push('\nO QUE VOCÊ JÁ DISSE (não repita):');
    for (const l of meus) linhas.push(`- ${l.texto}`);
  }
  return linhas.join('\n');
}

const PARA_COMANDO = {
  ajudar: (a) => ({ tipo: 'AJUDAR', herdade: a.herdade, tile: a.tile, acao: a.acao }),
  falar: (a) => ({ tipo: 'RECADO', texto: a.texto, para: a.para || undefined }),
  presentear: (a) => ({ tipo: 'PRESENTEAR', para: a.para, recurso: a.recurso, item: a.item, quantidade: a.quantidade }),
  abracar: (a) => ({ tipo: 'ABRACAR', para: a.para }),
  doar: (a) => ({ tipo: 'DOAR', obra: a.obra, recursos: { [a.recurso]: a.quantidade } }),
  anunciar: (a) => ({ tipo: 'ANUNCIAR', item: a.item, quantidade: a.quantidade, preco: a.preco }),
};

async function rodada() {
  const { vila, motor } = await abrirVila(chave);
  const eu = Object.values(motor.mundo.jogadores).find((p) => p.nome === NOME_PIPO);
  if (!eu) {
    console.error(`O ${NOME_PIPO} ainda não entrou nessa vila. Abra o jogo com a chave e entre com esse nome uma vez.`);
    return;
  }

  const texto = briefing(motor, eu.id);
  console.log(`\n${'—'.repeat(70)}\n${new Date().toLocaleString('pt-BR')} · ${vila.nome}\n${'—'.repeat(70)}`);
  if (soOlhar) return console.log(texto);
  if (!cliente || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    console.log(texto);
    console.log('\n⚠ Sem credencial da API — o Pipo não consegue pensar.\n  Windows:   $env:ANTHROPIC_API_KEY = "sua-chave"\n  Linux/Mac: export ANTHROPIC_API_KEY=sua-chave\nA chave fica no seu computador; o jogo publicado nunca a vê.');
    return;
  }

  const resposta = await cliente.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    system: [{ type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    tools: FERRAMENTAS,
    messages: [{ role: 'user', content: `Você acabou de olhar a vila. Decida o que fazer agora.\n\n${texto}` }],
  });

  if (resposta.stop_reason === 'refusal') {
    console.log('(o modelo recusou esta rodada)', resposta.stop_details);
    return;
  }

  for (const bloco of resposta.content) {
    if (bloco.type === 'text' && bloco.text.trim()) console.log(`\n💭 ${bloco.text.trim()}`);
    if (bloco.type !== 'tool_use') continue;
    const a = bloco.input;
    if (bloco.name === 'nada') { console.log(`\n😴 nada a fazer — ${a.porque}`); continue; }
    const cmd = PARA_COMANDO[bloco.name]?.(a);
    if (!cmd) continue;
    console.log(`\n▶ ${bloco.name}: ${a.porque ?? a.texto ?? ''}`);
    if (seco) { console.log(`   (seco) ${JSON.stringify(cmd)}`); continue; }
    const r = await enviar(vila, motor, { ...cmd, por: eu.id, data: new Date().toISOString().slice(0, 10) });
    console.log(r.ok ? `   ✓ ${r.eventos?.[0]?.texto ?? 'feito'}` : `   ✗ ${r.erro}`);
  }
}

await rodada();
if (vigiar) {
  console.log(`\n(vigiando: nova olhada a cada ${INTERVALO / 60e3} min — Ctrl+C pra parar)`);
  setInterval(() => rodada().catch((e) => console.error('erro na rodada:', e.message)), INTERVALO);
}
