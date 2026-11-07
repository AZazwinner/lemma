"use client"

import { useEffect, useRef, useState } from "react"
import { Download, FileCode, FileText, Sheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DrawnCheck, UnitSpinner } from "@/components/ui/spinner"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ExportFormat } from "./TextEditor"

const OPTIONS: { format: ExportFormat; label: string; description: string; icon: typeof FileText }[] = [
    { format: "pdf", label: "PDF document", description: ".pdf", icon: FileText },
    { format: "md", label: "Markdown", description: ".md", icon: FileCode },
    { format: "html", label: "Web page", description: ".html", icon: FileCode },
    { format: "txt", label: "Plain text", description: ".txt", icon: Sheet },
]

// Short enough not to slow anyone down, long enough that the progress state reads as a step rather than a flicker.
const MIN_PROGRESS_MS = 500
const DONE_MS = 1300

type ExportState = { phase: "idle" } | { phase: "working"; label: string } | { phase: "done" }

export function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => void | Promise<void> }) {
    const [state, setState] = useState<ExportState>({ phase: "idle" })
    const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => {
        if (doneTimer.current) clearTimeout(doneTimer.current)
    }, [])

    async function run(format: ExportFormat, label: string) {
        setState({ phase: "working", label })
        try {
            await Promise.all([onExport(format), new Promise((r) => setTimeout(r, MIN_PROGRESS_MS))])
            setState({ phase: "done" })
            doneTimer.current = setTimeout(() => setState({ phase: "idle" }), DONE_MS)
        } catch {
            setState({ phase: "idle" })
        }
    }

    const busy = state.phase === "working"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={busy}>
                <Button variant="outline" size="sm" className="text-sm" data-anim="drop" aria-busy={busy}>
                    {state.phase === "working" ? (
                        <>
                            <UnitSpinner className="size-3.5" />
                            <span className="mb-swap">Exporting {state.label}…</span>
                        </>
                    ) : state.phase === "done" ? (
                        <>
                            <DrawnCheck className="size-3.5 text-ok" />
                            <span className="mb-swap">Exported</span>
                        </>
                    ) : (
                        <>
                            <Download className="h-4 w-4" />
                            Export
                        </>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {OPTIONS.map(({ format, label, description, icon: Icon }) => (
                    <DropdownMenuItem key={format} onSelect={() => run(format, label)} className="gap-3 py-2">
                        <Icon className="h-4 w-4 text-ink-faint" />
                        <span className="flex-1">{label}</span>
                        <span className="font-mono text-[11.5px] text-ink-faint">{description}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
