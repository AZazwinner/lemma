"use client"

import { motion } from "framer-motion"
import { useId } from "react"
import { cn } from "@/lib/utils"

type Option<T extends string> = { value: T; label: React.ReactNode }

/**
 * A small set of mutually exclusive options. The chosen one sits inside [ ] on a sheet that slides between options.
 * `as="tabs"` renders a tablist (for switching views); the default renders toggle buttons (for settings like sort).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  as = "buttons",
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  label: string
  as?: "buttons" | "tabs"
  className?: string
}) {
  const layoutId = useId()
  const tabs = as === "tabs"

  return (
    <div
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      className={cn(
        "relative inline-flex gap-0.5 rounded-[9px] border border-hairline-soft bg-muted p-[3px]",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? active : undefined}
            aria-pressed={tabs ? undefined : active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              active ? "text-foreground" : "text-ink-faint hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-md bg-sheet shadow-[0_1px_2px_rgba(20,30,50,0.1)]"
              >
                <span className="absolute top-1/2 left-1 -translate-y-[54%] font-serif text-[17px] leading-none text-ink-soft">[</span>
                <span className="absolute top-1/2 right-1 -translate-y-[54%] font-serif text-[17px] leading-none text-ink-soft">]</span>
              </motion.span>
            )}
            <span className="relative">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
