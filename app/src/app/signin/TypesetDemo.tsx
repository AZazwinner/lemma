"use client"

import katex from "katex"
import { useEffect, useMemo, useRef, useState } from "react"

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
 * The LaTeX source is typed out once by a collaborator cursor, and the typeset equation is uncovered alongside it.
 * The finished equation is laid out once and revealed left to right behind a soft edge, so it never re-flows while
 * typing. How far it is uncovered comes from measuring the typeset width of each prefix that parses, so the reveal
 * keeps pace with what has actually been typed.
 */
export function TypesetDemo() {
  const [typed, setTyped] = useState(0)
  // Uncovered width (px) after n characters, measured once the fonts are ready.
  const [widths, setWidths] = useState<number[] | null>(null)
  const measureRef = useRef<HTMLDivElement>(null)

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

  const full = useMemo(() => render(SOURCE, true) ?? "", [])

  // The last prefix that parses at each length, with anything still open closed provisionally (a pending \left gets
  // an invisible \right., a pending { its }), so the measured width grows with every keystroke instead of waiting for
  // the closing bracket. Prefixes that stop inside a command name are skipped: "\le \le" parses, but it is half of
  // "\left".
  const prefixFrames = useMemo(() => {
    const close = (prefix: string) => {
      const lefts = (prefix.match(/\\left\b/g) ?? []).length - (prefix.match(/\\right\b/g) ?? []).length
      const braces = (prefix.match(/{/g) ?? []).length - (prefix.match(/}/g) ?? []).length
      return prefix + "}".repeat(Math.max(0, braces)) + String.raw`\right.`.repeat(Math.max(0, lefts))
    }
    const out: string[] = []
    let last = ""
    for (let n = 0; n <= SOURCE.length; n++) {
      const prefix = SOURCE.slice(0, n)
      const midCommand = /\\[a-zA-Z]+$/.test(prefix) && /[a-zA-Z]/.test(SOURCE[n] ?? "")
      if (!midCommand) last = render(close(prefix), true) ?? render(prefix, true) ?? last
      out.push(last)
    }
    return out
  }, [])

  useEffect(() => {
    let cancelled = false
    const measure = () => {
      const box = measureRef.current
      if (!box || cancelled) return
      const out: number[] = []
      let lastHtml: string | null = null
      let lastWidth = 0
      let widest = 0
      for (const html of prefixFrames) {
        if (html !== lastHtml) {
          box.innerHTML = html
          lastWidth = box.getBoundingClientRect().width
          lastHtml = html
        }
        // Never move the edge backwards, even when a closing bracket makes a prefix render narrower.
        widest = Math.max(widest, lastWidth)
        out.push(widest)
      }
      box.innerHTML = ""
      setWidths(out)
    }
    if (document.fonts?.ready) document.fonts.ready.then(measure)
    else measure()
    return () => {
      cancelled = true
    }
  }, [prefixFrames])

  const caption = useMemo(() => render(CAPTION, false) ?? "", [])
  const done = typed >= SOURCE.length

  // Until widths are measured, reveal in proportion to how much has been typed.
  const reveal = done
    ? "calc(100% + var(--reveal-edge))"
    : widths
      ? `${widths[typed]}px`
      : `${(typed / SOURCE.length) * 100}%`

  return (
    <div aria-hidden className="relative w-full max-w-[40rem]">
      <p className="min-h-12 font-mono text-[0.8125rem] leading-6 text-ink-soft [overflow-wrap:anywhere]">
        {SOURCE.slice(0, typed)}
        <span className="auth-caret">
          <span className="auth-flag">Ada</span>
        </span>
      </p>

      <div className="relative mt-9 min-h-[5.5rem] text-[1.35rem]">
        <div
          className="auth-render auth-reveal inline-block"
          style={{ "--reveal": reveal } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: full }}
        />
        {/* Off-screen twin used only to measure each prefix's typeset width. */}
        <div ref={measureRef} className="auth-render pointer-events-none invisible absolute top-0 left-0 inline-block whitespace-nowrap" />
      </div>

      <p
        className="font-heading mt-6 text-[1.1875rem] text-heading transition-opacity duration-700"
        style={{ opacity: done ? 1 : 0 }}
      >
        for all <span dangerouslySetInnerHTML={{ __html: caption }} />, with equality exactly when they are parallel.
      </p>
    </div>
  )
}
