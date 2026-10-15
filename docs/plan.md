# Build Plan

> Companion to `BLUEPRINT.md`. Time box: **3–4 hours**. The main risk is discipline, not design: scope creep in T2 that starves Docker and the README.

## 1. Scope tiers

| Tier | Contents | Budget |
|---|---|---|
| **T1: must ship** | Happy path in Docker; enrollment-based access (no IDOR); hashed single-use expiring invitations; server-side pricing and year validation; password hashing and cookie auth; seed data; `/health` and `/ready`; Fastify OpenTelemetry technical/business signals; per-user time-window request limits; explicit CORS allowlist; README | ~3h |
| **T2: strong signal** | Idempotent checkout; payment state machine with mock gateway; outbox + worker (confirmation email, then reminders); test-first on invitation/entitlement/idempotency; concurrency tests; helmet and log redaction | +1h |
| **T3: document only** | Real Stripe + webhooks + reconciliation; broker; refunds; parent portal and "ask my parent"; k6 numbers; Prometheus/tracing; GDPR flows; SSR landing page | README roadmap |

**Cut order if time runs short** (cut from the bottom): k6 script → reminders (schema and outbox stay) → email via outbox (log inline instead) → idempotency. **Never cut:** entitlement access control, hashed single-use tokens, required Fastify telemetry/rate-limit/CORS setup, fresh-clone Docker test, README.

## 2. Time budget

| Time | Work |
|---|---|
| 0:20 | Commit `BLUEPRINT.md`, `PLAN.md`, `CLAUDE.md`; AI critique of the plan, record accepted/rejected points |
| 0:30 | Slice 1: compose, DB, migrations, seed, `/ready` |
| 0:20 | Slice 2: catalog API + product page |
| 0:40 | Slice 3: checkout, mock gateway, invitations |
| 0:30 | Slice 4: activation + auth |
| 0:30 | Slice 5: LMS with entitlement checks |
| 0:10 | **Checkpoint: fresh-clone `docker compose up`** |
| 0:50 | Slice 6 (T2): idempotency, outbox, email, reminders, concurrency tests |
| 0:20 | README, AI artefacts, final fresh-clone test |

## 3. Vertical slices

Commit after each slice. Each slice leaves the app runnable.

### Slice 1: Foundations
- [ ] `docker-compose.yml`: db (healthcheck), api (`service_healthy`), web
- [ ] Migrations for all tables incl. timestamps + trigger; seed 3 courses (Maths 5–13, English 5–13, Science 5–11, £199) and 3–5 lessons each
- [ ] Config module: fail startup if `JWT_SECRET` / `DATABASE_URL` missing; `.env.example`
- [ ] pino logger with request ID; central error handler; `/health`, `/ready`
- **Done when:** `docker compose up` from a clean clone gives a healthy stack.

### Slice 2: Catalog
- [ ] `GET /api/courses` with cache headers
- [ ] Product page: course list, year picker, select course
- **Done when:** courses render from the DB with no manual SQL.

### Slice 3: Checkout and invitations
- [ ] Write tests 3 (basic), 4, 6 first (see Blueprint §12)
- [ ] zod schema; year eligibility; server-side pricing; ≤5 courses
- [ ] `PaymentGateway` interface + `MockPaymentGateway`; `markPaid()` transaction
- [ ] Invitation token generation (32 bytes, SHA-256 hash stored)
- [ ] Confirmation page showing invitation links
- **Done when:** a checkout creates order, slots, enrollments (PENDING), invitations, in one transaction.

### Slice 4: Activation and auth
- [ ] Write tests 1 and 2 first
- [ ] `GET /invitations/:token`, `POST .../activate` (atomic `UPDATE ... RETURNING`)
- [ ] argon2id/bcrypt (async); JWT in `HttpOnly` cookie; login/logout/me
- [ ] Onboarding form page; login page
- **Done when:** link → form → logged-in student; reuse of the link fails.

### Slice 5: LMS
- [ ] Write test 5 first (entitlement matrix)
- [ ] `/me/enrollments`, `/courses/:id/lessons`, `/lessons/:id` via the entitlement join
- [ ] Dashboard + lesson list + lesson view (render body as text)
- **Done when:** student A cannot read student B's lessons by ID; unenrolled course returns 404.

### Checkpoint: fresh-clone test
Clone to a new directory, remove local `.env`, run `docker compose up`, walk the full journey in the browser. Fix before continuing.

### Slice 6 (T2): Reliability
- [ ] Idempotency key handling + `request_hash` (test 3 in full, incl. 20 parallel)
- [ ] Outbox insert in `markPaid()`; worker with `SKIP LOCKED`, backoff + jitter; `EmailSender` (log) 
- [ ] Test 7 (retry), then reminders (+3d/+7d, rotate token) and test 8
- [ ] helmet/CSP, rate limits (checkout, login, activation), pino `redact`
- [ ] Optional: k6 funnel script, MailHog

### Slice 7: Docs
- [ ] README final pass (see `README.md` skeleton)
- [ ] `docs/ai/CORRECTIONS.md` filled with **real** corrections made during the build
- [ ] Final fresh-clone test

## 4. AI workflow (graded deliverable: keep evidence)

1. **Plan first.** This plan + blueprint exist before any code. Ask Claude to critique them; record what was accepted and rejected in `CORRECTIONS.md`.
2. **Steer with `CLAUDE.md`** (conventions in Blueprint §14).
3. **Tests first, implementation second.** Write the test as the spec, then have Claude implement against it.
4. **Thin slices, one commit each.** Keep the history readable.
5. **Review everything.** Be able to explain every file in the follow-up interview.
6. **Log real corrections** (not invented ones). Typical things to watch for and record if they happen: trusting a client-sent price, storing the raw token, read-then-write on activation, adding a broker, using `localStorage` for auth, `SELECT * FROM lessons WHERE id = $1` without the entitlement join.
7. **Keep artefacts:** `docs/ai/PROMPTS.md` with the key prompts, plus this plan and blueprint.

## 5. Definition of done

- [ ] `docker compose up` works from a fresh clone, no manual steps
- [ ] Full journey works in the browser
- [ ] Tests for Blueprint §12 items 1–6 pass (7–8 if T2 reached)
- [ ] No secrets committed; `.env.example` present
- [ ] README states shortcuts, trade-offs, security notes, AI usage and roadmap
- [ ] `CORRECTIONS.md` contains genuine entries

## 6. Risks

| Risk | Mitigation |
|---|---|
| T2 polish eats the time | Hard timer; cut order in §1 |
| Docker works only locally | Mid-point fresh-clone test; healthchecks |
| Over-building (broker, Stripe) | Interfaces + roadmap only |
| Unfamiliar stack slows delivery | Keep dependencies minimal; stack unfamiliarity is explicitly not penalised |
| Raw tokens or PII end up in logs | `redact` config + a test that greps log output |
