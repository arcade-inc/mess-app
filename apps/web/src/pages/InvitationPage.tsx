import { useEffect, useRef, useState, type FormEvent } from 'react'
import { trace } from '@opentelemetry/api'
import { claimInvitation, getCurrentStudent, getInvitation, IdentityApiError, redeemInvitation, type InvitationClaimResult, type InvitationPreview } from '../api/identity.js'
import IdentityHeader from '../components/IdentityHeader.js'

interface InvitationPageProps {
  apiOrigin: string
  token: string
}

export default function InvitationPage({ apiOrigin, token }: InvitationPageProps) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activated, setActivated] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimOutcome, setClaimOutcome] = useState<InvitationClaimResult | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const claimRequest = useRef<{ token: string; promise: Promise<Awaited<ReturnType<typeof claimInvitation>>> } | null>(null)
  const signInHref = `/login?${new URLSearchParams({ activationCode: token })}`

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const result = await getInvitation(apiOrigin, token)
        if (active) setInvitation(result)

        const student = await getCurrentStudent(apiOrigin)
        if (student) {
          if (active) setClaiming(true)
          try {
            if (claimRequest.current?.token !== token) {
              claimRequest.current = { token, promise: claimInvitation(apiOrigin, token) }
            }
            const result = await claimRequest.current.promise
            if (active) {
              if (result.declinedCourses.length > 0) setClaimOutcome(result)
              else window.location.replace('/dashboard')
            }
          } catch (cause) {
            if (!active) return
            if (cause instanceof IdentityApiError && cause.statusCode === 401) {
              window.location.replace(signInHref)
              return
            }
            setError(cause instanceof Error ? cause.message : 'The course could not be added to your account.')
          } finally {
            if (active) setClaiming(false)
          }
        }
      } catch (cause: unknown) {
        if (active) setError(cause instanceof Error ? cause.message : 'This invitation is unavailable.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [apiOrigin, signInHref, token])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAccountExists(false)
    if (password !== passwordConfirm) {
      setError('The passwords do not match. Try typing them again.')
      return
    }
    setSubmitting(true)
    await trace.getTracer('mes-web').startActiveSpan('invitation.redeem', async (span) => {
      try {
        await redeemInvitation(apiOrigin, token, { email: email.trim(), password })
        setActivated(true)
      } catch (cause) {
        if (cause instanceof IdentityApiError && cause.code === 'ACCOUNT_EXISTS') setAccountExists(true)
        setError(cause instanceof Error ? cause.message : 'The invitation could not be activated.')
      } finally {
        span.end()
        setSubmitting(false)
      }
    })
  }

  return (
    <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <IdentityHeader />
        <section className="mt-9 grid overflow-hidden rounded-[2rem] bg-[#fffefa] shadow-[0_24px_70px_-50px_#173c3d] lg:grid-cols-[0.86fr_1.14fr]">
          <aside className="relative min-h-64 overflow-hidden bg-[#173c3d] p-7 text-[#fffefa] sm:p-10 lg:min-h-[38rem]">
            <div className="absolute -right-28 -top-24 h-80 w-80 rounded-full border border-[#d5e77d]/35" />
            <div className="absolute -right-12 -top-8 h-56 w-56 rounded-full border border-[#d5e77d]/25" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Your invitation</p>
                <h1 className="mt-5 max-w-md font-display text-4xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-5xl">A place for every bright idea.</h1>
                <p className="mt-5 max-w-sm text-sm leading-6 text-[#d0e0db]">Your courses are ready. Create a student account to open your learning space.</p>
              </div>
              <div className="mt-10 border-t border-white/20 pt-5 text-xs text-[#d0e0db]">MES Learning <span className="mx-2 text-[#d5e77d]">·</span> Small steps, bright ideas</div>
            </div>
          </aside>

          <div className="p-6 sm:p-10 lg:p-12">
            {loading ? <p className="py-16 text-center text-sm text-[#526a69]">Checking your invitation…</p> : activated ? (
              <div aria-live="polite" className="py-8">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d5e77d] text-xl font-black">✓</span>
                <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Account activated</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">You’re ready to learn, {invitation?.studentName}.</h2>
                <p className="mt-4 text-sm leading-6 text-[#526a69]">Your account is active and your purchased courses are connected. You’re signed in on this device.</p>
                <a href="/dashboard" className="mt-8 inline-flex rounded-full bg-[#173c3d] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#245657] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">Continue to learning</a>
              </div>
            ) : claiming ? (
              <p aria-live="polite" className="py-16 text-center text-sm text-[#526a69]">Adding this course to your account…</p>
            ) : claimOutcome ? (
              <div role="alert" className="py-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a84e2c]">Some courses weren’t added</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">You already have access to these courses.</h2>
                {invitation && invitation.courses.some((course) => !claimOutcome.declinedCourses.some((declined) => declined.id === course.id)) && (
                  <p className="mt-4 text-sm leading-6 text-[#526a69]">The other courses in this invitation have been added to your account.</p>
                )}
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[#793a28]">
                  {claimOutcome.declinedCourses.map((course) => (
                    <li key={course.id}><strong>{course.subject}</strong> wasn’t added because it’s already on this learner’s account.</li>
                  ))}
                </ul>
                <p className="mt-4 text-sm leading-6 text-[#526a69]">If this purchase was a mistake, please contact technical support for help.</p>
                <a href="/dashboard" className="mt-7 inline-flex rounded-full bg-[#173c3d] px-6 py-3.5 text-sm font-bold text-white">Continue to learning</a>
              </div>
            ) : invitation ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Make it yours</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">Welcome, {invitation.studentName}.</h2>
                <p className="mt-3 text-sm leading-6 text-[#526a69]">This invitation includes:</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Included courses">
                  {invitation.courses.map((course) => <li key={course.id} className="rounded-full bg-[#edf3f1] px-3.5 py-2 text-xs font-semibold text-[#315a58]">{course.subject}</li>)}
                </ul>
                <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                  <label className="block text-xs font-bold text-[#315a58]">Student email
                    <input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="identity-input" placeholder="you@example.com" />
                  </label>
                  <label className="block text-xs font-bold text-[#315a58]">Create a password
                    <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="identity-input" aria-describedby="password-hint" />
                    <span id="password-hint" className="mt-1.5 block font-normal text-[#718783]">Use at least 12 characters.</span>
                  </label>
                  <label className="block text-xs font-bold text-[#315a58]">Type the password again
                    <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} className="identity-input" />
                  </label>
                  {error && <div role="alert" className="rounded-xl border border-[#c75e3c]/30 bg-[#fff2e9] p-3 text-sm leading-5 text-[#793a28]">{error}{accountExists && <> <a className="font-bold underline underline-offset-2" href={signInHref}>Sign in instead.</a></>}</div>}
                  <button type="submit" disabled={submitting} className="w-full rounded-full bg-[#173c3d] px-5 py-4 text-sm font-bold text-white transition hover:bg-[#245657] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">{submitting ? 'Setting up your account…' : 'Activate my account'}</button>
                </form>
                <p className="mt-5 text-center text-xs text-[#718783]">Already have an account? <a href={signInHref} className="font-bold text-[#315a58] underline underline-offset-2">Sign in</a></p>
              </>
            ) : (
              <div role="alert" className="py-10">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a84e2c]">Invitation unavailable</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">This link can’t be used.</h2>
                <p className="mt-4 text-sm leading-6 text-[#526a69]">{error || 'It may have expired or already been used. Ask your parent or guardian for a new invitation.'}</p>
                <a href="/" className="mt-7 inline-flex font-bold text-[#315a58] underline underline-offset-4">Return to course selection</a>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
