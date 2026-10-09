# Changelog

Todas as mudanças notáveis do Kami são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [1.8.5] - 2026-10-09

### Adicionado
- proteção de sequência: a cada 7 dias com ação a sequência ganha uma proteção (até 2), que segura sozinha um dia em branco; conquistas de sequência aceitam dias protegidos
- chama em pixel art no perfil e na barra lateral, crescendo com a sequência, com as proteções guardadas ao lado; fica "blindada" quando uma proteção segurou o dia anterior
- aviso "sequência salva!" uma vez por dia protegido
- missões: até 3 por dia e 1 por semana, sorteadas só entre as que dá para cumprir agora, concluídas sozinhas quando a ação acontece (+10/+40 xp) e devolvidas a pendente se a ação for desfeita
- widget "missões" no topo do núcleo e aviso "missão concluída"
- bônus de xp: +5 na primeira ação do dia, multiplicador de sequência (até 1,5×) e 2× no atributo mais atrasado, cada um com teto de +20 e numa linha própria no log e na tela
- prioridades mostram qual atributo rende 2×
- radar apaga o atributo sem atividade há 14 dias, sem perder xp

### Modificado
- ação manual do núcleo não conclui missão nem ganha bônus
- bônus e missões não contam como ação nas conquistas de contagem
- README descreve a parte de hábito da gamificação

## [1.8.4] - 2026-10-09

### Adicionado
- 39 conquistas novas (50 no total) em todas as áreas: sequências de 3 a 365 dias, níveis de atributo, mês e trimestre no azul, contas em dia, trilha completa, maratona, promoção, meta épica, curador e outras
- conquistas com área, nível (bronze/prata/ouro) e secretas — secreta bloqueada aparece como `???`
- galeria de conquistas com filtro por uma ou mais áreas, desbloqueadas primeiro e bloqueadas ordenadas pelo progresso
- tela "LEVEL UP" em ASCII ao subir de nível geral
- opção de efeitos visuais em configurações > aparência: completo, sutil ou desligado
- barra de xp no perfil e linha de nível na barra lateral, preenchendo bloco a bloco

### Corrigido
- tooltips não piscam mais quando o widget é redesenhado com o mouse em cima

### Modificado
- critérios de conquista viram um registro de funções no backend (um tipo novo de regra é só uma função)
- README descreve a gamificação atual do núcleo

## [1.8.3] - 2026-10-08

### Adicionado
- feedback de progresso em todos os módulos: "+xp"/"−xp" na tela, aviso de subida de nível e de conquista desbloqueada
- sequência de dias (atual e recorde) e nível geral do jogador no perfil (`GET /api/nucleo/player`)
- progresso das conquistas bloqueadas na galeria (ex: `[########--] 8/10`)
- revisão do xp antigo em configurações > backup: simula, guarda uma cópia do banco e aplica
- chave estável para as conquistas do seed (renomear não duplica mais)

### Corrigido
- desfazer uma ação (desmarcar pagamento, reabrir marco ou formação, apagar posição, salário, link, repositório ou meta) estorna o xp e o registro dela
- sincronizar repositório ou e-mail e contribuir com uma meta rendem xp no máximo 1x por dia
- ações manuais do núcleo limitadas a 50 xp
- data e hora gravadas e exibidas no fuso local do computador; registros antigos convertidos automaticamente
- sequência de dias, limites diários e calendário usam o dia local (ações à noite não contam mais como o dia seguinte)
- conquistas voltam a ficar bloqueadas quando o critério deixa de valer
- widgets deixam de acumular atualizações ao reorganizar o dashboard
- textos do tutorial e das dicas alinhados às regras de xp

### Modificado
- balanceamento de xp: lançamento 3, pagamento recorrente 4, contribuição em meta 5, marco 20, sync do github 3


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
