"use client"

import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { UnitSpinner } from "@/components/ui/spinner"
import { createAccountHandler, signinHandler } from "./handlers"
import { setAuthToken } from "@/lib/auth-token"
import { useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import { AtSign, Lock, Mail, User } from "lucide-react"
import { AuthCardShell, AuthField, AuthFormError, AuthHeading, authLinkClass, shake } from "./AuthLayout"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

const submitClass = "mt-2 h-[42px] w-full text-sm"

export const CreateAccount = ({
    handleRedirect,
}: {
    handleRedirect: () => void
    setMode: (arg0: Mode) => void
}) => {
    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [touched, setTouched] = useState({ username: false, email: false, password: false })

    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const usernameRef = useRef<HTMLInputElement>(null)
    const emailRef = useRef<HTMLInputElement>(null)
    const passwordRef = useRef<HTMLInputElement>(null)

    const emailValid = email === "" || EMAIL_PATTERN.test(email)
    const passwordValid = password === "" || password.length >= MIN_PASSWORD_LENGTH
    const canSubmit = username.trim() !== "" && EMAIL_PATTERN.test(email) && password.length >= MIN_PASSWORD_LENGTH

    const markTouched = (field: keyof typeof touched) => setTouched((prev) => ({ ...prev, [field]: true }))

    async function handleSignUp() {
        setTouched({ username: true, email: true, password: true })
        if (!canSubmit) {
            shake(username.trim() === "" ? usernameRef.current : !EMAIL_PATTERN.test(email) ? emailRef.current : passwordRef.current)
            return
        }

        setLoading(true)

        const result = await createAccountHandler({
            username,
            email,
            password,
        })

        setLoading(false)

        if (!result.ok) {
            setError(result.error)
            return
        }

        setAuthToken(result.token)
        handleRedirect()
    }

    return (
        <div className="space-y-4">
            <AuthHeading title="Create account for Mathboard" subtitle="Pick up where your last proof left off" />

            <AuthField
                ref={usernameRef}
                id="signup-username"
                label="Username"
                icon={User}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => markTouched("username")}
                aria-invalid={touched.username && username.trim() === ""}
                error={touched.username && username.trim() === "" ? "Username is required." : undefined}
            />

            <AuthField
                ref={emailRef}
                id="signup-email"
                label="Email"
                icon={Mail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => markTouched("email")}
                placeholder="you@example.com"
                aria-invalid={touched.email && !emailValid}
                error={touched.email && !emailValid ? "Enter a valid email address." : undefined}
            />

            <AuthField
                ref={passwordRef}
                id="signup-password"
                label="Password"
                icon={Lock}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => markTouched("password")}
                placeholder="••••••••"
                aria-invalid={touched.password && !passwordValid}
                error={touched.password && !passwordValid ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
            />

            {error && <AuthFormError>{error}</AuthFormError>}

            <Button className={submitClass} onClick={handleSignUp} disabled={loading} aria-busy={loading}>
                {loading ? <><UnitSpinner /><span className="mb-swap">Creating account…</span></> : "Create Account"}
            </Button>
        </div>
    );
}

export const Signin = ({
    handleRedirect,
}: {
    handleRedirect: () => void
    setMode: (arg0: Mode) => void
}) => {
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const passwordRef = useRef<HTMLInputElement>(null)

    async function handleSignin() {
        setLoading(true)

        const result = await signinHandler({
            username,
            password,
        })

        setLoading(false)

        if (!result.ok) {
            setError(result.error || "Incorrect credentials")
            shake(passwordRef.current)
            return
        }

        setAuthToken(result.token)
        handleRedirect()
    }

    return (
        <div className="space-y-4">
            <AuthHeading title="Sign in to Mathboard" subtitle="Pick up where your last proof left off" />

            <AuthField
                id="signin-username"
                label="Username/email"
                icon={AtSign}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
            />

            <AuthField
                ref={passwordRef}
                id="signin-password"
                label="Password"
                icon={Lock}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                aside={
                    <Link href="/forgot-password" className={`text-xs ${authLinkClass}`}>
                        Forgot password?
                    </Link>
                }
            />

            {error && <AuthFormError>{error}</AuthFormError>}

            <Button className={submitClass} onClick={handleSignin} disabled={loading} aria-busy={loading}>
                {loading ? <><UnitSpinner /><span className="mb-swap">Signing in…</span></> : "Sign in"}
            </Button>
        </div>
    );
}

type Mode = "signin" | "signup"

const MODES: { value: Mode; label: string }[] = [
    { value: "signin", label: "Sign in" },
    { value: "signup", label: "Create account" },
]

export const AuthCard = ({
    handleRedirect,
    paramMode = "signup"
}: {
    handleRedirect: () => void
    paramMode?: Mode
}) => {
    const [mode, setMode] = useState<Mode>(paramMode)
    // Slide toward the side of the tab that was chosen.
    const direction = mode === "signup" ? 1 : -1

    return (
        <AuthCardShell
            top={<Segmented as="tabs" label="Account" value={mode} onChange={setMode} options={MODES} />}
            footer={
                mode === "signin" ? (
                    <>No account? <button type="button" className={authLinkClass} onClick={() => setMode("signup")}>Create one</button></>
                ) : (
                    <>Already have an account? <button type="button" className={authLinkClass} onClick={() => setMode("signin")}>Sign in</button></>
                )
            }
        >
            <motion.div layout transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }} className="relative">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                    <motion.div
                        key={mode}
                        custom={direction}
                        initial={{ opacity: 0, x: 24 * direction }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 * direction }}
                        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                    >
                        {mode === "signup"
                            ? <CreateAccount handleRedirect={handleRedirect} setMode={setMode} />
                            : <Signin handleRedirect={handleRedirect} setMode={setMode} />}
                    </motion.div>
                </AnimatePresence>
            </motion.div>
        </AuthCardShell>
    )
}
