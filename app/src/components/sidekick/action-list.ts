import { ArrowRight, PenLine, Sparkles, Wrench } from "lucide-react"
import type { ActionName } from "@/lib/sidekick-actions"

/** The four things the sidekick does to a selection or a block. The floating toolbar and the top-bar menu list the same ones. */
export const SIDEKICK_ACTIONS: {
    name: ActionName
    label: string
    icon: typeof Sparkles
    /** A few words saying what it will do: the toolbar's tooltip and the menu's second line. */
    hint: string
    /** True if it can end up changing the document (so it is off in a view-only document). */
    edits: boolean
}[] = [
    { name: "explain", label: "Explain", icon: Sparkles, hint: "What this equation says, in a card below", edits: false },
    { name: "fix", label: "Fix", icon: Wrench, hint: "Find what's wrong, preview a fix", edits: true },
    { name: "next", label: "Next step", icon: ArrowRight, hint: "Suggest the next line of the work", edits: true },
    { name: "rewrite", label: "Rewrite", icon: PenLine, hint: "Turn the selection into LaTeX", edits: true },
]
