"""
Módulo Perfil (v1, decisão 15).

Linha única em user_profile — não existe endpoint de criação nem de
listagem, só leitura e atualização. Avatar chega já como texto ASCII
(a conversão de foto -> ASCII acontece 100% no frontend, via canvas;
o backend nunca recebe nem guarda a foto original).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, now_iso

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
    updated_at: str


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    accent_color: Optional[str] = None
    notif_alerts_enabled: Optional[bool] = None
    notif_email_enabled: Optional[bool] = None


class AvatarUpdate(BaseModel):
    avatar_ascii: str


class OnboardingUpdate(BaseModel):
    completed: bool


class ScreenTipsOut(BaseModel):
    seen: list[str]


def _get_profile_row(db):
    row = db.execute("SELECT * FROM user_profile LIMIT 1").fetchone()
    if not row:
        # não deveria acontecer — init_db sempre semeia a linha única
        raise HTTPException(status_code=404, detail="perfil não encontrado")
    return row


@router.get("", response_model=ProfileOut)
def get_profile(db=Depends(get_db)):
    return dict(_get_profile_row(db))


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
    db.execute(
        "UPDATE user_profile SET display_name = ?, accent_color = ?, "
        "notif_alerts_enabled = ?, notif_email_enabled = ?, updated_at = ? WHERE id = ?",
        (display_name, accent_color, notif_alerts_enabled, notif_email_enabled, now_iso(), row["id"]),
    )
    db.commit()
    return dict(_get_profile_row(db))


@router.put("/avatar", response_model=ProfileOut)
def update_avatar(payload: AvatarUpdate, db=Depends(get_db)):
    row = _get_profile_row(db)
    db.execute(
        "UPDATE user_profile SET avatar_ascii = ?, updated_at = ? WHERE id = ?",
        (payload.avatar_ascii, now_iso(), row["id"]),
    )
    db.commit()
    return dict(_get_profile_row(db))


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
    return dict(_get_profile_row(db))


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