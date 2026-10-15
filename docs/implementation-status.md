# Implementation status and roadmap

This is the reviewer-facing status for the current app. The root [README](../README.md) is the run and operations guide; feature specifications remain the detailed behavior contracts. Status below is based on the checked-in implementation, tests, and completed task checklists. The latest recorded full validation is in the README; changes made after that record should be revalidated before release.

## What is implemented

| Design/spec area | Current behavior | Evidence |
|---|---|---|
| Blueprint v1: runnable journey and architecture | React/Vite SPA behind nginx, Fastify modular-monolith API, PostgreSQL, migrations/seeds, Compose health/readiness, catalog, commerce, identity, learning, and outbox worker. | `docker-compose.yml`, `apps/`, `db/`, `specs/001-mes-learning-journey/tasks.md` (T001–T061, T066) |
| Spec 001: parent purchase → student → LMS | Server-priced, year-validated checkout; idempotency; hashed single-use invitations; student activation/session; active-enrollment authorization on learning reads; telemetry, rate limiting, CORS, and database pool routing. | `specs/001-mes-learning-journey/tasks.md`; API/web tests and README validation record |
| Spec 002: parent contact and mock payment | Parent name/email/confirm-email validation; separate payment stage with Visa, Mastercard, and Apple Pay mock choices; simulated success confirmation naming the parent email and seven-day activation window. No real payment or email is claimed. | `apps/web/src/pages/CheckoutPage.tsx`, checkout API/service and tests; `specs/002-parent-checkout/tasks.md` (T001–T012) |
| Spec 003: existing account course linking | Invitation is claimed automatically for a signed-in learner whose normalized name matches. School year is not compared. Sign-in continuation carries only `activationCode`, derives `/invite/{code}`, and resumes the claim. Mismatch leaves the invitation unclaimed. | `apps/api/src/modules/identity/onboarding.service.ts`, `apps/web/src/pages/{InvitationPage,LoginPage}.tsx`; `specs/003-existing-course-linking/tasks.md` (T001–T018) |
| Blueprint T2 reliability seam | Transactional outbox, worker leasing/retries, delivery-time invitation state check and token rotation, plus purchase confirmation/reminder message handlers. | `db/migrations/002_outbox.sql`, `apps/api/src/worker/`, commerce and worker integration tests |

All tasks in the three feature task files are checked complete. This records implementation progress, not a claim that every usability success criterion has been measured with participants or that the app is production-ready. The feature spec headers currently say `Draft`; treat their requirements as implemented per the task records, but update that metadata if the repository adopts a formal spec-status convention.

## Blueprint refinements and deliberate limits

- **Invitation timing changed:** the original `docs/blueprint-v1.md` proposed a 14-day invitation and reminders at days 3 and 7. The implemented policy is a 7-day invitation lifetime and one day-7 reminder (`INVITATION_LIFETIME_DAYS` and `INVITATION_REMINDER_DELAY_DAYS` in `apps/api/src/modules/identity/invitation.service.ts`). Follow current code/specs and README, not those earlier timing values.
- **Reminder and confirmation delivery is not a working local email integration:** the outbox can schedule/process these message types, but the included sender is disabled/no-op. The checkout receipt provides the usable invitation links; delivery text is explicitly simulated.
- **Existing-account linking is now implemented**, although the initial blueprint listed it under the later parent-portal horizon. It links a purchased student slot to the current authenticated account after the name check; it does not add parent accounts or a parent portal.
- Payment method names are illustrative only. There is no Stripe integration, card collection, signed webhook, reconciliation, refund, or real charge.
- The app does not provide password recovery, MFA, admin tooling, video hosting, a message broker, production dashboards/alerts, or completed child-data consent/retention/deletion workflows. See the README security and operations sections.

## Recommended next steps

In dependency order; these are roadmap items, not currently implemented functionality:

1. **Before any real-user deployment:** agree the threat model, verified learner identity/email binding, parental consent, privacy notice, retention/deletion and safeguarding processes; obtain legal/privacy/security review for UK GDPR, the ICO Children's Code, and transactional email/PECR. Do not treat this demo as production-ready.
2. **Real delivery:** choose and configure an email provider, verify delivery and retry/idempotency behavior, and establish safe secret/key rotation for pending outbox messages. Add operational ownership, dashboards/alerts, runbooks, access controls, finite retention, and production trace sampling.
3. **Real payments:** integrate a provider through `PaymentGateway`, verify signed webhooks, deduplicate provider events, reconcile payment state, and define refund/entitlement-revocation behavior before enabling charges.
4. **Product expansion:** parent account/portal and family management, explicit resend/recovery for expired invitations, progress reporting, and richer lesson delivery. Preserve session-derived identity and enrollment-based authorization.
5. **Scale only when justified:** add a broker behind the outbox relay, read replicas for lag-tolerant reads, or SSR/CDN for public acquisition pages only when measured requirements support them. Keep authorization and read-after-write checks on the primary.

## Source-of-truth rule

For implemented behavior, use the application code and current feature specs; use this file for the status summary and the README for setup, operational guidance, and security limits. `docs/blueprint-v1.md` and `docs/blueprint-draft.md` describe earlier design intent and may contain superseded timing or roadmap assumptions. When behavior changes, update the relevant spec, README/status summary, and tests together.
