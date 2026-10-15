Blueprint v1 (with reminders and the product vision)

Your reminder idea is good, and it hits the product’s real leak: purchased but never activated is lost value and an unhappy parent. It also exposes a design trap I need to fix first.

Two corrections this idea triggers

1. Reminders can’t resend the link if we store only the token hash.
Hashing means we can never reproduce the raw link. The fix is token rotation: when a reminder fires, generate a new token, mark the old invitation superseded_at, store the new hash, and put the new link in the email. This is also more secure, since stale links die.

2. The schema needs a student slot.
My earlier model issued one invitation per enrollment. A parent buying Maths and English for the same child would get two invitations and two account claims. The invitation should belong to a student slot (one child in one order), and activating it activates all of that child’s enrollments.

Reminder design
The parent’s email is already required at checkout. Add a confirm-email field (a typo means the link is lost) and show the links on the confirmation screen too, so email is never the only channel.
Emails sent: purchase confirmation with links (immediately), and reminders at +3 and +7 days. Invitations expire at 14 days.
Reminders are scheduled outbox rows (run_at). At send time the handler re-checks state (still unredeemed, not expired, not revoked) and skips otherwise. Never trust the state at enqueue time.
Cap at 2 reminders and keep copy transactional. Note PECR/UK GDPR in the README.
Tier: confirmation email is T2. Reminders are a T2 stretch (about 20 minutes once the outbox has run_at). If time runs out, the schema and outbox support it anyway and the README documents it.
1. Goals and non-goals

Goals: a working Parent → Student → LMS journey in Docker, with access derived from entitlement.
Non-goals: real payments, a real broker, refunds, a parent portal, and admin tooling. All are documented in the roadmap.

2. Architecture
React (Vite) ─nginx, same-origin /api─▶ Node API (TS, Fastify) ──▶ Postgres
                                         ├ catalog   (courses, cached)
                                         ├ commerce  (orders, payments, invitations)
                                         ├ identity  (students, auth)
                                         ├ learning  (enrollments, lessons, access)
                                         └ worker    (outbox relay: email, reminders)

Rule: modules call each other through service interfaces, never through each other’s tables. The worker is the same codebase, started in-process or as a second compose service.

3. Schema
sql
courses(id, subject, year_min, year_max, price_minor, currency)
parents(id, name, email)
orders(id, parent_id, status, total_minor, currency, idempotency_key UNIQUE, created_at)
student_slots(id, order_id, name, year, student_id NULL)
order_items(id, order_id, slot_id, course_id, unit_price_minor)
payments(id, order_id, provider, provider_ref UNIQUE, status, amount_minor)
students(id, email UNIQUE, name, year, password_hash, created_at)
enrollments(id, order_item_id UNIQUE, slot_id, course_id, student_id NULL,
            status, activated_at)
invitations(id, slot_id, token_hash UNIQUE, expires_at, used_at NULL,
            superseded_at NULL)
lessons(id, course_id, position, title, body)
outbox(id, type, payload jsonb, status, attempts, run_at, last_error,
       dedupe_key UNIQUE)

Constraints that do real work: CHECK (year_min <= year_max), unique dedupe_key (one reminder per slot per step), and the unique idempotency key. Money is integer minor units.

4. State machines
Order: PENDING_PAYMENT → PAID | FAILED (reserve REFUND_PENDING, REFUNDED)
Enrollment: PENDING → ACTIVE (reserve REVOKED)
Invitation: active when used_at IS NULL AND superseded_at IS NULL AND expires_at > now()
5. API contract
Endpoint	Auth	Notes
GET /api/courses	none	Cached, Cache-Control set
POST /api/checkout	none	Idempotency-Key header. Body: parent{name,email}, students[{name,year,courseIds[]}], max 5 courses. Server prices and validates year
GET /api/invitations/:token	token	Valid/expired/used, prefilled child name and courses
POST /api/invitations/:token/activate	token	Form and password. One transaction. Sets cookie
POST /api/auth/login, /logout, GET /api/me	cookie	Generic login error, rate limited
GET /api/me/enrollments	student	Dashboard
GET /api/courses/:id/lessons, GET /api/lessons/:id	student	Via entitlement join; 404 if not entitled
GET /health, /ready	none	/ready checks the DB
6. Key flows

Checkout: validate → find or create the order by idempotency key → create the order as PENDING_PAYMENT → PaymentGateway.charge() → the mock confirms through the same markPaid() path a webhook would use → in one transaction: order PAID, slots, enrollments PENDING, invitations, and outbox rows (PurchaseConfirmed now, InvitationReminder at +3d and +7d).

Activation: UPDATE invitations SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now(). If affected rows ≠ 1, return a generic failure. Otherwise, in the same transaction, create the student, activate the slot’s enrollments, and issue the session. If the email already has an account, return “log in instead” (linking is on the roadmap).

Reminder handler: load the slot → if invitation redeemed, expired or revoked, mark the row SKIPPED → else rotate the token, send the email, and mark SENT. Retries use backoff; after N attempts the row goes to FAILED and is logged at error level.

Lesson access: SELECT l.* FROM lessons l JOIN enrollments e ON e.course_id = l.course_id WHERE l.id = $1 AND e.student_id = $session AND e.status = 'ACTIVE'. No row means 404 and a security log line.

7. Security and observability (condensed)

Hashed single-use tokens, cookie flags (HttpOnly, SameSite), Origin check, helmet and CSP, zod validation on every body, rate limits on checkout, login and activation, pino with redact, fail-closed errors, and JWT_SECRET required at startup.
Events logged: order_created, order_paid, invitation_issued, reminder_sent|skipped|failed, invitation_redeemed, activation_failed(reason), lesson_access_denied.

8. Tests (written first, against a real Postgres)
Redeem: valid, expired, reused, superseded, wrong token
50 parallel activations: exactly one succeeds
Same idempotency key twice (and 20 in parallel): one order
Client-sent price ignored; year-ineligible course rejected
Entitlement matrix: enrolled, pending, not enrolled, another student’s lesson
Gateway failure: no orphan enrollments or invitations
Email fails twice then succeeds: one email recorded
Reminder after redemption: skipped. Reminder before: rotates the token and the old link stops working
9. Repo layout
/apps/web   /apps/api (src/modules/{catalog,commerce,identity,learning}, src/worker)
/db/migrations + seed   /docs/ai/{PLAN.md,CORRECTIONS.md}
CLAUDE.md  docker-compose.yml  .env.example  README.md

Compose: db (healthcheck) → api (depends_on: service_healthy, migrate and seed on start) → web (nginx). Optional MailHog. Postgres is not published to the host.

10. Build order (commit after each slice)
Compose, DB, migrations, seed, /ready
Catalog API and the product page
Checkout with mock gateway and invitations
Activation and auth
LMS with entitlement checks
Fresh-clone docker compose up test (halfway checkpoint)
T2: idempotency, outbox, email, reminders, concurrency tests
README, AI artefacts
11. README skeleton

Run instructions, architecture, domain model (“enrollment is the entitlement”), decisions and trade-offs, security and threat model (including the forwarded-link gap), AI usage with artefacts, limitations, and the vision below.

Product vision and roadmap (the part you asked for)

Direction: from a single purchase-to-access flow toward a family learning platform, where a parent manages several children, payments and progress in one place, and the system reliably turns every purchase into an activated student.

Horizon	What changes	Why
Now (this MVP)	Purchase → invitation → onboarding → entitlement-gated LMS; mock payment; outbox with email and reminders	Prove the core journey and its correctness guarantees
Next	Real Stripe with signed webhooks and a reconciliation job; a real email provider; RabbitMQ/SQS behind the outbox relay; “resend my link” for expired invitations; student-email-bound invitations; rate limits and alerting on the activation funnel	Production-grade payments and delivery
Then	Parent account and portal (orders, add a course for an existing child, link purchases to existing students); refunds with a ledger and entitlement revocation; student progress and parent reporting; Prometheus, tracing and Sentry; SSR/CDN landing page for ad traffic	Retention, trust and growth
Later	Subscriptions and bundles; an external IdP (Auth0/Cognito) with SSO; school or tutor accounts; an analytics event stream (Kafka only if several consumers justify it); GDPR retention, deletion and parental-consent workflows; multi-region	Scale and compliance

Each step follows from a seam built now: the PaymentGateway and EmailSender interfaces, the outbox relay, the module boundaries, the order and enrollment status enums, and the parents table (a parent account is an addition, not a migration of the model).


