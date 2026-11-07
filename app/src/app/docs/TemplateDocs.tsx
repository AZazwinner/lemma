"use client"

import { createDoc } from "@/api/docs"
import katex from "katex"
import { useRouter } from "next/navigation"
import { useMemo } from "react"

const TEMPLATES: { name: string; blurb: string }[] = [
  { name: "Blank Document", blurb: "Start from scratch" },
  { name: "Math Notes", blurb: "Quick notation & notes" },
  { name: "Homework Template", blurb: "Structured problem sets" },
  { name: "Lecture Summary", blurb: "Condensed lecture notes" },
  { name: "Research Paper", blurb: "Formal paper structure" },
  { name: "Proof Writing", blurb: "Theorem & proof layout" },
  { name: "Exam Prep Sheet", blurb: "Cheat-sheet style review" },
]

function tex(src: string): string {
  try {
    return katex.renderToString(src, { throwOnError: true })
  } catch {
    return src
  }
}

/** A miniature of the page each template starts you on. Decorative: the card's name comes from its label. */
function TemplatePreview({ name }: { name: string }) {
  const math = useMemo(
    () => ({
      notes: tex(String.raw`\int_a^b f'(x)\,dx = f(b)-f(a)`),
      proof: tex(String.raw`n \ge 1`),
      exam: tex(String.raw`e^{i\pi} + 1 = 0`),
    }),
    []
  )

  switch (name) {
    case "Blank Document":
      return <span className="auth-caret h-3" />
    case "Math Notes":
      return (
        <>
          <b>Notes</b>
          <br />
          <span dangerouslySetInnerHTML={{ __html: math.notes }} />
        </>
      )
    case "Homework Template":
      return (
        <>
          <b>Problem 1.</b>
          <br />
          (a) Show that
          <br />
          (b) Hence find
        </>
      )
    case "Lecture Summary":
      return (
        <>
          <b>Lecture 7</b>
          <br />
          Key ideas
          <br />
          Worked example
        </>
      )
    case "Research Paper":
      return (
        <>
          <b>Abstract</b>
          <br />1&nbsp; Introduction
          <br />2&nbsp; Main results
        </>
      )
    case "Proof Writing":
      return (
        <>
          <b>Theorem 1.</b> <i>Let</i> <span dangerouslySetInnerHTML={{ __html: math.proof }} />
          <br />
          <i>Proof.</i> By induction. ∎
        </>
      )
    case "Exam Prep Sheet":
      return (
        <>
          <b>Formulas</b>
          <br />
          <span dangerouslySetInnerHTML={{ __html: math.exam }} />
          <br />
          Common mistakes
        </>
      )
    default:
      return null
  }
}

export function TemplateDocsRow() {
  const router = useRouter()

  async function handleSelect(template: string) {
    try {
      const res = await createDoc({
        template,
        title: template
      })

      router.push(`/docs/d/${res.doc_id}`)
    } catch (err) {
      console.error("Failed to create doc:", err)
    }
  }

  return (
    <div className="scrollbar-custom -mx-1 overflow-x-auto px-1 pt-1 pb-3">
      <div className="flex w-max gap-3 pr-1">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.name}
            type="button"
            onClick={() => handleSelect(tpl.name)}
            className="group/tpl flex w-40 shrink-0 flex-col overflow-hidden rounded-[10px] border border-hairline bg-sheet text-left transition-[border-color,transform,box-shadow] duration-250 ease-[cubic-bezier(0.2,0.7,0.2,1)] outline-none hover:-translate-y-[3px] hover:border-ink-faint/50 hover:shadow-[0_10px_22px_-12px_rgba(20,24,30,0.35)] focus-visible:ring-2 focus-visible:ring-ring/40 active:translate-y-[-1px] active:scale-[0.99]"
          >
            <div
              aria-hidden
              className="relative h-[88px] overflow-hidden border-b border-hairline-soft bg-page py-3 pr-3 pl-[22px] font-serif text-[11.5px] leading-[1.45] text-ink-soft before:absolute before:inset-y-0 before:left-3 before:border-l before:border-[var(--rule)] [&_.katex]:text-[1em] [&_b]:font-bold [&_b]:text-ink"
            >
              <div className="transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover/tpl:-translate-y-[3px]">
                <TemplatePreview name={tpl.name} />
              </div>
            </div>
            <div className="px-3 pt-2 pb-2.5">
              <div className="truncate text-[12.5px] font-medium text-ink">{tpl.name}</div>
              <div className="truncate text-xs text-ink-faint">{tpl.blurb}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
