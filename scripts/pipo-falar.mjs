// A boca do Pipo: manda o que ele diz ou dá, de fora do jogo. Zero API — quem
// pensa a frase é quem chama (uma pessoa, ou o Claude do app pela assinatura).
//
//   npm run pipo:falar -- CHAVE recado "Juliana, teu arroz tava com sede, molhei"
//   npm run pipo:falar -- CHAVE recado "..." --para juliana
//   npm run pipo:falar -- CHAVE abraco --para jessica
//   npm run pipo:falar -- CHAVE presente --para lelecs --item trigo --qtd 5
//
// O nome depois de --para pode ser o primeiro nome (ele acha o id sozinho).
import { abrirVila, enviar } from './vila-remota.mjs';

const args = process.argv.slice(2);
const chave = args.find((a) => a.startsWith('VILA-'));
const acao = args.find((a) => ['recado', 'abraco', 'presente'].includes(a));
const opcao = (nome, padrao = null) => { const i = args.indexOf(`--${nome}`); return i >= 0 ? args[i + 1] : padrao; };
const depois = args.slice(args.indexOf(acao) + 1);
const texto = depois.find((a, i) => !a.startsWith('--') && !depois[i - 1]?.startsWith('--'));

if (!chave || !acao) {
  console.error('uso: npm run pipo:falar -- VILA-XXXXX-XXXXX recado "texto" [--para nome]');
  console.error('     npm run pipo:falar -- VILA-XXXXX-XXXXX abraco --para nome');
  console.error('     npm run pipo:falar -- VILA-XXXXX-XXXXX presente --para nome --item trigo --qtd 5');
  process.exit(1);
}

const { vila, motor } = await abrirVila(chave);
const eu = Object.values(motor.mundo.jogadores).find((p) => p.nome === 'Pipo');
if (!eu) { console.error('O Pipo não está nessa vila.'); process.exit(1); }

const acha = (nome) => {
  if (!nome) return undefined;
  const p = Object.values(motor.mundo.jogadores).find((x) => x.id === nome || x.nome.toLowerCase().startsWith(String(nome).toLowerCase()));
  if (!p) { console.error(`não achei "${nome}" na vila. Tem: ${Object.values(motor.mundo.jogadores).map((x) => x.nome).join(', ')}`); process.exit(1); }
  return p.id;
};

const para = acha(opcao('para'));
const cmds = {
  recado: () => ({ tipo: 'RECADO', texto, para }),
  abraco: () => ({ tipo: 'ABRACAR', para }),
  presente: () => ({ tipo: 'PRESENTEAR', para, recurso: opcao('recurso', 'colheita'), item: opcao('item'), quantidade: Number(opcao('qtd', 3)) }),
};
if (acao === 'recado' && !texto) { console.error('faltou o texto do recado'); process.exit(1); }

const r = await enviar(vila, motor, { ...cmds[acao](), por: eu.id, data: new Date().toISOString().slice(0, 10) });
console.log(r.ok ? `✓ ${r.eventos?.[0]?.texto ?? 'feito'}` : `✗ ${r.erro}`);
