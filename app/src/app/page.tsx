"use client"

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react"
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useReducedMotion,
  type Variants,
} from "framer-motion"
import { Button } from "@/components/ui/button"
import { RotateCcw, Link2, Check, Menu, X } from "lucide-react"
import { Logo } from "@/components/Logo"
import Link from "next/link"
import LatexRenderer from "@/components/LatexRenderer"

const DEMO_LINE_A = String.raw`## Cauchy–Schwarz

For vectors $u, v \in \mathbb{R}^n$:

`

const DEMO_LINE_B = String.raw`$$\left(\sum_i u_i v_i\right)^2 \;\leq\; \left(\sum_i u_i^2\right)\left(\sum_i v_i^2\right)$$

with equality iff $u$ and $v$ are linearly dependent.`

const DEMO_SOURCE = DEMO_LINE_A + DEMO_LINE_B

const AUTHOR_A = { name: "Ada", color: "#5B6EBA" }
const AUTHOR_B = { name: "Gauss", color: "#BA7A4F" }

const HEADLINE_WORDS = ["document", "proof", "paper", "problem set"]

const FEATURES = [
  {
    title: "Renders as you type",
    description: "Every block compiles the moment you finish typing it, right in the document.",
    Visual: RenderToggleIcon,
  },
  {
    title: "Real-time collaboration",
    description: "Edit the same proof together and see collaborators' cursors as they write.",
    Visual: CollabCursorsIcon,
  },
  {
    title: "Share with a link",
    description: "Send a link and the other person can read or edit the document right away.",
    Visual: ShareLinkIcon,
  },
]

const NAV_LINKS = [
  { key: "features", label: "Features", href: "#features" },
  { key: "docs", label: "Docs", href: "/docs" },
]

const ACCENT = "#F1F1EF"


const VIEWPORT_ONCE = { once: true, margin: "-80px" } as const
const VIEWPORT_ONCE_TIGHT = { once: true, margin: "-40px" } as const


const GRID_BACKGROUND: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.035) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 260, damping: 20, mass: 0.9 },
  },
}

const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
}

const cardReveal: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 220, damping: 24 },
  },
}

function Reveal({
  children,
  className,
  variants = fadeUp,
}: {
  children: React.ReactNode
  className?: string
  variants?: Variants
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT_ONCE}
      variants={variants}
    >
      {children}
    </motion.div>
  )
}

function AnimatedButton({ children }: { children: React.ReactNode }) {
  return (
    <motion.span
      className="inline-block"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      {children}
    </motion.span>
  )
}

function WordRotator({ words, interval = 3000 }: { words: string[]; interval?: number }) {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [striking, setStriking] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    const t = setTimeout(() => setStriking(true), interval)
    return () => clearTimeout(t)
  }, [index, interval, reduceMotion])

  useEffect(() => {
    if (!striking) return
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % words.length)
      setStriking(false)
    }, 380)
    return () => clearTimeout(t)
  }, [striking, words.length])

  if (reduceMotion) {
    return (
      <span className="underline decoration-dotted decoration-hairline underline-offset-4">
        {words[0]}
      </span>
    )
  }

  return (
    <span className="relative inline-block">
      <motion.span
        key={index}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative inline-block underline decoration-dotted decoration-hairline underline-offset-4"
      >
        {words[index]}
        {striking && (
          <motion.span
            className="absolute left-0 top-[0.72em] h-[0.125rem] bg-red-400/70"
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          />
        )}
      </motion.span>
    </span>
  )
}

function PresenceDot() {
  const reduceMotion = useReducedMotion()
  return (
    <span className="relative mr-1.5 inline-flex h-1.5 w-1.5 shrink-0">
      {!reduceMotion && (
        <motion.span
          className="absolute inline-flex h-full w-full rounded-full bg-ink-faint"
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.8, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ink-faint" />
    </span>
  )
}

function DrawUnderline({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      {children}
      <motion.svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -bottom-1 left-0 h-2 w-full text-ink-faint/50"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_ONCE_TIGHT}
      >
        <motion.path
          d="M1,4 Q50,7 99,3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            visible: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.6, ease: "easeInOut", delay: 0.3 },
            },
          }}
        />
      </motion.svg>
    </span>
  )
}

function RenderToggleIcon() {
  const reduceMotion = useReducedMotion()
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    const id = setInterval(() => setRendered((r) => !r), 2000)
    return () => clearInterval(id)
  }, [reduceMotion])

  return (
    <div className="relative inline-flex h-8 w-8 items-center justify-center rounded-[0.375rem] border border-hairline bg-sheet">
      <AnimatePresence mode="wait">
        {rendered ? (
          <motion.span
            key="rendered"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="font-serif text-[0.9375rem] italic text-ink"
          >
            ∑x²
          </motion.span>
        ) : (
          <motion.span
            key="source"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-[0.5625rem] text-ink-faint"
          >
            \sum x^2
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

function CollabCursorsIcon() {
  const reduceMotion = useReducedMotion()
  return (
    <div className="relative h-8 w-8 overflow-hidden rounded-[0.375rem] border border-hairline bg-sheet">
      {!reduceMotion ? (
        <>
          <motion.span
            className="absolute top-2 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: AUTHOR_A.color }}
            animate={{ x: [4, 20, 4] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            className="absolute bottom-2 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: AUTHOR_B.color }}
            animate={{ x: [20, 4, 20] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      ) : (
        <>
          <span
            className="absolute top-2 left-2 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: AUTHOR_A.color }}
          />
          <span
            className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: AUTHOR_B.color }}
          />
        </>
      )}
    </div>
  )
}

function ShareLinkIcon() {
  const reduceMotion = useReducedMotion()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    const id = setInterval(() => setCopied((c) => !c), 2400)
    return () => clearInterval(id)
  }, [reduceMotion])

  return (
    <div className="relative inline-flex h-8 w-8 items-center justify-center rounded-[0.375rem] border border-hairline bg-sheet">
      <AnimatePresence mode="wait">
        {copied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
          >
            <Check className="h-4 w-4 text-ink" />
          </motion.span>
        ) : (
          <motion.span
            key="link"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
          >
            <Link2 className="h-4 w-4 text-ink" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

function AuthorLane({
  author,
  full,
  typed,
  done,
}: {
  author: { name: string; color: string }
  full: string
  typed: string
  done: boolean
}) {
  return (
    <div className="p-5">
      <div
        className="mb-3 inline-flex items-center gap-1.5 rounded-[0.25rem] px-2 py-0.5 text-[0.625rem] font-medium text-white"
        style={{ backgroundColor: author.color }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
        {author.name}
      </div>

      <pre className="scrollbar-custom overflow-x-auto font-mono text-[0.7812rem] leading-relaxed whitespace-pre-wrap break-words text-ink-faint">
        {typed}
        {!done && (
          <motion.span
            className="ml-[0.0625rem] inline-block h-[1em] w-[0.125rem] translate-y-[0.125rem]"
            style={{ backgroundColor: author.color }}
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
          />
        )}
        <span className="invisible">{full.slice(typed.length)}</span>
      </pre>
    </div>
  )
}


function useTypewriter(text: string, playToken: number) {
  const reduceMotion = useReducedMotion()
  const [animatedLength, setAnimatedLength] = useState(0)
  // With reduced motion the whole text shows at once, so there is nothing to animate.
  const typedLength = reduceMotion && playToken !== 0 ? text.length : animatedLength

  useEffect(() => {
    if (playToken === 0 || reduceMotion) return

    let raf = 0
    let last = performance.now()
    let acc = 0
    let count = 0
    const CHARS_PER_SECOND = 150

    const tick = (now: number) => {
      acc += ((now - last) / 1000) * CHARS_PER_SECOND
      last = now
      const whole = Math.floor(acc)
      if (whole > 0) {
        acc -= whole
        count = Math.min(text.length, count + whole)
        setAnimatedLength(count)
      }
      if (count < text.length) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setAnimatedLength(0)
    }
  }, [text, playToken, reduceMotion])

  return { typed: text.slice(0, typedLength), done: typedLength >= text.length }
}

type DemoHandle = { replay: () => void }


const CollabDemoCard = forwardRef<DemoHandle>(function CollabDemoCard(_props, ref) {
  const [playToken, setPlayToken] = useState(0)
  const [showRender, setShowRender] = useState(false)
  const a = useTypewriter(DEMO_LINE_A, playToken)
  const b = useTypewriter(DEMO_LINE_B, playToken)
  const bothDone = a.done && b.done

  useEffect(() => {
    if (!bothDone) return
    const t = setTimeout(() => setShowRender(true), 300)
    return () => {
      clearTimeout(t)
      setShowRender(false)
    }
  }, [bothDone])

  const replay = () => {
    setShowRender(false)
    setPlayToken((t) => t + 1)
  }

  useImperativeHandle(ref, () => ({ replay }))


  const hasAutoPlayed = useRef(false)

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT_ONCE}
      variants={cardReveal}
      onViewportEnter={() => {
        if (hasAutoPlayed.current) return
        hasAutoPlayed.current = true
        setPlayToken((t) => t + 1)
      }}
      className="group relative overflow-hidden rounded-[0.375rem] border border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <div className="flex items-center gap-1.5 border-b border-hairline bg-[#FAFAF9] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/40" />
        <span className="ml-3 text-xs text-ink-faint">cauchy-schwarz.tex</span>
        <button
          type="button"
          onClick={replay}
          aria-label="Replay animation"
          className="ml-auto rounded-[0.25rem] p-1 text-ink-faint opacity-0 transition-opacity duration-200 hover:bg-tint hover:text-ink-soft group-hover:opacity-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid divide-y divide-hairline sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <AuthorLane author={AUTHOR_A} full={DEMO_LINE_A} typed={a.typed} done={a.done} />
        <AuthorLane author={AUTHOR_B} full={DEMO_LINE_B} typed={b.typed} done={b.done} />
      </div>

      <div className="min-h-[10.5rem] border-t border-hairline">
        <AnimatePresence mode="wait">
          {showRender && (
            <motion.div
              key={playToken}
              initial={{ opacity: 0, scale: 0.94, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="p-6"
            >
              <LatexRenderer content={DEMO_SOURCE} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
})

export default function HomePage() {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const demoRef = useRef<DemoHandle>(null)
  const demoSectionRef = useRef<HTMLDivElement>(null)

  const handleViewDemo = () => {
    demoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    demoRef.current?.replay()
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-sheet text-ink" style={GRID_BACKGROUND}>

        <header className="border-b border-hairline">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2 text-[0.9375rem] font-medium">
              <Logo className="h-4 w-4" />
              mathboard
            </div>

            <nav className="hidden items-center gap-1 text-sm text-ink-faint sm:flex">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  className="relative z-0 rounded-[0.375rem] px-3 py-1.5 hover:text-ink"
                  onMouseEnter={() => setHoveredLink(link.key)}
                  onMouseLeave={() => setHoveredLink(null)}
                  onFocus={() => setHoveredLink(link.key)}
                  onBlur={() => setHoveredLink(null)}
                >
                  {hoveredLink === link.key && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-[0.375rem]"
                      style={{ backgroundColor: ACCENT }}
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                  <span className="relative">{link.label}</span>
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-4">
              <Link href="/signin?mode=signin" className="text-sm text-ink-faint hover:text-ink">
                Sign in
              </Link>
              <AnimatedButton>
                <Link href="/signin">
                  <Button size="sm" className="rounded-[0.375rem] bg-primary text-primary-foreground hover:bg-primary/90">
                    Get started
                  </Button>
                </Link>
              </AnimatedButton>
              <button
                type="button"
                onClick={() => setMobileNavOpen((open) => !open)}
                aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileNavOpen}
                className="rounded-[0.375rem] p-1.5 text-ink-faint hover:bg-[#FAFAF9] hover:text-ink sm:hidden"
              >
                {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {mobileNavOpen && (
              <motion.nav
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden border-t border-hairline sm:hidden"
              >
                <div className="flex flex-col px-6 py-2">
                  {NAV_LINKS.map((link) => (
                    <a
                      key={link.key}
                      href={link.href}
                      onClick={() => setMobileNavOpen(false)}
                      className="rounded-[0.375rem] px-2 py-2.5 text-sm text-ink-soft hover:bg-[#FAFAF9] hover:text-ink"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        </header>


        <motion.section
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="mx-auto max-w-4xl px-6 pt-24 pb-14 text-center"
        >
          <motion.p
            variants={fadeUp}
            className="inline-flex items-center rounded-[0.375rem] px-3 py-1 text-sm text-ink-soft"
            style={{ backgroundColor: ACCENT }}
          >
            <PresenceDot />
            Now in beta
          </motion.p>


          <div className="mt-5 flex min-h-[7.15rem] items-center justify-center sm:min-h-[9.9rem] lg:min-h-[4.95rem]">
            <motion.h1
              variants={fadeUp}
              className="font-heading text-[3.25rem] leading-[1.1] font-normal tracking-tight text-ink sm:text-7xl"
            >
              Write math like it&apos;s a <WordRotator words={HEADLINE_WORDS} />.
            </motion.h1>
          </div>

          <motion.p variants={fadeUp} className="mx-auto mt-6 max-w-xl text-lg text-ink-faint">
            Write LaTeX with someone else and watch it render as you type. Built
            for proofs, papers, and problem sets.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8 flex items-center justify-center gap-2">
            <AnimatedButton>
              <Link href="/signin">
                <Button size="lg" className="rounded-[0.375rem] bg-primary px-5 text-primary-foreground hover:bg-primary/90">
                  Get started
                </Button>
              </Link>
            </AnimatedButton>
            <AnimatedButton>
              <Button
                size="lg"
                variant="ghost"
                onClick={handleViewDemo}
                className="rounded-[0.375rem] text-ink-soft hover:text-ink"
              >
                View demo
              </Button>
            </AnimatedButton>
          </motion.div>
        </motion.section>


        <section ref={demoSectionRef} id="demo" className="mx-auto max-w-4xl px-6 pb-28">
          <CollabDemoCard ref={demoRef} />
        </section>


        <section id="features" className="border-t border-hairline">
          <div className="mx-auto max-w-5xl px-6 py-24">
            <Reveal>
              <h2 className="font-heading text-3xl font-normal text-ink">
                Focus on the math. Mathboard handles the rendering.
              </h2>
            </Reveal>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT_ONCE}
              variants={staggerContainer}
              className="mt-12 grid gap-6 sm:grid-cols-3"
            >
              {FEATURES.map((feature) => (
                <motion.div key={feature.title} variants={fadeUp} className="h-full">
                  <div className="h-full rounded-[0.375rem] border border-hairline p-6 transition-colors duration-300 hover:border-ink-faint/50 hover:bg-[#FAFAF9]">
                    <feature.Visual />
                    <h3 className="mt-4 font-medium text-ink">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-faint">
                      {feature.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>


        <section className="border-t border-hairline">
          <Reveal
            variants={staggerContainer}
            className="relative z-0 mx-auto max-w-3xl px-6 py-24 text-center"
          >
            <motion.div
              variants={{
                hidden: { scaleY: 0 },
                visible: {
                  scaleY: 1,
                  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
                },
              }}
              style={{ transformOrigin: "center", backgroundColor: ACCENT }}
              className="absolute inset-x-6 inset-y-6 -z-10 rounded-[0.375rem] sm:inset-x-12"
            />

            <motion.h2 variants={fadeUp} className="font-heading text-3xl font-normal text-ink">
              Start writing <DrawUnderline>mathematics</DrawUnderline> like a document.
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-3 text-ink-faint">
              Type LaTeX and watch it render instantly, without a separate compile step.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-8 inline-block">
              <AnimatedButton>
                <Link href="/docs">
                  <Button size="lg" className="rounded-[0.375rem] bg-primary px-6 text-primary-foreground hover:bg-primary/90">
                    Launch Mathboard
                  </Button>
                </Link>
              </AnimatedButton>
            </motion.div>
          </Reveal>
        </section>


        <footer className="border-t border-hairline">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 py-8 text-sm text-ink-faint sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} mathboard</span>
            <a
              href="https://github.com/AZazwinner/Mathboard"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ink"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}
