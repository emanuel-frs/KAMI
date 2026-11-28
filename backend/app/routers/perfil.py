"""
Módulo Perfil (v1, decisão 15).

Linha única em user_profile — não existe endpoint de criação nem de
listagem, só leitura e atualização. Avatar chega já como texto ASCII
(a conversão de foto -> ASCII acontece 100% no frontend, via canvas;
o backend nunca recebe nem guarda a foto original).
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.business_days import paises_com_feriados
from app.database import SOM_COLUNAS, get_db, now_iso
from app import aparencia as ap_mod
from app.recompensas import TITULOS, nivel_jogador, nivel_minimo
from app.limites import Entrada
from app.mensagens import ErroKami

router = APIRouter()


class ProfileOut(BaseModel):
    id: str
    display_name: str
    accent_color: str
    avatar_ascii: Optional[str] = None
    onboarding_completed: bool
    last_backup_at: Optional[str] = None
    notif_alerts_enabled: bool
    notif_email_enabled: bool
    efeitos_visuais: str = "completo"
    titulo: Optional[str] = None  # GAM-10: chave escolhida; None = automático
    tema: str = "padrao"          # GAM-10 (antigo: só monta a aparência de quem não tem uma)
    aparencia: dict = Field(default_factory=ap_mod.padrao)  # 2.1.0: app/aparencia.py
    # GAM-13: sons (ver database.SOM_COLUNAS)
    som_ativo: bool = True
    som_volume: int = 60
    som_progresso: bool = True
    som_interface: bool = True
    som_avisos: bool = True
    icone_tema: bool = False  # ICO-01
    widgets_altura_auto: bool = False  # widget sempre do tamanho do conteúdo
    org_abas: Optional[str] = None  # ordem das abas da organização ("notas,entrada,…")
    # ORG-05: notificações do sistema (fora do app)
    notif_fora_lembretes: bool = True
    notif_fora_vencimentos: bool = True
    notif_fora_eventos: bool = True
    notif_ocultar_texto: bool = False
    avisos_hora: str = "09:00"
    formato_data: str = "sistema"  # ORG-07
    # DIST-01
    atualizacoes_procurar: bool = True
    atualizacao_avisada: Optional[str] = None
    atualizacao_pulada: Optional[str] = None
    idioma: Optional[str] = None  # I18N-01: None = ainda não escolhido
    moeda: Optional[str] = None  # I18N-06: ISO 4217; None = ainda não escolhida
    pais: Optional[str] = None  # I18N-06: ISO 3166 (feriados do dia útil)
    updated_at: str


# DIST-01: versão semver (1.15.0, 2.0.0-rc.1) ou "" pra limpar
VERSAO_OU_VAZIO = r"^(\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?)?$"


class ProfileUpdate(Entrada):
    display_name: Optional[str] = None
    accent_color: Optional[str] = Field(None, pattern=ap_mod.HEX)
    notif_alerts_enabled: Optional[bool] = None
    notif_email_enabled: Optional[bool] = None
    efeitos_visuais: Optional[str] = None
    # GAM-10: "auto" volta pro título automático (o mais alto liberado)
    titulo: Optional[str] = None
    # 2.1.0: a aparência inteira (paleta, textura, avatar, calendário…); o
    # `tema` antigo não é mais escolhido — virou capacidades (app/aparencia.py)
    aparencia: Optional[ap_mod.AparenciaIn] = None
    # GAM-13: sons
    som_ativo: Optional[bool] = None
    som_volume: Optional[int] = Field(None, ge=0, le=100)
    som_progresso: Optional[bool] = None
    som_interface: Optional[bool] = None
    som_avisos: Optional[bool] = None
    # ICO-01: o ícone do app acompanha a cor de destaque (o Rust aplica)
    icone_tema: Optional[bool] = None
    widgets_altura_auto: Optional[bool] = None
    org_abas: Optional[str] = Field(None, max_length=100)
    # ORG-05
    notif_fora_lembretes: Optional[bool] = None
    notif_fora_vencimentos: Optional[bool] = None
    notif_fora_eventos: Optional[bool] = None
    notif_ocultar_texto: Optional[bool] = None
    avisos_hora: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    formato_data: Optional[str] = Field(None, pattern=r"^(sistema|dma|mda|iso)$")  # ORG-07
    # DIST-01: "" limpa a versão guardada
    atualizacoes_procurar: Optional[bool] = None
    atualizacao_avisada: Optional[str] = Field(None, max_length=40, pattern=VERSAO_OU_VAZIO)
    atualizacao_pulada: Optional[str] = Field(None, max_length=40, pattern=VERSAO_OU_VAZIO)
    # I18N-01 (P-74): os 10 idiomas — frontend/js/i18n.js::IDIOMAS
    idioma: Optional[str] = Field(None, pattern=r"^(pt|en|es|fr|it|de|zh|ja|ko|hi)$")
    # I18N-06: qualquer código ISO (o frontend confere com o Intl); país sem
    # calendário na workalendar = dia útil só de segunda a sexta
    moeda: Optional[str] = Field(None, pattern=r"^[A-Z]{3}$")
    pais: Optional[str] = Field(None, pattern=r"^[A-Z]{2}$")


# GAM-04 — ver database.py::_migrate_user_profile_efeitos_visuais
EFEITOS_VISUAIS = {"completo", "sutil", "desligado"}


class AvatarUpdate(Entrada):
    avatar_ascii: str


class OnboardingUpdate(Entrada):
    completed: bool


class ScreenTipsOut(BaseModel):
    seen: list[str]


class DicasOut(BaseModel):
    vistas: list[str]
    telas_antigas: list[str]


class DicasVistasIn(Entrada):
    # uma sequência tem no máximo ~15 dicas; 100 é folga, não limite real
    dicas: list[str] = Field(..., max_length=100)


def _get_profile_row(db):
    row = db.execute("SELECT * FROM user_profile LIMIT 1").fetchone()
    if not row:
        # não deveria acontecer — init_db sempre semeia a linha única
        raise ErroKami(404, "erro.perfil.perfil_nao_encontrado", "perfil não encontrado")
    return row


def _perfil(row) -> dict:
    """A linha do perfil como resposta: com a aparência já completa."""
    dados = dict(row)
    dados["aparencia"] = ap_mod.do_perfil(row)
    return dados


def _aparencia_escolhida(db, payload, row, accent_color):
    """
    2.1.0: a aparência nova (ou a de sempre) e a conferência de nível. Só o
    que PASSA a ser usado é conferido — o que já estava em uso continua
    valendo mesmo que o nível tenha caído depois (mesma regra do GAM-10).
    Devolve o JSON a gravar, ou None se nada mudou.
    """
    antes = ap_mod.do_perfil(row)
    depois = ap_mod.normalizar(payload.aparencia.model_dump()) if payload.aparencia is not None else antes
    novas = ap_mod.capacidades_usadas(depois, accent_color) - ap_mod.capacidades_usadas(antes, row["accent_color"])
    if novas:
        nivel = nivel_jogador(db)
        for cap in sorted(novas):
            minimo = ap_mod.nivel_da_capacidade(cap)
            if nivel < minimo:
                raise ErroKami(
                    422,
                    "erro.perfil.campo_valor_liberado_no_nivel",
                    "{campo} '{valor}' é liberado no nível {minimo}",
                    campo="aparencia",
                    valor=cap,
                    minimo=minimo,
                )
    return ap_mod.serializar(depois) if payload.aparencia is not None else None


def _titulo_escolhido(db, payload, row):
    """
    GAM-10: valida o título pedido contra o catálogo e o nível atual
    (app/recompensas.py). Só o que muda é validado — uma escolha antiga
    continua valendo mesmo que o nível tenha caído depois.
    """
    titulo = row["titulo"]
    for campo, valor, catalogo_ in (("titulo", payload.titulo, TITULOS),):
        if valor is None or valor == "auto":
            continue
        minimo = nivel_minimo(catalogo_, valor)
        if minimo is None:
            raise ErroKami(
                422,
                "erro.perfil.campo_desconhecido_valor",
                "{campo} desconhecido: '{valor}'",
                campo=campo,
                valor=valor,
            )
        if nivel_jogador(db) < minimo:
            raise ErroKami(
                422,
                "erro.perfil.campo_valor_liberado_no_nivel",
                "{campo} '{valor}' é liberado no nível {minimo}",
                campo=campo,
                valor=valor,
                minimo=minimo,
            )
    if payload.titulo is not None:
        titulo = None if payload.titulo == "auto" else payload.titulo
    return titulo


@router.get("", response_model=ProfileOut)
def get_profile(db=Depends(get_db)):
    return _perfil(_get_profile_row(db))


@router.get("/paises-feriados")
def get_paises_feriados():
    """I18N-06: países com calendário de feriados (o nome sai do Intl no app)."""
    return {"paises": paises_com_feriados()}


# ids das abas da organização (frontend/js/pages/organizacao-abas.js ABAS)
ABAS_ORGANIZACAO = ("notas", "entrada", "github", "email", "links")


def _org_abas(valor: str):
    """A ordem das abas: só ids conhecidos, sem repetir; "" = volta à padrão."""
    ids = [v.strip() for v in valor.split(",") if v.strip()]
    if any(i not in ABAS_ORGANIZACAO for i in ids) or len(ids) != len(set(ids)):
        raise ErroKami(422, "erro.perfil.abas_invalidas", "ordem de abas inválida")
    return ",".join(ids + [a for a in ABAS_ORGANIZACAO if a not in ids]) if ids else None


@router.put("", response_model=ProfileOut)
def update_profile(payload: ProfileUpdate, db=Depends(get_db)):
    row = _get_profile_row(db)
    display_name = payload.display_name if payload.display_name is not None else row["display_name"]
    accent_color = payload.accent_color if payload.accent_color is not None else row["accent_color"]
    notif_alerts_enabled = (
        int(payload.notif_alerts_enabled) if payload.notif_alerts_enabled is not None else row["notif_alerts_enabled"]
    )
    notif_email_enabled = (
        int(payload.notif_email_enabled) if payload.notif_email_enabled is not None else row["notif_email_enabled"]
    )
    efeitos_visuais = payload.efeitos_visuais if payload.efeitos_visuais is not None else row["efeitos_visuais"]
    if efeitos_visuais not in EFEITOS_VISUAIS:
        raise ErroKami(
            422,
            "erro.perfil.efeitos_visuais_invalido_valores_aceitos",
            "efeitos_visuais inválido; valores aceitos: {valores}",
            valores=", ".join(map(str, sorted(EFEITOS_VISUAIS))),
        )
    titulo = _titulo_escolhido(db, payload, row)
    aparencia = _aparencia_escolhida(db, payload, row, accent_color)
    db.execute(
        "UPDATE user_profile SET display_name = ?, accent_color = ?, "
        "notif_alerts_enabled = ?, notif_email_enabled = ?, efeitos_visuais = ?, titulo = ?, "
        "updated_at = ? WHERE id = ?",
        (display_name, accent_color.lower(), notif_alerts_enabled, notif_email_enabled, efeitos_visuais, titulo,
         now_iso(), row["id"]),
    )
    if aparencia is not None:
        db.execute("UPDATE user_profile SET aparencia = ? WHERE id = ?", (aparencia, row["id"]))
    # GAM-13: preferências de som — cada uma só muda se veio no payload
    for col in SOM_COLUNAS:
        value = getattr(payload, col)
        if value is not None:
            db.execute(f"UPDATE user_profile SET {col} = ? WHERE id = ?", (int(value), row["id"]))
    if payload.icone_tema is not None:
        db.execute("UPDATE user_profile SET icone_tema = ? WHERE id = ?", (int(payload.icone_tema), row["id"]))
    if payload.widgets_altura_auto is not None:
        db.execute(
            "UPDATE user_profile SET widgets_altura_auto = ? WHERE id = ?", (int(payload.widgets_altura_auto), row["id"])
        )
    if payload.org_abas is not None:
        db.execute("UPDATE user_profile SET org_abas = ? WHERE id = ?", (_org_abas(payload.org_abas), row["id"]))
    for col in ("notif_fora_lembretes", "notif_fora_vencimentos", "notif_fora_eventos", "notif_ocultar_texto"):
        value = getattr(payload, col)
        if value is not None:
            db.execute(f"UPDATE user_profile SET {col} = ? WHERE id = ?", (int(value), row["id"]))
    if payload.formato_data is not None:
        db.execute("UPDATE user_profile SET formato_data = ? WHERE id = ?", (payload.formato_data, row["id"]))
    if payload.avisos_hora is not None:
        db.execute("UPDATE user_profile SET avisos_hora = ? WHERE id = ?", (payload.avisos_hora, row["id"]))
    if payload.atualizacoes_procurar is not None:
        db.execute("UPDATE user_profile SET atualizacoes_procurar = ? WHERE id = ?", (int(payload.atualizacoes_procurar), row["id"]))
    for col in ("idioma", "moeda", "pais"):
        value = getattr(payload, col)
        if value is not None:
            db.execute(f"UPDATE user_profile SET {col} = ? WHERE id = ?", (value, row["id"]))
    for col in ("atualizacao_avisada", "atualizacao_pulada"):
        value = getattr(payload, col)
        if value is not None:
            db.execute(f"UPDATE user_profile SET {col} = ? WHERE id = ?", (value or None, row["id"]))
    db.commit()
    return _perfil(_get_profile_row(db))


@router.put("/avatar", response_model=ProfileOut)
def update_avatar(payload: AvatarUpdate, db=Depends(get_db)):
    row = _get_profile_row(db)
    db.execute(
        "UPDATE user_profile SET avatar_ascii = ?, updated_at = ? WHERE id = ?",
        (payload.avatar_ascii, now_iso(), row["id"]),
    )
    db.commit()
    return _perfil(_get_profile_row(db))


@router.put("/onboarding", response_model=ProfileOut)
def update_onboarding(payload: OnboardingUpdate, db=Depends(get_db)):
    """
    Item 15.6 (decisão 25): marca (ou desmarca) o tutorial como visto.
    Chamado ao fechar o modal de onboarding — reaberto depois via
    configurações ("ver tutorial novamente") sem alterar essa flag de novo,
    já que reabrir manualmente não deve fazer o app parar de mostrá-lo
    sozinho de novo no próximo boot.
    """
    row = _get_profile_row(db)
    db.execute(
        "UPDATE user_profile SET onboarding_completed = ?, updated_at = ? WHERE id = ?",
        (1 if payload.completed else 0, now_iso(), row["id"]),
    )
    db.commit()
    return _perfil(_get_profile_row(db))


@router.get("/tips", response_model=ScreenTipsOut)
def get_screen_tips_seen(db=Depends(get_db)):
    """
    Etapa 5: granularidade por tela, separada
    do onboarding_completed acima (que é só o tour geral). Devolve as
    telas cuja sequência de dicas contextuais já foi vista ou pulada —
    o frontend usa isso pra decidir se dispara a sequência automática
    ao entrar numa tela pela primeira vez.
    """
    rows = db.execute("SELECT screen FROM screen_tips_seen").fetchall()
    return {"seen": [r["screen"] for r in rows]}


@router.put("/tips/{screen}", response_model=ScreenTipsOut)
def mark_screen_tips_seen(screen: str, db=Depends(get_db)):
    """
    Marca uma tela como vista (idempotente — INSERT OR REPLACE). Chamado
    ao concluir ou pular a sequência de dicas contextuais dessa tela.
    Reabrir manualmente via botão de ajuda ("rever dicas desta tela",
    etapa 6) NÃO chama isso de novo — mesma lógica do onboarding geral:
    reabrir por vontade própria não deve alterar o que já foi marcado.
    """
    db.execute(
        "INSERT OR REPLACE INTO screen_tips_seen (screen, seen_at) VALUES (?, ?)",
        (screen, now_iso()),
    )
    db.commit()
    rows = db.execute("SELECT screen FROM screen_tips_seen").fetchall()
    return {"seen": [r["screen"] for r in rows]}


def _dicas(db):
    vistas = [r["dica"] for r in db.execute("SELECT dica FROM dicas_vistas ORDER BY dica")]
    telas = [r["screen"] for r in db.execute("SELECT screen FROM screen_tips_seen ORDER BY screen")]
    return {"vistas": vistas, "telas_antigas": telas}


@router.get("/dicas", response_model=DicasOut)
def get_dicas_vistas(db=Depends(get_db)):
    """
    MAN-05: dicas já vistas, uma a uma ('<tela>/<id>'), e as telas
    marcadas pelo esquema antigo (por tela, até a 1.13). Quem decide o
    que mostrar é o frontend (components/dicas-novas.js): numa tela
    antiga, as dicas que já existiam até a 1.12 contam como vistas.
    """
    return _dicas(db)


@router.put("/dicas", response_model=DicasOut)
def marcar_dicas_vistas(payload: DicasVistasIn, db=Depends(get_db)):
    """Marca dicas como vistas (idempotente; a data da primeira vez fica)."""
    agora = now_iso()
    for dica in payload.dicas:
        db.execute("INSERT OR IGNORE INTO dicas_vistas (dica, vista_em) VALUES (?, ?)", (dica, agora))
    db.commit()
    return _dicas(db)
