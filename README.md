# Vila da Família — motor do jogo

Motor headless de um jogo 8-bit cooperativo para a família: cada pessoa cuida da
sua **herdade**, mas todo mundo divide os mesmos **bens comuns** (água, mata,
terra e harmonia). O que um faz hoje aparece na colheita do outro amanhã.

**No ar:** https://dartagnan-2023.github.io/vila-da-familia/web/ (GitHub Pages, publica a cada push em `main`).

Sem dependências. Node 20+.

```bash
npm start    # abre o jogo em http://localhost:5173
npm test     # 31 testes do motor + 8 do transporte
npm run demo # simula 2 famílias com a MESMA semente e compara o destino
```

## A ideia em uma frase

O jogo não tem inimigo. O antagonista é a **tentação de otimizar sozinho**.

A demo mostra isso rodando: mesma semente, mesmos 30 dias, mesmas ferramentas —
a família que ajuda o vizinho termina com mais dinheiro *e* mais terra viva do
que a que só cuidou do próprio quintal.

## Arquitetura

Três camadas, sem acoplamento com tela nenhuma:

```
  comando  ->  regras (valida)  ->  eventos  ->  reducer  ->  mundo
                                       |
                                       +-> feed em português (a narrativa)
```

- **`src/engine/motor.js`** — fachada. `executar(cmd)`, `passarDia()`, `hash`.
- **`src/engine/regras.js`** — o que cada comando exige e o que ele provoca.
- **`src/engine/aplicar.js`** — único lugar que muta o estado.
- **`src/engine/simular.js`** — a virada do dia: clima, crescimento, destino.
- **`src/engine/apresentador.js`** — o que a **tela** consome (`visao()`).
- **`src/net/transporte.js`** — como o log viaja entre os familiares.

### Determinismo é o coração

O mundo **não trafega pela rede** — trafega o **log de comandos**, em ordem.
Todo cliente que reproduz o mesmo log a partir da mesma semente chega ao mesmo
mundo, e `motor.hash` prova isso. Nada de `Math.random()`: a aleatoriedade vem
de `rngPara(semente, dia, canal)`.

Consequências práticas:
- estado de 3 meses de jogo cabe em uma tabela de comandos;
- quem entra depois reproduz o log e alcança a vila (tem teste pra isso);
- se dois primos exibem hashes diferentes, deu dessincronia — dá pra detectar.

## O loop (depois do estudo — ver `docs/ESTUDO-JOGABILIDADE.md`)

Hay Day não tem energia e começa com trigo em 2 minutos. Colheita Feliz
prendia porque a planta *pede* coisas e o amigo resolve. A Vila copiou os dois:

- **Sem energia.** O limite é tempo, semente, canteiro e o descanso do machado
  (3 min) e da picareta (5 min).
- **Timers em minutos, por nível:** trigo 2 min (nv 1, rende 2 por 1), flor 3,
  milho 5, cenoura 10, abóbora 30, arroz 1h, café 4h (nv 10).
- **XP e nível** (`XP`, `xpParaNivel` em `conteudo.js`): toda ação dá XP;
  nível abre culturas, máquinas e benfeitorias. Subir de nível é festa na tela.
- **A planta pede ajuda:** culturas de 10 min ou mais param em pontos
  determinísticos (40%, às vezes 75%) pedindo 💧 sede, 🐛 praga ou 🌿 mato.
  O dono resolve com `CUIDAR`; um parente resolve com `AJUDAR` e leva XP e laço.
- **Encomendas** (`gerarEncomenda`): 3 por pessoa, pedem o que ela já produz,
  pagam 50% acima do balcão + XP. Entregou, entra outra.
- **Produção:** Moinho (2 trigo → farinha, 3 min), Forno (farinha → pão 5 min,
  bolo 12 min). Com fila; "sempre tem algo no forno".
- **Harmonia → velocidade:** o destino compartilhado virou o multiplicador de
  crescimento de todo mundo (0.8× a 1.2×; ponte +10%; rio seco −15%).

## Comandos

| Comando | O que faz | Custa | Mexe no comum |
|---|---|---|---|
| `ENTRAR` | ocupa uma herdade livre, abre 3 encomendas | — | harmonia +3 |
| `PLANTAR` | semeia (cultura do seu nível) | semente | — |
| `CUIDAR` | atende o pedido da planta (sede gasta água comum) | — | água − (sede) |
| `COLHER` | colhe pro celeiro, dá XP da cultura ao dono | — | solo − |
| `VENDER` | vira moeda (culturas e produtos) | — | — |
| `PRODUZIR` / `RECOLHER` | põe insumo na máquina / tira o produto | insumos | — |
| `CUMPRIR_ENCOMENDA` | entrega itens do celeiro, recebe G + XP | itens | harmonia +1 |
| `CORTAR` | pega 4–6 madeira (+1 a cada 4 níveis, +1 com a mata ≥ 80); machado descansa 2 min | — | **mata −3** |
| `PLANTAR_ARVORE` | repõe a mata | 1 madeira | mata +4, harmonia +1 |
| `MINERAR` | pega 3–5 pedra (+1 a cada 5 níveis); picareta descansa 4 min | — | solo −1 |
| `CONSTRUIR` / `DEMOLIR` | benfeitoria (por nível) / desmancha, devolve metade | materiais | harmonia ±1 |
| `COMPRAR_CANTEIRO` | abre o 10º, 11º, 12º canteiro | 60/90/120 G | — |
| `PRESENTEAR` / `ABRACAR` / `RECADO` | gestos; `RECADO` aceita `para` (conversa particular: só os dois veem) | — | harmonia +1 |
| `SENTIR` | reação da pessoa (😍😂😐😤🤯💡 + texto): vira dado pra próxima versão | — | — |
| `ANUNCIAR` / `RETIRAR` | põe lote na **vendinha** (3 lotes; +3 com Celeiro), preço entre 1× e 2× a feira | item | — |
| `COMPRAR` | compra o lote do parente: moeda vai pra ele, item pro seu celeiro, laço +1 | G | harmonia +1 |
| **`AJUDAR`** | cuida/colhe **na terra do outro**; XP e laço pra quem ajuda | — | **harmonia +2** |
| `DOAR` | material pra obra da vila | — | harmonia +1 |
| `CUMPRIR_MISSAO` | prêmio de uma missão do dia | — | harmonia +1 |
| `ACORDAR` / `PASSAR_DIA` | carimba data/hora / vira o dia (clima, estação, destino) | — | — |

### O jogo roda em tempo real

`src/engine/tempo.js`. Todo comando leva `em` (ms). Antes de aplicar, o motor
avança o mundo de `mundo.agora` até `em`: plantas crescem (× velocidade da
vila), máquinas terminam. Como os `em` vêm do log, todo cliente reproduz o
mesmo avanço. A tela usa `projetar(mundo, Date.now())` para mostrar o estado
de agora ("pronta em 1 min", "Farinha em 2 min").

**Missões do dia** (`MISSOES`): 3 sorteadas por semente + dia, iguais para
todos; `jogador.hoje` conta; `CUMPRIR_MISSAO` paga uma vez. Zeram à meia-noite.

## Como uma atitude vira o destino do outro

Cinco vetores, todos já implementados e testados:

1. **Bens comuns** — regar bebe do mesmo rio; cortar derruba a mesma mata.
2. **Vizinhança** — colmeia dá +15% de colheita pra quem está do lado; forja
   joga fumaça na terra do vizinho.
3. **Clima encadeado** — mata em pé alimenta a nascente e puxa chuva. Mata rala
   = seca + enxurrada que leva a terra boa.
4. **Harmonia** — ajudar e presentear enchem; o tempo esvazia. Ela é o
   multiplicador de velocidade de TODAS as plantas da vila (0.8× a 1.2×).
5. **Obras coletivas** — ponte, praça, açude, escola. Ninguém termina sozinho, e
   o bônus é pra vila inteira.

E o **destino** (`simular.js`): quando um comum cruza o limiar, o mundo responde
com seca, praga, erosão ou festa — pra todo mundo, sem escolher culpado.

## O contrato da tela

A UI **nunca** lê o mundo direto. Ela chama:

```js
import { visao, acoesPossiveis } from './src/engine/apresentador.js';

const v = visao(motor.mundo, 'marcos');
// v.hud            -> energia, moedas, sprite, celeiro
// v.comuns         -> [{ chave, rotulo, valor, pct, estado: ok|alerta|critico }]
// v.minhaHerdade   -> canteiros com progresso, pronto, sede
// v.mapa           -> as 9 herdades pra desenhar a vila
// v.pedidosDeAjuda -> onde a sua mão faz falta AGORA (o gancho social)
// v.obras          -> progresso das obras coletivas
// v.familia        -> quem é quem, reputação e o "laço"
// v.feed           -> narrativa em português, pronta pra caixa de texto
// v.presagios      -> o que o mundo andou mandando
```

`acoesPossiveis(mundo, jogadorId, comandos)` devolve cada botão já com
`habilitado` e `motivo` — a tela não precisa conhecer nenhuma regra.

Foi exatamente assim que o layout do Stitch entrou: ligando esses campos aos
elementos dele, sem mexer em regra nenhuma.

## A interface (layout do Stitch, vestido)

`web/` é o layout **Vila Raízes — Edição Aldeia** ligado ao motor. Os tokens de
`layout/.../DESIGN.md` (cores, Space Mono, bevels de 2px/4px, raio 0) entraram
sem alteração no `tailwind.config` do `index.html`. `app.js` não conhece nenhuma
regra: pinta `visao()` e despacha comandos.

Duas trocas conscientes em relação ao HTML gerado:

- **Ícones**: o Stitch usou ligaduras do Material Symbols, que não renderizaram
  (aparecia o texto `monetization_on` na tela). Troquei por glifos — sem
  dependência externa e mais coerente com 8-bit.
- **Mapa**: o mundo do mockup é um PNG hospedado em URL temporária do Google.
  A vila agora é desenhada em DOM a partir das herdades reais (cada card mostra
  dono, canteiros, benfeitorias, fertilidade), então ela muda quando o jogo muda.

Onde o layout pedia coisa que o motor não tinha:

| Tela do Stitch | Virou |
|---|---|
| `#RAIZES-FAMILIA-42` | a chave real de `novaChave()` |
| Medidores HP + EN | **EN** = energia; **TERRA** = fertilidade − poluição da sua herdade |
| Relógio `10:45 AM` | estação + dia + clima (o tick do motor é o dia, não a hora) |
| Sinergia Familiar Nv.4 | harmonia, com o bônus real que ela dá naquele momento |
| Armazém Coletivo (madeira/pedra/sementes/pães) | os **4 bens comuns** — é o coração da mecânica e não havia lugar pra eles |
| Missão Familiar | a obra coletiva mais adiantada, com o que falta |
| Ecos do Destino | o feed, com o impacto de cada ato (`➔ −1 água`) |
| Abraço / Maçã / Chat | comandos novos `ABRACAR` e `RECADO`, e `PRESENTEAR` |
| `Nv.8` do avatar | derivado dos feitos da pessoa, sem inventar sistema de XP |
| Hotbar 1–0 | os comandos reais, com atalho de teclado e `habilitado/motivo` do motor |

Com `web/config.js` presente o log vai pro Supabase e a família joga entre
casas; sem ele, fica no `localStorage` e joga por revezamento no mesmo aparelho.
A tela é a mesma — só muda o transporte.

## Chave de convite

```js
novaChave() // -> "VILA-K7M2Q-3XR9T"
```

Base32 de Crockford (sem I, L, O, U — ninguém erra digitando no WhatsApp):
8 caracteres sorteados (≈ 1 trilhão de combinações) + 2 de verificação. Quem
digita `vila k7m2q 3xr9t` ou troca 0 por O entra do mesmo jeito; quem erra um
caractere é barrado antes de bater no servidor.

**A chave é o segredo da vila.** Quem tem, entra. É o modelo certo pra família
e o modelo errado pra estranhos — não publique a chave.

## Multiplayer entre casas

Projeto Supabase `vila-da-familia` (São Paulo, free tier). `web/config.js`
carrega a URL e a chave publicável; sem esse arquivo, o jogo cai no modo
"só neste aparelho" com a mesma tela.

O banco tem duas tabelas e as duas ficam **trancadas** (RLS ligado, nenhuma
policy). O papel `anon` só alcança quatro funções `security definer`:

| Função | Faz |
|---|---|
| `criar_vila(chave, nome, semente)` | funda a vila; recusa chave repetida e freia em 20 vilas/hora |
| `entrar_na_vila(chave)` | troca a chave pelo `id`, nome e semente |
| `ler_comandos(vila, desde)` | o log a partir de uma ordem, em páginas de 2000 |
| `enviar_comando(vila, cmd)` | insere com **ordem contígua por vila**; reenvio devolve a ordem que já tinha |

A ordem é reservada com `UPDATE vilas SET proxima_ordem = proxima_ordem + 1
... RETURNING` — o row lock serializa quem envia junto, sem buracos. O linter
do Supabase avisa sobre RLS-sem-policy e funções públicas: é intencional, é a
porta única.

### Como o cliente se mantém em sincronia

`src/net/supabase.js`:

1. Ao entrar, lê o log inteiro e assina o canal de broadcast `vila:<id>`.
2. Ao enviar, chama a RPC, recebe a ordem, aplica localmente e avisa o canal.
3. Um broadcast só é aplicado direto se for **exatamente** o próximo número.
   Qualquer salto manda buscar no banco — que é a única fonte da ordem.
4. Um poll a cada 20s e a volta da aba (`visibilitychange`) cobrem broadcast
   perdido.

`tests/rede.test.mjs` cobre isso com um Supabase falso que perde e atrasa
broadcasts: duas casas mandando ao mesmo tempo, comando perdido, buraco,
reenvio, chegada tardia — todas terminam com o mesmo hash.

O que o servidor **não** faz: validar regra de jogo. O cliente valida antes de
enviar; entre familiares basta. Quem quiser trapacear consegue — e vai ter que
explicar pra vovó por que a mata sumiu.

## O que ainda não existe

- Autenticação — hoje "quem tem a chave, entra".
- Telas do layout ainda não montadas: inventário completo e mural de trocas.
- Balanceamento fino: os números de `conteudo.js` seguram uma partida inteira,
  mas só o playtest com a família de verdade vai dizer se a água aperta na hora
  certa.

## O Pipo (ator de IA na vila)

O Pipo é um morador como os outros — tem herdade, celeiro e nível — só que quem
decide o que ele faz é um modelo da Anthropic. Ele **joga pelas mesmas regras**:
cada decisão vira um comando, o motor valida antes de sair, e o comando entra no
mesmo log da família. Sem recurso de graça, sem atalho.

```bash
npm run pipo -- VILA-XXXXX-XXXXX --briefing   # só mostra o que ele vê (não gasta API)
npm run pipo -- VILA-XXXXX-XXXXX --seco       # decide e explica, sem mandar nada
npm run pipo -- VILA-XXXXX-XXXXX              # uma rodada de verdade
npm run pipo -- VILA-XXXXX-XXXXX --vigiar     # fica olhando a vila (15 em 15 min)
```

Precisa de `ANTHROPIC_API_KEY` no ambiente de quem roda — a chave fica nessa
máquina; o jogo publicado nunca a vê. As ações que ele pode tomar são só as do
jogo: ajudar, falar (mural ou particular), presentear, abraçar, doar pra obra,
anunciar na vendinha, ou **nada** — que é resposta legítima e a mais comum.

Do outro lado do canal, `npm run sentir -- CHAVE` traz o que a família sentiu
(😍😂😐😤🤯💡 + texto) como dado pra próxima versão.

### O corpo e o cérebro

O Pipo tem duas metades, de propósito:

| | o que faz | custa |
|---|---|---|
| `npm run pipo:rotina -- CHAVE` | **o corpo**: rega, colhe, socorre quem está pedindo, replanta o que a família precisa pras encomendas, doa pra obra, cuida da mata | nada — regra escrita à mão, zero API |
| `npm run pipo -- CHAVE` | **o cérebro**: lê a vila e decide como gente — o que falar, a quem dar, quando calar | uma chamada de API por rodada |

A rotina também é o **olho**: tudo que a família escreve no mural, manda pro Pipo
ou sente (😍😂😐😤🤯💡) vai pra `.pipo-caixa.jsonl`, com 🔥 no que é reclamação.
O cérebro só é acionado quando a caixa tem algo — silêncio não custa nada.
