import { cn } from "@/lib/utils"

/** Loading mark: a radius sweeping the unit circle. */
export function UnitSpinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("mb-unit size-4 shrink-0 overflow-visible", className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.2} />
      <g className="mb-unit-r">
        <line x1="8" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <circle cx="14.5" cy="8" r="1.4" fill="currentColor" />
      </g>
    </svg>
  )
}

/** Confirmation mark that draws itself once when it appears. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("mb-check size-4 shrink-0", className)}>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The empty set, for empty states. The slash draws in. */
export function EmptySet({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("mb-empty-set size-8 text-ink-soft", className)}>
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="7" y1="27" x2="25" y2="5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
}
