// ---------------------------------------------------------------------------
// Transporte Supabase: o log de comandos da vila, entre casas.
//
// Fonte da verdade da ORDEM e a coluna `ordem` no Postgres, contigua POR VILA
// (1, 2, 3...). O Realtime (broadcast no canal da vila) so avisa "chegou o
// comando N"; se chegar N+2 sem N+1, o cliente vai ao banco buscar o que
// faltou. Assim todo familiar aplica a mesma sequencia e o hash bate.
//
// Nada acessa as tabelas direto: RLS ligado, sem policy para anon. Tudo passa
// pelas funcoes `criar_vila`, `entrar_na_vila`, `ler_comandos`, `enviar_comando`.
// ---------------------------------------------------------------------------

const paraComando = (linha) => ({ ...linha.dados, id: linha.id, ordem: Number(linha.ordem) });

export async function criarVila(client, { chave, nome, semente }) {
  const { data, error } = await client.rpc('criar_vila', { p_chave: chave, p_nome: nome, p_semente: semente });
  if (error) throw new Error(traduz(error));
  return data; // uuid
}

export async function acharVila(client, chave) {
  const { data, error } = await client.rpc('entrar_na_vila', { p_chave: chave });
  if (error) throw new Error(traduz(error));
  const vila = Array.isArray(data) ? data[0] : data;
  return vila ?? null; // { id, nome, semente }
}

export class TransporteSupabase {
  constructor({ client, vilaId, intervaloPoll = 20000 }) {
    this.client = client;
    this.vilaId = vilaId;
    this.intervaloPoll = intervaloPoll;
    this.ouvintes = new Set();
    this.ultima = 0;
    this.canal = null;
    this.poll = null;
    this.recuperando = null;
  }

  async entrar() {
    const lote = await this.#ler(0);
    this.ultima = lote.at(-1)?.ordem ?? 0;

    this.canal = this.client
      .channel(`vila:${this.vilaId}`)
      .on('broadcast', { event: 'cmd' }, ({ payload }) => this.#recebe(payload))
      .subscribe();

    // Rede de seguranca: se um broadcast se perder, o poll pega no banco.
    this.poll = setInterval(() => this.recuperar(), this.intervaloPoll);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.recuperar(); });
    }
    return lote;
  }

  async enviar(cmd) {
    const { data: ordem, error } = await this.client.rpc('enviar_comando', { p_vila: this.vilaId, p_cmd: cmd });
    if (error) throw new Error(traduz(error));
    const carimbado = { ...cmd, ordem: Number(ordem) };
    // O remetente nao recebe o proprio broadcast: aplica localmente aqui. Se
    // outro familiar enviou antes, o await traz o comando dele junto — quem
    // chamou so recebe a resposta com o mundo ja atualizado.
    await this.#recebe(carimbado);
    // Uma recuperacao que ja estava em andamento pode ter lido o banco antes
    // do nosso insert; insiste ate o nosso comando estar aplicado.
    for (let tentativa = 0; this.ultima < carimbado.ordem; tentativa++) {
      if (tentativa >= 3) throw new Error('o comando foi salvo, mas a vila não respondeu — recarregue');
      await this.recuperar();
    }
    this.canal?.send({ type: 'broadcast', event: 'cmd', payload: carimbado }).catch(() => {});
    return carimbado;
  }

  aoReceber(fn) {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  fechar() {
    clearInterval(this.poll);
    this.canal && this.client.removeChannel(this.canal);
  }

  // Um broadcast so e aplicado direto se for exatamente o proximo; qualquer
  // salto (um comando de outra pessoa que ainda nao chegou) manda buscar no banco.
  async #recebe(cmd) {
    if (cmd.ordem <= this.ultima) return;
    if (cmd.ordem !== this.ultima + 1) return this.recuperar();
    this.#emite(cmd);
  }

  #emite(cmd) {
    this.ultima = cmd.ordem;
    for (const fn of this.ouvintes) fn(cmd);
  }

  /** Busca no banco, ja em ordem, tudo depois do ultimo comando conhecido. */
  recuperar() {
    if (this.recuperando) return this.recuperando;
    this.recuperando = (async () => {
      try {
        for (const cmd of await this.#ler(this.ultima)) {
          if (cmd.ordem > this.ultima) this.#emite(cmd);
        }
      } catch (e) {
        console.warn('[vila] falha ao recuperar comandos', e);
      } finally {
        this.recuperando = null;
      }
    })();
    return this.recuperando;
  }

  async #ler(desde) {
    const tudo = [];
    for (;;) {
      const { data, error } = await this.client.rpc('ler_comandos', { p_vila: this.vilaId, p_desde: desde });
      if (error) throw new Error(traduz(error));
      const lote = (data ?? []).map(paraComando);
      tudo.push(...lote);
      // O PostgREST corta em 1000 linhas por chamada: so se pode confiar numa pagina VAZIA.
      if (!lote.length) return tudo;
      desde = lote.at(-1).ordem;
    }
  }
}

const traduz = (e) => {
  const m = e?.message ?? String(e);
  if (/chave_em_uso/.test(m)) return 'essa chave já existe — tente fundar de novo';
  if (/muitas_vilas/.test(m)) return 'muitas vilas fundadas na ultima hora — tente mais tarde';
  if (/vila_nao_encontrada/.test(m)) return 'nenhuma vila com essa chave';
  if (/Failed to fetch|NetworkError/.test(m)) return 'sem conexao com a vila';
  return m;
};
