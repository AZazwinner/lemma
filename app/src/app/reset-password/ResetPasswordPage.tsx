"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DrawnCheck, UnitSpinner } from "@/components/ui/spinner"
import { AuthCardShell, AuthField, AuthFormError, AuthHeading, AuthLayout, authLinkClass } from "../signin/AuthLayout"
import { resetPassword } from "@/api/signin"

const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordPage() {
    const router = useRouter()
    const params = useSearchParams()
    const token = params?.get("token") ?? ""

    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    const passwordValid = password.length >= MIN_PASSWORD_LENGTH
    const matches = password === confirm
    const canSubmit = Boolean(token) && passwordValid && matches

    async function handleSubmit() {
        if (!canSubmit) return
        setLoading(true)
        setError(null)

        try {
            const res = await resetPassword(token, password)
            if (!res.success) {
                setError("This reset link is invalid or has expired - request a new one.")
                return
            }
            setDone(true)
            setTimeout(() => router.push("/signin?mode=signin"), 1500)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong - please try again")
        } finally {
            setLoading(false)
        }
    }

    if (!token) {
        return (
            <AuthLayout>
                <AuthCardShell>
                    <AuthHeading title="Invalid reset link" subtitle="This link is missing its reset token." />
                    <Link href="/forgot-password" className={`text-sm ${authLinkClass}`}>
                        Request a new reset link
                    </Link>
                </AuthCardShell>
            </AuthLayout>
        )
    }

    return (
        <AuthLayout>
            <AuthCardShell>
                <AuthHeading title="Set a new password" />

                {done ? (
                    <div className="mb-swap flex items-center gap-2 rounded-lg border border-hairline bg-muted p-4 text-sm text-ink-soft">
                        <DrawnCheck className="text-ok" />
                        Password updated - redirecting to sign in…
                    </div>
                ) : (
                    <div className="space-y-4">
                        <AuthField
                            id="reset-password"
                            label="New password"
                            icon={Lock}
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            aria-invalid={password !== "" && !passwordValid}
                            error={password !== "" && !passwordValid ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
                        />

                        <AuthField
                            id="reset-confirm"
                            label="Confirm password"
                            icon={Lock}
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                            placeholder="••••••••"
                            aria-invalid={confirm !== "" && !matches}
                            error={confirm !== "" && !matches ? <>Passwords don&apos;t match.</> : undefined}
                        />

                        {error && <AuthFormError>{error}</AuthFormError>}

                        <Button className="mt-2 h-[42px] w-full text-sm" onClick={handleSubmit} disabled={loading || !canSubmit} aria-busy={loading}>
                            {loading ? <><UnitSpinner /><span className="mb-swap">Updating…</span></> : "Update password"}
                        </Button>
                    </div>
                )}
            </AuthCardShell>
        </AuthLayout>
    )
}
