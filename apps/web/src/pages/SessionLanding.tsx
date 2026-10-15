import { useEffect, useState } from 'react'
import type { StudentSummary } from '../api/identity.js'
import { endSession, readSession } from '../auth/session.js'
import IdentityHeader from '../components/IdentityHeader.js'

export default function SessionLanding({ apiOrigin }: { apiOrigin: string }) {
  const [student, setStudent] = useState<StudentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    readSession(apiOrigin)
      .then((current) => { if (active) setStudent(current) })
      .catch(() => { if (active) setError('Your learning space is temporarily unavailable.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [apiOrigin])

  async function signOut() {
    try {
      await endSession(apiOrigin)
      window.location.assign('/login')
    } catch {
      setError('We couldn’t sign you out. Try again.')
    }
  }

  return (
    <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <IdentityHeader />
        <section className="mt-9 rounded-[2rem] bg-[#173c3d] p-7 text-[#fffefa] sm:p-12">
          {loading ? <p className="py-10 text-center text-sm text-[#d0e0db]">Opening your learning space…</p> : student ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">You’re signed in</p>
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-6xl">Keep exploring, {student.name}.</h1>
              <p className="mt-5 text-sm leading-6 text-[#d0e0db]">Your account is active. Your course dashboard will be here next.</p>
              {error && <p role="alert" className="mt-4 text-sm text-[#ffd5c5]">{error}</p>}
              <button type="button" onClick={signOut} className="mt-8 rounded-full border border-white/30 px-5 py-3 text-sm font-bold transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d5e77d]">Sign out</button>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Sign in to continue</p>
              <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Your learning space is waiting.</h1>
              <a href="/login" className="mt-8 inline-flex rounded-full bg-[#d5e77d] px-6 py-3.5 text-sm font-bold text-[#173c3d]">Go to sign in</a>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
