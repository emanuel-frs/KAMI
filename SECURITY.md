# Segurança

O Kami é um projeto pessoal mantido por uma pessoa. Levo relatos de
segurança a sério, mas o prazo de resposta é "melhor esforço".

## Como reportar

Abra uma issue **privada** pelo GitHub em
[Security → Report a vulnerability](https://github.com/emanuel-frs/KAMI/security/advisories/new)
(se a opção não aparecer, abra uma issue comum pedindo um canal privado,
**sem** detalhes técnicos da falha). Não publique exploits antes de eu
poder corrigir.

## Modelo de ameaça (o que o Kami protege e o que não protege)

- O backend escuta apenas em `127.0.0.1`, numa porta escolhida pelo
  sistema a cada execução. Toda chamada à API exige um **token de sessão**
  aleatório gerado a cada execução e lido pelo app a partir de um arquivo
  (`backend_token.txt`, permissão `0600` em Linux/macOS) na pasta de dados.
  Uma página aberta no navegador não consegue obtê-lo.
- Senhas de app (IMAP) e tokens (GitHub, busca) ficam **cifrados** no
  banco. Desde a 1.11 a chave fica no **cofre do sistema** (Gerenciador
  de Credenciais no Windows, Secret Service — GNOME Keyring, KWallet —
  no Linux), não na pasta de dados: quem copiar a pasta (backup em
  nuvem, pendrive) não leva a chave. Sem cofre disponível, a chave fica
  num arquivo `.secret_key` só do dono, e configurações › segurança
  avisa. Isso **não** protege contra outro programa rodando com o seu
  usuário (ele pode pedir a chave ao cofre como o Kami pede).
- Os instaladores do Windows **não são assinados** (veja
  [docs/INSTALACAO.md](docs/INSTALACAO.md)). Confira o SHA-256 publicado
  na Release.
- Não há atualização automática: baixe as novas versões pela página de
  Releases.

Fora de escopo: ataques que exigem acesso físico ou administrador à
máquina, e o funcionamento de serviços de terceiros (GitHub, Tavily,
provedores de e-mail).
