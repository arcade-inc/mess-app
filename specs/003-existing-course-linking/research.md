# Research: Existing Account Course Linking

## Existing-account invitation claim

- **Decision**: Add an authenticated claim operation for an unused invitation. The invitation code stays in the URL; when an existing learner opens that URL while authenticated, the web flow automatically submits the claim. If signed out, the learner signs in and returns to the same invitation URL, which automatically submits the claim. Resolve learner identity exclusively from the verified student session.
- **Rationale**: Existing `POST /invitations/{token}` creates an account and correctly rejects duplicate emails; reusing it for account linking would conflate registration with claiming. A separate authenticated operation preserves registration behavior while the original invitation URL provides continuity. The existing session authenticates the learner; it does not store the invitation code.
- **Alternatives considered**: Requiring a second confirmation button after login was rejected by the user's clarified flow. Storing invitation state in a cookie was rejected; validating an arbitrary return URL was rejected because it could create an open redirect.

## Learner identity matching

- **Decision**: Compare the invitation slot's learner name with the authenticated student's existing name after trimming leading/trailing whitespace, collapsing repeated whitespace, and ignoring letter case. Do not compare school year/age. Reject a mismatch with the exact user-facing message “This course belongs to another learner.”
- **Rationale**: The user explicitly selected name-based matching and explained that school year can change between purchases. Server-side comparison is authoritative and cannot be bypassed by submitting a different student ID.
- **Alternatives considered**: Comparing school year was rejected as it would reject legitimate later purchases. Fuzzy matching was rejected because it could associate one learner's purchase with another account.

## Transaction and persistence

- **Decision**: Lock the still-usable invitation and unlinked student slot, compare names before changing state, then in one transaction mark the invitation used, associate the slot with the session student, and activate all pending enrollments in that slot. Roll back on any mismatch or inconsistent update.
- **Rationale**: `student_slots.student_id`, enrollment ownership/status/activation fields, and invitation use/expiry fields already represent this lifecycle. The current repository already uses a transaction and row locks for first-time redemption.
- **Alternatives considered**: A new linking table or schema migration is unnecessary because a student can be referenced by multiple slots; non-transactional updates risk consuming an invitation without granting the paid access.

## Sign-in continuation and activation-code handling

- **Decision**: The sign-in link contains only the explicit `activationCode` query parameter. After successful login, construct the local `/invite/{activationCode}` path and resume the invitation claim. The same automatic claim occurs when an authenticated learner opens the invitation directly.
- **Rationale**: The activation code already uniquely identifies the invitation, so a separate `returnTo` parameter duplicates state. Constructing a fixed local route from the code avoids accepting an arbitrary return URL/open redirect; the server remains authoritative for session identity, name match, invitation state, and entitlement changes. The code must remain out of cookies and be redacted from logs and telemetry, including URL query attributes.
- **Alternatives considered**: Carrying both `activationCode` and `returnTo` was rejected as redundant. Carrying the code only inside `returnTo` was rejected because the clarified contract requires an explicit `activationCode` parameter. A second post-login claim button was rejected because the user wants the link to activate the course automatically after sign-in. Automatically mutating on an ordinary login without an invitation was rejected; the invitation context is required.

## Security and verification

- **Decision**: Keep the claim endpoint protected by the existing default-deny session guard; do not accept a student ID or learner name in the request body. Return the specified name-mismatch message without changing invitation or enrollment state. Cover successful, invalid, mismatch, retry, and concurrent claims with PostgreSQL-backed tests. Add a Playwright end-to-end case asserting the single sign-in parameter, derived invitation route, and automatic post-login claiming.
- **Rationale**: Authentication and active enrollment remain separate boundaries. Transaction/locking correctness depends on PostgreSQL behavior and should be exercised against the real database engine.
- **Alternatives considered**: Client-only name matching or mock-only transaction tests are insufficient because a caller can modify client input and locking semantics are database-specific.

## Repository evidence reviewed

- `apps/api/src/modules/identity/onboarding.service.ts` creates a new student during redemption and rejects an existing email.
- `apps/api/src/modules/identity/invitation.repository.ts` locks unused invitations/slots and exposes the slot learner name and year.
- `apps/api/src/platform/database.ts` provides the transaction helper.
- `db/migrations/001_core.sql` allows multiple student slots to reference the same student and records pending/active enrollments separately.
- The prior implementation linked to `/login` with both `activationCode` and `returnTo`, and `LoginPage.tsx` required the values to match.
- The latest clarification removes the duplicate return parameter: login must derive the local invitation path from `activationCode` alone. The existing Playwright coverage must be updated to assert this contract and automatic claim.
- `specs/001-mes-learning-journey/contracts/openapi.yaml` documents the existing invitation and session conventions.
