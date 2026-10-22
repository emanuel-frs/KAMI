"""
Módulo Organização (v1).

Três fontes, conforme decisão de arquitetura:
  - links:  cadastro simples, agrupado por categoria (CRUD puro, sem API externa)
  - github: 1+ repositórios, status sincronizado via API do GitHub. Sem
            token cadastrado, usa autenticação anônima (só repositórios
            públicos, rate limit de 60 req/h por IP). Com token pessoal
            cadastrado (ver PUT /github-token), autentica via header
            Authorization — libera repositórios privados do usuário e um
            limite de requisições bem maior. Repositórios têm uma
            coluna `source`: 'manual' (cadastrados um a um por aqui) ou 'auto'
            (importados automaticamente ao salvar/trocar o token — ver
            PUT /github-token e _auto_import_repos). Trocar o token remove só
            os 'auto' da conta anterior e reimporta da conta nova; repos
            'manual' nunca são tocados por esse processo.
  - email:  1+ contas IMAP reais, sem resumo por IA no v1 (campo summary_text
            fica reservado pro pós-mvp); senha de app guardada criptografada
            (ver app/crypto.py)

A busca rápida (org-search no mockup) usa a
API da Tavily (https://tavily.com) — free tier real (1000
créditos/mês, sem cartão), e já devolve um "answer" resumido pronto
além dos links, o que evita ter que montar esse resumo aqui a partir
de snippets crus. A chave é pessoal (cadastro gratuito do usuário) e
fica guardada criptografada em search_settings (mesmo esquema do
token do github/senha de app do IMAP — ver app/crypto.py); sem chave
configurada, o endpoint devolve 422 e o frontend cai pro link "abrir
no duckduckgo" como antes.

Endpoints:
  GET    /api/organizacao/links                    lista links (filtro opcional por categoria)
  POST   /api/organizacao/links                     cria link
  PUT    /api/organizacao/links/{id}                edita link (todos os campos opcionais,
                                                     mesmo padrão de PUT /email-accounts/{id})
  DELETE /api/organizacao/links/{id}                remove link

  GET    /api/organizacao/github-repos              lista repos cadastrados (com cache atual)
  POST   /api/organizacao/github-repos              cadastra repo + sincroniza na hora
  PUT    /api/organizacao/github-repos/{id}/sync    força resync do status
  DELETE /api/organizacao/github-repos/{id}         remove repo

  GET    /api/organizacao/email-accounts            lista contas (nunca devolve a senha)
  POST   /api/organizacao/email-accounts            cadastra conta (senha vai criptografada)
  PUT    /api/organizacao/email-accounts/{id}       edita conta (todos os campos opcionais —
                                                     só reescreve o que vier no payload; se
                                                     app_password vier, recriptografa e troca;
                                                     se não vier, mantém a senha salva)
  DELETE /api/organizacao/email-accounts/{id}       remove conta (cache junto, CASCADE)
  POST   /api/organizacao/email-accounts/{id}/sync  conecta via IMAP e atualiza o cache

  GET    /api/organizacao/email-cache               lista e-mails em cache (filtro por account_id/is_read/
                                                     exclude_muted)
  PUT    /api/organizacao/email-cache/{id}/read      marca e-mail como lido

  GET    /api/organizacao/muted-accounts            lista contas de e-mail silenciadas
  POST   /api/organizacao/muted-accounts             silencia uma conta inteira (idempotente)
  DELETE /api/organizacao/muted-accounts/{id}        dessilencia (remove da lista)

  GET    /api/organizacao/search-key                status da chave da tavily (nunca devolve a chave)
  PUT    /api/organizacao/search-key                 cadastra/troca a chave (valida contra a api antes de salvar)
  DELETE /api/organizacao/search-key                 remove a chave
  GET    /api/organizacao/search?q=...               busca via tavily — resumo + lista de resultados

Regras de negócio / XP (mesmo padrão do financas.py — ação automática
credita XP pequeno em 'organizacao'; ajuste os valores se não for o
comportamento esperado):
  - adicionar um link:            +2xp
  - sincronizar e-mail com sucesso: +3xp (1x por chamada de sync, não por e-mail novo)
  - sincronizar repo do github:    +2xp
  - editar uma conta de e-mail:   sem XP (não é uma "ação" nova, é manutenção)
"""
# MAN-02: o módulo virou pacote, uma parte por assunto (links.py,
# github.py, emails.py, busca.py), mas continua UM router montado em
# /api/organizacao (main.py não mudou). Nenhum caminho se confunde entre
# as partes, então a ordem dos include_router não importa. `urllib`,
# `imaplib` e `_extract_body` ficam visíveis aqui porque os testes trocam
# `app.routers.organizacao.urllib.request.urlopen` e `...imaplib.IMAP4_SSL`
# (o módulo da stdlib é o mesmo objeto em todas as partes) e importam
# `_extract_body` daqui. (emails.py, não email.py: não confundir com o
# pacote `email` da stdlib, que emails.py usa.)
import imaplib  # noqa: F401
import urllib.request  # noqa: F401

from fastapi import APIRouter

from app.routers.organizacao import busca, emails, github, links
from app.routers.organizacao.emails import _extract_body  # noqa: F401

router = APIRouter()
router.include_router(links.router)
router.include_router(github.router)
router.include_router(emails.router)
router.include_router(busca.router)
