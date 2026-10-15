import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { trace } from '@opentelemetry/api'
import {
  createCheckoutIdempotencyKey,
  CheckoutApiError,
  loadCourses,
  submitCheckout,
  type CatalogCourse,
  type CheckoutPayload,
  type CheckoutResponse,
  type CheckoutStudentInput,
} from '../api/checkout.js'

interface StudentForm {
  name: string
  year: number
  courseIds: string[]
}

interface CheckoutPageProps {
  apiOrigin: string
}

const initialStudent = (): StudentForm => ({ name: '', year: 8, courseIds: [] })

function formatPrice(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

export default function CheckoutPage({ apiOrigin }: CheckoutPageProps) {
  const [courses, setCourses] = useState<CatalogCourse[]>([])
  const [parentName, setParentName] = useState('')
  const [parentEmail, setParentEmail] = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [students, setStudents] = useState<StudentForm[]>([initialStudent()])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<CheckoutResponse | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null)

  useEffect(() => {
    let active = true
    loadCourses(apiOrigin)
      .then((items) => { if (active) setCourses(items) })
      .catch(() => { if (active) setCatalogError('The course list is unavailable right now.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [apiOrigin])

  const totalMinor = useMemo(() => students.reduce((total, student) => total + student.courseIds.reduce((studentTotal, id) => {
    return studentTotal + (courses.find((course) => course.id === id)?.priceMinor ?? 0)
  }, 0), 0), [courses, students])
  const currency = courses[0]?.currency ?? 'GBP'

  function updateStudent(index: number, update: Partial<StudentForm>) {
    setStudents((current) => current.map((student, studentIndex) => studentIndex === index ? { ...student, ...update } : student))
  }

  function toggleCourse(studentIndex: number, courseId: string) {
    const current = students[studentIndex]!
    const courseIds = current.courseIds.includes(courseId)
      ? current.courseIds.filter((id) => id !== courseId)
      : [...current.courseIds, courseId]
    updateStudent(studentIndex, { courseIds })
  }

  function buildPayload(): CheckoutPayload {
    return {
      parent: { name: parentName.trim(), email: parentEmail.trim(), emailConfirm: emailConfirm.trim() },
      students: students.map((student): CheckoutStudentInput => ({ name: student.name.trim(), year: student.year, courseIds: student.courseIds })),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const payload = buildPayload()
    if (payload.parent.email.toLowerCase() !== payload.parent.emailConfirm.toLowerCase()) {
      setError('Those email addresses do not match. Check them and try again.')
      return
    }
    if (payload.students.some((student) => !student.name || student.courseIds.length === 0)) {
      setError('Add each learner’s name and choose at least one course.')
      return
    }
    const fingerprint = JSON.stringify(payload)
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: createCheckoutIdempotencyKey() }
    }

    setSubmitting(true)
    const tracer = trace.getTracer('mes-web')
    await tracer.startActiveSpan('checkout.submit', async (span) => {
      span.setAttribute('checkout.student_count', payload.students.length)
      try {
        const outcome = await submitCheckout(apiOrigin, payload, attempt.current!.key)
        setReceipt(outcome)
        attempt.current = null
      } catch (cause) {
        if (cause instanceof CheckoutApiError && ['PAYMENT_FAILED', 'PAYMENT_UNAVAILABLE'].includes(cause.code ?? '')) attempt.current = null
        setError(cause instanceof Error ? cause.message : 'Checkout could not be completed. Try again.')
      } finally {
        span.end()
        setSubmitting(false)
      }
    })
  }

  if (receipt) {
    return (
      <main className="min-h-screen bg-[#edf3f1] px-5 py-8 text-[#173c3d] sm:px-8">
        <div className="mx-auto max-w-3xl">
          <BrandHeader />
          <section className="mt-16 rounded-[2rem] border border-[#cbdad4] bg-[#fffefa] p-7 shadow-[0_24px_70px_-50px_#173c3d] sm:p-12" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#527775]">Mock purchase confirmed</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">A new chapter starts here.</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#526a69]">Order <span className="font-mono text-sm">{receipt.orderId}</span> is confirmed. No payment was taken.</p>
            <div className="mt-8 flex items-center justify-between border-y border-[#dce5e1] py-5">
              <span className="text-sm font-semibold">Order total</span>
              <span className="font-display text-2xl font-semibold">{formatPrice(receipt.totalMinor, receipt.currency)}</span>
            </div>
            <h2 className="mt-9 text-lg font-bold">Student invitations</h2>
            {receipt.invitations.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {receipt.invitations.map((invitation) => (
                  <li key={invitation.url} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#edf3f1] p-4">
                    <span className="font-semibold">{invitation.studentName}</span>
                    <a className="font-bold text-[#a84e2c] underline decoration-2 underline-offset-4" href={invitation.url}>Open invitation</a>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm leading-6 text-[#526a69]">This order was already completed. For safety, invitation links are shown only once.</p>}
            <button className="mt-8 rounded-full bg-[#173c3d] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#245657] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]" onClick={() => window.location.reload()}>Browse courses again</button>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#edf3f1] px-4 py-5 text-[#173c3d] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <BrandHeader />
        <section className="relative mt-9 overflow-hidden rounded-[2rem] bg-[#173c3d] px-6 py-9 text-[#fffefa] sm:px-10 sm:py-12">
          <div className="absolute -right-14 -top-24 h-64 w-64 rounded-full border-[1px] border-[#d5e77d]/40 sm:right-12 sm:top-[-8rem] sm:h-[27rem] sm:w-[27rem]" />
          <div className="absolute -right-2 -top-12 h-48 w-48 rounded-full border-[1px] border-[#d5e77d]/30 sm:right-24 sm:top-[-6rem] sm:h-[21rem] sm:w-[21rem]" />
          <div className="relative max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#d5e77d]">A little more room to grow</p>
            <h1 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-[1.03] tracking-[-0.055em] sm:text-6xl">Make space for their next big idea.</h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-[#d0e0db] sm:text-base">Thoughtful online courses, ready when curiosity strikes. Choose a course for each learner to get started.</p>
          </div>
          <div className="relative mt-8 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d0e0db] sm:mt-10">
            <span className="rounded-full border border-white/20 px-3 py-2">Flexible, student-led learning</span>
            <span className="rounded-full border border-white/20 px-3 py-2">One-time mock checkout</span>
          </div>
        </section>

        {catalogError && <div role="alert" className="mt-6 rounded-xl border border-[#c75e3c]/40 bg-[#fff2e9] p-4 text-sm text-[#793a28]">{catalogError} Refresh to try again.</div>}
        {loading ? <p className="py-16 text-center text-sm text-[#526a69]">Loading courses…</p> : (
          <form className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem]" onSubmit={handleSubmit}>
            <div className="space-y-7">
              <section className="rounded-[1.75rem] border border-[#cbdad4] bg-[#fffefa] p-5 sm:p-8">
                <div className="flex items-end justify-between gap-4 border-b border-[#dce5e1] pb-5">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">The learning shelf</p>
                    <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.035em]">Choose courses</h2>
                  </div>
                  <span className="hidden text-xs text-[#718783] sm:block">Prices are per learner</span>
                </div>
                {students.map((student, studentIndex) => (
                  <fieldset key={studentIndex} className="mt-6">
                    <legend className="mb-3 flex w-full items-center justify-between text-sm font-bold">
                      <span>Learner {studentIndex + 1}</span>
                      {students.length > 1 && <button type="button" onClick={() => setStudents((current) => current.filter((_, index) => index !== studentIndex))} className="text-xs font-semibold text-[#a84e2c] underline underline-offset-4">Remove learner</button>}
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {courses.map((course) => {
                        const selected = student.courseIds.includes(course.id)
                        const eligible = student.year >= course.yearMin && student.year <= course.yearMax
                        return (
                          <label key={course.id} className={`group relative flex min-h-32 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#a84e2c] ${selected ? 'border-[#173c3d] bg-[#e9f0ec]' : 'border-[#dce5e1] bg-white hover:border-[#8ca8a2]'} ${!eligible ? 'cursor-not-allowed opacity-45' : ''}`}>
                            <input className="peer sr-only" type="checkbox" checked={selected} disabled={!eligible} onChange={() => toggleCourse(studentIndex, course.id)} />
                            <span aria-hidden="true" className={`absolute right-4 top-4 grid h-5 w-5 place-items-center rounded-full border text-[11px] transition ${selected ? 'border-[#173c3d] bg-[#173c3d] text-white' : 'border-[#b7c8c2] text-transparent'}`}>✓</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#788d87]">Course selection</span>
                            <span className="mt-5 pr-8 font-display text-xl font-semibold tracking-[-0.03em]">{course.subject}</span>
                            <span className="mt-1 text-xs text-[#647a74]">Years {course.yearMin}–{course.yearMax} <span aria-hidden="true">·</span> {formatPrice(course.priceMinor, course.currency)}</span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                ))}
                <button type="button" onClick={() => setStudents((current) => [...current, initialStudent()])} className="mt-5 rounded-full border border-dashed border-[#9db3ac] px-4 py-2.5 text-sm font-bold text-[#315a58] transition hover:border-[#173c3d] hover:bg-[#edf3f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a84e2c]">+ Add another learner</button>
              </section>

              <section className="rounded-[1.75rem] border border-[#cbdad4] bg-[#fffefa] p-5 sm:p-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Purchase details</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.035em]">Who’s placing the order?</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-bold text-[#315a58] sm:col-span-2">Parent or guardian name
                    <input required maxLength={200} autoComplete="name" value={parentName} onChange={(event) => setParentName(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#cbdad4] bg-white px-4 py-3 text-sm font-normal text-[#173c3d] outline-none transition placeholder:text-[#9aa9a4] focus:border-[#315a58] focus:ring-2 focus:ring-[#d5e77d]" placeholder="Your name" />
                  </label>
                  {students.map((student, index) => (
                    <label key={index} className="text-xs font-bold text-[#315a58]">Learner {index + 1} name
                      <input required maxLength={200} value={student.name} onChange={(event) => updateStudent(index, { name: event.target.value })} className="mt-2 block w-full rounded-xl border border-[#cbdad4] bg-white px-4 py-3 text-sm font-normal text-[#173c3d] outline-none transition placeholder:text-[#9aa9a4] focus:border-[#315a58] focus:ring-2 focus:ring-[#d5e77d]" placeholder="Learner’s name" />
                    </label>
                  ))}
                  {students.map((student, index) => (
                    <label key={index} className="text-xs font-bold text-[#315a58]">Learner {index + 1} school year
                      <select value={student.year} onChange={(event) => {
                        const year = Number(event.target.value)
                        const courseIds = student.courseIds.filter((id) => {
                          const selectedCourse = courses.find((course) => course.id === id)
                          return selectedCourse !== undefined && year >= selectedCourse.yearMin && year <= selectedCourse.yearMax
                        })
                        updateStudent(index, { year, courseIds })
                      }} className="mt-2 block w-full rounded-xl border border-[#cbdad4] bg-white px-4 py-3 text-sm font-normal text-[#173c3d] outline-none focus:border-[#315a58] focus:ring-2 focus:ring-[#d5e77d]">
                        {Array.from({ length: 9 }, (_, year) => year + 5).map((year) => <option key={year} value={year}>Year {year}</option>)}
                      </select>
                    </label>
                  ))}
                  <label className="text-xs font-bold text-[#315a58]">Email address
                    <input required type="email" maxLength={320} autoComplete="email" value={parentEmail} onChange={(event) => setParentEmail(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#cbdad4] bg-white px-4 py-3 text-sm font-normal text-[#173c3d] outline-none transition placeholder:text-[#9aa9a4] focus:border-[#315a58] focus:ring-2 focus:ring-[#d5e77d]" placeholder="you@example.com" />
                  </label>
                  <label className="text-xs font-bold text-[#315a58]">Confirm email address
                    <input required type="email" maxLength={320} autoComplete="email" value={emailConfirm} onChange={(event) => setEmailConfirm(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#cbdad4] bg-white px-4 py-3 text-sm font-normal text-[#173c3d] outline-none transition placeholder:text-[#9aa9a4] focus:border-[#315a58] focus:ring-2 focus:ring-[#d5e77d]" placeholder="Type it again" />
                  </label>
                </div>
              </section>
            </div>

            <aside className="h-fit rounded-[1.75rem] border border-[#cbdad4] bg-[#dce9e2] p-5 sm:p-6 lg:sticky lg:top-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#527775]">Your plan</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.035em]">Ready when they are.</h2>
              <div className="my-6 space-y-3 border-y border-[#b9cec4] py-5 text-sm">
                {students.map((student, index) => <div key={index} className="flex justify-between gap-3"><span className="text-[#526a69]">Learner {index + 1}</span><span className="text-right font-semibold">{student.courseIds.length} {student.courseIds.length === 1 ? 'course' : 'courses'}</span></div>)}
                <div className="flex justify-between gap-3"><span className="text-[#526a69]">Payment</span><span className="font-semibold">Mock only</span></div>
              </div>
              <div className="flex items-end justify-between gap-2"><span className="text-sm font-semibold">Total</span><span className="font-display text-3xl font-semibold tracking-[-0.04em]">{formatPrice(totalMinor, currency)}</span></div>
              <p className="mt-3 text-xs leading-5 text-[#526a69]">A one-time simulated purchase. No payment details are collected and no charge is made.</p>
              {error && <p role="alert" className="mt-4 rounded-xl border border-[#c75e3c]/30 bg-[#fff2e9] p-3 text-sm leading-5 text-[#793a28]">{error}</p>}
              <button type="submit" disabled={submitting || loading || courses.length === 0} className="mt-6 w-full rounded-full bg-[#173c3d] px-5 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#245657] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">{submitting ? 'Confirming…' : 'Complete mock purchase'}</button>
              <p className="mt-3 text-center text-[11px] text-[#718783]">Invitation links appear after confirmation</p>
            </aside>
          </form>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 px-2 py-8 text-xs text-[#718783]">
          <span>MES Learning · Small steps, bright ideas</span>
          <span>Secure checkout · Simulated payment</span>
        </footer>
      </div>
    </main>
  )
}

function BrandHeader() {
  return (
    <header className="flex items-center justify-between gap-4 px-1">
      <a href="/" className="flex items-center gap-3 text-[#173c3d] no-underline">
        <span className="grid h-10 w-10 place-items-center rounded-[0.85rem] bg-[#d5e77d] font-display text-lg font-black tracking-[-0.08em]">m.</span>
        <span className="font-display text-sm font-bold tracking-[-0.02em]">MES Learning</span>
      </a>
      <span className="rounded-full border border-[#bdcec7] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#527775] sm:px-4 sm:text-[11px]">For curious minds</span>
    </header>
  )
}
