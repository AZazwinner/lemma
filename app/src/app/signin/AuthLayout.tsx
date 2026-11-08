"use client"

import { Logo } from "@/components/Logo"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { CircleAlert, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { forwardRef } from "react"
import { TypesetDemo } from "./TypesetDemo"

function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex w-fit items-center gap-2 text-sm font-medium", className)}>
      <Logo className="h-4 w-4" />
      lemma
    </Link>
  )
}

/** Sign-in, sign-up and password screens: the typing demo on quadrille paper, the form on a sheet. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="auth-grid relative hidden w-[55%] flex-col justify-between gap-10 p-10 lg:flex xl:p-12">
        <Brand />
        <TypesetDemo />
        <p className="max-w-sm text-sm text-ink-soft">Write LaTeX, see it typeset, and edit together in real time.</p>
      </div>

      <div className="flex flex-1 flex-col border-hairline px-4 py-8 sm:px-10 lg:border-l">
        <Brand className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center py-10">{children}</div>
      </div>
    </div>
  )
}

/** The card every account screen sits in. `top` sits beside the logo in the header row; `footer` under the form. */
export function AuthCardShell({
  top,
  footer,
  children,
}: {
  top?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="w-full max-w-[25rem]">
      <div className="overflow-hidden rounded-[14px] border border-hairline bg-sheet shadow-[var(--shadow-sheet)] transition-shadow duration-300 focus-within:shadow-[0_0_0_4px_var(--wash),var(--shadow-sheet)]">
        <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-hairline-soft bg-[color-mix(in_srgb,var(--tint)_45%,var(--sheet))] px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Logo className="h-4 w-4" />
            lemma
          </span>
          {top}
        </div>
        <div className="px-7 py-6">{children}</div>
        {footer && (
          <div className="flex justify-center gap-1.5 border-t border-hairline-soft bg-[color-mix(in_srgb,var(--muted)_60%,var(--sheet))] px-5 py-3.5 text-[13px] text-ink-soft">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-heading text-[34px] leading-[1.05] tracking-[-0.01em] text-heading">{title}</h1>
      {subtitle && <p className="mt-2 text-[14.5px] text-ink-soft">{subtitle}</p>}
    </div>
  )
}

type AuthFieldProps = React.ComponentProps<"input"> & {
  id: string
  label: string
  icon: LucideIcon
  error?: React.ReactNode
  aside?: React.ReactNode
}

/** Label, leading icon, input with a focus line that draws from the middle, and an inline error. */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { id, label, icon: Icon, error, aside, className, ...input },
  ref
) {
  return (
    <div className="group/field space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[13px] text-ink-soft transition-colors group-focus-within/field:text-ink">
          {label}
        </Label>
        {aside}
      </div>
      <div className="mb-field">
        <Icon className="size-4" aria-hidden />
        <Input
          ref={ref}
          id={id}
          className={cn("h-[42px] rounded-lg pl-9 text-[14.5px] md:text-[14.5px]", className)}
          {...input}
        />
      </div>
      {error && <AuthFieldError>{error}</AuthFieldError>}
    </div>
  )
})

export function AuthFieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-swap flex items-center gap-1.5 text-[12.5px] text-destructive">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

export function AuthFormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-swap rounded-r-md border-l-2 border-destructive bg-[var(--pencil-wash)] py-1.5 pl-2.5 text-[13.5px] text-destructive">
      {children}
    </p>
  )
}

/** Underlined text link used inside account screens. */
export const authLinkClass =
  "font-medium text-ink underline decoration-hairline underline-offset-[3px] transition-colors hover:decoration-current"

/** Shake an input once after a failed submit. */
export function shake(el: HTMLElement | null) {
  if (!el) return
  el.classList.remove("mb-shake")
  void el.offsetWidth
  el.classList.add("mb-shake")
}
