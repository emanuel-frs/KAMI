"""
Texto legível dos e-mails da Organização (ORG-06).

Antes a prévia era o text/plain cru, achatado e cortado em 280
caracteres: links de marketing apareciam inteiros (com o token de
rastreamento), e-mail só em HTML ficava "sem prévia disponível" e não
dava pra ler mais do que isso sem abrir o webmail. Aqui fica tudo que
transforma o corpo de um e-mail num texto limpo — funções puras, sem
banco nem rede, testadas sozinhas em tests/test_email_texto.py.

Regra que não muda: **nunca guardar nem renderizar HTML de terceiro.**
O HTML só é LIDO aqui, por html.parser da biblioteca padrão (um
tokenizador: não executa script, não baixa imagem, não resolve CSS), e
o que sai é texto puro. O frontend monta a tela com textContent.

Formato do texto guardado (coluna email_cache.body_text):
  - linhas de texto comum; linha em branco separa parágrafos;
  - "• " no começo = item de lista; "> " = trecho citado (resposta);
  - link = MARCA_INI + texto + MARCA_MEIO + url + MARCA_FIM, com
    caracteres da área de uso privado do Unicode (U+E000..E002) — nenhum
    e-mail de verdade usa esses caracteres (e os que aparecerem são
    removidos na entrada), então não tem ambiguidade com colchetes ou
    parênteses do próprio texto, o que aconteceria com `[texto](url)`.
    Texto vazio = link sem rótulo (ex.: "Ver agora <https://...>" no
    text/plain): a tela mostra só o "↗".
"""
import re
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urlsplit

MARCA_INI = ""
MARCA_MEIO = ""
MARCA_FIM = ""

TEXTO_MAX = 20_000  # P-27: ~20 mil caracteres do texto completo
PREVIA_MAX = 280

# caracteres invisíveis que o marketing usa pra encher o "preheader"
# (aquele texto que aparece do lado do assunto no Gmail) — sem tirar, a
# prévia começa com dezenas de espaços "fantasmas".
_INVISIVEIS = re.compile(
    "[­͏؜ᅟᅠ឴឵᠎​-‏"
    "‪-‮⁠-⁤⁪-⁯ㅤ﻿ﾠ-]"
)
_ESPACOS = re.compile(r"[ \t\f\v  -   　]+")
_URL = r"https?://[^\s<>\[\]()\"']+"
_MARKDOWN_LINK = re.compile(r"\[([^\]\n]{1,300})\]\(\s*(" + _URL + r")\s*\)")
_URL_ENVOLTA = re.compile(r"\s?(?:<\s*(" + _URL + r")\s*>|\[\s*(" + _URL + r")\s*\]|\(\s*(" + _URL + r")\s*\))")
_URL_SOLTA = re.compile(_URL)
_LINK_MARCADO = re.compile(MARCA_INI + "([^" + MARCA_MEIO + "]*)" + MARCA_MEIO + "([^" + MARCA_FIM + "]*)" + MARCA_FIM)
_DIVISORIA = re.compile(r"^\s*[-=_*~#.·•]{4,}\s*$")

# linhas que só existem porque o e-mail é HTML ("veja no navegador") —
# no Kami não ajudam em nada. Reconhecidas pela linha inteira, pra não
# cortar uma frase que só mencione o navegador.
_LINHAS_INUTEIS = re.compile(
    r"^\W*("
    r"(clique aqui )?(para |pra )?(visualizar|ver|abrir)( este| esse| o)?( e-?mail| mensagem)?( no| em seu| no seu)? navegador"
    r"|(ver|veja|visualize)( a)? vers[aã]o (web|online|no navegador)"
    r"|(est[aá] com )?problemas (para|pra|ao) visualizar.*"
    r"|n[aã]o (est[aá] )?conseguindo visualizar.*"
    r"|view (this )?(email |e-mail |message )?(in|on) (your |a )?(web )?browser"
    r"|(having )?trouble viewing( this)?( email| e-mail| message)?.*"
    r"|view (it )?online"
    r")\W*$",
    re.IGNORECASE,
)
# começo de resposta citada ("Em 10/10/2026, Fulano escreveu:") — a
# prévia para aí; o texto completo mantém.
_CABECALHO_CITACAO = re.compile(r"^(em|on) .{4,200}(escreveu|wrote)\s*:\s*$", re.IGNORECASE)


def link(texto: str, url: str) -> str:
    return f"{MARCA_INI}{texto}{MARCA_MEIO}{url}{MARCA_FIM}"


def dominio(url: str) -> str:
    """'https://www.loja.com.br/x?utm=...' -> 'loja.com.br' (rótulo curto
    pra link sem texto, e o que a tela mostra no lugar da URL)."""
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _url_ok(url: str) -> bool:
    return bool(url) and url.lower().startswith(("http://", "https://")) and bool(dominio(url))


def _parece_url(texto: str) -> bool:
    t = texto.strip().lower()
    return t.startswith(("http://", "https://", "www."))


def _rotulo(texto: str, url: str) -> str:
    """Texto do link sem URL por extenso: se o "texto" já é uma URL (muito
    comum: <a href=X>X</a>), vira só o domínio."""
    texto = " ".join(texto.split())
    if not texto or _parece_url(texto):
        return dominio(url)
    return texto[:300]


def _normalizar_espacos(texto: str) -> str:
    """Espaços repetidos viram um; espaço no fim da linha some; mais de
    uma linha em branco seguida vira uma só; divisórias de ASCII
    (=====, -----) viram linha em branco."""
    linhas = []
    for linha in texto.split("\n"):
        linha = _ESPACOS.sub(" ", linha).strip()
        if _DIVISORIA.match(linha):
            linha = ""
        linhas.append(linha)
    texto = "\n".join(linhas)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip("\n ")


def _tirar_linhas_inuteis(texto: str) -> str:
    return "\n".join(l for l in texto.split("\n") if not _LINHAS_INUTEIS.match(_LINK_MARCADO.sub(r"\1", l)))


def limpar_texto_plano(texto: str) -> str:
    """text/plain cru -> texto no formato descrito no topo do módulo."""
    if not texto:
        return ""
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    texto = _INVISIVEIS.sub("", texto)
    # citação "> > texto" vira "> texto" (um nível basta pra ler)
    texto = re.sub(r"(?m)^(?:>\s?)+", "> ", texto)
    # "- item" / "* item" / "+ item" viram o item de lista do formato
    # ("-- " sozinho é assinatura: não tem texto depois, não casa)
    texto = re.sub(r"(?m)^[ \t]*[-*+•][ \t]+(?=\S)", "• ", texto)

    # 1) [texto](url) — o formato que gerou a reclamação
    texto = _MARKDOWN_LINK.sub(lambda m: link(_rotulo(m.group(1), m.group(2)), m.group(2)), texto)
    # 2) "Ver agora <url>" / "[url]" / "( url )": o texto antes já é o rótulo,
    #    a URL vira só o ↗
    texto = _URL_ENVOLTA.sub(lambda m: link("", m.group(1) or m.group(2) or m.group(3)), texto)

    # 3) URL solta no meio do texto -> domínio (sem mexer nas já marcadas)
    def _soltas(trecho: str) -> str:
        return _URL_SOLTA.sub(lambda m: link(dominio(m.group(0)), m.group(0)), trecho)

    partes = re.split("(" + MARCA_INI + "[^" + MARCA_FIM + "]*" + MARCA_FIM + ")", texto)
    texto = "".join(p if p.startswith(MARCA_INI) else _soltas(p) for p in partes)

    return _normalizar_espacos(_tirar_linhas_inuteis(texto))


class _ConversorHtml(HTMLParser):
    """HTML -> texto, guardando só estrutura de bloco (parágrafo, quebra,
    lista, citação) e os links. Tolerante a HTML malformado (o normal em
    e-mail): fechar uma tag desempilha até a correspondente, e tag sem
    abertura é ignorada."""

    _IGNORAR = {"script", "style", "head", "title", "noscript", "template", "svg", "object", "iframe", "xml"}
    _BLOCOS = {
        "p", "div", "table", "tr", "tbody", "thead", "tfoot", "section", "article", "header", "footer",
        "center", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "dl", "dt", "dd", "pre", "address",
        "main", "nav", "aside", "figure", "figcaption", "form", "fieldset",
    }
    _VAZIAS = {"br", "img", "hr", "meta", "link", "input", "area", "base", "col", "embed", "source", "wbr", "track"}
    _OCULTO = re.compile(
        r"display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0(?![.\d])|"
        r"font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])|mso-hide\s*:\s*all",
        re.IGNORECASE,
    )

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.saida: list[str] = []
        self.pilha: list[tuple[str, bool]] = []  # (tag, esconde o conteúdo?)
        self.escondido = 0
        self.link_url: Optional[str] = None
        self.link_texto: list[str] = []
        self.citacao = 0
        # quebras pedidas e ainda não escritas: vale a MAIOR, não a soma —
        # "</div><div>" ou "</li><li>" não podem virar várias linhas em
        # branco (e-mail de marketing aninha div/table dezenas de níveis)
        self.pendente = 0

    def _emitir(self, s: str) -> None:
        if self.pendente and self.saida:
            self.saida.append("\n" * self.pendente + ("> " if self.citacao else ""))
        self.pendente = 0
        self.saida.append(s)

    def _escrever(self, s: str) -> None:
        if self.escondido:
            return
        if self.link_url is not None:
            self.link_texto.append(s)
        elif s.strip() or not self.pendente:
            self._emitir(s)

    def _quebra(self, n: int = 1) -> None:
        if self.escondido:
            return
        self._fechar_link()
        self.pendente = max(self.pendente, n)

    def _fechar_link(self) -> None:
        if self.link_url is None:
            return
        url, texto = self.link_url, "".join(self.link_texto)
        self.link_url, self.link_texto = None, []
        if texto.strip():
            self._emitir(" " + link(_rotulo(texto, url), url) + " " if _url_ok(url) else texto)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self._VAZIAS:
            if tag == "br":
                self._quebra()
            elif tag == "hr":
                self._quebra(2)
            return
        oculto = tag in self._IGNORAR or "hidden" in a or bool(self._OCULTO.search(a.get("style") or ""))
        self.pilha.append((tag, oculto))
        if oculto:
            self.escondido += 1
            return
        if tag == "blockquote":
            self.citacao += 1
            self._quebra(2)
        elif tag == "li":
            self._quebra()
            self._escrever("• ")
        elif tag in self._BLOCOS:
            self._quebra(2 if tag in ("p", "h1", "h2", "h3", "table", "ul", "ol") else 1)
        elif tag in ("td", "th"):
            self._escrever(" ")
        elif tag == "a":
            self._fechar_link()
            self.link_url = (a.get("href") or "").strip()
            self.link_texto = []

    def handle_endtag(self, tag):
        if not any(t == tag for t, _ in self.pilha):
            return  # fechamento sem abertura: ignora
        while self.pilha:
            t, oculto = self.pilha.pop()
            if oculto:
                self.escondido -= 1
            elif t == "a":
                self._fechar_link()
            elif t == "blockquote":
                self.citacao = max(0, self.citacao - 1)
                self._quebra(2)
            elif t in self._BLOCOS:
                self._quebra(2 if t in ("p", "h1", "h2", "h3", "table", "ul", "ol") else 1)
            if t == tag:
                break

    def handle_data(self, data):
        self._escrever(" ".join(data.split("\n")))

    def texto(self) -> str:
        self._fechar_link()
        return "".join(self.saida)


def html_para_texto(html: str) -> str:
    """HTML de e-mail -> texto no formato do topo do módulo."""
    if not html:
        return ""
    conversor = _ConversorHtml()
    try:
        conversor.feed(_INVISIVEIS.sub("", html))
        conversor.close()
    except Exception:  # html.parser é tolerante, mas não confiamos em e-mail de terceiro
        pass
    texto = conversor.texto()
    # espaço sobrando em volta do link marcado, colado a pontuação
    texto = re.sub(r" +([,.;:!?)])", r"\1", texto)
    texto = re.sub(r"(?m)^> *$", "", texto)
    return _normalizar_espacos(_tirar_linhas_inuteis(texto))


def tamanho_visivel(texto: str) -> int:
    return len(_LINK_MARCADO.sub(r"\1", texto).replace("\n", " ").strip())


def escolher_texto(plano: Optional[str], html: Optional[str]) -> str:
    """Decide entre o text/plain e o HTML convertido.

    O text/plain ganha (é o que o remetente escreveu como texto), a não
    ser que seja só um "abra no navegador"/stub: muito menor que o HTML
    e curto. Aí o HTML convertido dá muito mais o que ler."""
    texto_plano = limpar_texto_plano(plano or "")
    if not html:
        return texto_plano
    texto_html = html_para_texto(html)
    tp, th = tamanho_visivel(texto_plano), tamanho_visivel(texto_html)
    if tp < 200 and th > tp * 4:
        return texto_html
    return texto_plano or texto_html


def cortar_texto(texto: str, maximo: int = TEXTO_MAX) -> tuple[str, bool]:
    """Corta no limite sem partir um link marcado ao meio. Devolve
    (texto, foi_cortado)."""
    if len(texto) <= maximo:
        return texto, False
    corte = texto[:maximo]
    ini, fim = corte.rfind(MARCA_INI), corte.rfind(MARCA_FIM)
    if ini > fim:
        corte = corte[:ini]
    espaco = max(corte.rfind("\n"), corte.rfind(" "))
    if espaco > maximo * 0.9:
        corte = corte[:espaco]
    return corte.rstrip() + "…", True


def previa(texto: str, maximo: int = PREVIA_MAX) -> Optional[str]:
    """Texto completo -> uma linha curta pra lista: links viram só o
    rótulo (ou somem, se não têm), citação e assinatura ficam de fora."""
    if not texto:
        return None
    linhas = []
    for linha in texto.split("\n"):
        if linha in ("-- ", "--") or _CABECALHO_CITACAO.match(linha):
            break
        if linha.startswith(">"):
            continue
        linhas.append(linha)
    plano = _LINK_MARCADO.sub(lambda m: m.group(1), " ".join(linhas))
    plano = " ".join(plano.replace("• ", "").split())
    if not plano:
        return None
    if len(plano) <= maximo:
        return plano
    corte = plano[:maximo]
    espaco = corte.rfind(" ")
    if espaco > maximo * 0.7:
        corte = corte[:espaco]
    return corte.rstrip(" ,.;:-") + "…"


def separar_remetente(remetente: str) -> tuple[str, str]:
    """'"Gabriel - Gran" <gabriel@x.com>' -> ('Gabriel - Gran', 'gabriel@x.com').
    Sem nome, usa a parte antes do @ (mesmo critério da inicial do avatar)."""
    from email.utils import parseaddr

    nome, endereco = parseaddr(remetente or "")
    nome = nome.strip().strip("\"'").strip()
    if not endereco and not nome:
        return (remetente or "").strip(), ""
    if not nome:
        nome = endereco.split("@")[0] if "@" in endereco else endereco
    return nome, endereco


# webmail por servidor IMAP — só os conhecidos; o resto fica sem o botão
# "abrir no webmail" (melhor que mandar pra um lugar errado).
_WEBMAIL = {
    "imap.gmail.com": "gmail",
    "imap.googlemail.com": "gmail",
    "outlook.office365.com": "https://outlook.office.com/mail/",
    "imap-mail.outlook.com": "https://outlook.live.com/mail/",
    "imap.outlook.com": "https://outlook.live.com/mail/",
    "imap.mail.yahoo.com": "https://mail.yahoo.com/",
    "imap.mail.me.com": "https://www.icloud.com/mail/",
    "imap.zoho.com": "https://mail.zoho.com/",
    "imap.uol.com.br": "https://email.uol.com.br/",
    "imap.terra.com.br": "https://mail.terra.com.br/",
}


def url_webmail(imap_host: str, usuario: str, message_id: Optional[str]) -> Optional[str]:
    """Link pro webmail da conta. No Gmail abre o próprio e-mail (busca
    pelo Message-ID, `rfc822msgid:`); nos outros, a caixa de entrada.

    Gmail: a conta vai em `?authuser=<e-mail>`. O formato
    `/mail/u/<e-mail>/` dava "Temporary Error (404)" no navegador do
    Emanuel (visto no teste do ORG-06); `authuser` é o parâmetro que o
    próprio Google usa pra escolher entre contas logadas e aceita o
    endereço (não só o índice 0, 1, 2...)."""
    from urllib.parse import quote

    destino = _WEBMAIL.get((imap_host or "").strip().lower())
    if destino != "gmail":
        return destino
    base = "https://mail.google.com/mail/"
    if usuario and "@" in usuario:
        base += "?authuser=" + quote(usuario, safe="@")
    mid = (message_id or "").strip().strip("<>")
    if not mid:
        return base
    return base + "#search/" + quote("rfc822msgid:" + mid, safe="")
