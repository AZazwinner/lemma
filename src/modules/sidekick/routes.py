from fastapi import APIRouter, Depends, HTTPException

from db.modules.users.schemas import UserPrivateResponse
from db.modules.users.services import get_current_user
from modules.sidekick import collab, config, service
from modules.sidekick.schemas import (
    ExplainIntoDocRequest,
    ExplainRequest,
    ExplainResponse,
    IntoDocResponse,
    LatexIntoDocRequest,
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


# --- Sidekick as a collaborator -----------------------------------------------------------------------------------
# Same work as above, but the answer is written into the live document by the Sidekick (a new block after the writer's),
# which shows in the presence list while it works. Only for someone who can edit the document and has it open.


@router.post("/docs/{doc_id}/latex", response_model=IntoDocResponse)
async def sidekick_latex_into_doc(
    doc_id: int, data: LatexIntoDocRequest, current_user: UserPrivateResponse = Depends(get_current_user)
):
    room = await collab.require_room(doc_id, current_user.id)
    try:
        latex, cached = await service.to_latex(current_user.id, data.text, on_working=lambda: collab.working(room))
        block_id = await collab.insert_block_after(room, data.after_block_id, f"$$\n{latex}\n$$")
    except _HANDLED as e:
        collab.done(room, 0)
        raise _translate(e) from None
    except BaseException:
        collab.done(room, 0)
        raise
    collab.done(room)
    return {"block_id": block_id, "cached": cached, "mock": config.mode() == "mock"}


@router.post("/docs/{doc_id}/explain", response_model=IntoDocResponse)
async def sidekick_explain_into_doc(
    doc_id: int, data: ExplainIntoDocRequest, current_user: UserPrivateResponse = Depends(get_current_user)
):
    room = await collab.require_room(doc_id, current_user.id)
    try:
        summary, steps, cached = await service.explain(
            current_user.id, data.latex, on_working=lambda: collab.working(room)
        )
        block_id = await collab.insert_block_after(room, data.after_block_id, explanation_text(summary, steps))
    except _HANDLED as e:
        collab.done(room, 0)
        raise _translate(e) from None
    except BaseException:
        collab.done(room, 0)
        raise
    collab.done(room)
    return {"block_id": block_id, "cached": cached, "mock": config.mode() == "mock"}


def explanation_text(summary: str, steps: list[str]) -> str:
    return "\n".join([summary, *(f"{n}. {step}" for n, step in enumerate(steps, 1))])
