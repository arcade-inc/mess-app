# Quickstart: Validate the MES Parent-to-LMS Journey

This guide describes the acceptance walkthrough for a clean checkout. It does not prescribe
implementation bodies or duplicate the API/data design; see [the API contract](contracts/openapi.yaml)
and [the logical data model](data-model.md).

## Prerequisites

- Docker and Docker Compose
- A browser
- A clean checkout of the repository

The API uses `DATABASE_URL` for the primary/write pool and optional `DATABASE_READ_URL` for the
read pool. Local Compose points both to its single PostgreSQL service; no local replica is required.

## Start

1. Copy `.env.example` to `.env` and set required development secrets if the documented defaults
   do not include them.
2. Start the application with `docker compose up`.
3. Wait for the API readiness check and open the local application URL documented in `README.md`.

Expected result: database migrations and seed data complete automatically; the catalog is visible
without manual SQL or administration steps.

## Full journey acceptance

1. On the course page, choose a course eligible for a sample student year.
2. Enter parent details and student name/year, then submit the clearly labeled mock checkout.
3. Confirm the success outcome shows the order and a student invitation; no real payment occurs.
4. Open the invitation and complete onboarding with a new student email and password.
5. Confirm the student reaches the LMS dashboard, sees the purchased course, and can open a lesson.
6. Sign out, then confirm the protected LMS content is not available until sign-in.
7. Check the purchase, invitation/onboarding, and LMS screens at a narrow mobile viewport and a desktop viewport; confirm Tailwind-styled content remains readable and usable without horizontal overflow.

## Negative and security acceptance

- Attempt checkout for an ineligible year and confirm it is rejected without an invitation.
- Retry the same checkout identity and confirm there is only one order; retry it with changed details
  and confirm the conflict is visible.
- Redeem an invitation twice or after expiration and confirm no second activation occurs.
- Sign in as a different student and request the first student's lesson; confirm protected content
  is denied without revealing whether the lesson exists.
- For every registered route outside the explicit public allowlist (catalog, checkout, invitation
  read/activation, login, and health/readiness), make a request without a session cookie and confirm
  it returns 401. The guard must be global so newly added routes default to protected.
- Revoke or change an enrollment in the database during a valid student session (where supported)
  and confirm the next lesson request is denied; session claims must not cache entitlement state.
- Simulate payment or email delivery failure where supported and confirm no partial entitlement is
  shown as successful; email retries must not duplicate access grants.
- For T2 outbox, stop a worker after claiming an item and verify an expired lease can be reclaimed;
  confirm provider calls happen outside a database transaction and retries do not lose the event.
- Send requests beyond the configured limit for one student and confirm the API returns 429 with
  the documented retry information; confirm another student has an independent allowance and that
  the first student's allowance replenishes after its configured time window. For public routes,
  verify the anonymous-client fallback is applied without trusting spoofed forwarded-IP headers.
- Send a browser preflight from an allowed development origin and an unlisted origin; confirm only
  the explicitly configured origin receives CORS permission and cookie credentials are not allowed
  for an unlisted origin.
- In the browser, complete checkout with tracing enabled and confirm the action, HTTP client, API
  server, and PostgreSQL spans share one W3C trace. Confirm fetch propagation sends `traceparent`
  only to the configured API origin, and that allowed CORS preflight permits `traceparent` and
  `tracestate` while unlisted origins do not.
- Send a request with a valid `traceparent`, then with missing and malformed context; confirm valid
  context becomes the API span's parent and missing/malformed context starts a fresh trace. Confirm
  active trace and span IDs appear in allowlisted logs, but raw invitation URLs, query strings,
  request bodies, credentials, and student data do not appear in spans, logs, or captured failure
  output. Checkout and later onboarding must have distinct traces with only opaque internal IDs used
  for optional correlation.
- Verify local validation retains spans for automated trace assertions. When T2 outbox/worker code
  is implemented, verify trace context is persisted without baggage, extracted before processing,
  and linked from retry traces where appropriate; do not add a broker solely for tracing.
- In local development, confirm Fastify request traces, HTTP request count/duration/error metrics, and
  purchase/invitation/activation/lesson-denial business counters are emitted. Confirm telemetry contains no student identifiers,
  emails, invitation secrets, passwords, or session credentials; verify an OTLP endpoint can be
  configured without making it mandatory for the local Docker journey.
- Verify repository routing tests send writes, transactions, checkout price/eligibility reads,
  enrollment authorization, and read-after-write operations to the primary pool. Only explicitly
  lag-tolerant reads may use `DATABASE_READ_URL`; simulate stale replica data and confirm it cannot
  grant access or hide a just-committed enrollment from a consistency-sensitive flow.

## Automated validation

Run the documented TypeScript lint command (for example, `npm run lint`) and the test command
documented in the final `README.md` (the initial `docs/plan.md` suggests
`docker compose run --rm api npm test`; adjust to the final script name). Critical tests must cover
pricing and year validation, payment failure consistency, idempotent/concurrent checkout, valid and
invalid/concurrent invitation redemption, and the entitlement matrix against PostgreSQL. If the
T2 outbox is completed, also verify retry behavior, lease recovery after worker interruption, and
reminder token rotation/state rechecks. The final README must explain key-per-attempt retry behavior,
same-key/different-body rejection, at-least-once email (including the accepted rare duplicate), and
that processing order is not guaranteed.

## Architecture seam review

- Review the README's architecture notes and source comments at payment, email/message delivery,
  retry, external-service, and any CPU-intensive operations. Confirm they identify plausible future
  producer/worker boundaries without suggesting those boundaries are currently broker-backed.
- Confirm the mock runs without a message broker. If no CPU-intensive operation exists, document
  that fact rather than creating a placeholder worker solely for future scaling.

## Clean-checkout validation

Repeat the start and full-journey acceptance steps from a disposable fresh clone with no local
`.env` or previous database volume. In that disposable checkout, run `docker compose down -v` to
remove its database volume, then `docker compose build --no-cache` and `docker compose up`. **Do not
run `down -v` against a checkout whose local database data you need.** Follow the repository's
documented secret setup, then confirm the database healthcheck passes, the one-shot migration/seed
service completes successfully before the API and worker start, health/readiness checks pass, and
seed data appears. Startup dependencies establish initial ordering only; API and worker processes
must still handle database unavailability after startup. Document required setup accurately in the
README; do not claim success if manual database edits are needed.
