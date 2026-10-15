# Blueprint: MES Mock Journey (Parent → Student → LMS)

> Status: design v1. This is the source of truth for architecture. `PLAN.md` covers sequencing; `README.md` is the reviewer-facing summary.

## 1. Goals and non-goals

**Goals**
- A working Parent purchase → Student onboarding → LMS journey, started with `docker compose up`.
- Access derived from **entitlement** (what was paid for this student), not merely from being logged in.
- Correctness of the risky parts: single-use invitations, idempotent checkout, server-side pricing, no IDOR.
- Visible seams for the production direction (real payments, broker, parent portal, refunds).

**Non-goals (documented in the roadmap, not built)**
Real payments and webhooks, a real message broker, refunds, a parent account/portal, admin tooling, real video hosting, password reset, GDPR workflows, SSR landing page.

## 2. Key insight

The **buyer (parent) and the user (student) are different people**, and the student does not exist when payment happens. So:

```
Parent ─places→ Order ─contains→ OrderItem(course) ─belongs to→ StudentSlot (one child in one order)
StudentSlot ─has→ Enrollment(s) (PENDING) ─has one active→ Invitation (hashed token)
Invitation redeemed by Student (new account) → Enrollments ACTIVE
```

**Enrollment is the entitlement.** Lesson access = `Student → ACTIVE Enrollment → Course → Lesson`.
Authentication answers "who are you?"; entitlement answers "what was bought for you?".

## 3. Architecture

Modular monolith: one backend, one database, one frontend.

```
Browser ─▶ nginx (serves React build, proxies /api) ─▶ API (Node + TypeScript + Fastify) ─▶ Postgres
                                                        ├─ catalog    courses (cached)
                                                        ├─ commerce   orders, payments, invitations, checkout
                                                        ├─ identity   students, auth, sessions
                                                        ├─ learning   enrollments, lessons, access checks
                                                        └─ worker     outbox relay (email, reminders)
```

**Rules**
- Modules interact through service interfaces, never through each other's tables. This is the seam for future extraction.
- The browser sees one origin in the Docker deployment (nginx proxies `/api`), but the API still registers `@fastify/cors` with an explicit allowed-origin configuration for development/deployment and credentialed cookie requests only from approved origins.
- The worker lives in the same codebase; it runs as a second compose service (or in-process if time is short).
- External systems sit behind interfaces: `PaymentGateway`, `EmailSender`. Mock implementations now.

## 4. Decisions (frozen)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Backend | Node + TypeScript + Fastify, modular monolith | Fast iteration, shared types, matches MES stack |
| 2 | Frontend | React + Vite SPA behind nginx | Auth-gated LMS gains nothing from SSR; landing page SSR/CDN is roadmap |
| 3 | Checkout | Async state machine `PENDING_PAYMENT → PAID`; mock gateway confirms via the same `markPaid()` path a webhook would use | Stripe later is a swap, not a rewrite |
| 4 | Cart | N courses per child, up to 5 courses per order | Parents have several children |
| 5 | Parent identity | No account; name + email (confirmed twice) at checkout | Deliberate gap; parent portal on roadmap |
| 6 | Unentitled lesson | 404, plus a security log line | Do not leak existence |
| 7 | Email | `EmailSender` interface; implementation logs the link (MailHog optional) | No external dependency |
| 8 | Async side effects | Transactional outbox in Postgres, polled by a worker with `FOR UPDATE SKIP LOCKED` | At-least-once delivery without new infrastructure |
| 9 | Broker | None now; RabbitMQ/SQS later behind the relay | Task-style jobs, low volume; Kafka rejected (no replay or multi-consumer need yet) |
| 10 | Session | Short-lived JWT in `HttpOnly`, `SameSite=Lax` cookie | Not exposed to XSS; stateless, scales horizontally |
| 11 | Passwords | argon2id (or bcrypt), async | CPU-bound; must not block the event loop |
| 12 | Tokens | 32 random bytes; store SHA-256 hash only | High-entropy token, fast hash is fine |
| 13 | Money | Integer minor units + currency | No floats |
| 14 | Timestamps | `created_at`, `updated_at` (`timestamptz`, trigger-maintained) on every table | Debuggability; business timestamps stay separate |

## 5. Data model

All tables have `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()`, with `updated_at` maintained by a trigger (see below). Business timestamps (`used_at`, `expires_at`, `superseded_at`, `activated_at`, `run_at`) are domain facts and are never derived from `updated_at`.

```sql
-- Shared trigger
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
-- Applied per table: CREATE TRIGGER trg_<t>_updated BEFORE UPDATE ON <t>
--                    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text NOT NULL,
  year_min      int  NOT NULL,
  year_max      int  NOT NULL,
  price_minor   int  NOT NULL CHECK (price_minor >= 0),
  currency      char(3) NOT NULL DEFAULT 'GBP',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (year_min <= year_max)
);

CREATE TABLE parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,                       -- not unique: no parent account yet
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id),
  status text NOT NULL CHECK (status IN
    ('PENDING_PAYMENT','PAID','FAILED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED')),
  total_minor int NOT NULL,
  currency char(3) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,                -- detect same key, different body
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_slots (                 -- one child within one order
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  name text NOT NULL,
  year int NOT NULL CHECK (year BETWEEN 5 AND 13),
  student_id uuid NULL REFERENCES students(id),   -- set at activation
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  slot_id uuid NOT NULL REFERENCES student_slots(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  unit_price_minor int NOT NULL,             -- snapshot at purchase time
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, course_id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,                    -- 'mock' now, 'stripe' later
  provider_ref text NOT NULL UNIQUE,
  status text NOT NULL,                      -- PENDING | SUCCEEDED | FAILED | REFUNDED
  amount_minor int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  year int NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id),
  slot_id uuid NOT NULL REFERENCES student_slots(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  student_id uuid NULL REFERENCES students(id),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  activated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON enrollments (student_id, status);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES student_slots(id),
  token_hash text NOT NULL UNIQUE,           -- never store the raw token
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  superseded_at timestamptz NULL,            -- set when a reminder rotates the token
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live invitation per slot:
CREATE UNIQUE INDEX one_live_invitation_per_slot ON invitations (slot_id)
  WHERE used_at IS NULL AND superseded_at IS NULL;

CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  position int NOT NULL,
  title text NOT NULL,
  body text NOT NULL,                        -- rendered as text, never as HTML
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,                        -- PurchaseConfirmed | InvitationReminder
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SENT','SKIPPED','FAILED')),
  attempts int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL,
  dedupe_key text NOT NULL UNIQUE,           -- e.g. 'reminder:<slotId>:3d'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (status, run_at);
```

**Reserved for the roadmap (not created now):** `guardianships(parent_id, student_id)`, `purchase_requests`, `ledger_entries` (append-only), `processed_events` (webhook dedupe), `parent_accounts`.

## 6. State machines

**Order:** `PENDING_PAYMENT → PAID | FAILED`. Reserved: `REFUND_PENDING`, `REFUNDED`, `PARTIALLY_REFUNDED`.
**Enrollment:** `PENDING → ACTIVE`. Reserved: `REVOKED`.
**Invitation:** live when `used_at IS NULL AND superseded_at IS NULL AND expires_at > now()`.
**Outbox:** `PENDING → PROCESSING → SENT | SKIPPED | FAILED` (retry returns it to `PENDING` with a later `run_at`).

## 7. API contract

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/courses` | none | Cached; `Cache-Control` header |
| `POST /api/checkout` | none | Header `Idempotency-Key`. Body: `parent{name,email,emailConfirm}`, `students[{name,year,courseIds[]}]`. Server prices and validates year eligibility. Returns order summary and invitation links (shown once) |
| `GET /api/invitations/:token` | token | Returns validity, child name, courses. Generic error for any invalid state |
| `POST /api/invitations/:token/activate` | token | Body: email, password, onboarding fields. Sets cookie |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/me` | cookie | Generic login error; rate limited |
| `GET /api/me/enrollments` | student | Dashboard |
| `GET /api/courses/:id/lessons` | student | Requires ACTIVE enrollment, else 404 |
| `GET /api/lessons/:id` | student | Entitlement join, else 404 |
| `GET /health` · `GET /ready` | none | `/ready` checks the DB; used by Docker healthcheck |

Error shape: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. No stack traces.

## 8. Key flows

### 8.1 Checkout
1. Validate body (zod): email format and confirmation, ≤5 courses total, years 5–13.
2. Look up `Idempotency-Key`. Same key and same `request_hash` → return the stored result. Same key, different hash → 422.
3. Load courses from DB; check each course's `year_min..year_max` against the child's year; compute the total **server-side**.
4. Create the order as `PENDING_PAYMENT`; call `PaymentGateway.charge()`.
5. On success, `markPaid()` runs **one transaction**: order `PAID`, payment `SUCCEEDED`, slots, order items, enrollments `PENDING`, one invitation per slot (random token, hash stored), outbox rows: `PurchaseConfirmed` (now), `InvitationReminder` (+3d, +7d). Invitations expire at +14d.
6. On gateway failure: order `FAILED`; nothing else is created.

The mock gateway calls `markPaid()` directly. A real Stripe webhook handler would call the same function after verifying the signature and deduping on the provider event ID.

### 8.2 Activation
```sql
UPDATE invitations
SET used_at = now()
WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now()
RETURNING slot_id;
```
Zero rows → generic failure. Otherwise, **in the same transaction**: create the student (hash password), set `student_slots.student_id`, set the slot's enrollments to `ACTIVE` with `student_id` and `activated_at`. If the email already has an account, roll back (the invitation stays valid) and return "log in instead"; linking to an existing account is roadmap. Issue the session cookie.
Read-then-write is never used, so 50 parallel activations yield exactly one winner.

### 8.3 Reminder handler
Load the slot → if its invitation was redeemed, or the order is refunded or revoked → mark `SKIPPED`. Otherwise **rotate**: set the old invitation's `superseded_at`, insert a new invitation with a new token hash (same expiry window cap), send the email with the new link, mark `SENT`. State is re-checked at send time, never trusted from enqueue time. On error: `attempts++`, backoff with jitter (1s, 5s, 30s, 5m, 1h), then `FAILED` with an error log.

### 8.4 Worker
```sql
SELECT * FROM outbox
WHERE status = 'PENDING' AND run_at <= now()
ORDER BY run_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```
Safe with multiple workers. Delivery is at-least-once; handlers are idempotent via `dedupe_key` and state re-checks.

### 8.5 Lesson access
```sql
SELECT l.* FROM lessons l
JOIN enrollments e ON e.course_id = l.course_id
WHERE l.id = $1 AND e.student_id = $session_student_id AND e.status = 'ACTIVE';
```
The student ID comes only from the session. No row → 404 and a `lesson_access_denied` log. Errors fail closed.

## 9. Security and threat model

**OWASP mapping (Top 10:2025, verify category names on owasp.org)**

| Area | Controls |
|---|---|
| Broken access control | Session-scoped queries (no IDOR); no guessable order lookup endpoint; `SameSite` cookie + `Origin` check |
| Misconfiguration | helmet + CSP; explicit `@fastify/cors` origin allowlist; Postgres not published; non-root containers; `JWT_SECRET` required at startup |
| Supply chain | Lockfile + `npm ci`; pinned base images; multi-stage builds; `npm audit` noted |
| Cryptographic failures | argon2id/bcrypt; hashed tokens; cookie flags; TLS terminates at the load balancer in prod |
| Injection | Parameterized queries; zod schemas; lesson body rendered as text |
| Insecure design | Threat model below; rate limits; item caps; single-use, expiring, rotated tokens |
| Authentication failures | Generic login errors; rate limiting; min password length 12; logout clears the cookie |
| Integrity failures | Status set server-side only; real webhooks must be signature-verified |
| Logging failures | Security events logged; pino `redact` for passwords, tokens, cookies |
| Exceptional conditions | Central error handler; fail closed; full transaction rollback on any failure |

**Threat model (short)**
- *Link forwarded or leaked:* whoever holds the link can claim the enrollment. Mitigations: 14-day expiry, single use, rotation on reminder. Production: bind to the student's email.
- *Wrong parent email:* confirm-email field; links also shown on the confirmation screen.
- *Duplicate submit or replay:* idempotency key.
- *Price tampering:* client sends only `courseId`.
- *Token brute force:* 256-bit tokens plus rate limiting on the activation endpoint.

**Children's data:** collect the minimum (name, school year, email). No date of birth or address. UK GDPR and the ICO Children's Code are production concerns (retention, deletion, parental consent). Do not log PII unnecessarily. Reminder emails are transactional, capped at two (PECR/UK GDPR to be reviewed).

## 10. Observability

- pino JSON logs with a `requestId` on every line; central error middleware.
- `/health` (liveness) and `/ready` (DB check).
- **OpenTelemetry:** register `@fastify/otel` before routes for HTTP/request lifecycle instrumentation; initialize an OpenTelemetry SDK and use console export locally with an optional configured OTLP endpoint.
- **Funnel metrics:** explicit low-cardinality business counters for `order_created`, `order_paid`, `invitation_issued`, `reminder_sent|skipped|failed`, `invitation_redeemed`, `activation_failed(reason)`, and `lesson_access_denied`.
- Never attach names, email addresses, invitation tokens, session IDs, or student IDs to telemetry; do not use per-student labels.
- Metrics backends, dashboards, alerting, and production retention remain deployment concerns; no collector/backend container is required for the mock.

## 11. Performance posture (ad-spike readiness)

A spike is browse-heavy. Controls: cached catalog and `Cache-Control`, static assets from nginx, stateless API, explicit DB pool size, async password hashing, and per-user time-window request limits. Authenticated limits key by verified student identity; unauthenticated routes use a trusted client IP fallback. Validate with rate-limit boundary tests, concurrency tests (correctness), and a small k6 funnel script (cliffs, not capacity claims; local Docker numbers are not production numbers).

## 12. Test strategy (test-first, real Postgres)

1. Redeem: valid, expired, reused, superseded, wrong token.
2. 50 parallel activations → exactly one succeeds.
3. Same idempotency key, sequential and 20 parallel → one order; same key with a different body → 422.
4. Client-sent price ignored; year-ineligible course rejected.
5. Entitlement matrix: enrolled, pending, not enrolled, another student's lesson.
6. Gateway failure → no orphan enrollments or invitations.
7. Email fails twice then succeeds → one email recorded.
8. Reminder after redemption → `SKIPPED`; reminder before → token rotated and old link rejected.
9. Optional: one Playwright smoke test of the full journey.

## 13. Repo layout

```
/apps/web                  React (Vite) + nginx.conf + Dockerfile
/apps/api
   src/modules/{catalog,commerce,identity,learning}
   src/worker             outbox relay
   src/platform           config, db, logger, errors, http
   tests/
/db/migrations  /db/seed
/docs/ai/{BLUEPRINT.md,PLAN.md,CORRECTIONS.md,PROMPTS.md}
/loadtest/funnel.js        k6
CLAUDE.md  docker-compose.yml  .env.example  README.md
```

### docker-compose
`db` (postgres, healthcheck `pg_isready`, not published) → `api` (`depends_on: db: service_healthy`; runs migrations + seed on start, healthcheck on `/ready`) → `web` (nginx, proxies `/api`, the only published port) · `worker` (same image as api, different command) · optional `mailhog`.

## 14. CLAUDE.md conventions (to commit at repo root)

- Modules communicate via service interfaces; never query another module's tables.
- Money is integer minor units. The client never sends prices or statuses.
- All SQL is parameterized. All request bodies go through zod.
- Student identity comes from the session only.
- Every table has `created_at`/`updated_at` (trigger-maintained).
- External side effects go through the outbox, never inline in a request transaction.
- Write the failing test first for anything in section 12.
- Never log tokens, passwords or cookies.
- Prefer the smallest implementation; list shortcuts in the README rather than silently taking them.
