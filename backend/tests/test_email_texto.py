"""
Testes de app/email_texto.py (ORG-06) — texto legível dos e-mails.

Os exemplos imitam o que chega de verdade: o link de marketing do print
do Emanuel (`[Statica](https://collect…/jwt/eyJ0…)`), o "preheader"
cheio de caracteres invisíveis, e-mail só em HTML com tabela de layout e
texto escondido, remetente com aspas.
"""
from email.message import EmailMessage

from app import email_texto as et
from app.email_texto import MARCA_FIM, MARCA_INI, MARCA_MEIO


def _links(texto):
    import re

    return re.findall(MARCA_INI + "([^" + MARCA_MEIO + "]*)" + MARCA_MEIO + "([^" + MARCA_FIM + "]*)" + MARCA_FIM, texto)


TOKEN = "https://collect.statica.com.br/jwt/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1IjoiYWJjIn0.x?utm_source=mail"


# ---------- texto plano ----------

def test_markdown_link_becomes_label_only():
    t = et.limpar_texto_plano(f"Conheça a [Statica]({TOKEN}) hoje")
    assert _links(t) == [("Statica", TOKEN)]
    assert et.previa(t) == "Conheça a Statica hoje"


def test_markdown_link_with_two_urls_and_no_closing_paren():
    # formato real (Slottica): duas URLs enormes com quebra de linha e, às
    # vezes, sem o ")" final
    a, b = TOKEN + "a" * 1400, TOKEN + "b" * 1600
    t = et.limpar_texto_plano(f"[Slottica]({a}\n{b})\n\nTexto\n\nclique no [link]({a}")
    assert _links(t) == [("Slottica", a), ("link", a)]
    assert "[" not in t and "](" not in t
    assert et.previa(t) == "Slottica Texto clique no link"


def test_bare_url_becomes_domain():
    t = et.limpar_texto_plano(f"acesse {TOKEN} agora")
    assert _links(t) == [("collect.statica.com.br", TOKEN)]
    assert "eyJ0" not in et.previa(t)
    assert et.previa(t) == "acesse collect.statica.com.br agora"


def test_url_in_brackets_after_label_becomes_arrow_only():
    t = et.limpar_texto_plano("Ver ofertas <https://loja.com/ofertas?id=9>\nFim [https://x.com/a]")
    assert _links(t) == [("", "https://loja.com/ofertas?id=9"), ("", "https://x.com/a")]
    assert et.previa(t) == "Ver ofertas Fim"


def test_markdown_link_whose_label_is_an_url_uses_domain():
    t = et.limpar_texto_plano("[https://www.site.com/x](https://www.site.com/x?t=1)")
    assert _links(t) == [("site.com", "https://www.site.com/x?t=1")]


def test_whitespace_and_blank_lines_collapse():
    t = et.limpar_texto_plano("Olá,\r\n\r\n\r\n\r\n   muitos     espaços\t\taqui   \n\n\n\nfim")
    assert t == "Olá,\n\nmuitos espaços aqui\n\nfim"


def test_invisible_preheader_characters_removed():
    t = et.limpar_texto_plano("͏ ‌ ͏ ‌ ­ Promoção relâmpago﻿")
    assert t == "Promoção relâmpago"


def test_ascii_dividers_become_blank():
    assert et.limpar_texto_plano("a\n==========\nb\n---------\nc") == "a\n\nb\n\nc"


def test_view_in_browser_lines_removed():
    texto = (
        "Visualizar este e-mail no navegador\n"
        "View this email in your browser <https://x.com/v>\n"
        "Problemas para visualizar? Clique aqui\n"
        "Conteúdo de verdade sobre o navegador novo"
    )
    assert et.limpar_texto_plano(texto) == "Conteúdo de verdade sobre o navegador novo"


def test_private_use_chars_in_input_cannot_fake_a_link():
    t = et.limpar_texto_plano(f"x{MARCA_INI}falso{MARCA_MEIO}javascript:alert(1){MARCA_FIM}y")
    assert _links(t) == []
    assert t == "xfalsojavascript:alert(1)y"


def test_plain_bullets_become_list_items_but_signature_stays():
    t = et.limpar_texto_plano("Veja:\n- um\n  * dois\n+ três\n\n-- \nFulano")
    assert t == "Veja:\n• um\n• dois\n• três\n\n--\nFulano"


def test_nested_quote_levels_collapse_to_one():
    assert et.limpar_texto_plano("> > > antigo\n> novo") == "> antigo\n> novo"


# ---------- prévia ----------

def test_preview_stops_at_signature_and_reply_header():
    t = et.limpar_texto_plano("Oi, tudo certo.\n\n-- \nFulano\nCEO")
    assert et.previa(t) == "Oi, tudo certo."
    t = et.limpar_texto_plano("Respondo já.\n\nEm 10/10/2026 10:00, Ana <ana@x.com> escreveu:\n> pergunta")
    assert et.previa(t) == "Respondo já."


def test_preview_skips_quoted_lines_and_bullets():
    t = et.limpar_texto_plano("> citado\nnovo texto\n• item")
    assert et.previa(t) == "novo texto item"


def test_preview_cuts_at_word_boundary():
    p = et.previa("palavra " * 100, maximo=50)
    assert p.endswith("…") and len(p) <= 51 and "palavr…" not in p


def test_preview_none_for_empty():
    assert et.previa("") is None
    assert et.previa(f"{MARCA_INI}{MARCA_MEIO}https://x.com{MARCA_FIM}") is None


# ---------- HTML ----------

HTML_MARKETING = """
<html><head><style>.x{color:red}</style><title>Newsletter</title>
<script>alert('xss')</script></head>
<body>
<div style="display:none;max-height:0;overflow:hidden">preheader escondido &#847; &zwnj;</div>
<table><tr><td><a href="https://loja.com/view">Ver no navegador</a></td></tr></table>
<table><tr><td><img src="https://track.loja.com/pixel.gif" alt="logo"></td></tr>
<tr><td><h1>Ofertas da semana</h1>
<p>Olá <b>Emanuel</b>, separamos&nbsp;estas ofertas:</p>
<ul><li>Fone por R$&nbsp;99</li><li>Mouse por R$ 49</li></ul>
<p><a href="https://click.loja.com/r?u=abc&amp;t=eyJ0">Comprar agora</a>.</p>
<p><a href="https://loja.com/a"><img src="x.png"></a></p>
<p><a href="javascript:alert(1)">perigoso</a></p>
<p><a href="https://www.loja.com/x">https://www.loja.com/x</a></p>
</td></tr></table>
</body></html>
"""


def test_html_converts_structure_and_drops_hidden_and_scripts():
    t = et.html_para_texto(HTML_MARKETING)
    assert "alert('xss')" not in t
    assert "preheader" not in t
    assert ".x{color" not in t and "Newsletter" not in t
    assert "Ver no navegador" not in t
    assert "Ofertas da semana" in t
    assert "Olá Emanuel, separamos estas ofertas:" in t
    assert "• Fone por R$ 99\n• Mouse por R$ 49" in t
    assert ("Comprar agora", "https://click.loja.com/r?u=abc&t=eyJ0") in _links(t)
    assert ("loja.com", "https://www.loja.com/x") in _links(t)
    # link só com imagem não vira nada; javascript: vira texto sem link
    assert all(url.startswith("https://") for _, url in _links(t))
    assert "perigoso" in t
    assert "\n\n\n" not in t


def test_html_link_text_followed_by_punctuation_keeps_it_attached():
    t = et.html_para_texto('<p>Veja <a href="https://a.com">aqui</a>.</p>')
    assert t.endswith(MARCA_FIM + ".")


def test_html_malformed_does_not_explode():
    t = et.html_para_texto("<div><p>abre<b>sem fechar<div>outro</span></p>texto</td>")
    assert "abre" in t and "outro" in t and "texto" in t


def test_html_blockquote_becomes_quote_lines():
    t = et.html_para_texto("<p>resposta</p><blockquote><p>pergunta antiga</p></blockquote>")
    assert "resposta" in t and "> pergunta antiga" in t
    assert et.previa(t) == "resposta"


# ---------- escolha plano × HTML ----------

def test_choose_plain_when_it_is_real():
    plano = "Olá, segue o relatório do mês com os números que combinamos. " * 3
    assert et.escolher_texto(plano, "<p>outro</p>").startswith("Olá, segue")


def test_choose_html_when_plain_is_a_stub():
    plano = "Seu cliente de e-mail não suporta HTML. Veja no navegador: https://x.com/v"
    html = "<p>" + "Conteúdo completo da newsletter. " * 20 + "</p>"
    assert et.escolher_texto(plano, html).startswith("Conteúdo completo")


def test_choose_html_when_no_plain():
    assert et.escolher_texto(None, "<p>só html</p>") == "só html"
    assert et.escolher_texto(None, None) == ""


# ---------- corte ----------

def test_cut_never_splits_a_link():
    texto = "a" * 95 + et.link("rótulo", "https://x.com/" + "b" * 40)
    cortado, foi = et.cortar_texto(texto, maximo=100)
    assert foi and MARCA_INI not in cortado and cortado.endswith("…")


def test_cut_not_needed():
    assert et.cortar_texto("curto", maximo=100) == ("curto", False)


# ---------- remetente ----------

def test_sender_split():
    assert et.separar_remetente('"Gabriel Granjeiro - Gran" <gabriel@gran.com>') == (
        "Gabriel Granjeiro - Gran",
        "gabriel@gran.com",
    )
    assert et.separar_remetente("ana.silva@x.com") == ("ana.silva", "ana.silva@x.com")
    assert et.separar_remetente("") == ("", "")


# ---------- webmail ----------

def test_webmail_gmail_opens_message_by_id():
    url = et.url_webmail("imap.gmail.com", "eu@gmail.com", "<abc.123@mail.gmail.com>")
    assert url == "https://mail.google.com/mail/?authuser=eu@gmail.com#search/rfc822msgid%3Aabc.123%40mail.gmail.com"


def test_webmail_gmail_opens_message_directly_with_gmail_id():
    # X-GM-MSGID em decimal -> hexadecimal na URL do Gmail
    url = et.url_webmail("imap.gmail.com", "eu@gmail.com", "<x@y>", "1278455344230334865")
    assert url == "https://mail.google.com/mail/?authuser=eu@gmail.com#all/" + format(1278455344230334865, "x")
    assert et.url_webmail("imap.gmail.com", "eu@gmail.com", None, "nao-numero").endswith("?authuser=eu@gmail.com")


def test_webmail_known_and_unknown_hosts():
    assert et.url_webmail("IMAP.GMAIL.COM", "eu@gmail.com", None) == "https://mail.google.com/mail/?authuser=eu@gmail.com"
    assert et.url_webmail("imap.gmail.com", "", None) == "https://mail.google.com/mail/"
    assert et.url_webmail("outlook.office365.com", "eu", None) == "https://outlook.office.com/mail/"
    assert et.url_webmail("mail.empresa.com", "eu", "<x>") is None


# ---------- extração ponta a ponta (router) ----------

def test_extract_body_html_only_message_has_preview():
    from app.routers.organizacao import _extract_body

    msg = EmailMessage()
    msg["Subject"] = "x"
    msg.set_content("<p>Promoção: <a href='" + TOKEN + "'>Statica</a></p>", subtype="html")
    texto, cortado, previa = _extract_body(msg)
    assert previa == "Promoção: Statica"
    assert not cortado and _links(texto) == [("Statica", TOKEN)]


def test_extract_body_ignores_attachments_and_unknown_charset():
    from app.routers.organizacao import _extract_body

    msg = EmailMessage()
    msg.set_content("corpo de verdade")
    msg.add_attachment(b"<p>anexo</p>", maintype="text", subtype="html", filename="a.html")
    texto, _, _ = _extract_body(msg)
    assert texto == "corpo de verdade"

    msg = EmailMessage()
    msg.set_payload("ol\xe1".encode("latin-1"))
    msg["Content-Type"] = 'text/plain; charset="x-inventado"'
    msg["Content-Transfer-Encoding"] = "8bit"
    texto, _, _ = _extract_body(msg)
    assert texto == "olá"
