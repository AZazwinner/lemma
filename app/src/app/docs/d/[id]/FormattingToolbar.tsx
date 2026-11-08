"use client"

import { useRef } from "react"
import katex from "katex"
import { Tip } from "@/components/ui/tooltip"
import type { EditorView } from "@codemirror/view"
import { Bold, Code, Divide, FunctionSquare, Grid3x3, Heading, Image as ImageIcon, Italic, Sigma, SquareCode, Strikethrough, Table } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
    insertBlockMath,
    insertFraction,
    insertImageMarkdown,
    insertInlineMath,
    insertMatrix,
    insertTable,
    isLinePrefixed,
    isWrapped,
    MAX_IMAGE_BYTES,
    readImageAsDataUri,
    toggleCodeBlock,
    toggleLinePrefix,
    toggleWrap,
} from "./format-commands"

type ToolbarAction = {
    label: string
    icon: React.ComponentType<{ className?: string }>
    /** Math actions show the symbol they insert, typeset, instead of an icon. */
    glyph?: string
    run: (view: EditorView) => void
    isActive?: (view: EditorView) => boolean
}

const TEXT_ACTIONS: ToolbarAction[] = [
    { label: "Bold", icon: Bold, run: (view) => toggleWrap(view, "**"), isActive: (view) => isWrapped(view, "**") },
    { label: "Italic", icon: Italic, run: (view) => toggleWrap(view, "_"), isActive: (view) => isWrapped(view, "_") },
    { label: "Strikethrough", icon: Strikethrough, run: (view) => toggleWrap(view, "~~"), isActive: (view) => isWrapped(view, "~~") },
    { label: "Heading", icon: Heading, run: (view) => toggleLinePrefix(view, "# "), isActive: (view) => isLinePrefixed(view, "# ") },
    { label: "Inline code", icon: Code, run: (view) => toggleWrap(view, "`"), isActive: (view) => isWrapped(view, "`") },
    { label: "Code block", icon: SquareCode, run: (view) => toggleCodeBlock(view) },
    { label: "Table", icon: Table, run: (view) => insertTable(view) },
]

const MATH_ACTIONS: ToolbarAction[] = [
    { label: "Inline math", icon: Sigma, glyph: "x", run: (view) => insertInlineMath(view), isActive: (view) => isWrapped(view, "$") },
    { label: "Block equation", icon: FunctionSquare, glyph: String.raw`\textstyle\sum`, run: (view) => insertBlockMath(view) },
    { label: "Fraction", icon: Divide, glyph: String.raw`\frac{a}{b}`, run: (view) => insertFraction(view) },
    { label: "Matrix", icon: Grid3x3, glyph: String.raw`\left[\begin{smallmatrix}a&b\\c&d\end{smallmatrix}\right]`, run: (view) => insertMatrix(view) },
]

const glyphCache = new Map<string, string>()
function glyphHtml(tex: string): string | null {
    if (!glyphCache.has(tex)) {
        try {
            glyphCache.set(tex, katex.renderToString(tex, { throwOnError: true }))
        } catch {
            return null
        }
    }
    return glyphCache.get(tex) ?? null
}

function ToolbarButton({
    action,
    activeView,
    disabled,
}: {
    action: ToolbarAction
    activeView: EditorView | null
    disabled: boolean
}) {

    "use no memo"

    const isDisabled = disabled || !activeView
    const isActive = !isDisabled && activeView ? Boolean(action.isActive?.(activeView)) : false
    const { label, icon: Icon, run, glyph } = action
    const glyphMarkup = glyph ? glyphHtml(glyph) : null

    return (
        <Tip label={label}>
        <Button
            type="button"
            variant="ghost"
            size="icon"
            data-anim={glyphMarkup ? undefined : "lift"}
            aria-label={label}
            aria-pressed={isActive}
            disabled={isDisabled}

            onMouseDown={(e) => e.preventDefault()}
            onClick={() => activeView && run(activeView)}
            className={cn(
                "text-ink-soft hover:text-ink",
                glyphMarkup && "min-w-9 px-1.5 [&_.katex]:inline-block [&_.katex]:transition-transform [&_.katex]:duration-250 hover:[&_.katex]:scale-110",
                glyph === "x" ? "[&_.katex]:text-[1rem]" : glyph?.includes("frac") || glyph?.includes("matrix") ? "[&_.katex]:text-[0.75rem]" : "[&_.katex]:text-[0.9375rem]",
                isActive && "bg-tint text-ink"
            )}
        >
            {glyphMarkup ? <span aria-hidden dangerouslySetInnerHTML={{ __html: glyphMarkup }} /> : <Icon className="w-4 h-4" />}
        </Button>
        </Tip>
    )
}


function ImageButton({
    activeView,
    disabled,
}: {
    activeView: EditorView | null
    disabled: boolean
}) {
    "use no memo"

    const inputRef = useRef<HTMLInputElement>(null)
    const isDisabled = disabled || !activeView

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file || !activeView) return

        if (file.size > MAX_IMAGE_BYTES) {
            window.alert(`Image is too large to embed (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB).`)
            return
        }

        const dataUri = await readImageAsDataUri(file)
        insertImageMarkdown(activeView, dataUri)
    }

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
            />
            <Tip label="Image">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                data-anim="lift"
                className="text-ink-soft hover:text-ink"
                aria-label="Image"
                disabled={isDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
            >
                <ImageIcon className="w-4 h-4" />
            </Button>
            </Tip>
        </>
    )
}

export function FormattingToolbar({
    activeView,
    disabled,
}: {
    activeView: EditorView | null
    disabled: boolean
}) {

    "use no memo"

    return (
        <div role="toolbar" aria-label="Formatting" className="scrollbar-none flex items-center gap-0.5 overflow-x-auto border-b border-hairline-soft bg-sheet px-3 py-1.5 sm:px-4">
            {TEXT_ACTIONS.map((action) => (
                <ToolbarButton key={action.label} action={action} activeView={activeView} disabled={disabled} />
            ))}

            <div className="mx-1.5 h-5 w-px shrink-0 bg-border" />

            {MATH_ACTIONS.map((action) => (
                <ToolbarButton key={action.label} action={action} activeView={activeView} disabled={disabled} />
            ))}

            <div className="mx-1.5 h-5 w-px shrink-0 bg-border" />

            <ImageButton activeView={activeView} disabled={disabled} />
        </div>
    )
}
