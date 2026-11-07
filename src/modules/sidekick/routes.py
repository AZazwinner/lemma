from fastapi import APIRouter, Depends, HTTPException

from db.modules.users.schemas import UserPrivateResponse
from db.modules.users.services import get_current_user
from modules.sidekick import config, service
from modules.sidekick.schemas import (
    ExplainRequest,
    ExplainResponse,
    LatexRequest,
    LatexResponse,
    StatusResponse,
)

router = APIRouter(prefix="/sidekick", tags=["sidekick"])

_HANDLED = (service.SidekickDisabled, service.SidekickBusy, service.SidekickUpstreamError)


def _translate(error: Exception) -> HTTPException:
    if isinstance(error, service.SidekickDisabled):
        return HTTPException(503, detail={"code": "disabled", "message": "The sidekick is switched off."})
    if isinstance(error, service.SidekickBusy):
        return HTTPException(
            429,
            detail={"code": "busy", "message": "The sidekick is busy. Try again soon.", "retry_after": error.retry_after},
            headers={"Retry-After": str(error.retry_after)},
        )
    return HTTPException(502, detail={"code": "upstream_error", "message": "The sidekick couldn't answer. Try again."})


@router.get("/status", response_model=StatusResponse)
def sidekick_status(current_user: UserPrivateResponse = Depends(get_current_user)):
    return service.status()


@router.post("/latex", response_model=LatexResponse)
async def sidekick_latex(data: LatexRequest, current_user: UserPrivateResponse = Depends(get_current_user)):
    try:
        latex, cached = await service.to_latex(current_user.id, data.text)
    except _HANDLED as e:
        raise _translate(e) from None
    return {"latex": latex, "cached": cached, "mock": config.mode() == "mock"}


@router.post("/explain", response_model=ExplainResponse)
async def sidekick_explain(data: ExplainRequest, current_user: UserPrivateResponse = Depends(get_current_user)):
    try:
        summary, steps, cached = await service.explain(current_user.id, data.latex)
    except _HANDLED as e:
        raise _translate(e) from None
    return {"summary": summary, "steps": steps, "cached": cached, "mock": config.mode() == "mock"}
