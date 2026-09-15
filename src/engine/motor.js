import { criarMundo } from './mundo.js';
import { REGRAS } from './regras.js';
import { aplicar, registrarFeed } from './aplicar.js';
import { passarDia } from './simular.js';
import { rngPara, hashMundo } from './rng.js';
import { avancarTempo } from './tempo.js';

// ---------------------------------------------------------------------------
// Fachada do motor.
//
// Contrato de rede: o mundo NAO trafega. Trafega o LOG DE COMANDOS, em ordem.
// Todo cliente que reproduzir o mesmo log a partir da mesma semente chega ao
// mesmo mundo — o hash serve para conferir isso. Quem define a ordem oficial e
// o servidor (uma sequencia unica por vila); o cliente so reproduz.
// ---------------------------------------------------------------------------

export class Motor {
  constructor(mundo, { aoEvento } = {}) {
    this.mundo = mundo;
    this.aoEvento = aoEvento;
  }

  static criar(opcoes = {}, cfg = {}) {
    return new Motor(criarMundo(opcoes), cfg);
  }

  static deSnapshot(snapshot, cfg = {}) {
    return new Motor(structuredClone(snapshot), cfg);
  }

  /** Reconstroi a vila inteira a partir do log compartilhado. */
  static reproduzir(comandos, opcoes = {}, cfg = {}) {
    const motor = Motor.criar(opcoes, cfg);
    for (const cmd of comandos) motor.executar(cmd);
    return motor;
  }

  executar(cmd) {
    const id = cmd.id ?? `${cmd.por ?? 'mundo'}#${this.mundo.seq + 1}`;
    if (this.mundo.aplicados[id]) return { ok: true, repetido: true, eventos: [] };

    // Todo comando pode trazer a data local de quem enviou. A primeira vira a
    // data de fundacao; um PASSAR_DIA com data avanca o calendario da vila.
    if (cmd.data && (!this.mundo.dataDoDia || cmd.tipo === 'PASSAR_DIA')) this.mundo.dataDoDia = cmd.data;
    // O relogio anda antes do comando: plantas crescem, energia volta.
    if (cmd.em) avancarTempo(this.mundo, cmd.em);

    if (cmd.tipo === 'PASSAR_DIA') {
      const eventos = passarDia(this.mundo).map((e) => this.#registra(e));
      this.mundo.aplicados[id] = 1;
      return { ok: true, eventos };
    }

    const regra = REGRAS[cmd.tipo];
    if (!regra) return { ok: false, erro: `comando desconhecido: ${cmd.tipo}`, eventos: [] };

    const erro = regra.valida(this.mundo, cmd);
    if (erro) return { ok: false, erro, eventos: [] };

    const rnd = rngPara(this.mundo.semente, this.mundo.tick, `cmd:${id}`);
    const eventos = (regra.emite(this.mundo, cmd, rnd) ?? []).map((e) => this.#registra(e));
    this.mundo.aplicados[id] = 1;
    return { ok: true, eventos };
  }

  /** Atalho de conveniencia; em producao emita { tipo:'PASSAR_DIA' } pelo log. */
  passarDia(id) {
    return this.executar({ tipo: 'PASSAR_DIA', id: id ?? `dia:${this.mundo.tick + 1}` });
  }

  #registra(ev) {
    ev.seq = ++this.mundo.seq;
    ev.tick = this.mundo.tick;
    aplicar(this.mundo, ev);
    if (ev.texto) registrarFeed(this.mundo, ev);
    this.aoEvento?.(ev, this.mundo);
    return ev;
  }

  snapshot() {
    return structuredClone(this.mundo);
  }

  get hash() {
    return hashMundo(this.mundo);
  }
}
