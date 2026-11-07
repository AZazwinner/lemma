from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_TEXT_CHARS = 2000
MAX_LATEX_CHARS = 4000


class LatexRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


class LatexResponse(BaseModel):
    latex: str
    cached: bool
    mock: bool


class ExplainRequest(BaseModel):
    latex: str = Field(min_length=1, max_length=MAX_LATEX_CHARS)


class ExplainResponse(BaseModel):
    summary: str
    steps: list[str]
    cached: bool
    mock: bool


class StatusResponse(BaseModel):
    """Safe for any signed-in user: counts and switches only. No key, no model name."""

    enabled: bool
    mock: bool
    used_today: int
    daily_budget: int
    user_per_minute: int
    features: list[str]


class LatexIntoDocRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    # The block the writer is in; the Sidekick's block goes right after it. Without one it goes at the end.
    after_block_id: str | None = Field(default=None, max_length=64)


class ExplainIntoDocRequest(BaseModel):
    latex: str = Field(min_length=1, max_length=MAX_LATEX_CHARS)
    after_block_id: str | None = Field(default=None, max_length=64)


class IntoDocResponse(BaseModel):
    block_id: str
    cached: bool
    mock: bool


MAX_STEPS = 20
MAX_STEP_CHARS = 500


class FixRequest(BaseModel):
    latex: str = Field(min_length=1, max_length=MAX_LATEX_CHARS)
    # What the renderer said was wrong, if the page knows. Helps the model, and is optional.
    error: str = Field(default="", max_length=500)


class FixResponse(BaseModel):
    latex: str
    why: str
    changed: bool
    cached: bool
    mock: bool


class StepsRequest(BaseModel):
    """A derivation, one step per item, in order."""

    steps: list[str] = Field(min_length=1, max_length=MAX_STEPS)

    @field_validator("steps")
    @classmethod
    def _each_step_is_short(cls, steps: list[str]) -> list[str]:
        if any(len(step) > MAX_STEP_CHARS for step in steps):
            raise ValueError(f"each step must be at most {MAX_STEP_CHARS} characters")
        if not any(step.strip() for step in steps):
            raise ValueError("at least one step must not be blank")
        return steps


class CheckResponse(BaseModel):
    ok: bool
    # 1-based, matching the order of the steps sent. None when everything is fine (or the model's number was unusable).
    step: int | None
    why: str
    suggestion: str | None
    cached: bool
    mock: bool


class NextResponse(BaseModel):
    next: str | None
    done: bool
    why: str
    cached: bool
    mock: bool


# Base64 of the largest photo the server accepts (600 KiB), plus a little slack.
MAX_IMAGE_BASE64_CHARS = 820_000


class ImageRequest(BaseModel):
    image: str = Field(min_length=1, max_length=MAX_IMAGE_BASE64_CHARS)
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
