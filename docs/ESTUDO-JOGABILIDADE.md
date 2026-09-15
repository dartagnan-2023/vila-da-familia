# Por que Hay Day, Colheita Feliz e Stardew prendem — e o que a Vila não tinha

Estudo feito em 15/09/2026 antes de mexer no motor. Fontes no fim.

## O que cada um faz

### Hay Day (Supercell, 2012 — ainda entre os jogos de fazenda mais jogados)

- **Não tem energia.** O limite é tempo e dinheiro. Você planta quanto tiver
  semente e canteiro. Nada impede de "continuar jogando".
- **Timers em minutos, escalonados por nível:** trigo 2 min, milho 5 min,
  cenoura 10 min, soja 20 min, cana 30 min, anil 2h, abóbora 3h, batata 3h40,
  pimenta 4h… até café 2 dias. Um jogador novo tem a primeira colheita em
  **2 minutos** e replanta na hora — três, quatro ciclos numa sessão.
- **Trigo dá 2 por 1.** A semente se paga; o loop fecha sozinho.
- **Cadeia de produção:** trigo → padaria → pão (5 min); leite → laticínio →
  manteiga (30 min), queijo (1h). Máquinas com fila. Sempre tem algo "no forno"
  quando você volta — o motivo de voltar não é só a plantação.
- **Encomendas (caminhão):** lista de pedidos "3 trigo + 2 pão → 40 moedas +
  12 XP". Você escolhe, cumpre, entra outro. É o **objetivo de curto prazo**.
- **XP e níveis:** toda ação dá XP; nível desbloqueia cultura, máquina, área.
  A progressão visível é o "meta-jogo" que segura por meses.
- **Loja de beira de estrada:** vender pra outros jogadores. Social e economia.
- **Sem tutorial forçado, sem missão obrigatória** — o loop é tão óbvio que
  ensina a si mesmo: galinha → ovo → moeda → coisa mais valiosa.
- Supercell mede D1/D7/D30 e otimizou tudo pra que "cada retorno dê progresso".

### Colheita Feliz (Orkut, 21,6 milhões de usuários em 2010)

- **Tarefas simples e diárias:** arar, plantar, regar, tirar mato, tirar praga,
  colher. Cada uma é um clique com feedback imediato.
- **A planta pede coisas enquanto cresce:** dá sede, aparece praga, nasce mato.
  Isso é o **gancho social**: amigo visita sua fazenda e resolve — e ganha XP
  por isso. E também **rouba** um pouco da colheita madura (uma vez por planta).
  Visitar os outros era metade do jogo.
- **Popularidade** (barra vermelha) subia com presentes de amigos.
- **Nível desbloqueia semente**; moedas compram animais (galinha 8 mil,
  cachorro 50 mil pra proteger do roubo).
- Prendia por: rotina, recompensa diária, e **competição/afeto entre amigos**.

### Stardew Valley

- Tem energia e dia, mas um dia dura **14 minutos reais** e você dorme quando
  quiser — o "só mais um dia" é possível porque o dia é curto.
- **Várias atividades que se alimentam:** lavoura, mina, pesca, coleta,
  amizades. Cansou de uma, faz outra; uma progride a outra.
- **Toda sessão rende progresso.** Estação muda o que dá pra plantar — o
  calendário vira assunto.

## O que a Vila estava fazendo de errado

| Vila (antes) | Os três jogos |
|---|---|
| Energia limita a 10 ações; acabou, tchau | Hay Day/Colheita: sem energia. Stardew: dia de 14 min |
| Trigo em 2 **horas** (antes: 3 dias) | Trigo em 2 **minutos** |
| Nada acontece enquanto você está lá | Sempre tem coisa ficando pronta na sua frente |
| Sem objetivo além de "cuidar" | Encomendas, XP, nível, desbloqueio |
| Uma coisa pra fazer (plantar/regar) | Plantar, produzir, cumprir pedido, visitar, colecionar |
| Ajudar o outro é "regar por ele" | Colheita Feliz: a planta *pede* ajuda (sede/praga/mato) e quem ajuda ganha |

## O desenho novo

1. **Sem energia.** Sai como limitador. O limite é tempo, semente e canteiro —
   como Hay Day. (O "destino compartilhado" migra da energia pra **velocidade
   de crescimento**: harmonia alta, tudo cresce 20% mais rápido pra todo mundo;
   baixa, 20% mais devagar. Continua sendo uma consequência coletiva, só que
   sentida a cada minuto.)
2. **Timers em minutos, escalonados por nível:** trigo 2 min (nv 1), flor 3
   min (nv 2), milho 5 min (nv 3), cenoura 10 min (nv 4), abóbora 30 min
   (nv 5), arroz 1h (nv 7), café 4h (nv 10). Trigo rende 2 por 1.
3. **XP e nível.** Plantar 1, colher = XP da cultura, ajudar 5, cumprir
   encomenda = XP do pedido. Nível desbloqueia culturas, benfeitorias, canteiro
   extra. Barra visível o tempo todo; subir de nível é festa na tela.
4. **A planta pede ajuda.** Culturas de 10 min ou mais ganham, em pontos
   determinísticos do crescimento, um problema — 💧 sede, 🐛 praga ou 🌿 mato —
   e **param** até alguém resolver. O dono resolve; ou um parente resolve e
   ganha XP + laço. É o Colheita Feliz: motivo pra visitar a herdade dos outros.
5. **Encomendas.** Cada familiar tem 3 pedidos abertos ("4 trigo + 2 milho →
   35 G + 20 XP"). Cumpriu, entra outro (sorteio determinístico). Objetivo de
   curto prazo que dá sentido ao que plantar.
6. **Cadeia de produção.** Moinho (2 trigo → farinha, 3 min) e Forno (2 farinha
   → pão, 5 min), com fila. Pão vale 6× o trigo. Encomendas pedem pão.
   "Sempre tem algo no forno".
7. **Rega vira cuidado, não gate.** Não precisa regar pra crescer; regar é a
   resposta ao pedido "sede". Sem a rega obrigatória, o loop de 2 minutos
   fecha sem fricção.

O que continua: bens comuns (mata, água, terra), obras coletivas, abraço,
recado, presentes, missões do dia, dia virando à meia-noite (clima/estação),
tudo por log de comandos com hash.

## Fontes

- GameSkinny — [Hay Day crops](https://www.gameskinny.com/tips/hay-day-guides-the-different-crops-farmers-can-grow/)
- Hay Day Wiki — [Crops](https://hayday.fandom.com/wiki/Crops), [Truck](https://hayday.fandom.com/wiki/Truck), [Bakery](https://hayday.fandom.com/wiki/Bakery), [Roadside Shop](https://hayday.fandom.com/wiki/Roadside_Shop)
- Deconstructor of Fun — [Behind the Success of Hay Day](https://www.deconstructoroffun.com/blog//2013/01/behind-success-of-hay-day.html)
- Game Developer — [Monetization design: Hay Day](https://www.gamedeveloper.com/business/game-monetization-design-analysis-of-hay-day)
- Mobile Free To Play — [Improving retention](https://mobilefreetoplay.com/bible/improving-games-retention/)
- TechTudo — [Colheita Feliz: como jogar](https://www.techtudo.com.br/noticias/2011/04/colheita-feliz-aprenda-como-jogar-este-sucesso-do-orkut.ghtml)
- TecMundo — [Colheita Feliz e jogos do Orkut](https://www.tecmundo.com.br/redes-sociais/237148-colheita-feliz-4-jogos-classicos-orkut.htm)
- Cheatswise — [Tutorial Colheita Feliz](https://cheatswise.forumeiros.com/t84-tutorial-completo-colheita-feliz)
- Medium (Kinney) — [Deceptively Simple Design: Stardew](https://medium.com/swlh/deceptively-simple-design-cabde40af87f)
- Medium (Zacky) — [Stardew: engagement done right](https://medium.com/@shakeebzacky/stardew-valley-player-engagement-done-right-7d25f9dc00e9)
