from pydantic import BaseModel, Field

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
