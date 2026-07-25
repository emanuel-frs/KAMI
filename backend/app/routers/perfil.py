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
    updated_at: str


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    accent_color: Optional[str] = None


class AvatarUpdate(BaseModel):
    avatar_ascii: str


class OnboardingUpdate(BaseModel):
    completed: bool


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
    db.execute(
        "UPDATE user_profile SET display_name = ?, accent_color = ?, updated_at = ? WHERE id = ?",
        (display_name, accent_color, now_iso(), row["id"]),
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
