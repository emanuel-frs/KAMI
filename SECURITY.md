# Segurança

O Kami é um projeto pessoal mantido por uma pessoa. Levo relatos de
segurança a sério, mas o prazo de resposta é "melhor esforço".

## Como reportar

Abra uma issue **privada** pelo GitHub em
[Security → Report a vulnerability](https://github.com/emanuel-frs/KAMI/security/advisories/new)
(se a opção não aparecer, abra uma issue comum pedindo um canal privado,
**sem** detalhes técnicos da falha). Não publique exploits antes de eu
poder corrigir.

## Modelo de ameaça

O Kami é um app de uma pessoa só, que roda na máquina dela. O que ele
tenta proteger: os seus dados contra **outros sites** abertos no
navegador, contra **quem copia a pasta de dados** (backup em nuvem,
pendrive, arquivo compartilhado), contra **quem senta no computador
destravado** (com o PIN ligado) e contra **entrada malformada** na API.

### O que o Kami protege

- **API só local e com token.** O backend escuta apenas em `127.0.0.1`,
  numa porta escolhida pelo sistema a cada execução. Toda chamada exige
  um **token de sessão** aleatório, gerado a cada execução e lido pelo app
  de um arquivo (`backend_token.txt`, `0600` no Linux) na pasta de dados.
  Uma página aberta no navegador não consegue obtê-lo.
- **Senhas salvas no cofre do sistema.** Senha de app do e-mail, token do
  GitHub e chave da busca ficam cifrados no banco, e desde a 1.11 a chave
  que os abre fica no **cofre do sistema** (Gerenciador de Credenciais no
  Windows; Secret Service — GNOME Keyring, KWallet — no Linux), não na
  pasta de dados. Sem cofre disponível, a chave fica num arquivo
  `.secret_key` só do dono, e configurações › segurança avisa. Se o cofre
  perder a chave, o Kami não cria outra por cima em silêncio: avisa e
  oferece redefinir (apagando os segredos, que são cadastrados de novo).
- **PIN opcional pra abrir o app.** Ligado em configurações › segurança,
  o backend nasce **bloqueado** e não entrega dado nenhum pela API (`423`)
  até o PIN certo — não é só a tela que esconde. PIN de 4 a 8 dígitos,
  guardado só como hash scrypt; 5 erros seguidos fazem esperar 30 s,
  dobrando até 15 min, mesmo fechando e abrindo o app. Ao ligar, aparece
  **uma vez** um código de recuperação. Bloqueio por inatividade é
  opcional (5, 15 ou 30 min).
- **Backup com senha.** Exportar com senha (o padrão) gera um arquivo
  cifrado com AES-256-GCM, chave derivada da senha por scrypt
  (N=2¹⁷, r=8, p=1); alterar qualquer byte do arquivo faz a abertura
  falhar. Esse backup leva as senhas salvas e funciona em outro
  computador. O backup **sem** senha é texto legível e avisa disso.
- **Entrada validada.** Corpo de requisição limitado a 1 MB (50 MB na
  importação), textos e números com limite em todas as rotas, e um teste
  que varre a API inteira com entradas absurdas garante que nenhuma vira
  erro 500.
- **Logs sem segredos.** O registro de requisições do `kami-backend.log`
  não grava parâmetros, corpos nem cabeçalhos (o token e as senhas nunca
  passam por ele). O diagnóstico de configurações › sobre ainda tira
  e-mails, chaves, senhas, valores e a pasta pessoal antes de mostrar o
  texto.
- **Superfície mínima do app.** A janela não tem permissão de shell,
  arquivos nem processos; só abre links `http`/`https`. A CSP só roda o
  código do próprio app e só fala com o backend local. Um teste fixa essa
  lista — liberar algo novo é uma mudança consciente.
- **Dependências auditadas.** Em todo PR e toda semana, `pip-audit`,
  `npm audit` e `cargo audit` rodam no CI e falham com vulnerabilidade
  alta ou crítica; o Dependabot propõe atualizações toda semana; as
  actions do GitHub são fixadas por SHA.

### O que o Kami NÃO protege

- **Outro programa rodando com o seu usuário.** Ele lê o `kami.db`
  direto e pode pedir a chave ao cofre como o Kami pede. O PIN **não
  cifra** o banco — protege a abertura do app.
- **Quem já tem a sua sessão do sistema aberta e o Kami destravado.** Use
  o bloqueio por inatividade ou "bloquear agora".
- **Esqueci o PIN e o código.** É de propósito que dá pra entrar: com o
  app fechado, apagar `pin.json` da pasta de dados abre o Kami sem PIN,
  com todos os dados. O PIN impede o acesso casual, não o de quem
  controla a sua conta do sistema.
- **Backup sem senha.** Quem tiver o arquivo lê tudo.
- **Acesso físico ou de administrador** à máquina, e o funcionamento de
  serviços de terceiros (GitHub, Tavily, provedores de e-mail).

## O que sai da sua máquina

Nada, a não ser que você ative uma integração — a tabela completa está no
[README](./README.md#privacidade-o-que-sai-da-sua-máquina): GitHub,
IMAP do seu e-mail e a busca, cada um só quando você cadastra. Não há
telemetria nem conta de usuário.

O **assistente com IA** (planejado) segue a mesma regra: fica desligado
até você configurar uma chave sua (ou um modelo local), nenhuma chave vem
embutida, e só o necessário para cada pedido é enviado. Esta seção será
atualizada com o que exatamente sai quando ele existir.

## Instaladores

Os instaladores do Windows **não são assinados** (veja
[docs/INSTALACAO.md](./docs/INSTALACAO.md)): confira o SHA-256 publicado
no `SHA256SUMS` de cada Release. Não há atualização automática — baixe as
novas versões pela página de Releases.

Assinatura, no futuro: a opção gratuita da
[SignPath Foundation](https://signpath.org/) exige uma licença open
source aprovada pela OSI, e o Kami hoje é código visível, não open source.
As alternativas são mudar a licença ou um serviço pago (Azure Trusted
Signing, certificado OV).
