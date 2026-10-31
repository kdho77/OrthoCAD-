import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const HEX_GRID =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd' stroke='%2322D3EE' stroke-width='0.35' fill='none' opacity='1'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5-13-7.5v-15l13-7.5z'/%3E%3C/g%3E%3C/svg%3E\")";

const inputClassName =
    "h-11 w-full rounded-[10px] border border-[#24335A] bg-[#0C1430] px-3 text-[15px] text-[#E6EDF7] placeholder:text-[#94A3B8] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(34,211,238,0.35)] max-[479px]:text-base";

// Email/password sign-in when Supabase is configured and there is no active session.
export function LoginScreen() {
    const emailId = useId();
    const passwordId = useId();
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const signIn = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            setFieldError("Enter your email.");
            setError(null);
            emailRef.current?.focus();
            return;
        }
        if (!password) {
            setFieldError("Enter your password.");
            setError(null);
            passwordRef.current?.focus();
            return;
        }

        const supabase = getSupabase();
        if (!supabase) return;
        setBusy(true);
        setFieldError(null);
        setError(null);
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
        });
        if (signInError) setError(signInError.message);
        setBusy(false);
    };

    const liveMessage = fieldError ?? error;

    return (
        <div
            className="relative flex min-h-full w-full flex-col items-center justify-center px-5 py-10 max-[479px]:px-5"
            style={{
                backgroundColor: "#0A1024",
                backgroundImage:
                    "radial-gradient(600px circle at 50% 30%, rgba(34,211,238,0.12), transparent 70%)",
            }}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.04]"
                style={{
                    backgroundImage: HEX_GRID,
                    backgroundSize: "28px 49px",
                }}
                aria-hidden
            />
            <div className="relative flex w-full max-w-[400px] flex-col items-center">
                <img
                    src="/brand/orthocad-logo-transparent.png"
                    alt="OrthoCAD by Vertex Orthopedic Group"
                    width={320}
                    height={107}
                    className="mb-10 h-auto w-[240px] min-[480px]:w-[320px]"
                    decoding="async"
                />

                <div className="w-full rounded-[10px] border border-[#1E2A4A] bg-[rgba(17,26,51,0.85)] p-6 shadow-xl backdrop-blur-[12px] max-[479px]:rounded-none max-[479px]:border-0 max-[479px]:bg-transparent max-[479px]:p-0 max-[479px]:shadow-none">
                    <header className="mb-6 space-y-1">
                        <h1 className="text-[20px] font-semibold leading-7 text-[#E6EDF7]">Sign in</h1>
                        <p className="text-sm leading-5 text-[#94A3B8]">Use your Vertex account</p>
                    </header>

                    <form
                        className="flex flex-col gap-4"
                        noValidate
                        onSubmit={(e) => {
                            e.preventDefault();
                            void signIn();
                        }}
                    >
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor={emailId} className="text-[13px] font-medium leading-[18px] text-[#E6EDF7]">
                                Email
                            </label>
                            <input
                                ref={emailRef}
                                id={emailId}
                                type="email"
                                autoComplete="email"
                                inputMode="email"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (fieldError) setFieldError(null);
                                }}
                                className={inputClassName}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor={passwordId}
                                className="text-[13px] font-medium leading-[18px] text-[#E6EDF7]"
                            >
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    ref={passwordRef}
                                    id={passwordId}
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (fieldError) setFieldError(null);
                                    }}
                                    className={`${inputClassName} pr-11`}
                                />
                                <button
                                    type="button"
                                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-[#94A3B8] transition-colors hover:text-[#E6EDF7] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(34,211,238,0.35)]"
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    onClick={() => setShowPassword((v) => !v)}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                                </button>
                            </div>
                        </div>

                        <div aria-live="polite" className="min-h-[18px] text-sm leading-5 text-[#F87171]">
                            {liveMessage}
                        </div>

                        <button
                            type="submit"
                            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#22D3EE] text-[15px] font-medium text-[#04212B] transition-colors hover:bg-[#06B6D4] active:bg-[#0891B2] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(34,211,238,0.35)] disabled:cursor-default"
                            aria-busy={busy}
                        >
                            {busy ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                    Signing in…
                                </>
                            ) : (
                                "Sign in"
                            )}
                        </button>
                    </form>
                </div>

                <footer className="mt-10 text-center text-xs leading-4 text-[#94A3B8]">
                    © 2026 Vertex Orthopedic Group ·{" "}
                    <a href="https://vertexorthopedic.com/privacy" className="underline-offset-2 hover:underline">
                        Privacy
                    </a>{" "}
                    ·{" "}
                    <a href="mailto:support@vertexorthopedic.com" className="underline-offset-2 hover:underline">
                        Support
                    </a>
                </footer>
            </div>
        </div>
    );
}
