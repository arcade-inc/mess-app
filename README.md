# MES Mock Journey: Parent → Student → LMS

A small full-stack demonstration of one learning journey:

**A parent selects a course → the student activates an invitation → the student opens lessons covered by an active enrollment.**

This is a mock checkout, not a payment product. See [deliberate limitations](#security-and-limitations) before treating it as production-ready.

The current implementation and blueprint alignment are summarized in [Implementation status and roadmap](docs/implementation-status.md). That document distinguishes shipped behavior from production follow-ups and records where the initial blueprint has since been refined.

## Run locally with Docker Compose

Requirements: Docker Engine with Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8080>. Compose waits for PostgreSQL health, runs migrations and seed data once, then starts the API and web server. The seeded catalog contains Maths, English, and Science with sample lessons. No manual SQL is required.

The single-origin nginx server serves the React app and proxies `/api/*` to Fastify. Fastify itself listens on port 3000 inside the Compose network; PostgreSQL is not published to the host. `/api/health` and `/api/ready` are proxied liveness/readiness checks.

To try the journey: select a course and fill in the parent and learner details; complete the mock purchase; open the invitation shown on the confirmation page; activate a student account; continue to the dashboard and open a lesson. Sign out and verify that navigating directly to the old lesson URL returns to sign-in.

The default `.env.example` values and JWT key are for local development only. Supply a new secret and deployment-appropriate origins before any non-local use. Compose stores database data in a named volume. Do not run `docker compose down -v` against a checkout whose data must be retained; only use it in a disposable copy when deliberately removing that copy's database volume.

## Development and checks

Install the pinned workspace dependencies with `npm ci`. Run `npm run dev:api` and `npm run dev:web` in separate terminals when a PostgreSQL server is available at the configured `DATABASE_URL`; Vite proxies `/api` to the local API. The example database URL assumes PostgreSQL is reachable on the host at port 5432.

Useful commands from the repository root:

```bash
npm run build
npm run lint
npm test --workspace @mes/web
npm test --workspace @mes/api
```

API integration tests use real PostgreSQL and are skipped unless `TEST_DATABASE_URL` is set. For example:

```bash
TEST_DATABASE_URL='postgres://mes:local-only-change-me@localhost:5432/mes' npm test --workspace @mes/api
```

The browser acceptance test needs the Compose app running at `http://localhost:8080` and Playwright's Chromium browser installed:

```bash
npx playwright install chromium
npm run test:e2e --workspace @mes/web
```

It runs the parent purchase → invitation activation → entitled lesson flow in desktop and mobile Chromium viewports, checks for horizontal overflow, and verifies signed-out navigation returns to sign-in. Run it only against a disposable local/test environment: each run creates orders and student accounts with random email addresses, which remain in that test database. Failure traces in `apps/web/test-results/` can contain test form values and invitation URLs; keep them private and do not upload them as general diagnostics. Set `E2E_BASE_URL` only to another disposable test deployment.

The browser→Fastify→PostgreSQL trace assertion uses a test-only OTLP receiver hosted by the Playwright process. Port `4318` must be free. Start the app with the tracing override, run the trace spec, then stop that Compose project (do not remove its volume):

```bash
docker compose -f docker-compose.yml -f docker-compose.tracing.yml -p mes-tracing up -d --build
npm run test:e2e --workspace @mes/web -- --workers=1 --grep 'one browser catalog request'
docker compose -f docker-compose.yml -f docker-compose.tracing.yml -p mes-tracing stop
```

The override points API and browser exporters at the local test receiver; it adds no collector service to the normal application. It tests a catalog request only, so no personal or invitation data is involved.

## Architecture and access boundary

```text
Browser ──same-origin /api──▶ nginx ──▶ Fastify API ──▶ PostgreSQL
   │                                          │
   └── React/Vite SPA                         ├── catalog
                                              ├── commerce
                                              ├── identity
                                              └── learning
                                               ▲
                         outbox worker ────────┘
```

The API is a modular monolith. Catalog reads may use the configured read pool; writes, transactions, and learning authorization use the primary pool. Compose points both pool URLs at its one PostgreSQL service. No physical replica is required locally. The migration-gated outbox worker shares the API image and database, and starts only after migrations/seeds complete.

The core data relationship is:

```text
Order → Student slot → pending enrollment(s) → invitation
Invitation redemption → student account → active enrollment(s)
Student session + current ACTIVE enrollment → lesson access
```

Authentication identifies the student; it does not grant course access by itself. Every learning read checks current enrollment server-side, using the session identity rather than a client-supplied student ID. A denied or unknown course/lesson returns the same not-found response. The lesson-denial counter has no student or resource labels.

## Implemented journey

- Parent/guardian contact details are grouped and validated, including email confirmation. Checkout has a separate Visa, Mastercard, or Apple Pay **mock** payment step; it collects no card details and makes no real charge.
- Successful mock checkout shows the parent email, invitation links, and a simulated-email notice. The access invitation expires after 7 days. A day-7 reminder is queued, but the included local email sender is disabled/no-op, so no email is actually delivered locally.
- A learner can create an account from an invitation, or add another purchased course to an existing account. Existing-account claims require a normalized learner-name match, do not compare school year, and resume automatically after sign-in using the URL's `activationCode`.
- Student course and lesson reads require a current active enrollment. The full journey is covered by API/web tests and a browser acceptance flow; see [validation](#validation-record) and the linked status document for the implementation-to-spec map.

## Configuration, telemetry, and operations

Configuration is documented in `.env.example` and validated by the API at startup:

| Setting | Purpose |
|---|---|
| `DATABASE_URL` | Primary/write PostgreSQL pool |
| `DATABASE_READ_URL` | Read pool; defaults to `DATABASE_URL` |
| `JWT_SECRET` | Session signing secret; minimum 32 characters |
| `CORS_ORIGINS` / `WEB_ORIGIN` | Explicit browser origins and invitation-link origin |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_TIME_WINDOW` | Request maximum and per-user window |
| `TRUST_PROXY` | Explicit trusted proxy IP/CIDR list; empty by default |
| `OTEL_SERVICE_NAME` | API service resource name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OTLP HTTP collector base URL; local default is console export |
| `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` | Optional browser trace-export endpoint |

Rate limits are keyed by verified student ID after sign-in and by the socket client IP for anonymous routes. Forwarded IP headers are trusted only when `TRUST_PROXY` explicitly names the proxy. CORS allows only configured origins and credentials only for those origins. The browser uses same-origin `/api` requests through nginx or Vite; trace headers are not authentication credentials.

The API emits HTTP request count, duration, and error metrics plus low-cardinality purchase, invitation, activation-failure, and lesson-denial business counters. Locally, traces and metrics are exported to the console; setting `OTEL_EXPORTER_OTLP_ENDPOINT` enables OTLP HTTP export. Browser fetch instrumentation propagates W3C trace context only to the current application origin. Checkout and later invitation activation are separate user journeys/traces.

Do not add request/response bodies, passwords, cookies, invitation tokens, student names/emails/IDs, or personal data to logs, spans, baggage, or metric attributes. Invitation tokens are redacted from browser telemetry URLs; PostgreSQL instrumentation records parameterized query text, not bound values. Verify any future instrumentation or exporter before enabling it with real student data.

### Production operations guidance (not deployed here)

This repository does not include a collector, dashboard, alerting service, or on-call integration. Before deployment, assign an operations owner and configure:

- Alerts for sustained API 5xx/latency increases, PostgreSQL unavailability/connection exhaustion, repeated migration failures, elevated 429 rates, and unusual invitation/activation failure or lesson-denial rates.
- Runbooks to check API readiness and recent deploys, database health/pool pressure, rate-limit configuration, and the relevant sanitized trace/request ID; never troubleshoot by requesting raw invitation tokens or student credentials.
- Per-deployment log and trace access restricted to authorized support/operations staff, audited where supported. Set and enforce finite retention (proposed starting point: at most 30 days for application logs and 14 days for traces), then revisit with security, privacy, and legal owners.
- Parent-based production trace sampling (suggested initial ratio: 5%) with a documented incident override. Keep local validation sampling always-on. Do not promise tail sampling unless a collector that implements it is deployed.

These are rollout recommendations, not active production controls in this mock.

## Security and limitations

- Checkout uses a deterministic mock payment gateway. No card details or real charges are accepted.
- Passwords are hashed with Node.js; invitation secrets are high-entropy, expiring, single-use, and stored as hashes.
- Student sessions are one-hour stateless JWTs in an HttpOnly, SameSite cookie; production mode sets Secure. Logout clears the browser cookie but cannot revoke a copied JWT before expiry.
- Parent accounts, real email delivery/provider integration, reminder delivery, password reset, MFA, refresh/revocation, refunds, administration, and video lessons are not implemented.
- Invitation links are bearer credentials: anyone holding a live link may claim it. Production should bind invitations to a verified student email and establish consent, retention, deletion, and safeguarding workflows.
- This mock is not a claim of compliance with UK GDPR, the ICO Children's Code, or a production security standard. Reassess privacy, security, threat model, and operational controls before real use.

## Key decisions

The assignment prioritizes a clear, runnable journey over production completeness. The main choices favor correctness at purchase and access boundaries while keeping deployment small:

| Choice | Reason and accepted tradeoff |
|---|---|
| Modular monolith + PostgreSQL | Keep purchase and activation changes transactional without distributed coordination. Modules share a deployment and database. |
| Native UUID identifiers | Expose opaque IDs without sequential record numbers. Keys and indexes are larger than integers; UUIDs do not replace authorization. |
| Student slots + separate enrollments | Purchase for a child before an account exists, then activate several courses through one invitation. More tables preserve the distinction between purchase, identity, and access. |
| Integer minor units + price snapshots | Avoid floating-point money calculations and preserve the purchased price after catalog changes. Currency-specific rules would need expansion beyond this GBP mock. |
| Current enrollment checks on the primary | Revocation must affect subsequent learning reads. Accept a database lookup instead of potentially stale cached or JWT-embedded permissions. |
| Atomic redemption + idempotent checkout | Database transactions and uniqueness protect against concurrent activation and repeated purchases. This adds explicit retry and conflict handling. |
| Hashed invitations + HttpOnly session cookie | Avoid storing usable invitation secrets in the invitation table or exposing the session token to JavaScript. Original links cannot be recovered from hashes, and stateless sessions cannot be immediately revoked. |
| Transactional outbox without a broker | Commit notification intent with the purchase, then have a separate worker poll and claim the PostgreSQL outbox rows. This is a brokerless approximation of an event-driven consumer: it processes messages and records sent, skipped, or retry states. PostgreSQL stands in for a broker, and the local email sender is disabled, so messages are not delivered. This demonstrates the pattern, not production event delivery. |

See [Design decisions and alternatives](docs/decisions.md) for the context, alternatives, costs, and conditions that would justify revisiting these choices.

## AI tools and development artefacts

AI assistants were used during development to support planning, implementation, test drafting, and debugging/review. Their suggestions and generated code were treated as drafts: changes were reviewed against the requirements and verified with the build, lint, and test commands recorded in the [validation record](#validation-record).

Relevant retained artefacts are available in the repository:

- [Build plan](docs/plan.md) and [implementation status](docs/implementation-status.md) — scope, workflow, and progress.
- [Architecture notes](docs/architecture.md) and [design decisions](docs/decisions.md) — design context and tradeoffs.
- [Feature specifications and plans](specs/) — feature requirements, implementation plans, tasks, and supporting research.


## Trade-offs and future seams

The modular monolith, PostgreSQL transactions, mock payment gateway interface, and primary-database entitlement check are intentionally small and testable. A payment provider could replace the mock gateway behind its interface. Paid checkout writes a purchase-confirmation outbox row and one invitation-reminder row per student slot in the same transaction as the order and invitations. The reminder is due seven days after purchase. When an enabled sender processes a confirmation or reminder, the worker creates a fresh seven-day invitation, supersedes the previous link, and includes the new URL in the email. To make retries reuse the same URL, the outbox temporarily stores an authenticated-encrypted token envelope; the database stores only the invitation hash, and the encrypted retry material is scrubbed after successful delivery. The encryption key is derived from `JWT_SECRET`, so rotating that secret while email messages are pending makes those encrypted retry payloads undecryptable. The included local sender is disabled/no-op: it skips email work without rotating checkout links. A real provider is not configured in this mock.

Outbox delivery is at-least-once, not exactly-once. A provider should use the stable outbox row ID as its idempotency key where supported; a rare duplicate message remains possible after delivery succeeds but before the worker records completion. Retries use bounded exponential delay and stop in `FAILED` after five attempts; the worker may process rows in any order, so consumers must not rely on message ordering. Expired two-minute leases are reclaimed after worker interruption. Trace context stores only validated `traceparent` and optional `tracestate`, never baggage; retry spans link to the original trace. The worker does not implement an email provider, broker, or production delivery guarantee. With the local no-op sender, due email rows are skipped and reminders are not delivered.

The read-pool interface is present for future lag-tolerant reads, but local Compose points it to the primary. Authorization and read-after-write operations must remain on the primary so a stale replica cannot preserve revoked access or hide a newly activated enrollment.


## Validation record

Code-only checks were rerun on 2026-10-15. No database or container was started, stopped, or modified for this check.

| Check | Result |
|---|---|
| `npm run build` | Passed for API and web workspaces |
| `npm run lint` | Passed |
| `npm test --workspace @mes/web` | Passed: 22 tests |
| `env -u TEST_DATABASE_URL npm test --workspace @mes/api` | Passed: 25 tests; 20 PostgreSQL integration tests skipped because no test database was configured |

These checks do not revalidate Compose startup, PostgreSQL integration, or browser end-to-end behavior. The full-stack results below are previously recorded results reviewed on 2026-10-15; those checks were not rerun because this update did not touch databases or containers.

### Full-stack validation record — reviewed 2026-10-15

The recorded full-stack run used a disposable source copy with no `.env` and a new named PostgreSQL volume. A temporary Compose override published PostgreSQL on host port 15432 for the host-side integration suite; the app itself stayed on its normal port 8080. The temporary `compose.e2e.override.yml` used for that run is not present in the current checkout. The command row shows the current project-name pattern for a future disposable rerun; its results are retained from the prior validation.

| Check | Result |
|---|---|
| `docker compose -f docker-compose.yml -f compose.e2e.override.yml -p mes-clean-20261015 config` and `docker compose -f docker-compose.yml -f compose.e2e.override.yml -p mes-clean-20261015 up -d --build` | Previously passed; DB healthy, migration/seed completed, API and nginx healthy |
| `curl http://localhost:8080/api/ready`, `/api/courses`, and `/healthz` | Passed; readiness and catalog returned 200, nginx health returned 204 |
| `npm run build` | Passed for API and web workspaces |
| `npm run lint` | Passed |
| `TEST_DATABASE_URL=<disposable PostgreSQL URL> npm test` (from `apps/api`) | Passed: 43 tests, including pool-routing, PostgreSQL integration, outbox schedule/lease/retry/trace tests, and operations/security tests |
| `npm test --workspace @mes/web` | Passed: 12 tests |
| `npm run test:e2e --workspace @mes/web -- --workers=1` | Passed: 2 desktop/mobile journey runs plus 1 desktop-only browser→Fastify→PostgreSQL trace assertion; trace test is intentionally skipped in mobile project |

Phase 2 routing and trace verification details were reviewed on 2026-10-15. `docker-compose.yml` configures the primary and read URLs to the same local PostgreSQL service; no replica or normal-runtime collector was added. The trace test uses the opt-in `docker-compose.tracing.yml` profile with an ephemeral OTLP receiver in the Playwright test process. The isolated `mes-phase2-red` Compose project used its own named volume and was stopped after validation; no `docker compose down -v` command was run. The pre-existing `mess-app-db-1` service and its data were not modified.

Optional T2 outbox validation details were reviewed on 2026-10-15. The recorded run used the isolated `mes-phase6-final` PostgreSQL volume and a separate `mes-phase6-trace` volume for the browser trace check. Both Compose projects were stopped after validation; their named volumes were preserved, and the pre-existing database was not touched. The outbox worker started only after the migration service completed, and `/api/ready` returned 200. The API integration suite passed 43 tests, including transactional enqueue rollback, deduplication, seven-day reminder scheduling, concurrent claim exclusivity, expired-lease recovery and exhaustion, retry-stable encrypted invitation tokens, bounded retries, reminder rotation/state rechecks, safe trace context, and worker send/failure behavior. The web unit suite passed 12 tests; the desktop/mobile journey passed twice, and the opt-in desktop browser→Fastify→PostgreSQL trace assertion passed. Build, lint, and `git diff --check` also passed.
