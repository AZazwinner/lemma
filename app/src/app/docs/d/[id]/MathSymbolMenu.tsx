"use client"

import { MATH_SYMBOLS, type MathSymbol } from "./math-symbols"


const MAX_RESULTS = 8

export function filterMathSymbols(query: string): MathSymbol[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const matches = MATH_SYMBOLS.filter(
        (s) =>
            s.trigger.toLowerCase().startsWith(q) ||
            (s.aliases ?? []).some((a) => a.toLowerCase().startsWith(q))
    )
    return matches.slice(0, MAX_RESULTS)
}

export function MathSymbolMenu({
    left,
    top,
    items,
    activeIndex,
    onHover,
    onSelect,
}: {
    left: number
    top: number
    items: MathSymbol[]
    activeIndex: number
    onHover: (index: number) => void
    onSelect: (symbol: MathSymbol) => void
}) {
    return (
        <div
            style={{ left, top }}
            className="fixed z-50 mt-1 w-56 overflow-hidden rounded-xl border border-hairline bg-popover p-1 text-popover-foreground shadow-[var(--shadow-sheet)] animate-in fade-in-0 zoom-in-95 duration-150"

            onMouseDown={(e) => e.preventDefault()}
        >
            {items.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No matching symbols</div>
            ) : (
                items.map((item, i) => (
                    <button
                        key={item.trigger}
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onSelect(item)}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                            i === activeIndex ? "bg-tint text-ink" : ""
                        }`}
                    >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted font-serif text-[0.9375rem] leading-none">
                            {item.glyph}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="font-medium leading-tight">{item.trigger}</span>
                            <span className="truncate text-xs leading-tight text-muted-foreground">
                                {item.latex}
                            </span>
                        </span>
                    </button>
                ))
            )}
        </div>
    )
}
