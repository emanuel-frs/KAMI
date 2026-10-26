# Changelog

Todas as mudanças notáveis do Kami são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [1.15.0] - em desenvolvimento

_O Kami em 10 idiomas, com a moeda e o país dos feriados escolhidos por você._

### Adicionado
- 10 idiomas: português, inglês, espanhol, francês, italiano, alemão, chinês, japonês, coreano e hindi. Na primeira abertura o Kami segue o idioma do sistema (fora desses 10, português); dá para trocar em configurações › aparência, e tudo muda na hora, sem reabrir — telas, avisos, mensagens de erro, conquistas, missões, o registro de atividade e até os registros antigos. Quem já usava continua em português. As traduções foram feitas com ajuda de IA: o link "sugerir correção" ao lado do idioma abre uma issue
- moeda (configurações › aparência): o símbolo e o formato dos valores em todo o app — só a aparência, nenhum valor é convertido. Quem já usava continua em real
- país dos feriados (configurações › aparência): o "5º dia útil" do salário e os vencimentos contam os feriados do país escolhido (76 países; os outros contam só sábado e domingo). Quem já usava continua no Brasil, que ganhou o 20 de novembro (Consciência Negra, feriado nacional desde 2024)
- a captura rápida (`Alt+Q`) entende datas e horas no idioma do app: "tomorrow 9am", "mañana 9h", "morgen 9 Uhr", "明天9点", "내일 9시"…
- no Linux, se faltar a fonte do chinês, japonês, coreano ou hindi, o Kami avisa com o pacote para instalar; os pacotes `.deb` e `.rpm` já recomendam as fontes
- "atualizar agora" também para quem instalou pelo `.rpm` (o sistema pede a senha para instalar)
- README e guia de instalação em inglês; a página de download fala o idioma do navegador

### Modificado
- títulos de widget longos quebram a linha em vez de serem cortados, e o botão "marcar como pago" desce de linha quando não cabe
- as listas de opções (moeda, país, idioma) aceitam digitar a letra para pular até a opção

### Corrigido
- a página de download não oferecia o instalador do Windows no Firefox

## [1.14.0] - 2026-10-23

_Fundação para a 2.0: aviso de versão nova pelo próprio app, cópias automáticas do banco, desinstalação sem rastros e a página de download explicando o aviso do Windows._

### Adicionado
- aviso de versão nova no sino: o Kami consulta a lista de versões do GitHub ao abrir e uma vez por dia (só isso sai da sua máquina; desliga em configurações › sobre, onde também tem "procurar agora"). Nada é baixado sozinho: no Windows e no AppImage, "atualizar agora" guarda uma cópia do banco, baixa, confere a assinatura da atualização e abre já na versão nova; quem instalou por `.deb`, `.rpm` ou AUR recebe o aviso e atualiza pelo gerenciador de pacotes. "Pular esta versão" tira o aviso do sino. Quem está na 1.13 instala esta versão à mão uma vez — o aviso vale a partir daqui
- cópias automáticas do banco: uma por semana (as 4 últimas) e uma antes de importar, apagar tudo, redefinir a chave, restaurar ou atualizar o app (as 5 últimas). Em configurações › backup e dados dá para ver as cópias, copiar agora, restaurar qualquer uma (o estado de agora é guardado antes) e escolher uma pasta extra — pendrive, HD externo ou uma pasta sincronizada (Drive, Dropbox, Nextcloud) — que recebe a cópia semanal também
- "remover tudo do kami deste computador" (configurações › backup e dados): para quem vai parar de usar o Kami numa máquina — apaga dados, cópias, a chave das senhas no cofre do sistema, o iniciar com o sistema, o ícone da cor e o cache da tela, e fecha; no Windows abre o desinstalador no fim. A pasta extra das cópias fica
- dicas novas aparecem uma vez para quem já tinha visto a tela (antes, só pelo "rever dicas desta tela")
- a página de download de cada versão diz qual arquivo baixar em cada sistema e, ao lado do instalador do Windows, que o aviso "editor desconhecido" é esperado, com o código (SHA256) do arquivo para conferir antes de "executar assim mesmo"

### Modificado
- desinstalar não deixa rastros: no Linux, removido o pacote, o Kami some do menu e não tenta mais abrir no login; `install.sh --uninstall` limpa o que ficou na pasta pessoal e, com `--apagar-dados`, apaga também os dados (pede confirmação). No Windows, "Remover dados do programa" no desinstalador apaga também a pasta de dados e a chave das senhas
- trocar o `.deb` pelo AppImage (ou mover o AppImage) não deixa o iniciar com o sistema apontando para um programa que não existe mais

### Corrigido
- `Ctrl+K` abria a busca por baixo das dicas da tela, e o `Esc` fechava a dica em vez da busca
- um lembrete criado só com a hora depois das 23h (`@ 23h30 remédio` às 23h10) ia para o dia seguinte; agora é hoje se a hora ainda não passou
- no Windows, ligar o iniciar com o sistema com o Kami aberto como administrador criava a entrada para todos os usuários do computador (e o desinstalador não a apagava); agora é sempre só para você, e desligar tira também uma entrada antiga dessas

### Testes
- o teste ponta a ponta do app compilado (Linux e Windows) passa pelas 9 telas e, com teclado de verdade, pela captura, um lembrete que tem que disparar, a busca, notas (inclusive trancada), formato das datas, cópias com restauração, PIN, bandeja, iniciar com o sistema, atualização pelo app (Windows) e "remover tudo"

### Manutenção
- arquivos grandes divididos por assunto (configurações, organização, finanças, aprendizado, grade dos widgets, migrações do banco), sem mudar comportamento
- Python 3.14, Node 24 e Rust fixados, com o guia `docs/MANUTENCAO.md` para quem voltar ao projeto depois de muito tempo
- conferência automática antes de cada release (versões iguais em todo lugar, CHANGELOG com data, tag no commit certo)

## [1.13.0] - 2026-10-21

_Sprint de organização: notas, captura rápida, busca em tudo, hábitos, lembretes com notificação do sistema e datas no formato do seu país._

### Adicionado
- notas em organização, com editor visual (títulos, listas, tarefas, citação, código, links), tags, cores, fixar e arquivar; uma nota pode ser ligada a uma meta, trilha, evento ou posição ("notas (N)" aparece lá) e, com o PIN ligado, trancada — o texto fica cifrado e só abre com o PIN
- nota rápida de qualquer tela com `Alt+Shift+N` e o widget "notas rápidas" (núcleo e perfil)
- captura rápida com `Alt+Q`: `$ 32,90 farmácia ontem` abre o lançamento preenchido, `# ideia` uma nota, `! sexta 14h reunião` um evento, `@ amanhã 9h ligar pro banco` um lembrete; o resto vai para a nova caixa de entrada, de onde vira gasto, tarefa, nota, meta, evento ou lembrete com um clique
- busca em tudo com `Ctrl+K` (notas, metas, hábitos, trilhas, lançamentos, contas, eventos, conquistas, carreira, links, e-mails…), sem ligar para acento, e comandos como "novo gasto" ou "ir para finanças"
- tela de hábitos (`Alt+9`): todo dia, dias fixos ou "x vezes por semana", lista do dia com um clique para marcar, grade das últimas 12 semanas (dá para marcar até 2 dias atrás), sequência e recorde por hábito, pausar e arquivar. Marcar dá +5 xp no atributo escolhido, conta na sequência geral e nas novas missões de hábito; widget "hábitos de hoje"
- lembretes com dia, hora e repetição, ligados opcionalmente a uma nota, conta fixa, meta ou hábito: avisam dentro do app (com "adiar 10 min / 1 h / amanhã") e pela notificação do sistema, ficam no sino até você dar "ok", e os que passaram com o app fechado aparecem ao abrir. Aparecem no calendário, que ganhou a aba "lembretes"
- configurações › notificações: escolher o que vira notificação do sistema (lembretes, vencimentos, eventos), esconder o texto delas (liga sozinho com o PIN) e a hora dos avisos de vencimento
- opcionais, desligados por padrão: manter o Kami na bandeja ao fechar (ele continua avisando) e iniciar com o sistema. Abrir o Kami de novo traz a janela que já está aberta
- leitura dos e-mails dentro do app: texto limpo, sem links de rastreamento nem HTML de terceiros, navegação por teclado e um link que abre o próprio e-mail no webmail; aviso quando a conta para de sincronizar por senha ou login
- formato das datas em configurações › aparência: seguir o sistema, dd/mm/aaaa, mm/dd/aaaa ou aaaa-mm-dd
- dicas das telas para tudo isso (caixa de entrada, lembretes, botão "lembrar", hábitos) e para os widgets de missões, notas rápidas e hábitos de hoje — em "rever dicas desta tela"

### Modificado
- as datas seguem o idioma do sistema (dd/mm/aaaa no Brasil) em todas as telas
- os campos de data dos formulários (lançamento, salário, posição, dívida, formação) são campos de data de verdade, no formato do sistema, em vez de texto "YYYY-MM-DD"
- o aviso diário de vencimentos virou um aviso só, com o que vence hoje e amanhã, na hora escolhida
- o sino também conta os itens da caixa de entrada e os lembretes pendentes
- avisos na tela se empilham acima do lembrete de backup em vez de ficarem um sobre o outro

### Corrigido
- campos de data que pediam a data digitada como "YYYY-MM-DD" (ex.: registro salarial) e confundiam a ordem
- num campo de data vazio, o Linux mostrava a data de hoje apagada, parecendo preenchido

## [1.12.0] - 2026-10-20

_Sprint de layout: as telas se organizam sozinhas em faixas alinhadas, cada uma com um layout padrão bem montado, e o ícone do app pode seguir a cor de destaque._

### Adicionado
- "restaurar padrão" em cada tela de widgets (perfil, núcleo, finanças, carreira), com desfazer
- na primeira abertura depois da atualização, o Kami avisa quando o layout padrão de uma tela melhorou e oferece aplicar — com desfazer
- ícone do app na cor de destaque, em configurações › aparência (desligado por padrão): muda a janela e a barra de tarefas na hora e, ao reabrir, o atalho do menu Iniciar/área de trabalho no Windows e o lançador no Linux

### Modificado
- os widgets se encaixam sozinhos em faixas: os que ficam lado a lado começam e terminam juntos, e a faixa seguinte começa reta — também quando os dados fazem um widget crescer, ao mudar o tamanho da janela, ao adicionar, remover ou arrastar. Nenhum widget é alargado para tapar espaço
- a grade usa 4 colunas também em telas grandes: o layout montado numa tela 1366 é o mesmo em 1920, só mais largo
- layout padrão novo em perfil, núcleo, finanças e carreira
- um widget removido e adicionado de novo volta para o lugar e o tamanho dele no layout padrão, em vez de cair no fim da tela
- os gráficos de evolução salarial, evolução do saldo e entradas vs saídas têm altura fixa: num widget largo não ficam mais enormes, com a linha grossa e as bolinhas grandes; os quadradinhos do mapa de atividade do perfil também têm tamanho máximo
- tooltip longa (ex.: o endereço de um e-mail) quebra linha em até 360px em vez de atravessar a tela
- dependências atualizadas (backend, Tauri, frontend e ações do CI)

### Corrigido
- em 1920×1080 sobrava uma faixa vazia à direita e buracos entre os widgets
- widgets ficavam 10 a 20px mais baixos que o conteúdo na abertura da tela, cortando o fim; e um widget readicionado aparecia com a lista cortada
- metas pessoais mostrava o título das metas cortado ("Res…")
- o aviso "sem avatar ainda" da barra lateral aparecia cortado
- os botões de configurações › sobre ficavam colados quando quebravam de linha
- sair de organização antes de terminar de carregar mostrava "algo deu errado nesta tela" na tela seguinte

## [1.11.0] - 2026-10-19

_Sprint de segurança: PIN opcional para abrir o app, backup com senha, as senhas salvas protegidas por uma chave no cofre do sistema, limites em toda entrada da API e auditoria contínua das dependências._

### Adicionado
- PIN opcional para abrir o app, em configurações › segurança: com ele ligado, nada do Kami carrega — nem pela API — antes do PIN certo. PIN de 4 a 8 dígitos, guardado só como hash; depois de 5 erros seguidos é preciso esperar (30 s, dobrando até 15 min), mesmo fechando e abrindo o app
- código de recuperação mostrado uma vez ao ligar o PIN (copiar e baixar `.txt`); "esqueci o PIN" na tela de bloqueio cria um PIN e um código novos. Sem o código, apagar `pin.json` da pasta de dados abre o app com todos os dados
- bloqueio por inatividade (5, 15 ou 30 min) e "bloquear agora", opcionais
- exportar backup com senha, marcado por padrão: o arquivo fica cifrado (AES-256-GCM, chave derivada da senha com scrypt), leva junto as senhas salvas (e-mail, GitHub, busca) e funciona em outro computador. A importação percebe sozinha que o arquivo pede senha
- configurações › segurança mostra onde está a chave das senhas salvas e, se o cofre perder a chave, oferece redefinir
- o diagnóstico de configurações › sobre diz onde está a chave das senhas salvas

### Modificado
- a chave que protege a senha de app do e-mail, o token do GitHub e a chave da busca saiu da pasta de dados e foi para o cofre do sistema (Gerenciador de Credenciais no Windows, Secret Service no Linux). A troca é automática na primeira abertura; sem cofre disponível, ela continua num arquivo só do dono, com aviso
- toda entrada da API tem limite: corpo de até 1 MB (50 MB na importação de backup), textos de até 200 caracteres (5.000 em descrições e notas) e números limitados; acima disso o app responde com uma mensagem clara em vez de erro interno
- dependências auditadas em todo PR e toda semana (pip, npm e cargo), com atualizações propostas toda semana

### Corrigido
- no Linux, fechar o app (ou reiniciar o backend) deixava o backend rodando escondido, ocupando memória e segurando o banco; agora ele encerra junto, e também sai sozinho se o app travar ou for fechado à força
- números absurdos no histórico de ações e na sincronização de e-mail davam erro interno

## [1.10.0] - 2026-10-19

_Sprint de confiabilidade: quando algo dá errado o Kami avisa, se recupera sozinho e guarda o que é preciso para investigar — e as regras de saldo e xp ganharam uma rede de testes que achou e corrigiu cinco bugs._

### Adicionado
- aviso de erro com código: um erro inesperado do backend aparece num aviso com um código (ex.: `#7f3a2c`) que também está no `kami-backend.log`, com "copiar detalhes"; banco ocupado, sem espaço em disco ou banco inacessível ou corrompido ganham uma mensagem própria. Erros da tela também passam a ir para o log
- vigia do backend: se o backend cair com o app aberto, uma faixa no topo avisa, o Kami reinicia o backend sozinho em ~15 s e recarrega a tela, sem fechar o app; se não voltar, a faixa oferece "reiniciar" e "abrir pasta do log"
- backup automático do banco antes de atualizar para uma versão nova, em `backups/` na pasta de dados (guarda as 3 últimas); se a atualização do banco falhar, ele volta sozinho para a cópia e o app avisa em vez de abrir pela metade
- configurações > sobre: versão do app e diagnóstico para relatar um problema (versão, sistema, tamanho do banco e fim do log), já sem dados pessoais — e-mails, chaves, senhas, valores em R$ e o nome da pasta pessoal saem antes; copiar, salvar `.txt`, abrir a pasta do log e "relatar um problema"
- corrigir e apagar um lançamento em finanças (lápis e lixeira): o saldo da conta e o xp acompanham. Lançamentos criados por conta fixa, assinatura, renda, meta ou dívida mostram a origem e se desfazem por ela
- apagar uma ação registrada à mão no log do núcleo, estornando o xp
- quitar dívida: marcar como paga escolhe a conta de onde sai o dinheiro (ou nenhuma), lança a saída e dá xp; voltar para "aberta" desfaz tudo

### Corrigido
- desfazer um pagamento ou reabrir um marco ou curso mantinha desbloqueada a conquista que deixou de valer
- pagar a última conta do mês só desbloqueava "contas em dia" na ação seguinte
- uma saída lançada com data retroativa não tirava "mês no azul" do mês que deixou de fechar positivo
- apagar uma conta fixa, assinatura ou fonte de renda deixava o xp dos meses pagos
- corrigir o valor ou a data de um salário não recalculava o xp dele
- abrir um mês novo podia dar erro no calendário ou nas contas fixas e assinaturas, quando a tela pedia o mês em várias requisições ao mesmo tempo
- apagar algo que não existe respondia de jeitos diferentes conforme a tela; agora é sempre "não encontrado"

### Modificado
- a tela de "não deu pra conectar" na abertura virou a mesma faixa do vigia, com as mesmas opções
- regras de negócio documentadas em `docs/REGRAS-DE-NEGOCIO.md`, cada uma com o teste que a garante
- testes rodam também no Windows em todo PR, e o app compilado é testado de ponta a ponta no Linux e no Windows (8 telas em 3 tamanhos, queda e volta do backend)

## [1.9.1] - 2026-10-17

_Ajustes pedidos depois da 1.9.0: o Windows para de abrir um terminal junto com o app, o scroll ganha a cara do Kami e o log passa a dizer quando cada coisa aconteceu._

### Corrigido
- no Windows, o app não abre mais uma janela de terminal junto (e fechar essa janela não derruba mais o Kami)
- botões de cor própria — "importar e sobrescrever" (âmbar), "limpar todos os dados" e "excluir" (vermelho) — não ficam mais com a cor do tema ao passar o mouse, focar pelo teclado ou clicar; desabilitados também mantêm a própria cor
- no Windows, o scroll aparecia como a barra nativa do sistema em vez da barra temática do app
- a barra de rolagem do roadmap de aprendizado aparecia no Windows e ficava escondida no Linux; agora aparece nos dois

### Modificado
- scroll novo em "blocos listrados": barra quadrada e listrada na cor de destaque, trilho com régua de marquinhas, cor cheia ao passar o mouse; listas menores (selects, roadmap) usam uma versão mais fina
- toda linha do `kami-backend.log` começa com a data e a hora local (ex.: `2026-10-17 16:42:07.684-03:00`), inclusive mensagens soltas e erros
- o log não grava mais os parâmetros das requisições (`?busca=...`), para buscas e filtros não ficarem no disco
- o nome "kami" no topo da janela fica sem o cursor piscando

## [1.9.0] - 2026-10-14

_Gamificação completa do Kami: o motor de xp ficou confiável e o app ganhou cara de jogo — conquistas, hábito, progressão e um visual e som de terminal antigo. Reúne o trabalho que estava versionado localmente como 1.8.3 a 1.8.6, que nunca foi publicado._

### Adicionado
- feedback de progresso em todos os módulos: "+xp"/"−xp" na tela, aviso de subida de nível e de conquista desbloqueada
- sequência de dias (atual e recorde) e nível geral do jogador no perfil (`GET /api/nucleo/player`)
- revisão do xp antigo em configurações > backup: simula, guarda uma cópia do banco e aplica
- 39 conquistas novas (50 no total) em todas as áreas: sequências de 3 a 365 dias, níveis de atributo, mês e trimestre no azul, contas em dia, trilha completa, maratona, promoção, meta épica, curador e outras
- conquistas com área, nível (bronze/prata/ouro) e secretas — secreta bloqueada aparece como `???`
- galeria de conquistas com filtro por uma ou mais áreas, desbloqueadas primeiro e bloqueadas ordenadas pelo progresso (ex: `[########--] 8/10`)
- conquistas personalizadas: "+ criar conquista" na galeria monta uma regra simples (quantidade de ações, área e palavra-chave opcional, ex: 10 ações em aprendizado com "inglês"), com a marca "sua" e opção de remover
- tela "LEVEL UP" em ASCII ao subir de nível geral, mostrando o que a subida desbloqueou
- barra de xp no perfil e linha de nível na barra lateral, preenchendo bloco a bloco
- proteção de sequência: a cada 7 dias com ação a sequência ganha uma proteção (até 2), que segura sozinha um dia em branco; conquistas de sequência aceitam dias protegidos
- chama em pixel art no perfil e na barra lateral, crescendo com a sequência, com as proteções guardadas ao lado; fica "blindada" quando uma proteção segurou o dia anterior, com o aviso "sequência salva!"
- missões: até 3 por dia e 1 por semana, sorteadas só entre as que dá para cumprir agora, concluídas sozinhas quando a ação acontece (+10/+40 xp) e devolvidas a pendente se a ação for desfeita; widget "missões" no topo do núcleo
- bônus de xp: +5 na primeira ação do dia, multiplicador de sequência (até 1,5×) e 2× no atributo mais atrasado, cada um com teto de +20 e numa linha própria no log e na tela; as prioridades mostram qual atributo rende 2×
- radar apaga o atributo sem atividade há 14 dias, sem perder xp
- títulos liberados pelo nível geral (iniciante, aprendiz, operador, veterano, mestre do terminal, lenda), exibidos sob o nome no perfil
- temas de terminal liberados por nível, por cima da cor de destaque: fósforo (nível 5), CRT com scanlines (nível 10) e âmbar clássico (nível 15); títulos e temas se escolhem em configurações > aparência
- classe do jogador no perfil, pelo atributo mais forte: Erudito, Mercador, Artífice, Estrategista, Arquivista ou Polímata (quando equilibrado)
- retrospectiva mensal em tela ASCII: abre sozinha no primeiro acesso do mês com o mês que acabou (xp por atributo, conquistas, melhor sequência, missões, ação do mês e comparação com o mês anterior), reabre pelo perfil e exporta em `.txt`
- efeitos visuais de terminal no app inteiro: títulos que se digitam, números que rolam, cards que ligam como um CRT, brilho de fósforo no hover, clique "pressionado", transição de tela e cursor em pixel art na cor de destaque
- aviso de conquista "estilo Steam" subindo do canto da tela (missão concluída e sequência salva usam o mesmo modelo, menor)
- opção de efeitos visuais em configurações > aparência: completo, sutil ou desligado (respeita também o "reduzir movimento" do sistema)
- sons 8-bit gerados na hora, sem arquivos de áudio, em três grupos que ligam e desligam sozinhos: progresso (+xp, nível, LEVEL UP, conquista, missão, sequência salva), interface (todo clique, com som próprio para confirmar, apagar, abas e opções; abrir e fechar janelas; trocar de tela; a abertura do app) e avisos (notificações, erros, confirmações e arquivos baixados); começam ligados, com volume e botão "ouvir" em configurações > aparência
- no diálogo de boas-vindas a kami "fala": voz em bipes, pausas depois da pontuação e o avatar mexendo enquanto ela escreve

### Corrigido
- desfazer uma ação (desmarcar pagamento, reabrir marco ou formação, apagar posição, salário, link, repositório ou meta) estorna o xp e o registro dela
- sincronizar repositório ou e-mail e contribuir com uma meta rendem xp no máximo 1x por dia
- ações manuais do núcleo limitadas a 50 xp
- data e hora gravadas e exibidas no fuso local do computador; registros antigos convertidos automaticamente
- sequência de dias, limites diários e calendário usam o dia local (ações à noite não contam mais como o dia seguinte)
- conquistas voltam a ficar bloqueadas quando o critério deixa de valer
- renomear uma conquista do catálogo não a duplica mais (chave estável)
- widgets deixam de acumular atualizações ao reorganizar o dashboard
- tooltips não piscam mais quando o widget é redesenhado com o mouse em cima
- textos do tutorial e das dicas alinhados às regras de xp

### Modificado
- balanceamento de xp: lançamento 3, pagamento recorrente 4, contribuição em meta 5, marco 20, sync do github 3
- ação manual do núcleo não conclui missão nem ganha bônus; bônus e missões não contam como ação nas conquistas de contagem
- critérios de conquista viram um registro de funções no backend (um tipo novo de regra é só uma função)
- "destaque" do perfil deu lugar à classe do jogador
- README descreve a gamificação completa


## [1.8.2] - 2026-10-07

### Documentação
- keep personal workflow notes local (#8)


## [1.8.1] - 2026-10-05

### Corrigido
- commit all synchronized version metadata
- polish roadmap, refresh app icons, and replace sidecar atomically


## [1.8.0] - 2026-10-02

### Adicionado
- adiciona seed de dados fictícios para gravar telas
- exige token de sessão entre o app e o backend local
- add verified Linux installation flow
- add release download page

### Corrigido
- allow bump-version without makepkg
- remove favicon do Google e corrige promessas de privacidade
- restringe permissões da chave e da pasta de dados
- isolate release notes and group CI
- persist sidecar startup logs

### Documentação
- prepara vitrine pública do Kami
- adiciona LICENSE, SECURITY.md e templates; reescreve aviso do Windows

### Testes
- remove dependência de fuso horário e usa nomes fictícios

### Manutenção
- alinha licença no PKGBUILD e reforça o .gitignore
- v1.7.3

### CI
- retain hidden Arch metadata in smoke artifact
- run smoke tests on installation branch
- add cross-platform installer smoke tests


## [1.7.3] - 2026-09-29

### Adicionado
- add verified Linux installation flow
- add release download page

### Corrigido
- isolate release notes and group CI
- persist sidecar startup logs

### CI
- retain hidden Arch metadata in smoke artifact
- run smoke tests on installation branch
- add cross-platform installer smoke tests


## [1.7.2] - 2026-09-22

### Corrigido
- permite imagens `blob:` no WebView2 para conversão de PNG/JPG em ASCII
- remove a janela de terminal aberta pelo sidecar do backend no Windows
- libera os URLs temporários das imagens após a conversão

## [1.7.1] - 2026-09-22

### Adicionado
- pré-carregamento dos dados de calendário, finanças e metas durante o boot

### Corrigido
- reutilização do cache de GET para abrir as telas sem novas esperas de rede
- aceitação explícita de formatos de imagem nos seletores de avatar

## [1.7.0] - 2026-09-21

### Adicionado
- atalhos globais, link para pular conteúdo e melhorias de acessibilidade
- perfil de atividade e novos componentes de suporte aos gráficos

### Corrigido
- foco, navegação por teclado, textos alternativos e cores de destaque
- interação dos modais, widgets e telas de calendário, metas e organização

### Testes
- cobertura adicional para acessibilidade, componentes, estado e fluxos de frontend

## [1.6.0] - 2026-09-14

### Adicionado
- aprimora acessibilidade e movimentação de widgets
- aprimorar acessibilidade e melhorar formulários de widgets

### Outros
- Adição de dicas de carreira contextuais e recurso de logotipo


## [1.5.0] - 2026-09-01

### Modificado
- padroniza nomenclatura para PT-BR e aplica achados da auditoria de código


## [1.4.0] - 2026-08-30

### Adicionado
- adiciona módulo Carreira, auto-import do GitHub e automações de sync/notificação

### Documentação
- atualiza README (versão, calendário/notificações, remove screenshots)

### Manutenção
- v1.3.1
- sincroniza versão do Tauri com v1.3.0

### Outros
- ci: sincroniza VERSION com tauri.conf.json/Cargo.toml antes do build
- Merge branch 'release/1.3.1' into develop
- ci: adiciona workflow de release (build Linux+Windows via tauri-action)
- Merge branch 'release/1.3.0' into develop


## [1.3.1] - 2026-08-24

### Adicionado
- workflow de CI (GitHub Actions) para build automático dos instaladores Linux e Windows a cada tag de release

### Documentação
- atualiza README (versão, calendário/notificações, remove screenshots)

### Manutenção
- sincroniza versão do Tauri com v1.3.0

## [1.3.0] - 2026-08-22

### Adicionado
- módulo Calendário — agrega eventos de contas fixas, dívidas, assinaturas, parcelas, metas e ações num só lugar, com filtros por tipo e navegação mensal
- hub de notificações centralizado (sino) substituindo o widget de notificações de organização, com sincronização automática de e-mail e silenciamento por remetente
- novo design da tela de e-mail em Organização

### Corrigido
- ajustes na tela de Calendário
- build.sh podia empacotar instalador de uma versão antiga

### Manutenção
- combo de ajustes em finanças, calendário, notificações, ícones e design

## [1.2.0] - 2026-08-10

### Adicionado
- lembrete de backup e Esc fecha modal
- onboarding completo — kami-intro + tour geral + dicas contextuais por tela
- modal de configurações, ícones novos e ajustes gerais de tema
- endpoints de sistema e catálogo de widgets servido pelo backend
- ajustes do módulo organização
- tipos novos, peso/xp e conexão com Finanças e Aprendizado
- adicao de configuracao de perfil ao iniciar o sistema sem cadastro
- Tauri, Readme, versionamento  e lapidacoes
- adicionando Onboarding ao sistema
- Ajustes de design, tela financeito completa, componentizacao de widgets, remocao do dinheiro como fixo no wallet
- tela metas
- tela organizacao (base) e tela de aprendizado (completa)
- forntend base, telas perfil, nucleo e designs padroes
- implementa v1 completo — perfil, nucleo, financas, aprendizado, metas, organizacao

### Corrigido
- remocao de metodos mortos e ajuste no readme
- update version in code to match tag 1.1.0
- Ajustes de design Readme
- testes de metas desatualizados

### Manutenção
- para de rastrear artefatos de build do backend
- atualiza dependências do Tauri
- remove artefatos de build do controle de versão
- merge release/1.1.0 back to develop
- v1.1.1
- torna bump-version.sh executável
- renomeia err-modal, adiciona teste do dashboard e anota decaimento de XP
- remove arquivos que deveriam estar no .gitignore

### Outros
- Merge pull request #1 from emanuel-frs/develop
- Merge branch 'release/1.1.0'
- Atualizacao dos testes de financas e wallet
- fase de lapidação final: titlebar, sidebar, ícones e reorganização do frontend
- Initial commit


## [1.1.0] - 2026-07-28

### Adicionado
- adicao de configuracao de perfil ao iniciar o sistema sem cadastro
- Tauri, Readme, versionamento  e lapidacoes
- adicionando Onboarding ao sistema
- Ajustes de design, tela financeito completa, componentizacao de widgets, remocao do dinheiro como fixo no wallet
- tela metas
- tela organizacao (base) e tela de aprendizado (completa)
- forntend base, telas perfil, nucleo e designs padroes
- implementa v1 completo — perfil, nucleo, financas, aprendizado, metas, organizacao

### Corrigido
- update version in code to match tag 1.1.0
- Ajustes de design Readme
- testes de metas desatualizados

### Manutenção
- torna bump-version.sh executável
- renomeia err-modal, adiciona teste do dashboard e anota decaimento de XP
- remove arquivos que deveriam estar no .gitignore

### Outros
- Merge pull request #1 from emanuel-frs/develop
- Merge branch 'release/1.1.0'
- Atualizacao dos testes de financas e wallet
- fase de lapidação final: titlebar, sidebar, ícones e reorganização do frontend
- Initial commit
