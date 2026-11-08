import { Sparkles } from "lucide-react"
import type { SlashCommand } from "@/app/docs/d/[id]/slash-commands"

// Registered in slash-commands.ts. Picking it starts an "@sidekick ..." line; Ctrl/Cmd+Enter runs it, through the same code
// as the "Write from description" field. `/ai` finds it too.
export const SIDEKICK_SLASH_COMMANDS: SlashCommand[] = [
    {
        id: "sidekick",
        label: "Sidekick",
        aliases: ["ai"],
        description: "Describe what to write, press Ctrl+Enter",
        icon: Sparkles,
        template: "@sidekick ",
        cursorOffset: 10,
    },
]
