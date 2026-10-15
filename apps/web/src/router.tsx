import CheckoutPage from './pages/CheckoutPage.js'
import CourseLessonsPage from './pages/CourseLessonsPage.js'
import DashboardPage from './pages/DashboardPage.js'
import InvitationPage from './pages/InvitationPage.js'
import LessonPage from './pages/LessonPage.js'
import LoginPage from './pages/LoginPage.js'

export function renderRoute(apiOrigin: string, path: string) {
  const invitation = path.match(/^\/invite\/([^/]+)$/)
  if (invitation) return <InvitationPage apiOrigin={apiOrigin} token={decodeURIComponent(invitation[1]!)} />
  const course = path.match(/^\/courses\/([^/]+)$/)
  if (course) return <CourseLessonsPage apiOrigin={apiOrigin} courseId={decodeURIComponent(course[1]!)} />
  const lesson = path.match(/^\/lessons\/([^/]+)$/)
  if (lesson) return <LessonPage apiOrigin={apiOrigin} lessonId={decodeURIComponent(lesson[1]!)} />
  if (path === '/login') return <LoginPage apiOrigin={apiOrigin} />
  if (path === '/dashboard') return <DashboardPage apiOrigin={apiOrigin} />
  return <CheckoutPage apiOrigin={apiOrigin} />
}
