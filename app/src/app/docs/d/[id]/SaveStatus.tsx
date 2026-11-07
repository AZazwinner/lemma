"use client"

import { WifiOff } from "lucide-react"
import type { ConnectionStatus } from "./yjs/provider"
import { DrawnCheck, UnitSpinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const COPY: Record<ConnectionStatus, string> = {
  connected: "Saved",
  connecting: "Connecting…",
  disconnected: "Offline. Will sync when reconnected",
}


export function SaveStatus({ status }: { status: ConnectionStatus }) {
  return (
    <div
      role="status"
      key={status}
      className={cn(
        "mb-swap flex items-center gap-1.5 text-xs whitespace-nowrap",
        status === "disconnected" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {status === "connected" && <DrawnCheck className="size-3.5 text-ok" />}
      {status === "connecting" && <UnitSpinner className="size-3.5" />}
      {status === "disconnected" && <WifiOff className="size-3.5" aria-hidden />}
      {COPY[status]}
    </div>
  )
}
