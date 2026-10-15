import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('anonymous index page does not request /api/me without an auth hint', async ({ page }) => {
  let currentUserRequests = 0
  await page.addInitScript(() => localStorage.removeItem('mes.authenticated'))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/courses') return route.fulfill({ json: { courses: [] } })
    if (url.pathname === '/api/me') {
      currentUserRequests++
      return route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(currentUserRequests).toBe(0)
})

test('learner access label skips automatic session check and verifies on sign-in click', async ({ page }) => {
  let sessionChecks = 0
  await page.route('**/api/courses', async (route) => route.fulfill({ json: { courses: [] } }))
  await page.route('**/api/me', async (route) => {
    sessionChecks++
    return route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } })
  })

  await page.goto('/')
  const signInLink = page.getByRole('link', { name: 'Sign in' })
  await expect(signInLink).toBeVisible()
  expect(sessionChecks).toBe(0)
  await expect(page).toHaveURL(/\/$/)

  await expectNoHorizontalOverflow(page)
  await signInLink.click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Good to have you back.' })).toBeVisible()
  expect(sessionChecks).toBe(1)
})

test('learner sign-in check shows a retryable error when the server check fails', async ({ page }) => {
  let sessionChecks = 0
  await page.route('**/api/courses', async (route) => route.fulfill({ json: { courses: [] } }))
  await page.route('**/api/me', async (route) => {
    sessionChecks++
    if (sessionChecks === 1) {
      return route.fulfill({ status: 503, json: { error: { message: 'Session service unavailable' } } })
    }
    return route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } })
  })

  await page.goto('/')
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Session service unavailable')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/login$/)
})

test('learner login link takes a signed-out visitor to the login form by keyboard', async ({ page }) => {
  await page.route('**/api/courses', async (route) => route.fulfill({ json: { courses: [] } }))
  await page.route('**/api/me', async (route) => route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } }))

  await page.goto('/')
  const homeLink = page.getByRole('link', { name: 'MES Learning' })
  const loginLink = page.getByRole('link', { name: 'Sign in' })
  await expect(loginLink).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.keyboard.press('Tab')
  await expect(homeLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(loginLink).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Good to have you back.' })).toBeVisible()
})

test('learner login link takes a hinted server-authenticated learner to the dashboard', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  let hintBeforeInitialCheck: string | null | undefined
  await page.addInitScript(() => localStorage.setItem('mes.authenticated', 'true'))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/courses') return route.fulfill({ json: { courses: [] } })
    if (url.pathname === '/api/me') {
      hintBeforeInitialCheck = await page.evaluate(() => localStorage.getItem('mes.authenticated'))
      return route.fulfill({ json: student })
    }
    if (url.pathname === '/api/me/enrollments') return route.fulfill({ json: { enrollments: [] } })
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  expect(hintBeforeInitialCheck).toBe('true')
  await page.getByRole('link', { name: 'Dashboard' }).click()

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('No active courses yet')).toBeVisible()
})

test('learner login link rechecks the session before dashboard navigation', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  let sessionChecks = 0
  await page.addInitScript(() => localStorage.setItem('mes.authenticated', 'true'))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/courses') return route.fulfill({ json: { courses: [] } })
    if (url.pathname === '/api/me') {
      sessionChecks++
      if (sessionChecks === 1) return route.fulfill({ json: student })
      return route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Good to have you back.' })).toBeVisible()
})

test('learner login link fails closed and can be retried after session verification fails', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  let sessionChecks = 0
  await page.addInitScript(() => localStorage.setItem('mes.authenticated', 'true'))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/courses') return route.fulfill({ json: { courses: [] } })
    if (url.pathname === '/api/me') {
      sessionChecks++
      if (sessionChecks === 1) return route.fulfill({ status: 503, json: { error: { message: 'Session service unavailable' } } })
      return route.fulfill({ json: student })
    }
    if (url.pathname === '/api/me/enrollments') return route.fulfill({ json: { enrollments: [] } })
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Session service unavailable')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('No active courses yet')).not.toBeVisible()

  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('No active courses yet')).toBeVisible()
})

test('parent purchase activates a learner and grants access to the purchased lesson', async ({ page }) => {
  const suffix = randomUUID()
  const parentEmail = `parent-${suffix}@example.com`
  const studentEmail = `student-${suffix}@example.com`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make space for their next big idea.' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.locator('label').filter({ has: page.getByRole('checkbox') }).filter({ hasText: 'Maths' }).first().click()
  await expect(page.getByRole('heading', { name: 'Parent or guardian contact' })).toBeVisible()
  await page.getByLabel('Parent or guardian name').fill('E2E Parent')
  await page.getByLabel('Learner 1 name').fill('E2E Learner')
  await page.getByLabel('Email address', { exact: true }).fill(parentEmail)
  await page.getByLabel('Confirm email address').fill(`wrong-${parentEmail}`)
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await expect(page.getByRole('alert')).toContainText('email')
  await expect(page.getByRole('heading', { name: 'Choose a payment method' })).not.toBeVisible()

  await page.getByLabel('Confirm email address').fill(parentEmail)
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a payment method' })).toBeVisible()
  await page.getByRole('radio', { name: 'Visa' }).check()
  await page.getByRole('button', { name: 'Pay now' }).click()

  await expect(page.getByText('Mock purchase confirmed')).toBeVisible()
  await expect(page.getByText(`Your course details and student activation links were sent to ${parentEmail} (simulated).`)).toBeVisible()
  await expect(page.getByText('Activate each student account within 7 days.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('link', { name: 'Open invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, E2E Learner.' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByLabel('Student email').fill(studentEmail)
  await page.getByLabel('Create a password').fill('e2e-student-password-2026')
  await page.getByLabel('Type the password again').fill('e2e-student-password-2026')
  await page.getByRole('button', { name: 'Activate my account' }).click()
  await expect(page.getByRole('heading', { name: 'You’re ready to learn, E2E Learner.' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue to learning' }).click()

  await expect(page.getByRole('heading', { name: 'Ready when you are, E2E.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Maths' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('link', { name: /Active course Maths Open course/ }).click()
  await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const firstLesson = page.getByRole('link', { name: /Lesson 1/ }).first()
  await expect(firstLesson).toBeVisible()
  await firstLesson.click()
  await expect(page.locator('article h1')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const protectedLessonUrl = page.url()

  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto(protectedLessonUrl)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Good to have you back.' })).toBeVisible()
})

test('parent contact details are grouped and a mismatched email cannot advance', async ({ page }) => {
  const parentEmail = `parent-${randomUUID()}@example.com`

  await page.goto('/')
  await page.locator('label').filter({ has: page.getByRole('checkbox') }).filter({ hasText: 'Maths' }).first().click()
  await expect(page.getByRole('heading', { name: 'Parent or guardian contact' })).toBeVisible()
  await page.getByLabel('Parent or guardian name').fill('E2E Parent')
  await page.getByLabel('Learner 1 name').fill('E2E Learner')
  await page.getByLabel('Email address', { exact: true }).fill(parentEmail)
  await page.getByLabel('Confirm email address').fill(`wrong-${parentEmail}`)
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  await expect(page.getByRole('alert')).toContainText('email')
})

test('mock payment is selected before checkout is submitted', async ({ page }) => {
  const parentEmail = `payment-${randomUUID()}@example.com`
  let checkoutRequest: Record<string, unknown> | undefined
  let checkoutCount = 0

  await page.route('**/api/checkout', async (route) => {
    checkoutCount += 1
    checkoutRequest = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        orderId: randomUUID(),
        status: 'PAID',
        totalMinor: 19900,
        currency: 'GBP',
        invitations: [{ studentName: 'E2E Learner', url: 'http://localhost:8080/invite/test-token' }],
      }),
    })
  })

  await page.goto('/')
  await page.locator('label').filter({ has: page.getByRole('checkbox') }).filter({ hasText: 'Maths' }).first().click()
  await page.getByLabel('Parent or guardian name').fill('E2E Parent')
  await page.getByLabel('Learner 1 name').fill('E2E Learner')
  await page.getByLabel('Email address', { exact: true }).fill(parentEmail)
  await page.getByLabel('Confirm email address').fill(parentEmail)
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  await expect(page.getByRole('heading', { name: 'Choose a payment method' })).toBeVisible()
  await expect(page.getByText('No real payment will be taken')).toBeVisible()
  await expect(page.getByText('£199.00')).toBeVisible()
  await page.getByRole('button', { name: 'Pay now' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a mock payment method')
  expect(checkoutCount).toBe(0)

  await page.getByRole('button', { name: 'Back to details' }).click()
  const updatedEmail = `updated-${parentEmail}`
  await page.getByLabel('Email address', { exact: true }).fill(updatedEmail)
  await page.getByLabel('Confirm email address').fill(updatedEmail)
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await expect(page.getByText(updatedEmail)).toBeVisible()
  await page.getByRole('radio', { name: 'Visa' }).check()
  await page.getByRole('button', { name: 'Pay now' }).click()

  await expect.poll(() => checkoutRequest?.paymentMethod).toBe('visa')
  await expect.poll(() => (checkoutRequest?.parent as { email?: string } | undefined)?.email).toBe(updatedEmail)
})

test('failed mock payment shows an error without a purchase confirmation', async ({ page }) => {
  await page.route('**/api/checkout', async (route) => {
    await route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'PAYMENT_FAILED', message: 'Mock payment was not successful.' } }),
    })
  })

  await page.goto('/')
  await page.locator('label').filter({ has: page.getByRole('checkbox') }).filter({ hasText: 'Maths' }).first().click()
  await page.getByLabel('Parent or guardian name').fill('E2E Parent')
  await page.getByLabel('Learner 1 name').fill('E2E Learner')
  await page.getByLabel('Email address', { exact: true }).fill('payment-failed@example.com')
  await page.getByLabel('Confirm email address').fill('payment-failed@example.com')
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await page.getByRole('radio', { name: 'Mastercard' }).check()
  await page.getByRole('button', { name: 'Pay now' }).click()

  await expect(page.getByRole('alert')).toContainText('Mock payment was not successful')
  await expect(page.getByText('Mock purchase confirmed')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose a payment method' })).toBeVisible()
})

test('returning learner resumes the invitation after sign-in and claims it automatically', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  let authenticated = false
  let claimCount = 0
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/invitations/test-token' && request.method() === 'GET') {
      return route.fulfill({ json: { valid: true, studentName: 'E2E Learner', year: 8, courses: [{ id: 'course-1', subject: 'Biology' }] } })
    }
    if (url.pathname === '/api/me' && request.method() === 'GET') {
      return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? student : { error: { message: 'Authentication is required' } } })
    }
    if (url.pathname === '/api/auth/login' && request.method() === 'POST') {
      authenticated = true
      return route.fulfill({ json: { student } })
    }
    if (url.pathname === '/api/invitations/test-token/claim' && request.method() === 'POST') {
      claimCount++
      return route.fulfill({ json: { student } })
    }
    if (url.pathname === '/api/me/enrollments' && request.method() === 'GET') {
      return route.fulfill({ json: { enrollments: [{ id: 'enrollment-1', status: 'ACTIVE', course: { id: 'course-1', subject: 'Biology' } }] } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/invite/test-token')
  await expect(page.getByRole('heading', { name: 'Welcome, E2E Learner.' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/login\?.*activationCode=/)
  const loginUrl = new URL(page.url())
  expect(loginUrl.searchParams.get('activationCode')).toBe('test-token')
  expect(loginUrl.searchParams.has('returnTo')).toBe(false)
  await page.getByLabel('Student email').fill(student.email)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Biology' })).toBeVisible()
  expect(claimCount).toBe(1)
})

test('signed-in learner opening another learner invitation sees the exact mismatch message', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  let claimCount = 0
  await page.addInitScript(() => localStorage.setItem('mes.authenticated', 'true'))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/invitations/mismatch-token' && request.method() === 'GET') {
      return route.fulfill({ json: { valid: true, studentName: 'Another Learner', year: 8, courses: [{ id: 'course-2', subject: 'Science' }] } })
    }
    if (url.pathname === '/api/me' && request.method() === 'GET') return route.fulfill({ json: student })
    if (url.pathname === '/api/invitations/mismatch-token/claim' && request.method() === 'POST') {
      claimCount++
      return route.fulfill({ status: 409, json: { error: { code: 'INVITATION_LEARNER_MISMATCH', message: 'This course belongs to another learner.' } } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/invite/mismatch-token')
  await expect(page.getByRole('alert')).toHaveText('This course belongs to another learner.')
  expect(claimCount).toBe(1)
})

test('signed-in learner sees each duplicate course declined and support guidance', async ({ page }) => {
  const student = { id: 'student-1', name: 'E2E Learner', email: 'learner@example.com', year: 8 }
  await page.addInitScript(() => localStorage.setItem('mes.authenticated', 'true'))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/invitations/duplicate-token' && request.method() === 'GET') {
      return route.fulfill({ json: { valid: true, studentName: 'E2E Learner', year: 8, courses: [
        { id: 'course-1', subject: 'Maths' },
        { id: 'course-2', subject: 'Biology' },
      ] } })
    }
    if (url.pathname === '/api/me' && request.method() === 'GET') return route.fulfill({ json: student })
    if (url.pathname === '/api/invitations/duplicate-token/claim' && request.method() === 'POST') {
      return route.fulfill({ json: { student, declinedCourses: [{ id: 'course-1', subject: 'Maths' }] } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/invite/duplicate-token')
  await expect(page.getByRole('alert')).toContainText('Maths')
  await expect(page.getByRole('alert')).toContainText('already on this learner’s account')
  await expect(page.getByRole('alert')).toContainText('contact technical support')
  await expect(page.getByRole('alert')).toContainText('other courses in this invitation have been added')
})

test('unauthenticated learner opening an invitation does not request /api/me', async ({ page }) => {
  let currentUserRequests = 0
  await page.addInitScript(() => localStorage.removeItem('mes.authenticated'))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/invitations/anonymous-token' && route.request().method() === 'GET') {
      return route.fulfill({ json: { valid: true, studentName: 'New Learner', year: 8, courses: [{ id: 'course-1', subject: 'Maths' }] } })
    }
    if (url.pathname === '/api/me' && route.request().method() === 'GET') {
      currentUserRequests++
      return route.fulfill({ status: 401, json: { error: { message: 'Authentication is required' } } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected API request' } } })
  })

  await page.goto('/invite/anonymous-token')
  await expect(page.getByRole('heading', { name: 'Welcome, New Learner.' })).toBeVisible()
  expect(currentUserRequests).toBe(0)
})
