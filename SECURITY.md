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
  banco com uma chave (`.secret_key`) guardada na mesma pasta de dados.
  Isso evita segredos em texto puro, mas **não** protege contra outro
  programa rodando com o seu usuário nem contra quem tenha acesso à sua
  conta do sistema. Guardar a chave no cofre do sistema está no roadmap.
- Os instaladores do Windows **não são assinados** (veja
  [docs/INSTALACAO.md](docs/INSTALACAO.md)). Confira o SHA-256 publicado
  na Release.
- Não há atualização automática: baixe as novas versões pela página de
  Releases.

Fora de escopo: ataques que exigem acesso físico ou administrador à
máquina, e o funcionamento de serviços de terceiros (GitHub, Tavily,
provedores de e-mail).
