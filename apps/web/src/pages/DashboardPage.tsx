import { useEffect, useState } from 'react'
import { getMyEnrollments, type EnrollmentSummary } from '../api/learning.js'
import { readSession, endSession } from '../auth/session.js'
import type { StudentSummary } from '../api/identity.js'
import IdentityHeader from '../components/IdentityHeader.js'

interface DashboardPageProps { apiOrigin: string }

export default function DashboardPage({ apiOrigin }: DashboardPageProps) {
  const [student, setStudent] = useState<StudentSummary | null>(null)
  const [enrollments, setEnrollments] = useState<EnrollmentSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const current = await readSession(apiOrigin)
        if (!current) { window.location.replace('/login'); return }
        const courses = await getMyEnrollments(apiOrigin)
        if (active) { setStudent(current); setEnrollments(courses) }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Your learning space could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [apiOrigin])

  async function signOut() {
    try { await endSession(apiOrigin); window.location.assign('/login') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'You could not be signed out.') }
  }

  return (
    <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <IdentityHeader />
        <section className="mt-10 overflow-hidden rounded-[2rem] bg-[#fffefa] shadow-[0_24px_70px_-50px_#173c3d]">
          <div className="grid gap-8 bg-[#173c3d] px-6 py-9 text-white sm:grid-cols-[1fr_auto] sm:items-end sm:px-10 sm:py-11">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Your learning desk</p>
              <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">{student ? `Ready when you are, ${student.name.split(' ')[0]}.` : 'Your courses, in one place.'}</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#d0e0db]">Choose a course to pick up your next lesson. Your active courses are shown here.</p>
            </div>
            <button type="button" onClick={signOut} className="justify-self-start rounded-full border border-white/35 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d5e77d] sm:justify-self-end">Sign out</button>
          </div>
          <div className="p-6 sm:p-10">
            {loading ? <p className="py-10 text-sm text-[#526a69]" aria-live="polite">Opening your courses…</p> : error ? <p role="alert" className="rounded-xl bg-[#fff2e9] p-4 text-sm text-[#793a28]">{error}</p> : enrollments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#bdcec7] px-6 py-12 text-center">
                <p className="font-display text-2xl font-semibold tracking-[-0.03em]">No active courses yet</p>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#526a69]">When a course is ready for you, it will appear here. Ask your parent or guardian to check the invitation.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {enrollments.map(({ id, course }) => <a key={id} href={`/courses/${encodeURIComponent(course.id)}`} className="group rounded-2xl border border-[#d9e4de] p-6 transition hover:-translate-y-0.5 hover:border-[#7d9e93] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d5e77d] font-display text-xl font-black text-[#173c3d]">{course.subject.slice(0, 1)}</span>
                  <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-[#527775]">Active course</p>
                  <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">{course.subject}</h2>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#315a58]">Open course <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></span>
                </a>)}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
