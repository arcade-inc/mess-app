import { useEffect, useState, type FormEvent } from 'react'
import { login, type StudentSummary } from '../api/identity.js'
import { endSession, readSession } from '../auth/session.js'
import IdentityHeader from '../components/IdentityHeader.js'

interface LoginPageProps {
  apiOrigin: string
}

function getInvitationReturnPath(): string | null {
  const params = new URLSearchParams(window.location.search)
  const activationCode = params.get('activationCode')
  if (!activationCode || !/^[A-Za-z0-9_-]+$/.test(activationCode)) return null

  return `/invite/${encodeURIComponent(activationCode)}`
}

export default function LoginPage({ apiOrigin }: LoginPageProps) {
  const returnPath = getInvitationReturnPath()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [student, setStudent] = useState<StudentSummary | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    readSession(apiOrigin)
      .then((current) => {
        if (!active) return
        setStudent(current)
        if (current && returnPath) window.location.replace(returnPath)
      })
      .catch(() => { if (active) setError('We couldn’t check your sign-in. Try again shortly.') })
      .finally(() => { if (active) setCheckingSession(false) })
    return () => { active = false }
  }, [apiOrigin, returnPath])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const current = await login(apiOrigin, { email: email.trim(), password })
      setStudent(current)
      setPassword('')
      if (returnPath) window.location.assign(returnPath)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t sign you in.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    setError('')
    try {
      await endSession(apiOrigin)
      setStudent(null)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t sign you out.')
    }
  }

  return (
    <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <IdentityHeader />
        <section className="mt-9 grid overflow-hidden rounded-[2rem] bg-[#fffefa] shadow-[0_24px_70px_-50px_#173c3d] md:grid-cols-[1fr_1fr]">
          <aside className="relative min-h-64 overflow-hidden bg-[#173c3d] p-7 text-[#fffefa] sm:p-10">
            <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[#d5e77d]/35" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Welcome back</p>
                <h1 className="mt-5 max-w-sm font-display text-4xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-5xl">Pick up where curiosity left off.</h1>
              </div>
              <p className="mt-10 border-t border-white/20 pt-5 text-xs text-[#d0e0db]">Your learning space is ready when you are.</p>
            </div>
          </aside>
          <div className="p-6 sm:p-10 lg:p-12">
            {checkingSession ? <p className="py-16 text-center text-sm text-[#526a69]">Checking your sign-in…</p> : student ? (
              <div aria-live="polite" className="py-7">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d5e77d] font-display text-lg font-black">{student.name.slice(0, 1).toUpperCase()}</span>
                <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Signed in</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">Hello, {student.name}.</h2>
                <p className="mt-3 text-sm leading-6 text-[#526a69]">You’re signed in as {student.email}.</p>
                {error && <p role="alert" className="mt-5 rounded-xl bg-[#fff2e9] p-3 text-sm text-[#793a28]">{error}</p>}
                <a href="/dashboard" className="mt-8 inline-flex rounded-full bg-[#173c3d] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#245657] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">Continue to learning</a>
                <button type="button" onClick={handleLogout} className="ml-4 mt-8 text-sm font-bold text-[#315a58] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">Sign out</button>
              </div>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Student sign in</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">Good to have you back.</h2>
                <p className="mt-3 text-sm leading-6 text-[#526a69]">Use the email and password you chose when you activated your invitation.</p>
                <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                  <label className="block text-xs font-bold text-[#315a58]">Student email
                    <input required type="email" maxLength={320} autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="identity-input" placeholder="you@example.com" />
                  </label>
                  <label className="block text-xs font-bold text-[#315a58]">Password
                    <input required type="password" maxLength={128} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="identity-input" />
                  </label>
                  {error && <p role="alert" className="rounded-xl border border-[#c75e3c]/30 bg-[#fff2e9] p-3 text-sm leading-5 text-[#793a28]">{error}</p>}
                  <button type="submit" disabled={submitting} className="w-full rounded-full bg-[#173c3d] px-5 py-4 text-sm font-bold text-white transition hover:bg-[#245657] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">{submitting ? 'Signing in…' : 'Sign in'}</button>
                </form>
                <p className="mt-5 text-center text-xs text-[#718783]">Need an account? Open the invitation from your parent or guardian.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
