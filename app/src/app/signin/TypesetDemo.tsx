"use client"

import katex from "katex"
import { useEffect, useMemo, useState } from "react"

const SOURCE = String.raw`\left(\sum_i u_i v_i\right)^2 \le \left(\sum_i u_i^2\right)\left(\sum_i v_i^2\right)`
const CAPTION = String.raw`u, v \in \mathbb{R}^n`
const KEYSTROKE_MS = 42
const START_DELAY_MS = 500

function render(src: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: true })
  } catch {
    return null
  }
}

/**
 * The LaTeX source is typed out once by a collaborator cursor, and the typeset equation follows keystroke by keystroke,
 * the way the editor behaves. While the source is mid-command it keeps showing the last prefix that parsed.
 */
export function TypesetDemo() {
  const [typed, setTyped] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let timer: ReturnType<typeof setTimeout>
    const step = (n: number) => {
      setTyped(n)
      if (n < SOURCE.length) timer = setTimeout(() => step(n + 1), KEYSTROKE_MS)
    }
    timer = reduced ? setTimeout(() => setTyped(SOURCE.length), 0) : setTimeout(() => step(1), START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  // Every prefix is rendered up front so typing never waits on KaTeX.
  const frames = useMemo(() => {
    const out: string[] = []
    let last = ""
    for (let n = 0; n <= SOURCE.length; n++) {
      const prefix = SOURCE.slice(0, n)
      // Skip prefixes that stop inside a command name: "\le \le" parses, but it is half of "\left".
      const midCommand = /\\[a-zA-Z]+$/.test(prefix) && /[a-zA-Z]/.test(SOURCE[n] ?? "")
      if (!midCommand) last = render(prefix, true) ?? last
      out.push(last)
    }
    return out
  }, [])

  const caption = useMemo(() => render(CAPTION, false) ?? "", [])
  const done = typed >= SOURCE.length

  return (
    <div aria-hidden className="relative w-full max-w-[40rem]">
      <p className="min-h-12 font-mono text-[13px] leading-6 text-ink-soft [overflow-wrap:anywhere]">
        {SOURCE.slice(0, typed)}
        <span className="auth-caret">
          <span className="auth-flag">Ada</span>
        </span>
      </p>

      <div
        className="auth-render mt-9 min-h-[5.5rem] text-[1.35rem]"
        dangerouslySetInnerHTML={{ __html: frames[typed] }}
      />

      <p
        className="font-heading mt-6 text-[19px] text-heading transition-opacity duration-700"
        style={{ opacity: done ? 1 : 0 }}
      >
        for all <span dangerouslySetInnerHTML={{ __html: caption }} />, with equality exactly when they are parallel.
      </p>
    </div>
  )
}
