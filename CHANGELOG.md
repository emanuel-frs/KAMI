# Changelog

Todas as mudanças notáveis do Kami são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [Semantic Versioning](https://semver.org/lang/pt-BR/).

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


