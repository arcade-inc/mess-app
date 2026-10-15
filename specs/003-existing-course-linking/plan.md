# Implementation Plan: Existing Account Course Linking

**Branch**: `003-existing-course-linking` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-existing-course-linking/spec.md`

## Summary

Allow an authenticated learner to activate a valid purchased-course invitation on an existing account by opening its link. When signed out, the sign-in link carries only an explicit `activationCode` query parameter. After sign-in, the browser constructs `/invite/{activationCode}` and automatically submits the claim. The activation code remains URL state, not cookie state; the authenticated session identifies the learner. Compare learner names on the server (case-insensitive, trimmed, and whitespace-collapsed; school year is ignored) and atomically link the purchase only after a successful match. A name mismatch returns the agreed message and leaves the invitation untouched.

## Technical Context

**Language/Version**: TypeScript 6.0; Node.js for the API; React 19 with Vite 8 for the web client.

**Primary Dependencies**: Fastify 5, PostgreSQL client `pg`, React, existing JWT-in-HttpOnly-cookie student sessions, and the existing Playwright browser test setup. The activation code remains in URL state as the explicit login `activationCode` parameter; after authentication, the app derives the invitation route from it. The existing session cookie is used only to authenticate the learner. No new dependency is needed.

**Storage**: PostgreSQL. Existing `student_slots.student_id`, `enrollments.student_id/status/activated_at`, and `invitations.used_at` support linking and activation; no schema migration is expected.

**Testing**: Node.js built-in test runner (`node:test`) for API and browser Playwright for the end-to-end journey; PostgreSQL integration tests for transactional and concurrency guarantees.

**Target Platform**: Existing MES web application and API, runnable through the repository's Docker Compose workflow.

**Project Type**: Web application with separate API and frontend workspaces.

**Performance Goals**: No feature-specific performance target; claim and login use the existing interactive request path and should complete within normal application response expectations.

**Constraints**: Claim identity comes only from the verified session, never request data. Carry the single-use invitation token as the sole `activationCode` query parameter on the sign-in link; after login, construct the local `/invite/{activationCode}` route rather than accepting a separate return URL. Do not store invitation state in a cookie. Redact the activation code from logs and telemetry, including query strings. A failed name match must not consume the invitation or modify access. The database transaction must keep claim, slot association, and enrollment activation all-or-nothing. School year is not part of name matching. Opening a valid invitation while authenticated, or returning to it after login, automatically initiates the claim without a second confirmation action.

**Scale/Scope**: One learner claim flow spanning invitation preview, login continuation, account linking, and course entitlement display. No new account types, roles, authentication methods, or payment behavior.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Ship the Complete Core Journey — PASS**: The feature completes the purchase-to-learning journey for returning students and can be implemented as a vertical slice without changing checkout or adding infrastructure.
- **II. Entitlement Is the Authorization Boundary — PASS**: Only the authenticated account receives the invitation's purchased enrollments; session identity is resolved server-side, and course access continues to require active enrollment.
- **III. Specify Risky Behavior with Tests First — PASS**: Add failing integration tests for successful linking, name mismatch/no mutation, invalid invitation, and competing claims before implementation. Use PostgreSQL for lock/transaction behavior.
- **IV. Protect Identity, Secrets, and Children's Data — PASS**: Compare only the existing account name and invitation's learner name; do not compare age/year. Keep token handling/redaction consistent with current invitation policy and do not add unnecessary learner data.
- **V. Prefer Explicit Seams and the Smallest Adequate Design — PASS**: Extend the existing identity/invitation service and web pages; add no dependencies, roles, or schema unless later evidence shows the existing slot linkage cannot represent the feature.

No constitution violations or complexity justifications are required.

## Project Structure

### Documentation (this feature)

```text
specs/003-existing-course-linking/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── openapi.yaml
```

### Source Code (repository root)

```text
apps/api/src/modules/identity/
├── identity.routes.ts
├── invitation.repository.ts
├── invitation.service.ts
└── onboarding.service.ts

apps/api/tests/identity/
├── invitation-claim.integration.test.ts
└── invitation-concurrency.integration.test.ts

apps/web/src/
├── api/identity.ts
├── pages/InvitationPage.tsx
├── pages/LoginPage.tsx
└── router.tsx

apps/web/tests/
└── parent-to-lms.spec.ts
```

**Structure Decision**: Follow the existing React/Vite frontend and Fastify API workspace boundaries. Keep account linking in the identity module, reusing the current invitation repository and transaction helper; let the invitation page automatically submit the authenticated claim when its URL is opened or resumed after login. The login link contains only `activationCode=<invitation-token>`. Login validates the code as an invitation token and constructs `/invite/<invitation-token>` locally after authentication; it does not accept a separate return URL. The session cookie carries authentication only. The Playwright journey verifies that no duplicate return parameter is present and that the derived invitation route automatically claims. Redact the code in telemetry URL attributes. Update the existing product contract and feature-specific acceptance guide. The listed paths are expected change locations, not a mandate to modify every file.

## Phase 0: Research

See [research.md](research.md). Existing repository patterns resolve the technical choices; no external technology research or new dependency is needed.

## Phase 1: Design & Contracts

- [Data model](data-model.md) records the existing entities, transitions, and invariants; no migration is expected.
- [API contract](contracts/openapi.yaml) defines the authenticated invitation claim operation and error behavior.
- [Quickstart](quickstart.md) describes the end-to-end and negative acceptance walkthroughs.

### Post-Design Constitution Check

- **I. Complete journey — PASS**: The design carries one explicit activation code through sign-in, derives the invitation return path locally, and automatically claims it, followed by entitled learning.
- **II. Entitlement boundary — PASS**: The claim uses the verified session identity; successful access is limited to the invitation's purchased enrollments.
- **III. Tests first — PASS**: PostgreSQL tests are planned for transactional atomicity and concurrent single-use claims, plus UI continuation coverage.
- **IV. Privacy and child data — PASS**: Name comparison is server-side and limited to the agreed matching rule; the activation code is URL state only and must be redacted from logs and telemetry.
- **V. Smallest adequate design — PASS**: Existing tables and session mechanisms suffice; no migration, dependency, or new infrastructure is planned.

## Complexity Tracking

No constitution violations.
