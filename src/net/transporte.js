// ---------------------------------------------------------------------------
// Transporte: como o log de comandos viaja entre os familiares.
//
// Regra de ouro: o cliente NUNCA aplica um comando direto no motor. Ele manda
// para o transporte, o transporte devolve o comando ja carimbado com uma
// posicao na fila, e so entao o motor aplica. Assim todos aplicam na MESMA
// ordem e o hash bate. E o mesmo contrato para memoria, arquivo ou Supabase.
// ---------------------------------------------------------------------------

export class TransporteLocal {
  constructor(log = []) {
    this.log = [...log];
    this.ouvintes = new Set();
  }

  async entrar() {
    return [...this.log];
  }

  async enviar(cmd) {
    const carimbado = { ...cmd, ordem: this.log.length + 1, em: this.log.length + 1 };
    this.log.push(carimbado);
    for (const fn of this.ouvintes) fn(carimbado);
    return carimbado;
  }

  aoReceber(fn) {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }
}

/** Liga um Motor a um Transporte. E isto que a tela usa. */
export class Sessao {
  constructor({ motor, transporte, jogadorId, aoAtualizar }) {
    this.motor = motor;
    this.transporte = transporte;
    this.jogadorId = jogadorId;
    this.aoAtualizar = aoAtualizar;
    this.pendentes = 0;
    this.desligar = transporte.aoReceber((cmd) => this.#aplicar(cmd));
  }

  /** Reproduz tudo o que aconteceu enquanto voce estava fora. */
  async sincronizar() {
    for (const cmd of await this.transporte.entrar()) this.motor.executar(cmd);
    this.aoAtualizar?.(this.motor.mundo);
    return this.motor.hash;
  }

  /** Valida localmente (feedback imediato) e so entao publica na fila. */
  async executar(cmd) {
    const completo = { ...cmd, por: cmd.por ?? this.jogadorId, id: cmd.id ?? novoId(this.jogadorId) };
    const previa = simulaValidacao(this.motor, completo);
    if (!previa.ok) return previa;
    this.pendentes++;
    await this.transporte.enviar(completo);
    return { ok: true, enviado: true };
  }

  #aplicar(cmd) {
    const r = this.motor.executar(cmd);
    if (this.pendentes > 0 && cmd.por === this.jogadorId) this.pendentes--;
    this.aoAtualizar?.(this.motor.mundo, r);
  }
}

function simulaValidacao(motor, cmd) {
  if (cmd.tipo === 'PASSAR_DIA') return { ok: true };
  const sombra = motor.constructor.deSnapshot(motor.mundo);
  const r = sombra.executar(cmd);
  return r.ok ? { ok: true } : r;
}

const novoId = (quem) => `${quem}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
