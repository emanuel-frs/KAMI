"""
Erros do assistente → resposta (IA-01/IA-02). Usado pelas rotas e pelo
laço da conversa (chat.py), que manda o mesmo erro como evento no meio do
streaming.

Uma ErroKami LITERAL por caso: tests/test_mensagens.py confere chave e
texto contra o pt.json do frontend.
"""
from app.assistente import config, provedores, transporte, uso
from app.mensagens import ErroKami


# Erro do provedor → resposta. Uma ErroKami literal por código (o teste
# tests/test_mensagens.py confere chave e texto contra o pt.json). Em
# `vars`: `detalhe` é o que o provedor disse (cortado, sem a chave da
# API), `http` o status dele, `local` o endereço de um redirecionamento.
def erro_do_provedor(e: transporte.ErroProvedor) -> ErroKami:
    v = {"detalhe": e.detalhe, "http": e.status, "local": e.local_redirecionado}
    c = e.codigo
    if c == "chave_invalida":
        return ErroKami(422, "erro.assistente.provedor.chave_invalida",
                        "o provedor recusou a chave — confira se colou a chave inteira e se ela ainda está ativa", **v)
    if c == "sem_credito":
        return ErroKami(422, "erro.assistente.provedor.sem_credito", "a conta no provedor está sem crédito ou cota", **v)
    if c == "limite":
        return ErroKami(429, "erro.assistente.provedor.limite",
                        "o provedor pediu pra esperar: muitas chamadas em pouco tempo", **v)
    if c == "modelo_indisponivel":
        return ErroKami(422, "erro.assistente.provedor.modelo_indisponivel",
                        "esse modelo não está disponível nesse provedor — escolha outro da lista", **v)
    if c == "sem_ferramentas":
        return ErroKami(422, "erro.assistente.provedor.sem_ferramentas",
                        "esse modelo não aceita ferramentas — escolha outro da lista", **v)
    if c == "url_errada":
        return ErroKami(422, "erro.assistente.provedor.url_errada",
                        "o endereço não respondeu como uma API de IA — confira a URL", **v)
    if c == "redirecionado":
        return ErroKami(422, "erro.assistente.provedor.redirecionado",
                        "o endereço mandou pra outro lugar ({local}) — por segurança o Kami não segue; confira a URL", **v)
    if c == "sem_conexao":
        return ErroKami(424, "erro.assistente.provedor.sem_conexao",
                        "não deu pra conectar ao provedor — confira a internet ou, se for local, se o programa está aberto", **v)
    if c == "tempo_esgotado":
        return ErroKami(424, "erro.assistente.provedor.tempo_esgotado", "o provedor demorou demais pra responder", **v)
    if c == "servidor":
        return ErroKami(424, "erro.assistente.provedor.servidor",
                        "o provedor está com problema agora — tente de novo daqui a pouco", **v)
    if c == "recusado":
        return ErroKami(422, "erro.assistente.provedor.recusado", "o provedor recusou o pedido", **v)
    return ErroKami(424, "erro.assistente.provedor.resposta_invalida", "o provedor respondeu algo que o Kami não entendeu", **v)


def url(endereco: str) -> tuple[str, bool]:
    try:
        return provedores.normalizar_url(endereco)
    except provedores.UrlInvalida as e:
        m = e.motivo
    if m == "vazia":
        raise ErroKami(422, "erro.assistente.url.vazia", "informe o endereço da API")
    if m == "esquema":
        raise ErroKami(422, "erro.assistente.url.esquema", "o endereço precisa começar com https://")
    if m == "credenciais":
        raise ErroKami(422, "erro.assistente.url.credenciais", "o endereço não pode ter usuário ou senha")
    if m == "consulta":
        raise ErroKami(422, "erro.assistente.url.consulta", "o endereço não pode ter ? nem #")
    if m == "http_fora_da_rede":
        raise ErroKami(422, "erro.assistente.url.http_fora_da_rede",
                       "http:// só vale pra este computador ou a rede local — use https://")
    raise ErroKami(422, "erro.assistente.url.host", "endereço inválido")


def falta(qual: str) -> ErroKami:
    if qual == "modelo":
        return ErroKami(422, "erro.assistente.falta.modelo", "escolha um modelo antes")
    if qual == "chave":
        return ErroKami(422, "erro.assistente.falta.chave", "cole a chave da API antes")
    return ErroKami(422, "erro.assistente.falta.provedor", "configure um provedor antes")


def teto(db, local: bool):
    try:
        uso.conferir(db, config.obter(db), local)
    except uso.TetoAtingido as e:
        if e.qual == "chamadas":
            raise ErroKami(429, "erro.assistente.teto.chamadas",
                           "o assistente chegou ao teto de {teto} chamadas de hoje — dá pra mudar em configurações › assistente",
                           usado=e.usado, teto=e.teto)
        raise ErroKami(429, "erro.assistente.teto.tokens",
                       "o assistente chegou ao teto de {teto} tokens de hoje — dá pra mudar em configurações › assistente",
                       usado=e.usado, teto=e.teto)
