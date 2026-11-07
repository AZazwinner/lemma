"use client"

import { Sparkles } from "lucide-react"
import { initialsForName } from "@/lib/user-color"

export type PresentUser = {
  clientId: number
  name: string
  color: string
  /** "ai" for the Sidekick, which shows a sparkle instead of initials. */
  kind?: string
}


export function PresenceStack({ users }: { users: PresentUser[] }) {
  if (users.length === 0) return null

  const shown = users.slice(0, 4)
  const overflow = users.length - shown.length

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u) => (
        <div
          key={u.clientId}
          title={u.name}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-medium text-white dark:border-neutral-950"
          style={{ backgroundColor: u.color }}
        >
          {u.kind === "ai" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : initialsForName(u.name)}
        </div>
      ))}
      {overflow > 0 && (
        <div
          title={`+${overflow} more`}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-neutral-200 text-[11px] font-medium text-neutral-600 dark:border-neutral-950 dark:bg-neutral-700 dark:text-neutral-300"
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
