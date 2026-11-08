"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { UnitSpinner } from "@/components/ui/spinner"
import { AuthCardShell, AuthField, AuthFormError, AuthHeading, AuthLayout, authLinkClass } from "../signin/AuthLayout"
import { forgotPassword } from "@/api/signin"

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [devResetLink, setDevResetLink] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState(false)

    async function handleSubmit() {
        if (!email.trim()) return
        setLoading(true)
        setError(null)

        try {
            const res = await forgotPassword(email.trim())
            setSubmitted(true)
            setDevResetLink(res.dev_reset_link ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong - please try again")
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthLayout>
            <AuthCardShell
                footer={
                    <Link href="/signin?mode=signin" className={authLinkClass}>
                        Back to sign in
                    </Link>
                }
            >
                <AuthHeading title="Reset your password" subtitle={<>We&apos;ll send a reset link to your email</>} />

                {submitted ? (
                    <div className="mb-swap space-y-4">
                        <div className="rounded-lg border border-hairline bg-muted p-4 text-sm text-ink-soft">
                            If an account exists for <span className="font-medium text-ink">{email}</span>,
                            a password reset link has been sent.
                        </div>

                        {devResetLink && (
                            <div className="space-y-2 rounded-lg border border-dashed border-hairline p-4 text-sm">
                                <p className="text-xs font-medium text-ink-faint">
                                    Dev mode - no email provider configured
                                </p>
                                <p className="text-ink-soft">
                                    Use this link directly instead of checking an inbox:
                                </p>
                                <Link href={devResetLink} className={`block break-all ${authLinkClass}`}>
                                    {devResetLink}
                                </Link>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <AuthField
                            id="forgot-email"
                            label="Email"
                            icon={Mail}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                            placeholder="you@example.com"
                        />

                        {error && <AuthFormError>{error}</AuthFormError>}

                        <Button className="mt-2 h-[2.625rem] w-full text-sm" onClick={handleSubmit} disabled={loading || !email.trim()} aria-busy={loading}>
                            {loading ? <><UnitSpinner /><span className="mb-swap">Sending…</span></> : "Send reset link"}
                        </Button>
                    </div>
                )}
            </AuthCardShell>
        </AuthLayout>
    )
}
