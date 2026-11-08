"use client"

import { Sparkles } from "lucide-react"
import { Tip } from "@/components/ui/tooltip"
import { variableInitial } from "@/components/UserAvatar"
import { cn } from "@/lib/utils"

export type PresentUser = {
  clientId: number
  name: string
  color: string
  /** "ai" for the Sidekick, which shows a sparkle instead of initials. */
  kind?: string
}


/** Who's here. The stack fans out on hover, and each avatar names its person. */
export function PresenceStack({ users }: { users: PresentUser[] }) {
  if (users.length === 0) return null

  const shown = users.slice(0, 4)
  const overflow = users.length - shown.length
  const avatar =
    "flex h-7 w-7 items-center justify-center rounded-full border-2 border-sheet leading-none transition-[margin,transform] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:z-10 hover:-translate-y-0.5 [&:not(:first-child)]:-ml-2 group-hover/stack:[&:not(:first-child)]:ml-0.5"

  return (
    <div className="group/stack flex items-center" aria-label={`${users.length} people here`}>
      {shown.map((u) => (
        <Tip key={u.clientId} label={u.name}>
          <div
            tabIndex={0}
            aria-label={u.name}
            className={cn(
              avatar,
              "text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              u.kind !== "ai" && "pr-px font-var text-[0.875rem] italic"
            )}
            style={{ backgroundColor: u.color }}
          >
            {u.kind === "ai" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : variableInitial(u.name)}
          </div>
        </Tip>
      ))}
      {overflow > 0 && (
        <Tip label={users.slice(4).map((u) => u.name).join(", ")}>
          <div
            tabIndex={0}
            aria-label={`${overflow} more`}
            className={`${avatar} bg-tint font-serif text-[0.6875rem] text-ink-soft outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          >
            +{overflow}
          </div>
        </Tip>
      )}
    </div>
  )
}
