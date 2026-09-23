// Acesso à vila de fora do navegador: ler o log e mandar comando, pelas mesmas
// 4 funções públicas que o jogo usa. Nada de chave secreta — só a chave da vila.
import { readFileSync } from 'node:fs';
import { Motor } from '../src/engine/motor.js';

const cfg = readFileSync(new URL('../web/config.js', import.meta.url), 'utf-8');
const pega = (nome) => cfg.match(new RegExp(`${nome}\\s*=\\s*['"]([^'"]+)`))?.[1];
export const URL_SB = pega('SUPABASE_URL'), KEY_SB = pega('SUPABASE_KEY');

export async function rpc(fn, corpo) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY_SB, Authorization: `Bearer ${KEY_SB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Abre a vila pela chave e reproduz o log inteiro. `projetar` dá o agora. */
export async function abrirVila(chave) {
  const [vila] = await rpc('entrar_na_vila', { p_chave: chave.toUpperCase() });
  if (!vila) throw new Error('nenhuma vila com essa chave');
  const log = [];
  for (let desde = 0; ; ) {
    const pagina = await rpc('ler_comandos', { p_vila: vila.id, p_desde: desde });
    if (!pagina.length) break;
    log.push(...pagina.map((r) => r.dados));
    desde = pagina.at(-1).ordem;
  }
  const motor = Motor.reproduzir(log, { semente: vila.semente, nome: vila.nome });
  return { vila, log, motor };
}

/** Manda um comando pra vila. O motor local valida antes; o servidor ordena. */
export async function enviar(vila, motor, cmd) {
  const completo = { ...cmd, id: cmd.id ?? `${cmd.por}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, em: Date.now() };
  // Ensaia num mundo sombra: comando invalido nao sai daqui nem suja o log.
  const sombra = Motor.deSnapshot(motor.mundo);
  const previa = sombra.executar(completo);
  if (!previa.ok) return { ok: false, erro: previa.erro };
  const ordem = await rpc('enviar_comando', { p_vila: vila.id, p_cmd: completo });
  motor.executar(completo);   // mantem o mundo local igual ao do servidor
  return { ok: true, ordem: Number(ordem), cmd: completo, eventos: previa.eventos };
}
