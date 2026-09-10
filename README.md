# Vila da Família — motor do jogo

Motor headless de um jogo 8-bit cooperativo para a família: cada pessoa cuida da
sua **herdade**, mas todo mundo divide os mesmos **bens comuns** (água, mata,
terra e harmonia). O que um faz hoje aparece na colheita do outro amanhã.

Sem dependências. Node 20+.

```bash
npm start    # abre o jogo em http://localhost:5173
npm test     # 22 testes do motor + 8 do transporte
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

## Comandos

| Comando | O que faz | Custa | Mexe no comum |
|---|---|---|---|
| `ENTRAR` | ocupa uma herdade livre | — | harmonia +3 |
| `PLANTAR` | semeia um canteiro | 1 energia + semente | — |
| `REGAR` | rega o canteiro | 1 energia | **água −** |
| `COLHER` | colhe pro celeiro | 1 energia | solo − |
| `VENDER` | vira moeda | — | — |
| `CORTAR` | pega madeira | 2 energia | **mata −3** |
| `PLANTAR_ARVORE` | repõe a mata | 2 energia + 2 madeira | mata +4, harmonia +1 |
| `MINERAR` | pega pedra | 2 energia | solo −1 |
| `CONSTRUIR` | benfeitoria na herdade | 3 energia + materiais | harmonia ±1 |
| `PRESENTEAR` | dá recurso a alguém | — | harmonia +1 |
| `ABRACAR` | abraça um parente (1x/dia cada) | — | harmonia +1 |
| `RECADO` | deixa um recado no mural | — | — |
| **`AJUDAR`** | rega/colhe **na terra do outro** | 2 energia | **harmonia +2** |
| `DOAR` | material pra obra da vila | — | harmonia +1 |
| `PASSAR_DIA` | vira o dia (pelo log) | — | clima, destino |

`AJUDAR` é o comando que define o jogo: você gasta a **sua** energia e a
colheita vai pro **celeiro do outro** — o que volta pra você é reputação,
harmonia e, por tabela, energia extra todo dia.

## Como uma atitude vira o destino do outro

Cinco vetores, todos já implementados e testados:

1. **Bens comuns** — regar bebe do mesmo rio; cortar derruba a mesma mata.
2. **Vizinhança** — colmeia dá +15% de colheita pra quem está do lado; forja
   joga fumaça na terra do vizinho.
3. **Clima encadeado** — mata em pé alimenta a nascente e puxa chuva. Mata rala
   = seca + enxurrada que leva a terra boa.
4. **Harmonia** — ajudar e presentear enchem; o tempo esvazia. Cheia, todo mundo
   acorda com +1 energia; vazia, todo mundo rende menos.
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

- Hospedagem: o jogo roda em `localhost`. Pra família abrir de casa, `web/` e
  `src/` precisam ir pra um host estático (GitHub Pages, Netlify, Vercel).
- Autenticação — hoje "quem tem a chave, entra".
- Telas do layout ainda não montadas: inventário completo e mural de trocas.
- Balanceamento fino: os números de `conteudo.js` seguram uma partida inteira,
  mas só o playtest com a família de verdade vai dizer se a água aperta na hora
  certa.
