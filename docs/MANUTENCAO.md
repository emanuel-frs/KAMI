# Manutenção: voltando depois de muito tempo

Guia para quem retoma o Kami depois de meses (ou anos) parado, seja para
soltar uma correção, seja para continuar o desenvolvimento. Ele descreve
o que costuma ter envelhecido e em que ordem conferir. O passo a passo de
cada release continua no README e nos workflows.

## Versões fixadas

| Ferramenta | Onde está fixada | Observação |
|---|---|---|
| Python | `.python-version` e `python-version:` nos workflows | vai **dentro** do backend empacotado (PyInstaller); suporte do 3.14 até out/2030 |
| Node.js | `.nvmrc` e `node-version:` nos workflows | só para os testes do frontend; suporte do 24 até abr/2028 |
| Rust | `rust-toolchain.toml` e `toolchain:` nos workflows | o `rustup` instala a versão sozinho ao rodar `cargo` |
| Actions do GitHub | SHA de cada `uses:` nos workflows | o Dependabot atualiza o SHA e o comentário da versão |

Para subir uma delas, troque **todos** os lugares da linha da tabela no
mesmo commit e rode o CI inteiro (PR para `main`, que inclui o e2e).

## Primeiro dia de volta

1. `git pull` em `main` e `develop`; confira se há PRs do Dependabot
   abertos e se a auditoria (`.github/workflows/auditoria.yml`) está
   falhando. Ela roda toda segunda; vulnerabilidade alta ou crítica a faz
   falhar, e uma exceção vencida em `.github/auditoria-excecoes.toml`
   também.
2. Recrie os ambientes locais: `python3.14 -m venv .venv` +
   `pip install -r backend/requirements.txt pytest-cov pyinstaller`, e
   `npm ci`.
3. Rode `pytest` (em `backend/`) e `npm test`. Se algo quebrou só por
   tempo (data fixa, versão de dependência), corrija antes de mexer em
   qualquer outra coisa.
4. Rode o CI manualmente (aba Actions → Smoke test → "Run workflow") para
   saber se os runners do GitHub ainda servem (próxima seção).

## Runners do GitHub que vão ser aposentados

O GitHub aposenta imagens antigas de tempos em tempos e avisa antes. Os
jobs que usam imagem fixa passam a falhar com "the runner image is
deprecated/removed".

- **`ubuntu-22.04`** (build Linux, release, smoke test): é a imagem mais
  antiga disponível de propósito. O binário Linux compilado nela roda nas
  distros com glibc igual ou mais nova, então trocar para `ubuntu-24.04`
  deixa de fora quem tem distro mais antiga. Ao trocar, confira o
  AppImage e o `.deb` numa distro da época da imagem antiga e atualize a
  seção de sistemas suportados do README.
- **`windows-2022`** (só o job `e2e-windows`): está preso nela porque o
  WebView2 133 em diante quebra a automação pelo `msedgedriver` (ver o
  comentário no `smoke-test.yml`). Quando ela sumir, tente
  `windows-latest` primeiro, porque a Microsoft pode ter corrigido. Se
  ainda falhar com "DevToolsActivePort file doesn't exist", uma saída a
  tentar é instalar uma versão antiga do WebView2 Runtime ("Fixed
  Version") dentro do job e apontar o app para ela
  (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`).
- O build do Windows usa `windows-latest`: normalmente basta continuar
  funcionando.

## Atualizar dependências em bloco

O Dependabot abre um PR por ecossistema (pip, cargo, npm, actions),
agrupado, para `develop`. Depois de muito tempo parado:

1. Junte tudo numa branch: `git switch -c chore/deps-<data> develop`, faça
   merge dos PRs do Dependabot (ou rode `pip install -U`, `cargo update`,
   `npm update` e suba os mínimos do `backend/requirements.txt`).
2. Versão maior (ex.: FastAPI 1.0, Tauri 3): leia o guia de migração
   antes. Nesse caso, uma por PR.
3. CI completo + o app real aberto: as 9 telas, configurações, backup
   com senha, PIN.
4. Se um PR do Dependabot foi fechado sem merge, ele passa a ignorar
   aquela versão; para voltar, comente `@dependabot unignore <nome>` num
   PR dele.

## Soltar uma correção partindo da última versão

Exemplo: a última publicada é a 2.0.0 e apareceu um bug.

1. `git switch -c hotfix/2.0.1 main`
2. Corrija, com teste; rode `pytest` e `npm test`.
3. `./scripts/bump-version.sh 2.0.1 --no-tag`, reescreva a entrada do
   `CHANGELOG.md` à mão e faça o commit `chore(release): v2.0.1`.
   `./scripts/conferir-release.sh` tem que terminar em "pronto pra
   release" (o CI do PR e o `release.yml` rodam o mesmo script).
4. PR para `main` (o CI roda o e2e), merge com merge commit, tag **no
   commit de release** (`git tag -a v2.0.1 <commit> -m v2.0.1 && git push
   origin v2.0.1`). O `release.yml` gera e publica os instaladores; não
   use `gh release create`.
5. Traga a correção para `develop`:
   `git switch develop && git merge --ff-only origin/main` (ou merge
   normal, se `develop` andou).

## A chave de assinatura das atualizações

O aviso de versão nova (DIST-01) consulta o `latest.json` da última
Release e, se a pessoa pede "atualizar agora", confere o pacote baixado
com a **chave pública** que está em `src-tauri/tauri.conf.json` ›
`plugins.updater.pubkey`. A **chave privada** (com senha) assina o
AppImage e o instalador do Windows na release:

- no GitHub: secrets `TAURI_SIGNING_PRIVATE_KEY` (o conteúdo do arquivo
  `.key`) e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. O `release.yml` para
  logo no começo se faltar um deles;
- fora do GitHub: o arquivo `kami-updater.key` e a senha, guardados pelo
  Emanuel (gerenciador de senhas / pendrive). Gerados em 2026-10-22 com
  `cargo tauri signer generate`.

Os builds do smoke test não assinam (`--config ci/sem-updater.json`): a
chave só existe na release.

**Trocar a chave sem perder ninguém:** publique uma versão assinada com a
chave ANTIGA que já traga a pública NOVA no `tauri.conf.json`; quem
atualizar por ela passa a aceitar a nova. Só depois troque os secrets.

**Se a privada se perder:** quem já tem o app não aceita mais
atualização pelo app (assinatura não confere) e precisa baixar o
instalador novo na página de Releases uma vez. Gere uma chave nova,
troque a pública no `tauri.conf.json` e os secrets, e avise nas notas da
release.

**Testar a atualização** sem publicar nada: compile com
`--config ci/teste-atualizacao.json` (única configuração que aceita http)
e aponte o app pra um servidor local com `KAMI_ATUALIZACAO_URL=http://127.0.0.1:<porta>/latest.json`
— o `scripts/gerar_latest_json.py` monta o arquivo a partir dos `.sig`.
