# Guia do Kami (pro assistente)

Fonte do que o assistente explica sobre o app (IA-03, P-114): ele consulta
a seção pelo tópico (ferramenta `kami_guide`) em vez de adivinhar. Escrito
a partir de docs/REGRAS-DE-NEGOCIO.md e do README. Cada `## tópico` vira um
tópico da ferramenta. Ao mudar uma regra do app, mude aqui também.

## xp_levels
- Toda ação registrada no Kami rende xp em um ou mais dos 5 atributos: carreira, finanças, aprendizado, organização e metas (o hábito escolhe o atributo dele). Ação registrada à mão no núcleo rende no máximo 50 de xp.
- Há o nível geral e o nível de cada atributo. A curva é 100 × n^1,3 de xp por nível — cada nível pede um pouco mais que o anterior.
- Desfazer o que gerou xp (desmarcar uma conta paga, reabrir um marco, apagar um lançamento) devolve o xp; o xp nunca fica negativo.
- Ações que se repetem por sincronização (GitHub, e-mail, contribuição em meta) rendem xp no máximo uma vez por dia.
- O dia de uma ação é o dia local da pessoa, não o UTC.
- Alguns valores: lançamento em finanças = 3 xp; pagar conta fixa com conta vinculada = 4 xp; marcar um hábito = 5 xp no atributo do hábito; salvar link rende xp; nota rende xp só ao ser criada, no máximo 3 por dia.
- Um atributo sem nenhuma ação há 14 dias aparece como "esquecido" no radar do núcleo, sem perder xp.

## missions_streak_bonus
- Missões: até 3 missões do dia e 1 da semana, sorteadas uma vez por dia só entre as que dá pra cumprir com os dados da pessoa. Concluir rende um bônus de xp; desfazer a ação que concluiu volta a missão a pendente e tira o bônus.
- Missões do dia possíveis: lançar um gasto ou entrada; pagar uma conta fixa específica; receber uma renda específica; contribuir com uma meta; concluir um marco de uma trilha; resgatar um marco esquecido; salvar um link; marcar um hábito.
- Missões da semana possíveis: agir em 5 dias diferentes; lançar 10 gastos ou entradas; concluir 2 marcos; agir em 4 atributos diferentes; cumprir todos os hábitos do dia em 4 dias.
- Sequência (streak): dias seguidos com pelo menos uma ação. Continua se a última ação foi ontem; um dia em branco quebra.
- Proteções: a cada 7 dias seguidos ganha 1 proteção (guarda no máximo 2). Um dia em branco gasta uma proteção e a sequência continua. O dia de hoje nunca gasta proteção.
- Bônus de xp: +5 na primeira ação do dia, um multiplicador pela sequência e 2× no atributo mais atrasado; cada bônus tem teto de 20. Ação manual do núcleo não ganha bônus nem conclui missão. Bônus e missões não contam pras conquistas de contagem.

## achievements_titles_class
- Conquistas desbloqueiam quando o critério vale (ex.: "contas em dia", "mês no azul", "trilha em dia"); se deixar de valer depois (ex.: uma saída retroativa deixa um mês negativo), a conquista volta a ficar bloqueada. As de sequência usam o recorde e não somem.
- Há conquistas secretas: bloqueadas, aparecem como "???".
- Dá pra criar conquistas personalizadas (contam só ações de verdade, com uma palavra-chave opcional).
- Subir o nível geral libera títulos (aparecem sob o nome) e temas de terminal (fósforo, CRT, âmbar).
- A classe (Erudito, Mercador, Artífice, Estrategista, Arquivista ou Polímata) vem do atributo mais forte.
- Todo mês abre uma retrospectiva em ASCII do mês que acabou, que pode ser exportada em .txt.

## finances
- Tela finanças: lançamentos (entrada, saída, transferência) por categoria, renda recorrente, contas fixas, dívidas e a visão do mês comparada com o mês anterior (transferências não entram no resumo).
- Todo lançamento é de uma conta da carteira (Wallet). Entrada soma no saldo; saída desconta do saldo ou vai pra fatura do cartão. Se a conta tem saldo e crédito, a pessoa escolhe a forma de pagamento. Saída não passa do saldo nem do limite.
- Transferência interna move saldo entre contas; externa só debita a origem.
- Renda recorrente: fontes com valor e data (ex.: 5º dia útil, contando os feriados do país escolhido; ou X dias úteis depois de outra fonte). Receber numa conta credita o saldo.
- Conta fixa: valor e dia de vencimento (dia 31 cai no último dia dos meses curtos). Marcar como paga com conta vinculada lança a saída real; desmarcar devolve o dinheiro e o xp.
- Dívida: valor, com quem e vencimento opcional; quitar pode lançar a saída numa conta.
- Lançamento digitado errado se corrige ou apaga, e saldo e xp acompanham. Lançamento criado por outro módulo (conta fixa, assinatura, renda, meta, dívida) mostra a origem e só se desfaz por lá.

## wallet
- Carteira (Wallet), dentro de finanças: bancos com uma ou mais contas; cada conta pode ter saldo, crédito (cartão, com limite e fatura) ou os dois. O banco "dinheiro" é fixo. Apagar a última conta de um banco apaga o banco.
- Assinaturas: valor esperado e dia de cobrança; pagar com conta lança a saída.
- Compras parceladas: o total entra na fatura e respeita o limite; a parcela atual vem do calendário, com ajuste manual.

## goals
- Metas pessoais (tela "metas pessoais"): tipos como financeira, saúde, leitura, hábito, aprendizado e acadêmica.
- Progresso = valor atual ÷ alvo (até 100%); alcançar o alvo conclui a meta e rende bônus. Meta concluída não aceita mais contribuição; baixar o alvo não conclui sozinha.
- Peso (baixo, médio, alto, épico) multiplica o xp de contribuição e de conclusão.
- Meta financeira pode receber contribuição de uma conta real (lança a saída). Meta de aprendizado ou acadêmica avança sozinha pelo vínculo com a trilha/formação e não aceita contribuição manual.
- Prazo opcional aparece no calendário.

## learning
- Aprendizado: trilhas de estudo (objetivo geral, status ativa/pausada/parada) com marcos em ordem (roadmap reordenável) e heatmap de atividade.
- Progresso da trilha = marcos concluídos ÷ total. Concluir um marco rende xp uma vez; reabrir devolve o xp exato.
- Marco pendente há mais de 30 dias vira "esquecido" (dá pra resgatar; há missão pra isso).

## career
- Carreira: área atual, área-meta e interesses (não rendem xp), linha do tempo de posições, formação e histórico salarial.
- Primeira posição rende xp de marco inicial; formação só rende ao concluir; salário: primeiro registro e retroativos rendem xp fixo, reajuste em tempo real rende pelo aumento (com teto).

## habits
- Hábitos (Alt+9): diários, em dias fixos da semana ou "x vezes por semana"; grade das últimas 12 semanas, sequência e recorde por hábito, pausar e arquivar.
- Marcar rende +5 xp no atributo do hábito, uma vez por dia; desmarcar devolve. Dá pra marcar até 2 dias atrás, nunca no futuro nem fora dos dias do hábito; pausado ou arquivado não se marca.
- A sequência do hábito não quebra em dia fora da programação, em pausa, nem hoje ainda sem marca. "x por semana" conta em semanas cumpridas.
- Marcar hábito conta na sequência geral e nas missões.

## notes
- Organização › notas: editor visual (salvo em markdown), tags, cores, fixar, arquivar, e vínculo com uma meta, trilha, evento ou posição.
- Nota trancada: exige o PIN ligado; o texto fica cifrado e some da lista, da busca e do widget (o título fica). Abrir, editar ou apagar pede o PIN. O assistente NUNCA lê nota trancada.
- A captura rápida de tarefa entra como "- [ ] texto" na nota "tarefas".

## capture_search
- Captura rápida: Alt+Q (ou Alt+Espaço) em qualquer tela. "$ 32,90 farmácia ontem" vira um gasto, "# ideia" uma nota, "! sexta 14h reunião" um evento, "@ amanhã 9h ligar pro banco" um lembrete; o resto vai pra caixa de entrada (organização › entrada), pra decidir depois. Datas e horas no idioma do app. Capturar não rende xp (rende o que a captura virar).
- Ctrl+K: paleta que busca em tudo (sem ligar pra acento ou maiúscula) e roda comandos.
- Outros atalhos: Alt+1…9 trocam de tela; Alt+Shift+N nota rápida; Alt+B busca da organização; Alt+C configurações; Alt+A abre/fecha o assistente. O botão "?" no rodapé mostra todos os atalhos.

## reminders_calendar
- Lembretes: dia, hora e repetição (todo dia, dias da semana, todo mês, todo ano), ligados opcionalmente a nota, conta fixa, meta, hábito ou evento. Disparam uma vez por ocorrência e ficam no sino até "ok" ou "adiar" (10 min, 1 h, amanhã); com o app fechado viram um aviso "que passou". Lembrete de hábito não dispara se o hábito já foi marcado no dia.
- Avisos também pela notificação do sistema (opcional), e avisos de vencimento agrupados num horário escolhido.
- Calendário: reúne contas fixas, dívidas, assinaturas, parcelas, metas com prazo, eventos próprios (com recorrência) e lembretes. Renda não aparece.

## backup
- Configurações › backup e dados: exportar (arquivo .json, opcionalmente protegido com senha — leva também as senhas salvas, cifradas pela senha), importar e apagar tudo (exige digitar a palavra de confirmação).
- Cópias automáticas do banco: toda semana e antes de importar, apagar tudo ou atualizar de versão; dá pra restaurar uma cópia e definir uma pasta extra (ex.: pendrive).
- Configurações › sobre: copiar um diagnóstico sem dados pessoais pra relatar um problema.

## security_pin
- PIN opcional pra abrir o app (configurações › segurança), com código de recuperação (mostrado uma vez) e bloqueio por inatividade (5, 15 ou 30 min).
- Senhas salvas (e-mail, token do GitHub, chave da busca, chave da IA) ficam cifradas, com a chave no cofre do sistema. Se o cofre perder a chave, dá pra redefinir — os segredos salvos são apagados e precisam ser colados de novo.

## language_currency_country
- Configurações › aparência: idioma (10), moeda (só o formato; nada é convertido) e país dos feriados (usado no dia útil do salário e vencimentos). Formato de data, cor de destaque, efeitos e sons também ficam ali.

## assistant
- O assistente é opcional e começa desligado; o Kami funciona inteiro sem ele. Nenhuma chave vem com o app: a pessoa escolhe um provedor (Gemini, Groq, OpenRouter, OpenAI, Anthropic, ou local com Ollama/LM Studio) em configurações › assistente.
- Ele só LÊ dados nesta versão, por áreas que a pessoa liga ou desliga (notas começam desligadas; nota trancada nunca). Antes de sair do computador, e-mails, cartões, documentos, chaves e telefones são trocados por [removido].
- "O que foi enviado" (no painel) mostra cada envio ao provedor. Há teto diário de chamadas e tokens pra provedor na nuvem.
- Conversas ficam só no computador (ou nem isso, com "guardar conversas" desligado) e somem depois do prazo escolhido. Ele não lembra de conversas antigas.
