import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from db.core.auth import mailer
from db.core.auth.mailer import send_password_reset_email
from db.core.auth.rate_limit import is_locked_out, record_failure, record_success, signup_max_attempts
from db.core.auth.schemas import AuthUserCreate__Password, AuthUserUpdate__Password
from db.core.auth.services import request_password_reset, reset_password_with_token, update_authuser__password
from db.core.auth.utils.token import create_access_token, create_ws_ticket
from db.modules.users.crud import bump_token_version, get_user_by_id, get_user_by_username
from db.modules.users.schemas import CreateUserResponse, UserPublicResponse, UserPrivateResponse, UserSignin, UserSigninResponse
from db.modules.users.services import create_user__password, get_current_user, login_user__password
from db.database import get_db

router = APIRouter()

@router.get("/ping")
def ping():
    return {"message": "pong"}

@router.post("/create-user", response_model=CreateUserResponse)
def create_user__password_route(
        data: AuthUserCreate__Password,
        request: Request,
        db: Session = Depends(get_db),
):
    """Throttled per client IP to prevent mass account creation / enumeration farming."""
    client_ip = request.client.host if request.client else "unknown"
    throttle_key = f"signup:{client_ip}"

    locked, retry_after = is_locked_out(throttle_key)
    if locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many signup attempts. Try again in {int(retry_after) // 60 + 1} minute(s).",
        )
    record_failure(throttle_key, signup_max_attempts())

    return create_user__password(data, db)

class GetUserResponse(BaseModel):
    success: bool
    user: Optional[UserPublicResponse]

@router.get("/user", response_model=GetUserResponse)
def get_user(
        id: int|None=None,
        username: str|None=None,
        current_user: UserPrivateResponse = Depends(get_current_user),
        db: Session = Depends(get_db),
):
    if id is not None:
        user = get_user_by_id(id, db)
    elif username is not None:
        user = get_user_by_username(username, db)
    else:
        return {
            "success": False
        }
    
    if user is None:
        return {
            "success": False
        }
    else:
        return {
            "success": True,
            "user": user
        }

@router.get("/me", response_model=UserPrivateResponse)
def get_me(
        current_user: UserPrivateResponse = Depends(get_current_user)
):
    return current_user
    

class WsTicketResponse(BaseModel):
    ticket: str

@router.post("/ws-ticket", response_model=WsTicketResponse)
def get_ws_ticket(
        current_user: UserPrivateResponse = Depends(get_current_user),
):
    """Trades the login token for a one-minute ticket to open a live-editing WebSocket with."""
    return {"ticket": create_ws_ticket(current_user.id, current_user.token_version)}

class LogoutResponse(BaseModel):
    success: bool

@router.post("/logout", response_model=LogoutResponse)
def logout(
        current_user: UserPrivateResponse = Depends(get_current_user),
        db: Session = Depends(get_db),
):
    """Revokes every login token this account has, on every device. Clearing the browser's copy alone would leave a stolen token working until it expired."""
    bump_token_version(current_user.id, db)
    return {"success": True}

class UpdatePasswordData(BaseModel):
    password: str
class UpdatePasswordResponse(BaseModel):
    success: bool

@router.post("/user-update-password", response_model=UpdatePasswordResponse)
def update_password(
        data: UpdatePasswordData,
        current_user: UserPrivateResponse = Depends(get_current_user),
        db: Session = Depends(get_db),
):
    auth_services_data = AuthUserUpdate__Password.model_validate({
        "id": current_user.authuser_id,
        "password": data.password
    })

    success = update_authuser__password(auth_services_data, db)
    return {
        "success": success
    }


@router.post("/signin", response_model=UserSigninResponse)
def login_user(
    user_data: UserSignin,
    request: Request,
    db: Session = Depends(get_db),
):
    """Logs in a user by username or email. Throttled per (client IP, username) after repeated failures."""
    client_ip = request.client.host if request.client else "unknown"
    throttle_key = f"{client_ip}:{user_data.username.strip().lower()}"

    locked, retry_after = is_locked_out(throttle_key)
    if locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed sign-in attempts. Try again in {int(retry_after) // 60 + 1} minute(s).",
        )

    user = login_user__password(user_data, db)
    if user is None:
        record_failure(throttle_key)
        return {
            "user": None
        }

    record_success(throttle_key)
    access_token = create_access_token(user.id, user.token_version)
    return {
        "user": user,
        "token": access_token
    }


class ForgotPasswordData(BaseModel):
    email: str

class ForgotPasswordResponse(BaseModel):
    success: bool

    dev_reset_link: Optional[str] = None

@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    data: ForgotPasswordData,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Always reports success regardless of whether the email is registered, to avoid leaking which emails have accounts. The email is sent after the response so a slow mail server can't show which addresses exist."""
    client_ip = request.client.host if request.client else "unknown"
    throttle_key = f"forgot:{client_ip}:{data.email.strip().lower()}"

    locked, retry_after = is_locked_out(throttle_key)
    if locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many reset requests. Try again in {int(retry_after) // 60 + 1} minute(s).",
        )
    record_failure(throttle_key)

    token = request_password_reset(data.email, db)
    if token is None:
        return {"success": True}

    app_url = os.getenv("APP_URL", "http://localhost:12000")
    reset_link = f"{app_url}/reset-password?token={token}"
    background_tasks.add_task(send_password_reset_email, data.email, reset_link)

    return {
        "success": True,
        "dev_reset_link": reset_link if mailer.dev_reset_links_enabled() and not mailer.is_configured() else None,
    }

class ResetPasswordData(BaseModel):
    token: str
    password: str

class ResetPasswordResponse(BaseModel):
    success: bool

@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    data: ResetPasswordData,
    db: Session = Depends(get_db),
):
    success = reset_password_with_token(data.token, data.password, db)
    return {
        "success": success
    }