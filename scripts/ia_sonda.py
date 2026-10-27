#!/usr/bin/env python3
"""
Sonda dos provedores de IA (IA-01; base do IA-08): roda os adaptadores do
backend contra os provedores DE VERDADE, sem banco e sem o app aberto.

Pra cada provedor do arquivo de chaves:
  1. lista os modelos (/models);
  2. "testar conexão" igual ao botão da tela (a ferramenta de teste);
  3. uma conversa curta em streaming, medindo o tempo até o 1º pedaço;
  4. uma ida e volta completa de ferramenta (pedido → resultado → resposta).

As chaves ficam FORA do repositório (P-108), num arquivo só seu (0600):

    ~/.config/kami-dev/chaves.env
        GEMINI_API_KEY=...
        GEMINI_MODELO=gemini-...          (opcional; sem ele só lista)
        GROQ_API_KEY=...
        GROQ_MODELO=...
        OPENROUTER_API_KEY=...
        OPENROUTER_MODELO=...:free
        OLLAMA_MODELO=qwen2.5-coder:7b     (local, sem chave)

Uso (da raiz do repositório):
    .venv/bin/python scripts/ia_sonda.py              # todos do arquivo
    .venv/bin/python scripts/ia_sonda.py groq ollama  # só esses

Nunca imprime a chave. Cada execução gasta umas 4 chamadas por provedor.
"""
import os
import stat
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.assistente import catalogo, provedores, transporte  # noqa: E402
from app.assistente.tipos import (  # noqa: E402
    Chamada, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso,
)

ARQUIVO = Path(os.environ.get("KAMI_CHAVES_DEV", Path.home() / ".config" / "kami-dev" / "chaves.env"))
PREFIXO = {"gemini": "GEMINI", "groq": "GROQ", "openrouter": "OPENROUTER", "openai": "OPENAI",
           "anthropic": "ANTHROPIC", "ollama": "OLLAMA", "lmstudio": "LMSTUDIO"}

SALDO = Ferramenta(
    nome="saldo_do_mes",
    descricao="Devolve quanto a pessoa gastou e recebeu no mês informado (formato AAAA-MM).",
    parametros={"type": "object", "properties": {"mes": {"type": "string", "description": "AAAA-MM"}}, "required": ["mes"]},
)


def ler_chaves() -> dict:
    if not ARQUIVO.exists():
        return {}
    modo = stat.S_IMODE(ARQUIVO.stat().st_mode)
    if modo & 0o077:
        print(f"aviso: {ARQUIVO} pode ser lido por outros usuários (chmod 600 {ARQUIVO})")
    valores = {}
    for linha in ARQUIVO.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            valores[k.strip()] = v.strip().strip('"').strip("'")
    return valores


def conversa(p: Provedor, mensagens, ferramentas=None):
    inicio = time.monotonic()
    primeiro, texto, chamadas, uso, fim = None, "", [], None, None
    for ev in provedores.adaptador(p.tipo).conversar(p, mensagens, ferramentas):
        if isinstance(ev, TextoDelta):
            primeiro = primeiro or time.monotonic() - inicio
            texto += ev.delta
        elif isinstance(ev, Chamada):
            chamadas.append(ev.chamada)
        elif isinstance(ev, Uso):
            uso = ev
        elif isinstance(ev, Fim):
            fim = ev.motivo
    return {"texto": texto, "chamadas": chamadas, "uso": uso, "fim": fim,
            "primeiro_s": primeiro, "total_s": time.monotonic() - inicio}


def sondar(cat: dict, chave: str | None, modelo: str | None) -> bool:
    url, local = provedores.normalizar_url(cat["url_base"])
    p = Provedor(cat["tipo"], url, modelo, chave, local)
    print(f"\n== {cat['nome']} ({url})")
    try:
        modelos = provedores.listar_modelos(p)
        print(f"   modelos: {len(modelos)} — ex.: {', '.join(modelos[:6])}{' …' if len(modelos) > 6 else ''}")
        if modelo and modelo not in modelos:
            print(f"   aviso: {modelo} não está na lista do /models")
        if not modelo:
            print("   sem <PREFIXO>_MODELO no arquivo — parei na lista")
            return True
        t = provedores.testar(p)
        print(f"   testar conexão: ok · ferramentas={t['ferramentas']} · {t['ms']} ms · uso={t['uso']}")
        r = conversa(p, [Mensagem("sistema", "Responda em português do Brasil, em uma frase curta."),
                         Mensagem("usuario", "Diga oi e conte até cinco.")])
        print(f"   streaming: 1º pedaço em {r['primeiro_s'] or 0:.2f} s, total {r['total_s']:.2f} s, fim={r['fim']}, uso={r['uso']}")
        print(f"   resposta: {r['texto'][:160]!r}")
        pedido = [Mensagem("sistema", "Você é um assistente de finanças. Use as ferramentas quando precisar de dados."),
                  Mensagem("usuario", "Quanto eu gastei em 2026-10?")]
        r1 = conversa(p, pedido, [SALDO])
        if not r1["chamadas"]:
            print(f"   ida e volta: o modelo NÃO pediu a ferramenta (fim={r1['fim']}): {r1['texto'][:120]!r}")
            return True
        c = r1["chamadas"][0]
        print(f"   ida e volta: pediu {c.nome}({c.argumentos})")
        pedido += [Mensagem("assistente", r1["texto"], r1["chamadas"]),
                   Mensagem("ferramenta", '{"gastos": 1234.5, "receitas": 3100}', id_chamada=c.id, nome_ferramenta=c.nome)]
        r2 = conversa(p, pedido, [SALDO])
        print(f"   ida e volta: respondeu {r2['texto'][:160]!r} (fim={r2['fim']})")
        return True
    except transporte.ErroProvedor as e:
        print(f"   ERRO {e.codigo} (http {e.status}): {e.detalhe} {e.local_redirecionado}")
        return False


def main(nomes: list[str]) -> int:
    chaves = ler_chaves()
    alvo = nomes or [c for c, pre in PREFIXO.items() if f"{pre}_API_KEY" in chaves or f"{pre}_MODELO" in chaves]
    if not alvo:
        print(f"nada pra testar — crie {ARQUIVO} (ver o cabeçalho deste script)")
        return 1
    ok = True
    for nome in alvo:
        cat = catalogo.obter(nome)
        if not cat:
            print(f"\n== {nome}: não está no catálogo")
            ok = False
            continue
        pre = PREFIXO[nome]
        ok = sondar(cat, chaves.get(f"{pre}_API_KEY"), chaves.get(f"{pre}_MODELO")) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
