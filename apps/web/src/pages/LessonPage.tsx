import { useEffect, useState } from 'react'
import { getLesson, type Lesson } from '../api/learning.js'
import { readSession } from '../auth/session.js'
import IdentityHeader from '../components/IdentityHeader.js'

interface LessonPageProps { apiOrigin: string; lessonId: string }

export default function LessonPage({ apiOrigin, lessonId }: LessonPageProps) {
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!await readSession(apiOrigin)) { window.location.replace('/login'); return }
        const result = await getLesson(apiOrigin, lessonId)
        if (active) setLesson(result)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'This lesson could not be opened.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [apiOrigin, lessonId])

  return <main className="min-h-screen bg-[#edf3f1] px-4 py-6 text-[#173c3d] sm:px-8 sm:py-9"><div className="mx-auto max-w-4xl"><IdentityHeader />
    {lesson && <a href={`/courses/${encodeURIComponent(lesson.courseId)}`} className="mt-9 inline-flex rounded-full border border-[#bdcec7] px-4 py-2 text-xs font-bold text-[#315a58] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">← Course lessons</a>}
    <article className="mt-6 overflow-hidden rounded-[2rem] bg-[#fffefa] shadow-[0_24px_70px_-50px_#173c3d]">{loading ? <p className="p-10 text-sm text-[#526a69]" aria-live="polite">Opening your lesson…</p> : error ? <div role="alert" className="p-8 sm:p-12"><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a84e2c]">Lesson unavailable</p><h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">This lesson isn’t available</h1><p className="mt-3 text-sm leading-6 text-[#526a69]">It may not be part of your active courses. Return to your dashboard to see what you can access.</p><a href="/dashboard" className="mt-6 inline-flex rounded-full bg-[#173c3d] px-5 py-3 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">Go to dashboard</a></div> : lesson && <><header className="bg-[#173c3d] px-6 py-10 text-white sm:px-12 sm:py-14"><p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d5e77d]">Lesson {String(lesson.position).padStart(2, '0')}</p><h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">{lesson.title}</h1></header><div className="px-6 py-9 sm:px-12 sm:py-12"><div className="prose max-w-2xl whitespace-pre-wrap text-base leading-8 text-[#31504c]">{lesson.body}</div><a href={`/courses/${encodeURIComponent(lesson.courseId)}`} className="mt-10 inline-flex items-center gap-2 rounded-full bg-[#d5e77d] px-5 py-3 text-sm font-bold text-[#173c3d] transition hover:bg-[#cbe15f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a84e2c]">Back to lessons <span aria-hidden="true">→</span></a></div></>}</article>
  </div></main>
}
