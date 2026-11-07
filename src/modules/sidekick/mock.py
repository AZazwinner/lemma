"""Canned answers for SIDEKICK_MOCK=1, so the UI can be built without spending any quota.

Triggers that help test the UI: an input containing "__busy__" gets the "busy" response and one containing "__error__"
gets the generic upstream error. For "check my work", "__ok__" in the steps says every step is fine; otherwise the second
step (or the first, if there is only one) is flagged. For "next step", "__done__" says the derivation is finished.
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

_IMAGE = "x^2 + 2x + 1 = (x + 1)^2"
_FIX = "LATEX: \\frac{1}{2}\nWHY: The fraction was missing a closing brace."
_CHECK_OK = "VERDICT: OK\nWHY: Every step follows from the one before."
_CHECK_WRONG = (
    "VERDICT: ERROR\nSTEP: {step}\n"
    "WHY: This step doesn't follow from the one before it.\n"
    "FIX: x = 2"
)
_NEXT = "NEXT: x = 3\nWHY: Divide both sides by 2."
_NEXT_DONE = "NEXT: DONE\nWHY: The answer is already reached."


async def mock_generate(feature: str, text: str) -> str:
    if MOCK_DELAY:
        await asyncio.sleep(MOCK_DELAY)
    if feature == "image":
        return _IMAGE
    if feature == "fix":
        return _FIX
    if feature == "check":
        if "__ok__" in text:
            return _CHECK_OK
        return _CHECK_WRONG.format(step=2 if "\n" in text.strip() else 1)
    if feature == "next":
        return _NEXT_DONE if "__done__" in text else _NEXT
    if feature == "latex":
        lowered = text.lower()
        for needle, latex in _LATEX:
            if needle in lowered:
                return latex
        return _DEFAULT_LATEX
    return _EXPLAIN
