"""
Notas da Organização (ORG-01).

Rotas (prefixo /api/organizacao/notas):
  GET    /                       lista (resumo, sem o texto inteiro). Filtros:
                                 q (título/texto/tag), tag, arquivadas, fixadas,
                                 vinculo_tipo + vinculo_id
  GET    /tags                   tags em uso, com quantas notas cada
  GET    /alvos?tipo=            itens que podem ser vinculados ({id, nome}) — o
                                 seletor de vínculo do editor
  GET    /contagem?vinculo_tipo= quantas notas por item vinculado ({id: n}) —
                                 o "notas (N)" de metas, trilhas, eventos, posições
  GET    /{id}                   nota inteira (trancada: sem o texto)
  POST   /                       cria (xp, ver abaixo)
  PUT    /{id}                   edita (parcial — o editor salva sozinho)
  DELETE /{id}                   apaga (estorna o xp se foi criada hoje)
  POST   /{id}/abrir             nota trancada: confere o PIN e devolve o texto
                                 + uma chave de acesso pra salvar/apagar
  POST   /{id}/trancar           tranca (exige o PIN ligado)
  POST   /{id}/destrancar        destranca de vez (confere o PIN)

Texto: markdown leve (o editor do frontend é WYSIWYG, mas o que chega
aqui e é guardado é markdown — nunca HTML; ver
frontend/js/components/nota-markdown.js). Assim a busca, a exportação e
a IA (Sprint 6) leem texto puro.

xp (P-32): só ao CRIAR, e no máximo NOTAS_XP_POR_DIA notas por dia rendem
xp (nota é barata de criar — sem teto virava "farm"). Apagar uma nota
criada hoje estorna; criar de novo depois volta a contar, mas o saldo
nunca passa de NOTAS_XP_POR_DIA notas por dia.

Nota trancada (P-33/P-50): só com o PIN de abertura ligado (SEG-02). O
texto vai cifrado com a chave do cofre (app/crypto.py, a mesma das senhas
salvas) e a coluna `conteudo` fica vazia — fora da busca, do widget e da
prévia. O título continua visível (a pessoa escolhe um discreto). Abrir
pede o PIN (com a mesma espera crescente do desbloqueio do app) e devolve
uma chave de acesso que vale CHAVE_ACESSO_MIN minutos, só em memória: é
com ela que o editor salva enquanto a nota está aberta. Consequências,
ditas na tela: entra no backup COM senha (como as senhas) e se perde se a
chave dos segredos for redefinida. Se o PIN for desligado depois, a nota
continua cifrada mas abre sem pedir PIN (quem desligou provou que sabia).
"""
import re
import secrets
import time
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app import pin
from app.actions import register_action, revert_actions, today_prefix
from app.crypto import decrypt_password, encrypt_password
from app.database import get_db, new_id, now_iso
from app.limites import Entrada
from app.mensagens import ErroKami, Texto, erro_de

router = APIRouter()

XP_NOTA = 2
NOTAS_XP_POR_DIA = 3
CONTEUDO_MAX = 100_000
TAGS_MAX = 20
CHAVE_ACESSO_MIN = 30
PREVIA_MAX = 160

# vínculo opcional (P-35): tipo -> (tabela, expressão do nome)
VINCULOS = {
    "meta": ("goals", "title"),
    "trilha": ("tracks", "name"),
    "evento": ("calendar_events", "title"),
    "posicao": ("career_positions", "role || ' — ' || company"),
}

# chaves de acesso das notas trancadas abertas: {nota_id: (chave, expira_em)}.
# Só em memória — reiniciar o backend fecha todas (pede o PIN de novo).
_acessos: Dict[str, tuple] = {}


# ==================== schemas ====================

class NotaIn(Entrada):
    titulo: str = Field("", max_length=200)
    conteudo: str = Field("", max_length=CONTEUDO_MAX)
    tags: List[str] = Field(default_factory=list, max_length=TAGS_MAX)
    cor: Optional[str] = Field(None, max_length=20)
    fixada: bool = False
    vinculo_tipo: Optional[str] = Field(None, max_length=20)
    vinculo_id: Optional[str] = Field(None, max_length=64)


class NotaUpdate(Entrada):
    """Tudo opcional: o editor manda só o que mudou. `chave` = chave de
    acesso da nota trancada aberta (POST /abrir)."""
    titulo: Optional[str] = Field(None, max_length=200)
    conteudo: Optional[str] = Field(None, max_length=CONTEUDO_MAX)
    tags: Optional[List[str]] = Field(None, max_length=TAGS_MAX)
    cor: Optional[str] = Field(None, max_length=20)
    limpar_cor: bool = False
    fixada: Optional[bool] = None
    arquivada: Optional[bool] = None
    vinculo_tipo: Optional[str] = Field(None, max_length=20)
    vinculo_id: Optional[str] = Field(None, max_length=64)
    limpar_vinculo: bool = False
    chave: Optional[str] = Field(None, max_length=64)


class PinNotaIn(Entrada):
    pin: Optional[str] = Field(None, max_length=8)


class VinculoOut(BaseModel):
    tipo: str
    id: str
    nome: str


class NotaResumoOut(BaseModel):
    id: str
    titulo: str
    previa: str = ""
    tags: List[str] = []
    cor: Optional[str] = None
    fixada: bool = False
    arquivada: bool = False
    trancada: bool = False
    vinculo: Optional[VinculoOut] = None
    criada_em: str
    atualizada_em: str


class NotaOut(NotaResumoOut):
    conteudo: str = ""
    # trancada e sem chave de acesso: conteudo vem vazio e isto é False
    conteudo_disponivel: bool = True
    pin_ligado: bool = False


class NotaAbertaOut(NotaOut):
    chave: Optional[str] = None


class TagOut(BaseModel):
    tag: str
    notas: int


# ==================== helpers ====================

_MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MD_MARCAS = re.compile(r"(\*\*|__|~~|\+\+|`+|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w))")
_MD_INICIO = re.compile(r"^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|\|)")


def previa_de_markdown(md: str, maximo: int = PREVIA_MAX) -> str:
    """Uma linha de texto puro a partir do markdown da nota (a lista e o
    widget não desenham markdown)."""
    linhas = []
    for linha in (md or "").split("\n"):
        linha = linha.strip()
        if not linha or linha.startswith("```") or re.fullmatch(r"[-*_]{3,}|\|?[\s:|-]+\|?", linha):
            continue
        linha = _MD_INICIO.sub("", linha)
        linha = _MD_LINK.sub(r"\1", linha)
        linha = _MD_MARCAS.sub("", linha).replace("|", " ")
        linhas.append(linha)
    texto = " ".join(" ".join(linhas).split())
    if len(texto) <= maximo:
        return texto
    corte = texto[:maximo]
    espaco = corte.rfind(" ")
    return (corte[:espaco] if espaco > maximo * 0.6 else corte).rstrip(" ,.;:") + "…"


def _limpar_tags(tags: List[str]) -> List[str]:
    """minúsculas, sem '#', sem espaço nas pontas, sem repetidas, até 40
    caracteres cada."""
    vistas = []
    for t in tags or []:
        t = " ".join(str(t).strip().lstrip("#").lower().split())[:40]
        if t and t not in vistas:
            vistas.append(t)
    return vistas


def _validar_vinculo(db, tipo: Optional[str], vid: Optional[str]) -> None:
    if not tipo and not vid:
        return
    if tipo not in VINCULOS or not vid:
        raise ErroKami(422, "erro.comum.vinculo_invalido", "vínculo inválido")
    tabela, _ = VINCULOS[tipo]
    if not db.execute(f"SELECT 1 FROM {tabela} WHERE id = ?", (vid,)).fetchone():  # tabela da lista fixa
        raise ErroKami(404, "erro.notas.item_vinculado_nao_encontrado", "item vinculado não encontrado")


def _vinculo(db, row) -> Optional[dict]:
    tipo, vid = row["vinculo_tipo"], row["vinculo_id"]
    if tipo not in VINCULOS or not vid:
        return None
    tabela, nome = VINCULOS[tipo]
    alvo = db.execute(f"SELECT {nome} AS nome FROM {tabela} WHERE id = ?", (vid,)).fetchone()
    # item vinculado apagado: o vínculo some da nota (a nota fica)
    return {"tipo": tipo, "id": vid, "nome": alvo["nome"]} if alvo else None


def _tags_de(db, nota_id: str) -> List[str]:
    return [r["tag"] for r in db.execute("SELECT tag FROM notas_tags WHERE nota_id = ? ORDER BY tag", (nota_id,))]


def _gravar_tags(db, nota_id: str, tags: List[str]) -> None:
    db.execute("DELETE FROM notas_tags WHERE nota_id = ?", (nota_id,))
    db.executemany("INSERT INTO notas_tags (nota_id, tag) VALUES (?, ?)", [(nota_id, t) for t in _limpar_tags(tags)])


def _resumo(db, row) -> dict:
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "previa": "" if row["trancada"] else previa_de_markdown(row["conteudo"]),
        "tags": _tags_de(db, row["id"]),
        "cor": row["cor"],
        "fixada": bool(row["fixada"]),
        "arquivada": bool(row["arquivada"]),
        "trancada": bool(row["trancada"]),
        "vinculo": _vinculo(db, row),
        "criada_em": row["criada_em"],
        "atualizada_em": row["atualizada_em"],
    }


def _nota(db, nota_id: str):
    row = db.execute("SELECT * FROM notas WHERE id = ?", (nota_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.notas.nota_nao_encontrada", "nota não encontrada")
    return row


def _chave_ok(nota_id: str, chave: Optional[str]) -> bool:
    guardada = _acessos.get(nota_id)
    if not guardada or not chave:
        return False
    if guardada[1] < time.time():
        _acessos.pop(nota_id, None)
        return False
    return secrets.compare_digest(guardada[0], chave)


def _nova_chave(nota_id: str) -> str:
    chave = secrets.token_urlsafe(24)
    _acessos[nota_id] = (chave, time.time() + CHAVE_ACESSO_MIN * 60)
    return chave


def _exigir_acesso(row, chave: Optional[str]) -> None:
    """Nota trancada só muda com a chave de acesso (ou sem PIN ligado)."""
    if row["trancada"] and pin.ativo() and not _chave_ok(row["id"], chave):
        raise ErroKami(423, "erro.notas.nota_trancada_abra_com_pin", "nota trancada — abra com o PIN pra editar")


def _conferir_pin(valor: Optional[str]) -> None:
    if not pin.ativo():
        return
    try:
        pin.conferir(valor or "")
    except pin.Esperando as exc:
        raise erro_de(exc, 429, headers={"Retry-After": str(exc.segundos)}) from exc
    except ValueError as exc:  # PinErrado é ValueError
        raise erro_de(exc, 422) from exc


def _decifrar(row) -> str:
    """Texto da nota trancada. Cifrado com uma chave que não existe mais
    (chave dos segredos redefinida — seguranca.py já zera a coluna, isto
    é só a rede de proteção): devolve vazio em vez de 500."""
    if not row["conteudo_cifrado"]:
        return ""
    try:
        return decrypt_password(row["conteudo_cifrado"])
    except ValueError:
        return ""


def _completa(db, row, com_conteudo: bool) -> dict:
    out = _resumo(db, row)
    if not row["trancada"]:
        out |= {"conteudo": row["conteudo"], "conteudo_disponivel": True}
    elif com_conteudo:
        out |= {"conteudo": _decifrar(row), "conteudo_disponivel": True}
    else:
        out |= {"conteudo": "", "conteudo_disponivel": False}
    out["pin_ligado"] = pin.ativo()
    return out


# ==================== rotas ====================

@router.get("", response_model=List[NotaResumoOut])
def listar_notas(
    q: Optional[str] = Query(None, max_length=200),
    tag: Optional[str] = Query(None, max_length=40),
    arquivadas: bool = False,
    fixadas: Optional[bool] = None,
    vinculo_tipo: Optional[str] = Query(None, max_length=20),
    vinculo_id: Optional[str] = Query(None, max_length=64),
    db=Depends(get_db),
):
    cond, args = ["arquivada = ?"], [int(arquivadas)]
    if fixadas is not None:
        cond.append("fixada = ?")
        args.append(int(fixadas))
    if tag:
        cond.append("id IN (SELECT nota_id FROM notas_tags WHERE tag = ?)")
        args.append(_limpar_tags([tag])[0] if _limpar_tags([tag]) else tag)
    if vinculo_tipo:
        cond.append("vinculo_tipo = ?")
        args.append(vinculo_tipo)
    if vinculo_id:
        cond.append("vinculo_id = ?")
        args.append(vinculo_id)
    if q and q.strip():
        # texto de nota trancada fica de fora (a coluna conteudo está vazia)
        termo = f"%{q.strip().lower()}%"
        cond.append(
            "(lower(titulo) LIKE ? OR lower(conteudo) LIKE ? "
            "OR id IN (SELECT nota_id FROM notas_tags WHERE tag LIKE ?))"
        )
        args += [termo, termo, termo]
    rows = db.execute(
        f"SELECT * FROM notas WHERE {' AND '.join(cond)} ORDER BY fixada DESC, atualizada_em DESC", args
    ).fetchall()
    return [_resumo(db, r) for r in rows]


@router.get("/tags", response_model=List[TagOut])
def listar_tags(db=Depends(get_db)):
    rows = db.execute(
        "SELECT t.tag, COUNT(*) AS notas FROM notas_tags t JOIN notas n ON n.id = t.nota_id "
        "WHERE n.arquivada = 0 GROUP BY t.tag ORDER BY notas DESC, t.tag"
    ).fetchall()
    return [dict(r) for r in rows]


# ordem do seletor: o que está em uso primeiro (meta ativa, trilha ativa,
# evento mais recente, posição atual)
_ALVOS_ORDEM = {
    "meta": "CASE status WHEN 'ativa' THEN 0 ELSE 1 END, title",
    "trilha": "CASE status WHEN 'ativa' THEN 0 ELSE 1 END, position, name",
    "evento": "date DESC",
    "posicao": "CASE WHEN end_date IS NULL THEN 0 ELSE 1 END, start_date DESC",
}


class AlvoOut(BaseModel):
    id: str
    nome: str


@router.get("/alvos", response_model=List[AlvoOut])
def listar_alvos(tipo: str = Query(..., max_length=20), db=Depends(get_db)):
    if tipo not in VINCULOS:
        raise ErroKami(422, "erro.notas.tipo_vinculo_invalido", "tipo de vínculo inválido")
    tabela, nome = VINCULOS[tipo]
    rows = db.execute(
        f"SELECT id, {nome} AS nome FROM {tabela} ORDER BY {_ALVOS_ORDEM[tipo]} LIMIT 300"  # da lista fixa
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/contagem", response_model=Dict[str, int])
def contar_por_vinculo(vinculo_tipo: str = Query(..., max_length=20), db=Depends(get_db)):
    if vinculo_tipo not in VINCULOS:
        raise ErroKami(422, "erro.notas.tipo_vinculo_invalido", "tipo de vínculo inválido")
    rows = db.execute(
        "SELECT vinculo_id, COUNT(*) AS n FROM notas WHERE vinculo_tipo = ? AND arquivada = 0 GROUP BY vinculo_id",
        (vinculo_tipo,),
    ).fetchall()
    return {r["vinculo_id"]: r["n"] for r in rows}


@router.get("/{nota_id}", response_model=NotaOut)
def obter_nota(nota_id: str, db=Depends(get_db)):
    row = _nota(db, nota_id)
    # PIN desligado depois de trancar: abre direto (ver a docstring)
    return _completa(db, row, com_conteudo=not pin.ativo())


@router.post("", response_model=NotaOut, status_code=201)
def criar_nota(payload: NotaIn, db=Depends(get_db)):
    _validar_vinculo(db, payload.vinculo_tipo, payload.vinculo_id)
    nota_id, agora = new_id(), now_iso()
    db.execute(
        "INSERT INTO notas (id, titulo, conteudo, cor, fixada, vinculo_tipo, vinculo_id, criada_em, atualizada_em) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (nota_id, payload.titulo.strip(), payload.conteudo, payload.cor, int(payload.fixada),
         payload.vinculo_tipo, payload.vinculo_id, agora, agora),
    )
    _gravar_tags(db, nota_id, payload.tags)
    db.commit()

    hoje = db.execute(
        "SELECT COUNT(*) FROM action_logs WHERE referencia_tipo = 'nota' AND substr(created_at, 1, 10) = ?",
        (today_prefix(),),
    ).fetchone()[0]
    if hoje < NOTAS_XP_POR_DIA:
        register_action(
            db,
            description=(
                Texto("log.nota.criada", "criou nota: {titulo}", titulo=payload.titulo.strip()) if payload.titulo.strip()
                else Texto("log.nota.criada_sem_titulo", "criou nota: (sem título)")
            ),
            categories=["organizacao"],
            xp=XP_NOTA,
            impact=1,
            source="organizacao",
            referencia_tipo="nota",
            referencia_id=nota_id,
        )
    return _completa(db, _nota(db, nota_id), com_conteudo=True)


@router.put("/{nota_id}", response_model=NotaOut)
def editar_nota(nota_id: str, payload: NotaUpdate, db=Depends(get_db)):
    row = _nota(db, nota_id)
    _exigir_acesso(row, payload.chave)

    campos, args = [], []

    def muda(coluna, valor):
        campos.append(f"{coluna} = ?")
        args.append(valor)

    if payload.titulo is not None:
        muda("titulo", payload.titulo.strip())
    if payload.conteudo is not None:
        if row["trancada"]:
            muda("conteudo_cifrado", encrypt_password(payload.conteudo))
        else:
            muda("conteudo", payload.conteudo)
    if payload.limpar_cor:
        muda("cor", None)
    elif payload.cor is not None:
        muda("cor", payload.cor)
    if payload.fixada is not None:
        muda("fixada", int(payload.fixada))
    if payload.arquivada is not None:
        muda("arquivada", int(payload.arquivada))
    if payload.limpar_vinculo:
        muda("vinculo_tipo", None)
        muda("vinculo_id", None)
    elif payload.vinculo_tipo is not None or payload.vinculo_id is not None:
        _validar_vinculo(db, payload.vinculo_tipo, payload.vinculo_id)
        muda("vinculo_tipo", payload.vinculo_tipo)
        muda("vinculo_id", payload.vinculo_id)
    if payload.tags is not None:
        _gravar_tags(db, nota_id, payload.tags)

    # fixar/arquivar não é "editar a nota": não mexe na ordem por data
    if payload.titulo is not None or payload.conteudo is not None or payload.tags is not None:
        muda("atualizada_em", now_iso())
    if campos:
        db.execute(f"UPDATE notas SET {', '.join(campos)} WHERE id = ?", (*args, nota_id))
    db.commit()
    return _completa(db, _nota(db, nota_id), com_conteudo=bool(payload.chave) or not row["trancada"] or not pin.ativo())


@router.delete("/{nota_id}", status_code=204)
def apagar_nota(nota_id: str, chave: Optional[str] = Query(None, max_length=64), db=Depends(get_db)):
    row = _nota(db, nota_id)
    _exigir_acesso(row, chave)
    db.execute("DELETE FROM notas_tags WHERE nota_id = ?", (nota_id,))
    db.execute("DELETE FROM notas WHERE id = ?", (nota_id,))
    db.commit()
    _acessos.pop(nota_id, None)
    # P-32: criada hoje -> estorna (o teto de 3/dia conta o que sobrou)
    if row["criada_em"][:10] == today_prefix():
        revert_actions(db, "nota", nota_id)


@router.post("/{nota_id}/abrir", response_model=NotaAbertaOut)
def abrir_nota(nota_id: str, payload: PinNotaIn, db=Depends(get_db)):
    row = _nota(db, nota_id)
    if not row["trancada"]:
        return _completa(db, row, com_conteudo=True)
    _conferir_pin(payload.pin)
    return {**_completa(db, row, com_conteudo=True), "chave": _nova_chave(nota_id)}


@router.post("/{nota_id}/trancar", response_model=NotaAbertaOut)
def trancar_nota(nota_id: str, db=Depends(get_db)):
    row = _nota(db, nota_id)
    if not pin.ativo():
        raise ErroKami(
            409,
            "erro.notas.ative_pin_configuracoes_seguranca_trancar",
            "ative o PIN em configurações › segurança pra trancar notas",
        )
    if not row["trancada"]:
        db.execute(
            "UPDATE notas SET trancada = 1, conteudo_cifrado = ?, conteudo = '' WHERE id = ?",
            (encrypt_password(row["conteudo"]), nota_id),
        )
        db.commit()
    # quem trancou está com a nota aberta: já sai com a chave de acesso
    return {**_completa(db, _nota(db, nota_id), com_conteudo=True), "chave": _nova_chave(nota_id)}


@router.post("/{nota_id}/destrancar", response_model=NotaOut)
def destrancar_nota(nota_id: str, payload: PinNotaIn, db=Depends(get_db)):
    row = _nota(db, nota_id)
    if not row["trancada"]:
        return _completa(db, row, com_conteudo=True)
    _conferir_pin(payload.pin)
    texto = _decifrar(row)
    db.execute("UPDATE notas SET trancada = 0, conteudo = ?, conteudo_cifrado = NULL WHERE id = ?", (texto, nota_id))
    db.commit()
    _acessos.pop(nota_id, None)
    return _completa(db, _nota(db, nota_id), com_conteudo=True)
