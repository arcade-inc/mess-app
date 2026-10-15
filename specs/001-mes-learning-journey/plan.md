# Implementation Plan: MES Parent-to-LMS Journey

**Branch**: `001-mes-learning-journey` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-mes-learning-journey/spec.md`; sequencing and time-box adapted from `docs/plan.md`, with architecture from `docs/blueprint-draft.md`.

## Summary

Deliver the parent purchase → student onboarding → entitlement-gated LMS flow as a small,
locally runnable web application. Follow the existing design: React/Vite web client, Node.js with
TypeScript and Fastify API, PostgreSQL, and a modular-monolith boundary. Add W3C distributed tracing
across browser, API, and PostgreSQL operations, and keep separate read/write database paths that may
share one local instance. Build in runnable vertical slices and prioritize T1 journey,
security/reproducibility, and core tracing; pursue T2 idempotency and outbox reliability within the
stated 3–4 hour time-box. Real payments, broker, parent portal, refunds, and production observability
infrastructure remain out of scope; production alerting, sampling, access, and retention policies
are documented for later deployment decisions.

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (pin in the toolchain); SQL migrations
**Primary Dependencies**: React + Vite + Tailwind CSS; TypeScript + typescript-eslint; Fastify with `@fastify/otel`, `@fastify/rate-limit`, and `@fastify/cors`; OpenTelemetry browser/Node SDKs, fetch and PostgreSQL instrumentation, W3C Trace Context propagation; PostgreSQL client; request validation; Docker Compose with health/completion dependency conditions
**Storage**: PostgreSQL with distinct read and write pool interfaces; local Compose points both at one instance and deployed environments may route lag-tolerant reads to replicas. Transactional records cover orders, student slots, enrollments, invitations, and lessons; optional T2 leased outbox records carry sanitized W3C trace context with `locked_until`.
**Testing**: Automated unit and integration tests; typescript-eslint lint command; critical
transaction/concurrency guarantees run against real PostgreSQL; browser test for the complete journey
and browser/API/database trace propagation; failure-path log/trace secret-scrubbing tests
**Target Platform**: Local Docker Compose environment; browser-based web application
**Project Type**: Full-stack web application (single-page frontend plus API)
**Performance Goals**: Responsive course browsing and completion of each primary journey in under
3 minutes; responsive page layouts across narrow/mobile and desktop browser widths; correctness
under specified concurrent activation and checkout retries
**Constraints**: 3–4 hour exercise; mock payment only; no real broker or production observability
infrastructure; student access must be enrollment-derived; preserve single-use hashed invitations;
application must start from a clean checkout with one documented command; validate checkout before
claiming a maximum-255-character idempotency key; use typescript-eslint for TypeScript linting;
per-user request rate limiting over a configured time window; explicit CORS origin allowlist; no
transaction is held during external network calls; telemetry excludes secrets and
student-identifying/high-cardinality attributes
**Scale/Scope**: Small demonstration; three seeded courses with sample lessons; multiple course
enrollments per student slot; preserve module/service seams and annotate future async/worker
boundaries; no message broker, collector, dashboard, alerting service, or production-scale claim.
Trace the core browser/API/database journey; add outbox/worker propagation when those optional
components are implemented.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / constraint | Gate result | Evidence in this plan |
|---|---|---|
| Ship the complete core journey | PASS | P1 purchase, P2 onboarding, P3 LMS; runnable slices and fresh-checkout walkthrough |
| Entitlement is the authorization boundary | PASS | LMS requests use session identity and active enrollment; denial tests are mandatory |
| Test risky behavior first | PASS | Write failing critical tests before implementation; use real PostgreSQL for transaction/concurrency guarantees |
| Protect identity, secrets, and children's data | PASS | Hash passwords/tokens; minimize collection; redact logs; fail closed; production compliance explicitly out of scope |
| Explicit seams and smallest adequate design | PASS | Modular monolith and payment/email interfaces; defer broker, real payment, and portal |
| Product constraints and reproducibility | PASS | React + Node/TypeScript/Fastify + PostgreSQL; Docker Compose; mock checkout |
| Clarified frontend and code-quality requirements | PASS | Tailwind CSS responsive UI and typescript-eslint lint command are required by FR-020/FR-021 |
| Fastify telemetry, per-user rate limiting, and CORS | PASS | FR-024/FR-025 require OTel technical/business signals, configured per-user request windows, and an explicit CORS allowlist; see research decisions and quickstart checks |
| W3C distributed tracing and telemetry privacy | PASS | FR-027 and FR-030–FR-032 require allowlisted/redacted logs and browser/API/database trace propagation, trace-safe CORS, no sensitive baggage, and explicit deployment sampling/retention; no collector is required locally |
| PostgreSQL read/write separation | PASS | FR-026 uses separate read/write access paths, permits one local database target, and routes enrollment authorization/read-after-write operations to the primary |
| Future event-driven/scaling preparation | PASS | FR-022 keeps module and replaceable-service seams, documents likely async boundaries in code and README, and adds no broker or production-scale infrastructure |
| Delivery and quality | PASS | Runnable vertical slices, automated checks, README, fresh-checkout journey test |

No constitution violations identified. T2 reliability work is conditional on the time-box and must
not displace the T1 journey, access-control guarantees, Docker validation, or README.

**Post-design re-check**: PASS. Authorization is global and deny-by-default with an explicit
public allowlist; a single learning-module function owns lesson authorization, and session claims
carry identity only while enrollment is checked from PostgreSQL per request. The optional T2 worker
uses a short claim/lease transaction and sends outside transactions. Compose gates API/worker startup
on a one-shot migration/seed service after database health. Tailwind CSS and typescript-eslint are
explicitly scoped frontend/static-check dependencies. Future scale preparation is limited to
replaceable seams, targeted code comments, and README guidance; no broker is introduced. These
choices preserve all principles. Browser telemetry propagates W3C trace context only to configured
API origins; API and PostgreSQL spans share that context, and logs correlate through allowlisted
trace/span IDs. Enrollment authorization and read-after-write queries use the primary; only
explicitly lag-tolerant reads use the read path. Outbox/worker context propagation is conditional on
the optional T2 implementation. The rate limiter keys authenticated requests by student identity
and uses the trusted client IP for unauthenticated routes; CORS allows only configured web origins,
credentials, and trace headers for those origins. No external telemetry service or physical local
replica is required for validation.

## Project Structure

### Documentation (this feature)

```text
specs/001-mes-learning-journey/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── tasks.md              # Dependency-ordered implementation tasks
```

### Source Code (repository root)

```text
apps/
├── web/                       # React/Vite/Tailwind client and browser tracing
│   └── src/telemetry.ts        # Web SDK, W3C propagation, approved API-origin allowlist
└── api/
    ├── src/
    │   ├── modules/            # catalog, commerce, identity, learning
    │   ├── platform/           # config, read/write DB pools, telemetry, safe logger, auth
    │   └── worker/             # optional T2 outbox relay and trace propagation
    └── tests/                  # unit and PostgreSQL integration/security tests
db/
├── migrations/
└── seed/
docker-compose.yml
.env.example
README.md
docs/                      # Assignment, blueprint, and build plan
```

Compose dependency order: database (healthcheck) → one-shot migrate + seed → API and optional
worker (`service_completed_successfully`) → web. Long-lived services still handle later database
outages; dependency ordering only gates initial startup.

The API's global auth guard is deny-by-default. Public bypasses are limited to course catalog,
checkout, invitation read/activation, login, and health/readiness. Checkout validates request and
eligibility before claiming a maximum-255-character idempotency key; a new user attempt gets a new
key, a same-key/different-body request returns 422, and a simultaneous in-progress retry gets a
retryable 409. Lesson authorization is centralized and reads active enrollment on every request;
tokens/sessions contain student identity but no entitlement claims.

**Structure Decision**: Use the repository layout prescribed by `docs/blueprint-draft.md`:
one React/Vite/Tailwind web client and one API organized as a modular monolith, plus database migrations/seeds.
Feature modules communicate through service interfaces and do not query each other's tables.
External operations remain behind replaceable interfaces; comments mark candidate asynchronous or
worker boundaries without adding generic event infrastructure. PostgreSQL outbox/worker work remains
the separately scoped, optional T2 reliability slice and does not require a message broker. Browser
telemetry uses the Web SDK and fetch instrumentation with an explicit API-origin propagation
allowlist; the Node SDK and Fastify/PostgreSQL instrumentation start before instrumented modules are
loaded. Local spans export to console; OTLP remains optional. A separate read pool may target a
replica, but enrollment/authorization and read-after-write queries use the write pool. No physical
replica is added to local Compose.

## Complexity Tracking

No constitution violations or additional architectural projects are proposed. The API, web client,
database, and optional worker are the minimum components in the existing blueprint; the worker
shares the API codebase and is only included if T2 is reached.
