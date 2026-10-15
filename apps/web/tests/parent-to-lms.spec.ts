import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('parent purchase activates a learner and grants access to the purchased lesson', async ({ page }) => {
  const suffix = randomUUID()
  const parentEmail = `parent-${suffix}@example.com`
  const studentEmail = `student-${suffix}@example.com`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make space for their next big idea.' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.locator('label').filter({ has: page.getByRole('checkbox') }).filter({ hasText: 'Maths' }).first().click()
  await page.getByLabel('Parent or guardian name').fill('E2E Parent')
  await page.getByLabel('Learner 1 name').fill('E2E Learner')
  await page.getByLabel('Email address', { exact: true }).fill(parentEmail)
  await page.getByLabel('Confirm email address').fill(parentEmail)
  await page.getByRole('button', { name: 'Complete mock purchase' }).click()

  await expect(page.getByText('Mock purchase confirmed')).toBeVisible()
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
