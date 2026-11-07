import type { ComponentType } from "react"
import { Code, FunctionSquare, Heading, Sigma, Table, Text } from "lucide-react"
import { SIDEKICK_SLASH_COMMANDS } from "@/components/sidekick/slash"

export type SlashCommand = {
    id: string
    label: string
    description: string
    icon: ComponentType<{ className?: string }>
    template: string
    cursorOffset: number
}


export const SLASH_COMMANDS: SlashCommand[] = [
    {
        id: "paragraph",
        label: "Text",
        description: "Plain paragraph",
        icon: Text,
        template: "",
        cursorOffset: 0,
    },
    {
        id: "heading",
        label: "Heading",
        description: "Section heading",
        icon: Heading,
        template: "# ",
        cursorOffset: 2,
    },
    {
        id: "equation",
        label: "Equation",
        description: "Block math, $$ ... $$",
        icon: FunctionSquare,
        template: "$$\n\n$$",
        cursorOffset: 3,
    },
    {
        id: "inline-math",
        label: "Inline math",
        description: "A $ ... $ span",
        icon: Sigma,
        template: "$$",
        cursorOffset: 1,
    },
    {
        id: "code",
        label: "Code block",
        description: "Fenced code block",
        icon: Code,
        template: "```\n\n```",
        cursorOffset: 4,
    },
    {
        id: "table",
        label: "Table",
        description: "3-column markdown table",
        icon: Table,
        template: "| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |",
        cursorOffset: 2,
    },
    ...SIDEKICK_SLASH_COMMANDS,
]
