"use client"

import { MotionConfig } from "framer-motion"
import { useEffect } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"

/** App-wide interface behaviour: tooltips, reduced-motion for framer, and the press ripple on buttons. */
export function UiEffects({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    function onPointerDown(e: PointerEvent) {
      if (reduced.matches) return
      const button = (e.target as Element | null)?.closest?.('[data-slot="button"]') as HTMLElement | null
      if (!button || button.matches(":disabled")) return
      const rect = button.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height) * 2.2
      const ripple = document.createElement("span")
      ripple.className = "mb-ripple"
      ripple.style.width = ripple.style.height = `${size}px`
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`
      if (getComputedStyle(button).position === "static") button.style.position = "relative"
      button.style.overflow = "hidden"
      button.appendChild(ripple)
      window.setTimeout(() => ripple.remove(), 650)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>{children}</TooltipProvider>
    </MotionConfig>
  )
}
