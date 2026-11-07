"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"


// The theme lives in a class on <html>, so read it from there. The server snapshot is "light",
// which matches what the first client render used before this was an external-store read.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

const getIsDark = () => document.documentElement.classList.contains("dark")
const getIsDarkOnServer = () => false

const ICON = "absolute h-4 w-4 transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(0.34,1.4,0.64,1)]"

export function ThemeToggle({ className }: { className?: string }) {
  const isDark = useSyncExternalStore(subscribe, getIsDark, getIsDarkOnServer)

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark")
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  const label = isDark ? "Switch to light theme" : "Switch to dark theme"

  // Sun and moon trade places with a quarter turn.
  return (
    <Tip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={toggle}
        className={cn("relative text-muted-foreground", className)}
      >
        <Moon className={cn(ICON, isDark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100")} />
        <Sun className={cn(ICON, isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
      </Button>
    </Tip>
  )
}
