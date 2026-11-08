"""Canned answers for SIDEKICK_MOCK=1, so the UI can be built without spending any quota.

The answers are not one fixed string: they read the input, so a demo looks like a real model. Explain recognises common
equations (and otherwise names the symbols it finds), Check and Next solve linear equations step by step, Fix repairs
unbalanced braces and misspelled commands, and Write knows a few short passages.

Triggers that help test the UI: an input containing "__busy__" gets the "busy" response and one containing "__error__"
gets the generic upstream error. For "check my work", "__ok__" in the steps says every step is fine. For "next step",
"__done__" says the derivation is finished.
"""

import asyncio
import re
from fractions import Fraction

# Seconds. Long enough to see the loading state. Tests set it to 0.
MOCK_DELAY = 0.4

_LATEX = [
    ("integral", r"\int_0^1 x^2 \, dx"),
    ("derivative", r"\frac{d}{dx} x^3 = 3x^2"),
    ("quadratic", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"),
    ("sum", r"\sum_{k=1}^{n} k = \frac{n(n+1)}{2}"),
    ("pythag", r"a^2 + b^2 = c^2"),
    ("gauss", r"\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}"),
    ("euler", r"e^{i\pi} + 1 = 0"),
]
_DEFAULT_LATEX = r"E = mc^2"
_IMAGE = "x^2 + 2x + 1 = (x + 1)^2"


# --- small helpers ----------------------------------------------------------------------------------------------

def _bare(latex: str) -> str:
    """The LaTeX without its $$ / $ / \\[ \\] wrapper."""
    text = latex.strip()
    for left, right in (("$$", "$$"), ("\\[", "\\]"), ("$", "$")):
        if text.startswith(left) and text.endswith(right) and len(text) > len(left) + len(right):
            text = text[len(left) : len(text) - len(right)].strip()
    return text


def _first_math(text: str) -> str:
    """The first equation in some text: its first $$ or $ span if there is one, else the first non-empty line."""
    match = re.search(r"\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$", text)
    if match:
        return (match.group(1) or match.group(2)).strip()
    for line in text.splitlines():
        if line.strip():
            return _bare(line)
    return text.strip()


def _num(value: Fraction) -> str:
    """A number as LaTeX: 4, -3, \\frac{5}{2}."""
    if value.denominator == 1:
        return str(value.numerator)
    sign = "-" if value < 0 else ""
    return f"{sign}\\frac{{{abs(value.numerator)}}}{{{value.denominator}}}"


def _term(coef: Fraction, var: str) -> str:
    """A coefficient and its variable: x, -x, 2x, \\frac{1}{2}x."""
    if coef == 1:
        return var
    if coef == -1:
        return f"-{var}"
    return f"{_num(coef)}{var}"


# --- linear equations in one variable ---------------------------------------------------------------------------

class _NotLinear(Exception):
    pass


# (coefficient of the variable, constant, the variable's name or None)
_Lin = tuple[Fraction, Fraction, "str | None"]


def _lin_add(a: _Lin, b: _Lin, sign: int) -> _Lin:
    if a[2] and b[2] and a[2] != b[2]:
        raise _NotLinear
    return (a[0] + sign * b[0], a[1] + sign * b[1], a[2] or b[2])


def _lin_mul(a: _Lin, b: _Lin) -> _Lin:
    if a[0] != 0 and b[0] != 0:
        raise _NotLinear
    if a[0] == 0:
        a, b = b, a
    return (a[0] * b[1], a[1] * b[1], a[2])


def _parse_linear(source: str) -> _Lin:
    """Parses a side like `2x + 3` or `3(x - 1)`. Raises _NotLinear for anything that isn't linear in one variable."""
    text = source.replace("\\cdot", "*").replace("\\times", "*").replace("\\left", "").replace("\\right", "")
    text = re.sub(r"\\[,;! ]", "", text)
    tokens = re.findall(r"\d+(?:\.\d+)?|[A-Za-z]|[-+*/()]|\S", re.sub(r"\s+", "", text))
    if not tokens or any(not re.fullmatch(r"\d+(?:\.\d+)?|[A-Za-z]|[-+*/()]", t) for t in tokens):
        raise _NotLinear
    pos = 0

    def peek() -> "str | None":
        return tokens[pos] if pos < len(tokens) else None

    def take() -> str:
        nonlocal pos
        pos += 1
        return tokens[pos - 1]

    def atom() -> _Lin:
        token = peek()
        if token == "(":
            take()
            value = expr()
            if peek() != ")":
                raise _NotLinear
            take()
            return value
        if token is not None and re.fullmatch(r"\d+(?:\.\d+)?", token):
            return (Fraction(0), Fraction(take()), None)
        if token is not None and token.isalpha():
            return (Fraction(1), Fraction(0), take())
        raise _NotLinear

    def unary() -> _Lin:
        if peek() == "-":
            take()
            value = unary()
            return (-value[0], -value[1], value[2])
        if peek() == "+":
            take()
        return atom()

    def term() -> _Lin:
        value = unary()
        while True:
            token = peek()
            if token == "*":
                take()
                value = _lin_mul(value, unary())
            elif token == "/":
                take()
                divisor = unary()
                if divisor[0] != 0 or divisor[1] == 0:
                    raise _NotLinear
                value = (value[0] / divisor[1], value[1] / divisor[1], value[2])
            elif token is not None and (token == "(" or token[0].isalnum()):
                value = _lin_mul(value, atom())  # 2x and 3(x - 1): multiplication written by juxtaposition
            else:
                return value

    def expr() -> _Lin:
        value = term()
        while peek() in ("+", "-"):
            sign = 1 if take() == "+" else -1
            value = _lin_add(value, term(), sign)
        return value

    result = expr()
    if pos != len(tokens):
        raise _NotLinear
    return result


def _linear_equation(step: str):
    """(left, right, variable) for a linear equation in one variable, else None."""
    parts = _bare(step).split("=")
    if len(parts) != 2:
        return None
    try:
        left, right = _parse_linear(parts[0]), _parse_linear(parts[1])
    except (_NotLinear, ZeroDivisionError):
        return None
    var = left[2] or right[2]
    if var is None:
        return None
    return left, right, var


def _solution(step: str):
    """What a linear step says about its variable: ("one", var, value), ("all", var), ("none", var), or None if it isn't one."""
    parsed = _linear_equation(step)
    if parsed is None:
        return None
    left, right, var = parsed
    a, b = left[0] - right[0], right[1] - left[1]
    if a == 0:
        return ("all", var) if b == 0 else ("none", var)
    return ("one", var, b / a)


def _next_linear(step: str):
    """(next step, why) for a linear equation, or None when it is already solved or isn't linear."""
    parsed = _linear_equation(step)
    if parsed is None:
        return None
    left, right, var = parsed
    a1, b1, a2, b2 = left[0], left[1], right[0], right[1]
    if a1 == 0 and a2 != 0:  # the variable is only on the right: read it the other way round
        a1, b1, a2, b2 = a2, b2, a1, b1
    if a2 != 0:
        gathered = a1 - a2
        if gathered == 0:
            return None
        return (
            f"{_term(gathered, var)} = {_num(b2 - b1)}",
            f"Collect the ${var}$ terms on the left and the constants on the right.",
        )
    if b1 != 0:
        verb = f"Subtract ${_num(b1)}$ from" if b1 > 0 else f"Add ${_num(-b1)}$ to"
        return (f"{_term(a1, var)} = {_num(b2 - b1)}", f"{verb} both sides to leave the ${var}$ term on its own.")
    if a1 not in (0, 1):
        return (f"{var} = {_num(b2 / a1)}", f"Divide both sides by ${_num(a1)}$.")
    return None


def _top_level_sign(expr: str) -> bool:
    depth = 0
    for index, char in enumerate(expr):
        if char in "({[":
            depth += 1
        elif char in ")}]":
            depth -= 1
        elif char in "+-" and depth == 0 and index > 0:
            return True
    return False


def _quadratic_next(expr: str):
    compact = re.sub(r"\s+", "", expr)
    factored = re.fullmatch(r"\((\w)([+-])(\d+)\)\(\1([+-])(\d+)\)=0", compact)
    if factored:
        var = factored.group(1)
        roots = [(-1 if factored.group(2) == "+" else 1) * int(factored.group(3)),
                 (-1 if factored.group(4) == "+" else 1) * int(factored.group(5))]
        return (f"{var} = {roots[0]} \\text{{ or }} {var} = {roots[1]}", "A product is zero only when one of its factors is zero.")
    quadratic = re.fullmatch(r"(\w)\^2([+-])(\d*)\1([+-])(\d+)=0", compact)
    if quadratic:
        var = quadratic.group(1)
        b = (1 if quadratic.group(2) == "+" else -1) * int(quadratic.group(3) or 1)
        c = (1 if quadratic.group(4) == "+" else -1) * int(quadratic.group(5))
        for r1 in range(-50, 51):
            r2 = -b - r1
            if r1 * r2 == c and r1 <= r2:
                def factor(root: int) -> str:
                    return f"({var} - {root})" if root > 0 else (f"({var} + {-root})" if root < 0 else var)
                return (f"{factor(r1)}{factor(r2)} = 0", f"Factor the quadratic: ${r1}$ and ${r2}$ add to ${-b}$ and multiply to ${c}$.")
    return None


def _next_step(step: str):
    """(next step, why) for the last line of a derivation, or None if there isn't an obvious one."""
    linear = _next_linear(step)
    if linear:
        return linear
    if _linear_equation(step):
        return None
    body = _bare(step)
    parts = body.split("=")
    if len(parts) != 2:
        return None
    left, right = parts[0].strip(), parts[1].strip()
    if right == "0":
        return _quadratic_next(body)
    rhs = f"({right})" if _top_level_sign(right) else right
    return (f"{left} - {rhs} = 0", "Move everything to one side, so the equation can be compared with zero.")


# --- the six features -------------------------------------------------------------------------------------------

_NUMBERED = re.compile(r"^\s*\d+\.\s?(.*)$")


def _steps_of(text: str) -> list[str]:
    """The steps in "1. ...\\n2. ..." (how the service sends a derivation)."""
    steps = []
    for line in text.splitlines():
        match = _NUMBERED.match(line)
        steps.append((match.group(1) if match else line).strip())
    return [step for step in steps if step]


def _mock_next(text: str) -> str:
    steps = _steps_of(text)
    if "__done__" in text or not steps:
        return "NEXT: DONE\nWHY: The answer is already reached."
    found = _next_step(steps[-1])
    if not found:
        return "NEXT: DONE\nWHY: I don't see a simpler form from here, so this looks finished."
    return f"NEXT: {found[0]}\nWHY: {found[1]}"


def _mock_check(text: str) -> str:
    steps = _steps_of(text)
    if "__ok__" not in text:
        previous = None  # (step text, solution)
        for number, step in enumerate(steps, 1):
            solution = _solution(step)
            if solution is None:
                previous = None  # not a linear equation: nothing to compare the next step with
                continue
            # Only steps about the same variable can be compared; a new variable starts a new chain.
            if previous is not None and solution[1] == previous[1][1] and solution != previous[1]:
                return _check_error(number, previous[0], previous[1], solution)
            previous = (step, solution)
    return "VERDICT: OK\nWHY: Every step follows from the one before."


def _solution_text(solution) -> str:
    if solution[0] == "one":
        return f"{solution[1]} = {_num(solution[2])}"
    return f"{solution[1]} can be anything" if solution[0] == "all" else f"{solution[1]} has no solution"


def _check_error(number: int, previous: str, previous_solution, solution) -> str:
    follow = _next_linear(previous)
    fix = follow[0] if follow else _solution_text(previous_solution)
    if follow is None:  # the line above is already solved, so quote its answer rather than "x = 2 gives x = 2"
        why = f"The line above says ${_solution_text(previous_solution)}$, not ${_solution_text(solution)}$."
    else:
        why = f"${_bare(previous)}$ gives ${_solution_text(previous_solution)}$, not ${_solution_text(solution)}$."
    return f"VERDICT: ERROR\nSTEP: {number}\nWHY: {why}\nFIX: {fix}"


_TYPOS = {
    r"\farc": r"\frac",
    r"\frca": r"\frac",
    r"\sqr": r"\sqrt",
    r"\sqrtt": r"\sqrt",
    r"\inft": r"\infty",
    r"\infity": r"\infty",
    r"\aplha": r"\alpha",
    r"\lamda": r"\lambda",
    r"\theata": r"\theta",
    r"\sigam": r"\sigma",
    r"\sumation": r"\sum",
    r"\intt": r"\int",
}


def _braces_open(latex: str) -> int:
    """How many { are never closed (a negative number means extra }). Escaped braces don't count."""
    cleaned = re.sub(r"\\[{}]", "", latex)
    return cleaned.count("{") - cleaned.count("}")


def _fix_latex(latex: str) -> tuple[str, str]:
    """(repaired text, one sentence on what was wrong); the text is unchanged if nothing obvious is wrong."""
    for typo, command in _TYPOS.items():
        pattern = re.compile(re.escape(typo) + r"(?![A-Za-z])")
        if pattern.search(latex):
            return pattern.sub(lambda _m: command, latex), f"`{typo}` is not a LaTeX command; it should be `{command}`."

    spans = [m for m in re.finditer(r"\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$", latex)]
    if not spans:  # bare LaTeX, with no $ around it
        missing = _braces_open(latex)
        if missing > 0:
            return _close_braces(latex, missing), _brace_reason(latex)
        return latex, "I couldn't find anything wrong with this."
    for span in spans:
        group = 1 if span.group(1) is not None else 2
        inner = span.group(group)
        missing = _braces_open(inner)
        if missing > 0:
            repaired = _close_braces(inner, missing)
            return latex[: span.start(group)] + repaired + latex[span.end(group) :], _brace_reason(inner)
    return latex, "I couldn't find anything wrong with this."


def _close_braces(latex: str, missing: int) -> str:
    """Adds the missing `}`. A fraction written \\frac{a{b} lost the brace after its numerator, so that is where it goes."""
    fraction = re.fullmatch(r"(\s*\\frac\{[^{}]*)\{([^{}]*\}\s*)", latex)
    if fraction and missing == 1:
        return f"{fraction.group(1)}}}{{{fraction.group(2)}"
    return latex + "}" * missing


def _brace_reason(latex: str) -> str:
    if "\\frac" in latex:
        return "The fraction was missing a closing brace."
    return "A `{` was never closed, so I added the missing `}`."


def _mock_fix(text: str) -> str:
    latex = text.rsplit("\n--\n", 1)[0] if "\n--\n" in text else text
    repaired, why = _fix_latex(latex)
    return f"LATEX: {repaired}\nWHY: {why}"


# --- explain ----------------------------------------------------------------------------------------------------

def _x_quadratic(expr: str, compact: str):
    if r"\sqrt{b^2-4ac}" not in compact or r"\pm" not in compact:
        return None
    return [
        r"This is the quadratic formula: it solves $ax^2 + bx + c = 0$ for $x$ using only the coefficients $a$, $b$ and $c$.",
        r"The part under the root, $b^2 - 4ac$, is the discriminant: positive means two real solutions, zero means one, and negative means none.",
        r"The $\pm$ sign gives the two solutions, one using $+\sqrt{b^2 - 4ac}$ and the other using $-\sqrt{b^2 - 4ac}$.",
        r"Dividing by $2a$ at the end only makes sense when $a \neq 0$, which is exactly what makes the equation quadratic.",
    ]


def _x_gauss(expr: str, compact: str):
    if r"e^{-x^2}" not in compact or r"\infty" not in compact:
        return None
    return [
        r"This is the Gaussian integral: it is the total area under the bell curve $e^{-x^2}$ over the whole real line.",
        r"The integrand $e^{-x^2}$ is symmetric about $x = 0$ and shrinks so quickly that the infinite area stays finite.",
        r"There is no elementary antiderivative of $e^{-x^2}$, so the value $\sqrt{\pi}$ comes from squaring the integral and switching to polar coordinates.",
        r"The same constant appears as the normalising factor of the normal distribution.",
    ]


def _x_euler(expr: str, compact: str):
    if not re.search(r"e\^\{?i\\pi\}?\+1=0", compact):
        return None
    return [
        r"This is Euler's identity: it ties together $e$, the imaginary unit $i$, $\pi$, $1$ and $0$.",
        r"It is the special case $\theta = \pi$ of Euler's formula $e^{i\theta} = \cos\theta + i\sin\theta$.",
        r"At $\theta = \pi$ the cosine is $-1$ and the sine is $0$, so $e^{i\pi} = -1$.",
        r"Adding $1$ to both sides gives $e^{i\pi} + 1 = 0$.",
    ]


def _x_integral(expr: str, compact: str):
    limit = r"-?(?:\d+|\\[a-z]+|[a-z])"  # one token: 3, -\infty, n
    match = re.fullmatch(rf"\\int_\{{?({limit})\}}?\^\{{?({limit})\}}?(.+?)(?:\\,)?d([a-z])(?:=(.+))?", compact)
    if not match:
        return None
    lo, hi, body, var = match.group(1), match.group(2), match.group(3).removesuffix(r"\,"), match.group(4)
    lines = [
        f"The integral adds up the values of ${body}$ as ${var}$ runs from ${lo}$ to ${hi}$, which is the signed area under the curve $y = {body}$ over that interval.",
        f"The factor $d{var}$ marks ${var}$ as the variable of integration, standing for the thin slices of width $d{var}$ that are added.",
    ]
    power = re.fullmatch(rf"{var}(?:\^\{{?(\d+)\}}?)?", body)
    if power and re.fullmatch(r"-?\d+", lo) and re.fullmatch(r"-?\d+", hi):
        n = int(power.group(1) or 1)
        value = (Fraction(int(hi)) ** (n + 1) - Fraction(int(lo)) ** (n + 1)) / (n + 1)
        lines.append(
            f"By the power rule an antiderivative of ${body}$ is $\\frac{{{var}^{{{n + 1}}}}}{{{n + 1}}}$: raise the exponent by one and divide by the new exponent."
        )
        lines.append(f"Evaluating it at ${hi}$ and at ${lo}$ and subtracting gives ${_num(value)}$.")
    else:
        lines.append("To evaluate it, find an antiderivative of the integrand and subtract its value at the lower limit from its value at the upper limit.")
    return lines


def _x_pythagoras(expr: str, compact: str):
    match = re.fullmatch(r"(\w)\^2\+(\w)\^2=(\w)\^2", compact)
    if not match:
        return None
    a, b, c = match.groups()
    return [
        f"This is the Pythagorean relation for a right triangle: the squares of the two legs ${a}$ and ${b}$ add up to the square of ${c}$.",
        f"Here ${c}$ is the hypotenuse, the side opposite the right angle, so it is always the longest side.",
        f"Given any two of ${a}$, ${b}$ and ${c}$ you can find the third; for example ${c} = \\sqrt{{{a}^2 + {b}^2}}$.",
        f"With ${a} = 3$ and ${b} = 4$ you get ${c}^2 = 25$, so ${c} = 5$.",
    ]


def _x_perfect_square(expr: str, compact: str):
    match = re.fullmatch(r"(\w)\^2\+(\d*)\1\+(\d+)=\(\1\+(\d+)\)\^2", compact)
    if not match:
        return None
    var, coef, const, m = match.group(1), int(match.group(2) or 1), int(match.group(3)), int(match.group(4))
    if coef != 2 * m or const != m * m:
        return None
    return [
        f"This identity says the quadratic ${var}^2 + {coef}{var} + {const}$ is a perfect square, equal to $({var} + {m})^2$.",
        f"Expanding $({var} + {m})^2$ gives ${var}^2 + 2 \\cdot {m} \\cdot {var} + {m}^2$, which matches the left side term by term.",
        f"The middle term ${coef}{var}$ is the cross term $2 \\cdot {var} \\cdot {m}$, and the constant ${const}$ is ${m}^2$.",
        f"Because both sides agree for every value of ${var}$, this is an identity to use for factoring rather than an equation to solve.",
    ]


def _x_sum(expr: str, compact: str):
    match = re.fullmatch(r"\\sum_\{(\w)=(\w+)\}\^\{?(\w+)\}?(.+?)(?:=(.+))?", compact)
    if not match:
        return None
    i, start, end, term, rhs = match.groups()
    lines = [f"The sum adds the terms ${term}$ as the index ${i}$ goes from ${start}$ up to ${end}$."]
    if term == i and start == "1" and rhs and rhs.replace(" ", "") == rf"\frac{{{end}({end}+1)}}{{2}}":
        lines += [
            f"The right-hand side is a closed form that avoids adding the terms one at a time.",
            f"It comes from Gauss's pairing trick: the first and last terms add to ${end} + 1$, as do the second and second-to-last, and there are $\\frac{{{end}}}{{2}}$ such pairs.",
            f"For example, with ${end} = 4$ both sides equal $1 + 2 + 3 + 4 = 10$.",
        ]
    else:
        lines.append(f"To evaluate it, substitute each value of ${i}$ in turn and add the results.")
        if rhs:
            lines.append(f"The right-hand side, ${rhs}$, is a closed form for that same total.")
    return lines


def _x_derivative(expr: str, compact: str):
    match = re.fullmatch(r"\\frac\{d\}\{d(\w)\}(.+?)=(.+)", compact)
    if not match:
        return None
    var, body, rhs = match.groups()
    lines = [f"The left side, $\\frac{{d}}{{d{var}}} {body}$, is the rate at which ${body}$ changes as ${var}$ changes."]
    power = re.fullmatch(rf"{var}\^\{{?(\d+)\}}?", body)
    if power:
        n = int(power.group(1))
        lines += [
            f"The power rule says to bring the exponent ${n}$ down as a factor and lower the exponent by one.",
            f"That turns ${var}^{{{n}}}$ into ${n}{var}^{{{n - 1}}}$, which is the right-hand side ${rhs}$.",
            f"At ${var} = 2$, for example, the slope of the curve is ${n * 2 ** (n - 1)}$.",
        ]
    else:
        lines.append(f"The right-hand side, ${rhs}$, is the derivative: the slope of ${body}$ at each value of ${var}$.")
    return lines


def _x_linear(expr: str, compact: str):
    parsed = _linear_equation(expr)
    solution = _solution(expr)
    if not parsed or not solution or solution[0] != "one":
        return None
    left, right, var = parsed
    parts = _bare(expr).split("=")
    lines = [f"This is a linear equation in ${var}$: it asks for the value of ${var}$ that makes ${parts[0].strip()}$ equal to ${parts[1].strip()}$."]
    step = _next_linear(expr)
    if step:
        lines.append(f"{step[1]} That leaves ${step[0]}$.")
    lines.append(f"Solving gives ${var} = {_num(solution[2])}$.")
    check = left[0] * solution[2] + left[1]
    lines.append(f"Substituting ${var} = {_num(solution[2])}$ back in makes the left side ${_num(check)}$, which matches the right side.")
    return lines


def _x_derivation(text: str):
    """Several equation lines: a derivation, described line by line."""
    lines = [_bare(line) for line in text.splitlines() if _bare(line) and not re.fullmatch(r"\$\$|\\\[|\\\]", line.strip())]
    solutions = [(line, _solution(line)) for line in lines]
    if len(lines) < 2 or any(sol is None for _, sol in solutions):
        return None
    var = solutions[0][1][1]
    out = [f"This is a derivation that solves ${lines[0]}$ for ${var}$, one line at a time."]
    for (prev, prev_sol), (cur, cur_sol) in zip(solutions, solutions[1:]):
        if cur_sol == prev_sol:
            out.append(f"Going from ${prev}$ to ${cur}$ keeps the same solution, ${_solution_text(cur_sol)}$.")
        else:
            out.append(f"Going from ${prev}$ to ${cur}$ changes the solution to ${_solution_text(cur_sol)}$, so the step does not follow.")
    return out[:5]


_OPERATIONS = [
    (r"\\frac", "a fraction"),
    (r"\\sqrt", "a square root"),
    (r"\^", "a power"),
    (r"\\sum", "a sum"),
    (r"\\int", "an integral"),
    (r"\\lim", "a limit"),
    (r"\\(?:sin|cos|tan)", "a trigonometric function"),
    (r"\\log|\\ln", "a logarithm"),
]


def _list_sentence(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _x_generic(expr: str):
    """Names what is actually in the equation: its two sides, its symbols and its operations."""
    short = len(expr) <= 70
    sides = _bare(expr).split("=") if expr.count("=") == 1 else None
    stripped = re.sub(r"\\[A-Za-z]+", " ", expr)
    symbols = []
    for letter in re.findall(r"[A-Za-z]", stripped):
        if letter not in symbols:
            symbols.append(letter)
    greek = []
    for name in re.findall(r"\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|phi|omega)\b", expr):
        if name not in greek:
            greek.append(name)
    names = [f"${s}$" for s in symbols] + [f"$\\{g}$" for g in greek]

    lines = []
    if sides and short:
        lines.append(f"This equation sets ${sides[0].strip()}$ equal to ${sides[1].strip()}$.")
    elif short:
        lines.append(f"This expression, ${expr}$, combines its symbols into a single quantity.")
    else:
        lines.append("This is a longer expression, so it is easiest to read it piece by piece.")
    if names:
        lines.append(f"It uses the symbols {_list_sentence(names[:6])}, so its value depends on what you choose for them.")
    operations = [label for pattern, label in _OPERATIONS if re.search(pattern, expr)]
    if operations:
        lines.append(f"The structure involves {_list_sentence(operations)}, and each of those is evaluated before the sides are compared.")
    if sides and short:
        lines.append(f"To check it, substitute numbers for the symbols and see that ${sides[0].strip()}$ and ${sides[1].strip()}$ give the same value.")
    else:
        lines.append("To check it, substitute numbers for the symbols and evaluate each part in turn.")
    return lines[:5]


def _mock_explain(text: str) -> str:
    derivation = _x_derivation(text)
    if derivation:
        return "\n".join(derivation)
    expr = _first_math(text)
    compact = re.sub(r"\s+", "", expr)
    for matcher in (_x_quadratic, _x_gauss, _x_euler, _x_integral, _x_pythagoras, _x_perfect_square, _x_sum, _x_derivative, _x_linear):
        lines = matcher(expr, compact)
        if lines:
            return "\n".join(lines)
    return "\n".join(_x_generic(expr))


# --- write ------------------------------------------------------------------------------------------------------

_EUCLID = r"""**Theorem.** There are infinitely many prime numbers.

*Proof.* Suppose, for contradiction, that there are only finitely many primes, $p_1, p_2, \ldots, p_n$. Consider the number

$$
N = p_1 p_2 \cdots p_n + 1.
$$

Since $N > 1$, it has at least one prime divisor $q$. By assumption $q$ is one of $p_1, \ldots, p_n$, so $q \mid p_1 p_2 \cdots p_n$. But $q$ also divides $N$, hence

$$
q \mid N - p_1 p_2 \cdots p_n = 1.
$$

No prime divides $1$, which is a contradiction. Therefore there are infinitely many primes. $\blacksquare$"""

_COMPLETING_THE_SQUARE = r"""Start from $ax^2 + bx + c = 0$ with $a \neq 0$ and divide by $a$:

$$
x^2 + \frac{b}{a}x = -\frac{c}{a}.
$$

Add $\left(\frac{b}{2a}\right)^2$ to both sides to complete the square:

$$
\left(x + \frac{b}{2a}\right)^2 = \frac{b^2 - 4ac}{4a^2}.
$$

Taking square roots and solving for $x$ gives the quadratic formula:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}.
$$"""


def _mock_write(description: str) -> str:
    lowered = description.lower()
    if "prime" in lowered and re.search(r"proof|prove|infinite", lowered):
        return _EUCLID
    if "quadratic" in lowered and re.search(r"deriv|prove|proof|complet|show", lowered):
        return _COMPLETING_THE_SQUARE
    return f"$$\n{_mock_latex(description)}\n$$"


def _mock_latex(description: str) -> str:
    lowered = description.lower()
    for needle, latex in _LATEX:
        if needle in lowered:
            return latex
    return _DEFAULT_LATEX


async def mock_generate(feature: str, text: str) -> str:
    if MOCK_DELAY:
        await asyncio.sleep(MOCK_DELAY)
    if feature == "image":
        return _IMAGE
    if feature == "fix":
        return _mock_fix(text)
    if feature == "check":
        return _mock_check(text)
    if feature == "next":
        return _mock_next(text)
    if feature == "write":
        return _mock_write(text)
    if feature == "latex":
        return _mock_latex(text)
    return _mock_explain(text)
