"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { cn } from "@/lib/utils"

// A line of text with typeset maths in it (`The root of $x^2 = 4$ is $2$.`), for the sidekick's one-line messages. It is
// inline: paragraphs become spans, so it sits in a sentence. Links and images are dropped, because the text comes from a
// model and must not be able to load anything from another site.

const components: Components = {
    p: ({ children }) => <span>{children}</span>,
    code: ({ children }) => <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>,
}

export function MathText({ text, className }: { text: string; className?: string }) {
    return (
        <span className={cn("font-serif", className)}>
            <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                components={components}
                disallowedElements={["img", "a", "pre"]}
                unwrapDisallowed
            >
                {text}
            </ReactMarkdown>
        </span>
    )
}
