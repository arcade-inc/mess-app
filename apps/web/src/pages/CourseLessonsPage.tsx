import { useEffect, useState } from 'react'
import { getCourseLessons, type LessonSummary } from '../api/learning.js'
import { readSession } from '../auth/session.js'
import IdentityHeader from '../components/IdentityHeader.js'

interface CourseLessonsPageProps { apiOrigin: string; courseId: string }

export default function CourseLessonsPage({ apiOrigin, courseId }: CourseLessonsPageProps) {
  const [lessons, setLessons] = useState<LessonSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!await readSession(apiOrigin)) { window.location.replace('/login'); return }
        setLessons(await getCourseLessons(apiOrigin, courseId))
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'This course could not be opened.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [apiOrigin, courseId])

  return <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9"><div className="mx-auto max-w-5xl"><IdentityHeader />
    <a href="/dashboard" className="mt-9 inline-flex rounded-full border border-[#bdcec7] px-4 py-2 text-xs font-bold text-[#315a58] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">← All courses</a>
    <section className="mt-6 overflow-hidden rounded-[2rem] bg-[#fffefa] shadow-[0_24px_70px_-50px_#173c3d]"><header className="bg-[#173c3d] px-6 py-9 text-white sm:px-10 sm:py-11"><p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Course notebook</p><h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Lessons</h1><p className="mt-3 text-sm text-[#d0e0db]">Follow the sequence or revisit a lesson whenever you need.</p></header>
      <div className="p-6 sm:p-10">{loading ? <p className="py-8 text-sm text-[#526a69]" aria-live="polite">Loading lessons…</p> : error ? <div role="alert" className="rounded-xl bg-[#fff2e9] p-4 text-sm text-[#793a28]"><p>{error}</p><a className="mt-3 inline-block font-bold underline" href="/dashboard">Return to your courses</a></div> : lessons.length === 0 ? <p className="py-8 text-sm text-[#526a69]">There are no lessons available in this course yet.</p> : <ol className="divide-y divide-[#e1e9e4]">{lessons.map((lesson) => <li key={lesson.id}><a href={`/lessons/${encodeURIComponent(lesson.id)}`} className="group flex items-center gap-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a84e2c]"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#bdcec7] font-mono text-xs font-bold text-[#527775]">{String(lesson.position).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#78918a]">Lesson {lesson.position}</span><span className="mt-1 block font-display text-xl font-semibold tracking-[-0.03em]">{lesson.title}</span></span><span aria-hidden="true" className="text-xl text-[#527775] transition-transform group-hover:translate-x-1">→</span></a></li>)}</ol>}</div>
    </section></div></main>
}
