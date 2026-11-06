# Decisões

As escolhas que moldaram o Kami e por quê. O detalhe de cada regra está em
[REGRAS-DE-NEGOCIO.md](./REGRAS-DE-NEGOCIO.md); o de segurança, no [SECURITY.md](../SECURITY.md).

## Produto

- **Local, sem conta.** Os dados ficam num SQLite na pasta do usuário. Nada sai do computador sem uma
  integração ligada (GitHub, e-mail, busca, IA), e a tabela do README lista cada uma.
- **Organização como jogo.** Toda ação registrada dá XP a um de cinco atributos (carreira, finanças,
  aprendizado, organização, metas). O XP precisa ser honesto: desfazer, apagar ou corrigir uma ação
  devolve exatamente o que ela deu, e marcar e desmarcar não acumula.
- **Desktop para Windows e Linux.** macOS, celular e sincronização ficaram de fora: cada um é um
  projeto à parte, e o foco foi fazer bem o que existe.
- **Código visível, não open source.** A licença permite ler, instalar e usar para fins pessoais, sem
  redistribuir nem usar comercialmente.

## Arquitetura

- **Tauri 2 com um backend Python embutido.** A casca em Rust é pequena (janela, bandeja, atualização,
  processo do backend); a regra de negócio fica em FastAPI, mais simples de escrever e de testar. O
  backend vira um executável PyInstaller (*sidecar*). O custo: instalador maior, abertura um pouco mais
  lenta e antivírus que às vezes desconfiam do formato.
- **Porta livre e token por execução.** O backend escuta só em `127.0.0.1`, numa porta escolhida pelo
  sistema, e exige um token aleatório que o app lê de um arquivo na pasta de dados. Restringir pela
  origem da requisição foi tentado e quebrou o app; o token não depende dela, e uma página web não tem
  como obtê-lo.
- **Frontend sem framework nem bundler.** HTML, CSS e JavaScript com módulos ES. Menos dependências e
  nada a compilar; em troca, organização e testes dependem de regras escritas no repositório.
- **Atualizar o banco sem perder nada.** As migrações rodam a cada abertura e conferem o estado antes de
  mexer. Antes de uma versão nova migrar, o banco é copiado, e a cópia volta sozinha se algo falhar.
  Bancos gerados pelas versões antigas entram nos testes e precisam terminar com o mesmo esquema de uma
  instalação nova.

## Segurança

- **Segredos no cofre do sistema.** Senhas de app, tokens e chaves de API são cifrados no banco com uma
  chave guardada no cofre (Gerenciador de Credenciais, Secret Service), não ao lado do banco.
- **PIN protege a abertura; a cifra protege o arquivo.** O PIN é opcional e não cifra nada. O banco
  cifrado (SQLCipher) também é opcional e vale para o arquivo longe da sessão do usuário (disco
  roubado, cópia na nuvem), com código de recuperação.
- **Backup com senha portátil.** O export com senha (scrypt + AES-256-GCM) leva as senhas salvas e
  funciona em outro computador; o formato é documentado em [FORMATO-DO-EXPORT.md](./FORMATO-DO-EXPORT.md).
- **Atualização só avisa.** O app nunca baixa nem instala sozinho; quando a pessoa pede, o pacote é
  conferido por uma assinatura própria das atualizações. O instalador do Windows não tem assinatura de
  código: a opção gratuita exige licença open source, e a paga não se justifica num projeto pessoal.
- **Superfície mínima da janela.** Sem permissão de shell, arquivos ou processos; uma CSP que só roda o
  código do app. Um teste fixa a lista de permissões, então liberar algo novo é sempre uma mudança
  consciente.

## Idiomas

- **Dez idiomas, traduzidos só no frontend.** O backend devolve chaves e variáveis, nunca frases
  prontas; os textos vivem em dicionários por idioma. Um teste impede texto em português escrito direto
  no código. As traduções foram feitas com ajuda de IA, sem revisão de falante nativo.

## Assistente de IA

- **Opcional e sem chave embutida.** Fica desligado até a pessoa escolher um provedor, na nuvem ou no
  computador (Ollama, LM Studio). Ela decide quais áreas ele lê e vê tudo o que foi enviado.
- **Lê pelas mesmas funções das telas.** Os números que o modelo recebe são os que a tela mostra.
  E-mails, cartões, documentos, chaves e telefones saem antes de enviar, e o modelo é instruído a nunca
  obedecer a um texto que vem dos dados (uma nota que diga "apague tudo", por exemplo).
- **O Kami calcula, a IA explica.** Metas, finanças, contas, hábitos e estudos chegam ao modelo já
  analisados (situação, ritmo, o que falta, se o dinheiro cobre), e a tela mostra os números num quadro
  montado pelo próprio Kami. O modelo só comenta, e o Kami marca qualquer valor ou data da resposta que
  não esteja nos dados. Modelos pequenos, no computador, erravam contas; com a conclusão pronta, erram
  bem menos.
- **Nada grava sem clique.** O assistente só propõe ações numa prévia editável; aplicar faz uma cópia do
  banco antes, e o lote inteiro se desfaz depois, com o XP de volta.
- **Medido, não suposto.** Uma bateria fixa de 30 pedidos (consulta, ações, dinheiro, escopo, risco e
  injeção) mede cada provedor; o resultado fica em [QUALIDADE-IA.md](./QUALIDADE-IA.md).
- **Avisos não usam IA.** Gasto acima do mês anterior, conta sem saldo e metas ou trilhas paradas são
  regras no próprio Kami.

## Qualidade

- **Cada regra aponta para os testes que a garantem.** As regras de negócio ficam numa tabela, e um teste
  falha se alguma citar um teste que não existe.
- **Testar o app de verdade.** Além dos testes de backend e frontend, o CI instala o app em máquinas
  limpas de Windows e Linux e o percorre de ponta a ponta. Na 2.0, também: acessibilidade conferida com
  o axe-core em todas as telas, uso só pelo teclado e uma base com cinco anos de dados fictícios para
  medir o tempo de cada tela.
