---
description: "Implementation tasks for the MES parent-to-LMS journey"
---

# Tasks: MES Parent-to-LMS Journey

**Input**: Design documents in `specs/001-mes-learning-journey/`

**Prerequisites**: `plan.md`, `spec.md`; supporting design in `research.md`, `data-model.md`, `contracts/openapi.yaml`, and `quickstart.md`.

**Tests**: Required by FR-017 and Constitution Principle III. Write security-, concurrency-, rate-limit-, CORS-, trace-propagation, database-routing, and telemetry-privacy tests before their implementation. Use PostgreSQL for transaction guarantees.

**Organization**: Tasks are grouped by user story and ordered by dependency. Complete the foundational API controls before registering story routes.

## Format

Every task uses `- [ ] Tnnn [USn?] Description with exact file path`. Execute tasks one at a time in dependency order; do not dispatch implementation tasks concurrently. User-story phases require their story label; setup, foundation, and polish tasks do not.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the runnable full-stack workspace and documented toolchain.

- [X] T001 Create `apps/web/`, `apps/api/src/modules/{catalog,commerce,identity,learning}/`, `apps/api/src/platform/`, `apps/api/src/worker/`, `apps/api/tests/`, `db/migrations/`, and `db/seed/` as specified in `specs/001-mes-learning-journey/plan.md`.
- [X] T002 Initialize pinned Node.js/npm workspace scripts, the TypeScript Fastify API package, and typescript-eslint configuration in `package.json`, `package-lock.json`, `apps/api/package.json`, `apps/api/tsconfig.json`, and `eslint.config.mjs`; document the official TypeScript setup references and commands in `README.md`.
- [X] T003 Initialize React/Vite with TypeScript and Tailwind CSS in `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, and `apps/web/src/index.css`.
- [X] T004 Define required secrets, database settings, telemetry exporter settings, rate-limit window/max, CORS origins, and safe local defaults in `.env.example`.
- [X] T005 Create local PostgreSQL, API, and web services with a named database volume in `docker-compose.yml`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish persistence, API safety, observability, rate limiting, and CORS before any journey routes are exposed.

**Checkpoint**: The API can start with validated configuration, migrate/seed PostgreSQL, redact sensitive logs, initialize telemetry before routes, enforce request limits and explicit CORS, and protect routes deny-by-default.

- [X] T006 Implement PostgreSQL pool lifecycle, transaction helpers, parameterized query conventions, and shutdown in `apps/api/src/platform/database.ts`.
- [X] T007 Implement typed environment parsing and validation for database, session, OTLP, time-window limit, and CORS settings in `apps/api/src/platform/config.ts`.
- [X] T008 Implement request validation and consistent HTTP error mapping, including standard 429 responses, in `apps/api/src/platform/validation.ts` and `apps/api/src/platform/errors.ts`.
- [X] T009 Implement structured request-ID logging with redaction for passwords, invitation tokens, cookies, session credentials, and unnecessary student data in `apps/api/src/platform/logger.ts`.
- [X] T010 Create the core PostgreSQL schema and constraints for courses, lessons, parents, students, orders, order items, student slots, enrollments, invitations, and payments in `db/migrations/001_core.sql`.
- [X] T011 Add deterministic catalog and lesson seed data in `db/seed/catalog.sql`.
- [X] T012 Implement the one-shot migrate-and-seed command and package script in `apps/api/src/platform/migrate.ts` and `apps/api/package.json`.
- [X] T013 Add PostgreSQL health checks and Compose ordering for database → migration/seed → API → web in `docker-compose.yml`.
- [X] T014 Add failing tests for request tracing/HTTP metrics, defined business counters, telemetry redaction, per-user limit isolation/429/window replenishment, anonymous IP fallback, and allowed/disallowed credentialed CORS origins in `apps/api/tests/platform/operations.test.ts`.
- [X] T015 Add failing tests for deny-by-default authorization and explicit public routes in `apps/api/tests/platform/auth-guard.test.ts`.
- [X] T016 Implement OpenTelemetry SDK startup before Fastify route construction, register `@fastify/otel`, configure local console export and optional OTLP export, and expose low-cardinality HTTP request-count/duration/error instruments and business-counter helpers in `apps/api/src/platform/telemetry.ts` and `apps/api/src/app.ts`.
- [X] T017 Implement `@fastify/rate-limit` configuration so the verified student identity is available before its limiter hook runs, with anonymous-route client-IP fallback, configurable time window/max, and trusted-proxy-only forwarded IP handling in `apps/api/src/platform/rate-limit.ts` and `apps/api/src/app.ts`.
- [X] T018 Implement `@fastify/cors` with an explicit environment-configured origin allowlist and credentials only for approved origins in `apps/api/src/platform/cors.ts` and `apps/api/src/app.ts`.
- [X] T019 Implement Fastify app/server construction, health/readiness endpoints, graceful shutdown, telemetry/limiter/CORS registration before story routes, and the deny-by-default session guard in `apps/api/src/app.ts`, `apps/api/src/server.ts`, and `apps/api/src/platform/auth-guard.ts`.
- [X] T020 Implement cookie-backed student session creation, verification, clearing, and secure cookie options in `apps/api/src/modules/identity/session.ts`.
- [X] T021 Verify foundational platform tests against the Fastify app and local test configuration in `apps/api/tests/platform/operations.test.ts` and `apps/api/tests/platform/auth-guard.test.ts`.
- [X] T022 Add tests for W3C traceparent extraction, malformed/missing context, active trace/span log correlation, and dummy-secret redaction on success and failure paths in `apps/api/tests/platform/tracing.test.ts` and `apps/api/tests/platform/logger.test.ts`.
- [X] T023 Add tests proving fetch propagation is restricted to configured API origins, allowed CORS preflight accepts `traceparent`/`tracestate`, and unapproved origins do not receive trace headers in `apps/web/tests/telemetry.test.ts` and `apps/api/tests/platform/cors.test.ts`.
- [X] T024 Add tests for PostgreSQL read/write pool selection: mutations, transactions, checkout consistency, enrollment authorization, and read-after-write use primary; only explicitly lag-tolerant reads use read pool in `apps/api/tests/platform/database-routing.test.ts` and learning repository integration tests.
- [X] T025 Add an end-to-end trace assertion that one browser request creates browser, Fastify, and PostgreSQL spans in one W3C trace, with no bodies, invitation tokens, student data, or sensitive SQL attributes in captured telemetry in `apps/web/tests/parent-to-lms-tracing.spec.ts`.
- [X] T026 Implement the browser OpenTelemetry Web SDK and fetch instrumentation, W3C Trace Context propagation, always-on local sampling, explicit API-origin allowlist, and active trace ID attachment to frontend error reports in `apps/web/src/telemetry.ts` and `apps/web/src/main.tsx`; add compatible dependencies and configuration in `apps/web/package.json` and `.env.example`.
- [X] T027 Implement API-side W3C extraction and PostgreSQL client spans, initialize instrumentation before Fastify/`pg` imports, and correlate active trace/span IDs through the allowlisted logger without recording request/response bodies in `apps/api/src/platform/telemetry.ts`, `apps/api/src/platform/logger.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, and `apps/api/package.json`.
- [X] T028 Implement separate primary/write and read PostgreSQL pool interfaces, default `DATABASE_READ_URL` to `DATABASE_URL`, route only catalog browsing and explicitly lag-tolerant content reads to the read pool, and keep checkout, transactions, entitlement authorization, and read-after-write on primary in `apps/api/src/platform/config.ts`, `apps/api/src/platform/database.ts`, and affected repositories.
- [X] T029 Configure CORS preflight to allow W3C trace headers only for the explicit configured-origin allowlist and update approved local/deployment configuration in `apps/api/src/platform/cors.ts` and `.env.example`.
- [X] T030 Verify tracing, privacy, CORS propagation, and database-routing tests in `apps/api/tests/platform/` and `apps/web/tests/`; confirm one database target for both pools in `docker-compose.yml` and no collector or physical replica is introduced per `specs/001-mes-learning-journey/quickstart.md`.

---

## Phase 3: User Story 1 - Purchase a Course for a Student (Priority: P1) 🎯 MVP

**Goal**: A parent completes a server-priced mock purchase and receives an invitation without creating duplicate or partial access grants.

**Independent Test**: With seeded PostgreSQL, complete an eligible checkout and verify its paid order, price, pending enrollments, and invitation; invalid eligibility/payment and duplicate retries create no incorrect or duplicate grants.

### Tests for User Story 1 (write first)

- [X] T031 [US1] Add PostgreSQL integration tests for server-side prices, year eligibility, checkout success, and rollback on simulated payment failure in `apps/api/tests/commerce/checkout.integration.test.ts`.
- [X] T032 [US1] Add PostgreSQL idempotency/concurrency tests for same-key replay, changed-body rejection, in-progress retry, 255-character key limit, and malformed input not claiming a key in `apps/api/tests/commerce/checkout-idempotency.integration.test.ts`.
- [X] T033 [US1] Add tests for invitation entropy/hash-only persistence, expiry, and one live invitation per student slot in `apps/api/tests/identity/invitation-creation.integration.test.ts`.

### Implementation for User Story 1

- [X] T034 [US1] Implement catalog repository/service queries for courses, eligibility ranges, prices, and lessons in `apps/api/src/modules/catalog/catalog.repository.ts` and `apps/api/src/modules/catalog/catalog.service.ts`.
- [X] T035 [US1] Implement canonical checkout request hashing and idempotency-key validation in `apps/api/src/modules/commerce/idempotency.ts`.
- [X] T036 [US1] Implement the replaceable mock `PaymentGateway` interface and deterministic success/failure adapter in `apps/api/src/modules/commerce/payment-gateway.ts`.
- [X] T037 [US1] Implement checkout orchestration with validation-before-key-claim, server pricing, idempotency, atomic order/grant/invitation writes, no grants on payment failure, and order-created/paid business-counter updates in `apps/api/src/modules/commerce/checkout.service.ts`.
- [X] T038 [US1] Implement public catalog and checkout endpoints matching `specs/001-mes-learning-journey/contracts/openapi.yaml`, including 409/422/429 responses, in `apps/api/src/modules/catalog/catalog.routes.ts` and `apps/api/src/modules/commerce/checkout.routes.ts`.
- [X] T039 [US1] Implement the responsive Tailwind purchase form, validation feedback, mock-checkout confirmation, and invitation result in `apps/web/src/pages/CheckoutPage.tsx` and `apps/web/src/api/checkout.ts`.
- [X] T040 [US1] Run US1 PostgreSQL tests and configure reusable database fixtures in `apps/api/tests/setup/postgres.ts`.

**Checkpoint**: The parent journey works independently; prices are server-controlled and checkout produces one consistent order/grant set per request identity.

---

## Phase 4: User Story 2 - Onboard the Student (Priority: P2)

**Goal**: A student redeems a valid invitation, creates an account, activates all purchased enrollments atomically, and is signed in.

**Independent Test**: Redeem a valid invitation and verify the account, session, and active enrollments; invalid, expired, superseded, reused, duplicate-email, or concurrent claims do not create a second activation.

### Tests for User Story 2 (write first)

- [X] T041 [US2] Add PostgreSQL tests for valid/expired/used/superseded invitations, existing email, password hashing, and atomic activation in `apps/api/tests/identity/invitation-redemption.integration.test.ts`.
- [X] T042 [US2] Add a concurrent redemption test proving exactly one activation wins in `apps/api/tests/identity/invitation-concurrency.integration.test.ts`.
- [X] T043 [US2] Add login/logout/session-cookie tests for invalid credentials and credential redaction in `apps/api/tests/identity/session.integration.test.ts`.

### Implementation for User Story 2

- [X] T044 [US2] Implement token generation, hash lookup, invitation state checks, bounded expiry, and invitation-issued business-counter updates in `apps/api/src/modules/identity/invitation.repository.ts` and `apps/api/src/modules/identity/invitation.service.ts`.
- [X] T045 [US2] Implement atomic invitation redemption, password hashing, unique-email handling, slot linking, enrollment activation, and redemption/activation-failure business-counter updates without sensitive attributes in `apps/api/src/modules/identity/onboarding.service.ts`.
- [X] T046 [US2] Implement public invitation read/activation and login/logout routes matching `contracts/openapi.yaml` in `apps/api/src/modules/identity/identity.routes.ts`.
- [X] T047 [US2] Implement responsive invitation preview/onboarding UI, password validation, duplicate-account sign-in direction, and activation feedback in `apps/web/src/pages/InvitationPage.tsx` and `apps/web/src/api/identity.ts`.
- [X] T048 [US2] Implement responsive login/logout screens and session-aware client state in `apps/web/src/pages/LoginPage.tsx` and `apps/web/src/auth/session.ts`.
- [X] T049 [US2] Run US2 invitation, concurrency, and session integration tests against PostgreSQL in `apps/api/tests/identity/invitation-redemption.integration.test.ts`, `apps/api/tests/identity/invitation-concurrency.integration.test.ts`, and `apps/api/tests/identity/session.integration.test.ts`.

**Checkpoint**: A purchased student slot can be claimed exactly once; activation creates authenticated access for all of its purchased courses.

---

## Phase 5: User Story 3 - Access Entitled Learning (Priority: P3)

**Goal**: An authenticated student views only lessons covered by active enrollments, with authorization checked on every request.

**Independent Test**: An enrolled student opens a lesson; anonymous, signed-out, cross-student, pending, and unenrolled requests receive no protected content and do not reveal resource existence.

### Tests for User Story 3 (write first)

- [X] T050 [US3] Add PostgreSQL authorization matrix tests for active, pending, revoked, cross-student, and unknown lessons/courses in `apps/api/tests/learning/entitlement-authorization.integration.test.ts`.
- [X] T051 [US3] Add route tests for unauthenticated access, enrollment changes taking effect on the next request, and no client-supplied student identity in `apps/api/tests/learning/protected-routes.integration.test.ts`.

### Implementation for User Story 3

- [X] T052 [US3] Implement current-student enrollment and lesson queries in `apps/api/src/modules/learning/learning.repository.ts`.
- [X] T053 [US3] Implement centralized lesson/course authorization using session identity and current ACTIVE enrollment, with uniform not-found behavior and denied-access business-counter updates without student identifiers in `apps/api/src/modules/learning/authorization.service.ts`.
- [X] T054 [US3] Implement protected `/me`, enrollment, course-lesson, and lesson-detail endpoints matching `contracts/openapi.yaml` in `apps/api/src/modules/learning/learning.routes.ts`.
- [X] T055 [US3] Implement responsive student dashboard, course lesson list, lesson view, and signed-out routing in `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/CourseLessonsPage.tsx`, `apps/web/src/pages/LessonPage.tsx`, and `apps/web/src/router.tsx`.
- [X] T056 [US3] Run US3 entitlement and protected-route integration tests against PostgreSQL and verify no route trusts a client-supplied student ID in `apps/api/tests/learning/entitlement-authorization.integration.test.ts` and `apps/api/tests/learning/protected-routes.integration.test.ts`.

**Checkpoint**: Every LMS read enforces current enrollment server-side; cross-student and unentitled lesson requests fail closed.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete application, document the implementation, and add optional T2 reliability work only if time permits.

- [X] T057 Add web static-serving/reverse-proxy configuration and web Dockerfile in `apps/web/nginx.conf` and `apps/web/Dockerfile`.
- [X] T058 Add the API Dockerfile and production-mode startup configuration in `apps/api/Dockerfile`.
- [X] T059 Add browser end-to-end coverage for parent checkout → student onboarding → entitled LMS access at mobile and desktop viewport sizes in `apps/web/tests/parent-to-lms.spec.ts`.
- [X] T060 Document architecture, setup, test/lint commands, telemetry signals/export configuration, rate-limit policy/configuration, CORS origins, security/privacy limitations, production alert signals and runbooks, per-deployment authorized log access and finite log/trace retention, trace sampling policy, trade-offs, AI contributions, and future worker seams in `README.md`.
- [X] T061 Run lint, unit/integration/E2E tests, operations-security checks, and the clean-checkout Compose walkthrough from `specs/001-mes-learning-journey/quickstart.md`; record verified commands and outcomes in `README.md`.
- [X] T062 **T2 only if time remains:** Add the transactional outbox schema and indexes in `db/migrations/002_outbox.sql`.
- [X] T063 **T2 only if time remains:** Add PostgreSQL tests for checked outbox enqueue, duplicate dedupe, concurrent claims, lease expiry recovery, retry, message identity, and sanitized trace-context persistence/extraction/link behavior in `apps/api/tests/worker/outbox.integration.test.ts`.
- [X] T064 **T2 only if time remains:** Implement short-transaction outbox claim/lease/completion/retry operations in `apps/api/src/worker/outbox.repository.ts`.
- [X] T065 **T2 only if time remains:** Implement idempotent email/reminder handlers with invitation state rechecks, token rotation, sanitized W3C context persistence/extraction and retry span links, and external delivery outside transactions in `apps/api/src/worker/outbox.worker.ts`, `apps/api/src/worker/outbox.repository.ts`, and `apps/api/src/worker/email-sender.ts`.
- [X] T066 **T2 only if time remains:** Add the migration-gated worker Compose service and document at-least-once delivery/retry behavior in `docker-compose.yml` and `README.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Start immediately; foundational work depends on the workspace and pinned toolchain.
- **Foundational (Phase 2)**: Blocks all user stories. Operations tests (T014–T015, T022–T025) precede instrumentation, routing, and CORS implementation (T026–T029); complete T030 before exposing journey routes.
- **US1 (Phase 3)**: Depends on the database and API foundation; creates orders, student slots, pending enrollments, and invitations.
- **US2 (Phase 4)**: Depends on US1 invitation/order data; activates student accounts and enrollments.
- **US3 (Phase 5)**: Depends on activated student identities and enrollments; can use fixtures for isolated authorization tests.
- **Polish/T2 (Phase 6)**: E2E and clean-checkout validation follow US1–US3. T2 outbox tasks are optional and must not delay the required journey or operations controls.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; suggested MVP checkpoint.
- **US2 (P2)**: Requires purchased invitations from US1.
- **US3 (P3)**: Requires active student sessions/enrollments from US2; authorization can also be independently tested with seeded fixtures.

### Sequential Execution Policy

- Execute exactly one task at a time in ascending task/dependency order. Do not launch parallel agents, concurrent implementation jobs, or overlapping test/build jobs against the API or database.
- Within each phase, finish and verify a task before starting the next. Preserve the existing phase gates and user-story dependencies.
- Required concurrency and idempotency tests still exercise concurrent requests as test scenarios; this is intentional product-behavior validation, not parallel task execution.

## Sequential Examples

### User Story 1

```text
1. Write and verify T031, then T032, then T033.
2. Implement and verify T034, then T035.
3. Implement T036, then transactional checkout orchestration in T037.
4. Implement T038 API routes, then T039 browser UI against the OpenAPI contract.
5. Run T040 before starting US2.
```

### User Story 2

```text
1. Write and verify T041, then T042, then T043.
2. Implement T044 invitation persistence, then T045 atomic onboarding, then T046 routes.
3. Build T047 invitation UI, then T048 login/logout UI.
4. Run T049 before starting US3.
```

### User Story 3

```text
1. Write and verify T050, then T051.
2. Implement T052 repository queries, then T053 centralized authorization, then T054 protected routes.
3. Build T055 dashboard/lesson UI against the OpenAPI contract.
4. Run T056 before final cross-cutting validation.
```

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases, including required browser/API/database tracing, privacy tests, read/write pool routing, per-user time-window limits, and trace-aware CORS.
2. Complete US1 and validate the purchase independently against PostgreSQL.
3. Continue through US2 and US3; US1 alone is a checkpoint, not the final deliverable.
4. Complete Compose, documentation, and clean-checkout/browser verification.
5. Add optional T2 outbox work only if time remains.

### Incremental Delivery

Deliver runnable increments in order: foundation → purchase → onboarding → entitled LMS → documentation and clean-checkout validation. Keep critical tests first and preserve the ability to run the application after each slice.

## Notes

- All tasks use a checkbox, unique task ID, applicable `[USn]` labels, and exact repository file paths; none are marked for parallel execution.
- Tasks are executed one at a time; do not overload the API or database with overlapping task, test, or build runs.
- Concurrency tests may deliberately issue simultaneous requests to validate race-safety; run those tests only as the active task, not alongside other work.
- Rate-limit values remain configurable and should use conservative local defaults; authenticated keys come from verified student identity, anonymous keys use trusted client IP, and forwarded IPs are trusted only behind a known proxy.
- Validate Fastify plugin versions against the selected Fastify major when dependencies are pinned.
- Keep enrollment authorization, checkout consistency, transactions, and read-after-write operations on the primary; replicas may serve only explicitly lag-tolerant reads. Local Compose uses one database instance for both pool targets.
- Propagate W3C trace context only to approved API origins. Trace IDs are diagnostic and never authorization inputs; no personal data, secrets, raw invitation URLs, bodies, or baggage may be emitted. Checkout and later onboarding remain separate traces. Outbox/worker propagation is conditional on T2 implementation.
- Do not deploy a collector, dashboards, or alerting service for this mock. Production deployments document finite log/trace retention, access restrictions, sampling policy, and alert/runbook guidance.
- Never run `docker compose down -v` against a checkout whose local database data must be preserved; use the disposable-clone procedure in `quickstart.md`.
