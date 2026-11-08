"use client"

import { useSyncExternalStore } from "react"
import { getServerState, getState, subscribe, type BlockSlots, type SidekickState } from "@/lib/sidekick"

export const useSidekick = (): SidekickState => useSyncExternalStore(subscribe, getState, getServerState)

const noSlots = () => undefined

/** What the sidekick shows for one block. The same object until that block's results change, so other blocks don't re-render. */
export const useBlockSlots = (blockId: string): BlockSlots | undefined =>
    useSyncExternalStore(subscribe, () => getState().blocks[blockId], noSlots)
