# Quickstart: Learner Login Link

## Prerequisites

- Install workspace dependencies from the repository root with `npm ci`.
- For browser tests, have the local app available at `http://localhost:8080` (or set `E2E_BASE_URL` to the running app) and Playwright Chromium installed.

## Validate the Feature

From the repository root:

1. Run web unit/API tests:

   ```bash
   npm test --workspace @mes/web
   ```

2. Run the focused learner login-link browser scenarios in both desktop and mobile projects:

   ```bash
   E2E_BASE_URL=http://localhost:8080 npm run test:e2e --workspace @mes/web -- --grep "learner access label|learner login link"
   ```

   Expected: signed-out visitors see “Sign in” and reach the existing login page; server-confirmed learners see “Dashboard” and reach the dashboard; missing local hints do not suppress a valid cookie session; verification failures do not show an authenticated label or expose dashboard content and show a retryable message.

3. Run the full web browser regression suite except the optional distributed-tracing test:

   ```bash
   E2E_BASE_URL=http://localhost:8080 npm run test:e2e --workspace @mes/web -- --grep-invert "one browser catalog request"
   ```

   The tracing test requires the optional tracing Compose overlay; the default API container does not export spans to the browser test collector.

4. To run that tracing-specific test, start the tracing-enabled API and web services and select the desktop project (the test collector uses a fixed local port):

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tracing.yml up -d --build api web
   E2E_BASE_URL=http://localhost:8080 npm run test:e2e --workspace @mes/web -- --project desktop --grep "one browser catalog request"
   ```

5. Run the web build and lint:

   ```bash
   npm run build --workspace @mes/web
   npm run lint --workspace @mes/web
   ```

See [contracts/ui-navigation.md](contracts/ui-navigation.md) for the expected user-visible behavior and [data-model.md](data-model.md) for authorization constraints.
