"use client"

/** The dashboard's starting point: a blank page. The "New document" button in the header does the same thing. */
export function NewDocumentCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="pt-1 pb-3">
      <button
        type="button"
        onClick={onCreate}
        className="group/card flex w-40 shrink-0 flex-col overflow-hidden rounded-[10px] border border-hairline bg-sheet text-left transition-[border-color,transform,box-shadow] duration-250 ease-[cubic-bezier(0.2,0.7,0.2,1)] outline-none hover:-translate-y-[3px] hover:border-ink-faint/50 hover:shadow-[0_10px_22px_-12px_rgba(20,24,30,0.35)] focus-visible:ring-2 focus-visible:ring-ring/40 active:translate-y-[-1px] active:scale-[0.99]"
      >
        {/* A miniature of the page it starts you on. Decorative: the card's name comes from its label. */}
        <div
          aria-hidden
          className="relative h-[88px] overflow-hidden border-b border-hairline-soft bg-page py-3 pr-3 pl-[22px] font-serif text-[11.5px] leading-[1.45] text-ink-soft before:absolute before:inset-y-0 before:left-3 before:border-l before:border-[var(--rule)]"
        >
          <div className="transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover/card:-translate-y-[3px]">
            <span className="auth-caret h-3" />
          </div>
        </div>
        <div className="px-3 pt-2 pb-2.5">
          <div className="truncate text-[12.5px] font-medium text-ink">Blank Document</div>
          <div className="truncate text-xs text-ink-faint">Start from scratch</div>
        </div>
      </button>
    </div>
  )
}
