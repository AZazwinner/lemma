"""Canned answers for SIDEKICK_MOCK=1, so the UI can be built without spending any quota.

Two triggers help test the UI's quiet states: an input containing "__busy__" gets the "busy" response, and one
containing "__error__" gets the generic upstream error.
"""

import asyncio

# Seconds. Long enough to see the loading state. Tests set it to 0.
MOCK_DELAY = 0.4

_LATEX = [
    ("integral", r"\int_0^1 x^2 \, dx"),
    ("derivative", r"\frac{d}{dx} x^3 = 3x^2"),
    ("quadratic", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"),
    ("sum", r"\sum_{k=1}^{n} k = \frac{n(n+1)}{2}"),
    ("pythag", r"a^2 + b^2 = c^2"),
]
_DEFAULT_LATEX = r"E = mc^2"

_EXPLAIN = (
    "SUMMARY: This is a sample explanation from mock mode; no AI model was called.\n"
    "1. Read the left-hand side as the quantity being defined.\n"
    "2. The right-hand side says how to compute it from the other symbols.\n"
    "3. Substitute the values you know and simplify."
)


async def mock_generate(feature: str, text: str) -> str:
    if MOCK_DELAY:
        await asyncio.sleep(MOCK_DELAY)
    if feature == "latex":
        lowered = text.lower()
        for needle, latex in _LATEX:
            if needle in lowered:
                return latex
        return _DEFAULT_LATEX
    return _EXPLAIN
