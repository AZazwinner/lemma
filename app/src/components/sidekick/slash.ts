import { Sparkles } from "lucide-react"
import type { SlashCommand } from "@/app/docs/d/[id]/slash-commands"

// Registered in slash-commands.ts. Picking it starts an "@sidekick ..." line; Ctrl/Cmd+Enter runs it.
export const SIDEKICK_SLASH_COMMANDS: SlashCommand[] = [
    {
        id: "sidekick",
        label: "Sidekick",
        description: "Describe an equation, press Ctrl+Enter",
        icon: Sparkles,
        template: "@sidekick ",
        cursorOffset: 10,
    },
]
