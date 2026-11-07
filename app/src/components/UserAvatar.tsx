import { colorForUser } from "@/lib/user-color"
import { cn } from "@/lib/utils"

/** A person's initial set as an italic variable, the way a proof names its objects. */
export function variableInitial(name: string): string {
  const first = name.trim()[0]
  return first ? first.toLowerCase() : "?"
}

export function UserAvatar({
  userId,
  name,
  className,
}: {
  userId: number
  name: string
  className?: string
}) {
  const { color } = colorForUser(userId)
  return (
    <div
      aria-label={name}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full pr-px font-var text-[13px] leading-none text-white italic transition-transform duration-200 hover:-translate-y-0.5",
        className
      )}
      style={{ backgroundColor: color }}
    >
      {variableInitial(name)}
    </div>
  )
}
