# Tasks: Existing Account Course Linking

**Input**: Design documents from `specs/003-existing-course-linking/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/openapi.yaml`

**Tests**: Included because the feature's transaction, identity, and single-use guarantees require test-first implementation under the project constitution.

**Organization**: Tasks are grouped by the single P1 user story so it can be implemented and validated as an independent vertical slice.

**Clarification follow-up**: The completed tasks below record the original two-parameter implementation. The final phase adds the current requirement to carry only `activationCode` and derive the invitation route after sign-in; completed history is preserved.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes a separate file and has no dependency on an unfinished task.
- **[Story]**: User story served by the task (`US1`).
- Every task includes the exact file path to change or validate.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm reusable project foundations.

No project initialization, dependency, or database setup changes are required. The API and web workspaces, PostgreSQL integration fixture, session authentication, and test commands already exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure that must be complete before user-story implementation.

No foundational code changes are required. The default-deny route guard, PostgreSQL transaction helper, invitation locking, and account/session lookup already exist in `apps/api/src/platform/auth-guard.ts`, `apps/api/src/platform/database.ts`, and `apps/api/src/modules/identity/`.

**Checkpoint**: Existing authentication and persistence foundations are available; proceed to the user-story tests.

---

## Phase 3: User Story 1 - Add a Purchased Course to an Existing Account (Priority: P1) 🎯 MVP

**Goal**: Automatically link a valid purchase invitation to an existing learner account when its URL is opened by an authenticated matching learner or resumed after sign-in, without comparing school year or creating a duplicate account.

**Independent Test**: With a disposable PostgreSQL database, activate one invitation for a learner, purchase a later course for the same learner, open the later invitation while signed in and verify automatic activation on the same account. Repeat while signed out, sign in, and verify the invitation URL resumes and activates without a separate action. Verify a different learner name is rejected without consuming the invitation.

### Tests for User Story 1

> Write and run the regression tests before implementation; confirm failures are caused by the missing claim behavior, not by test/setup errors.

- [X] T001 [P] [US1] Complete the PostgreSQL integration test for matching-name claim, changed school year, unauthenticated rejection, duplicate-account avoidance, and mismatch rollback in `apps/api/tests/identity/invitation-claim.integration.test.ts`
- [X] T002 [P] [US1] Add a PostgreSQL concurrency test proving one of two simultaneous claims succeeds and no partial state remains in `apps/api/tests/identity/invitation-concurrency.integration.test.ts`
- [X] T003 [P] [US1] Add API-client tests for the authenticated claim request, cookie credentials, response parsing, and safe mismatch errors in `apps/web/tests/identity-api.test.ts`
- [X] T004 [P] [US1] Write the returning-learner Playwright regression asserting both `activationCode` and `returnTo` and the post-login automatic claim in `apps/web/tests/parent-to-lms.spec.ts` (confirmed red before implementation)

### Implementation for User Story 1

- [X] T005 [US1] Implement the transactional existing-student invitation claim, normalized learner-name comparison, and no-write mismatch behavior in `apps/api/src/modules/identity/onboarding.service.ts`
- [X] T006 [US1] Add the authenticated `POST /invitations/{token}/claim` route, verified-session identity lookup, and safe success/failure telemetry in `apps/api/src/modules/identity/identity.routes.ts`
- [X] T007 [P] [US1] Add the cookie-authenticated invitation-claim client function and typed result/error handling in `apps/web/src/api/identity.ts`
- [X] T008 [P] [US1] Preserve and validate the invitation URL as the same-origin login return path, then navigate back after successful authentication without storing the token in a cookie in `apps/web/src/pages/LoginPage.tsx`
- [X] T009 [US1] Automatically submit the authenticated claim when the invitation page loads, redirect signed-out learners to login with the invitation URL preserved, and display the exact mismatch message in `apps/web/src/pages/InvitationPage.tsx`
- [X] T010 [P] [US1] Update the primary product requirement and API contract to document URL-preserved automatic invitation claiming and remove any sign-in-only limitation in `specs/001-mes-learning-journey/spec.md` and `specs/001-mes-learning-journey/contracts/openapi.yaml`

- [X] T012 [P] [US1] Extend `apps/web/tests/telemetry.test.ts` to explicitly verify an `activationCode` query value is absent from the sanitized browser telemetry URL
- [X] T013 [US1] Add the invitation token as the explicit `activationCode` query parameter in `apps/web/src/pages/InvitationPage.tsx`, then validate and consume it with the same-origin invitation `returnTo` in `apps/web/src/pages/LoginPage.tsx` after successful sign-in

**Checkpoint**: User Story 1 is independently functional when opening/resuming the invitation automatically adds the purchased course to the matching existing account, a name mismatch leaves the invitation untouched, and ordinary login without an invitation does not grant access.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Validate security, documentation, and the complete vertical slice.

- [X] T011 Run the documented PostgreSQL, web, lint, build, and browser acceptance checks from `specs/003-existing-course-linking/quickstart.md` using a disposable test database and record any required guide corrections there
- [X] T014 Re-run `npm test --workspace @mes/api`, `npm test --workspace @mes/web`, the Playwright user-journey suite, `npm run lint`, and `npm run build` per `specs/003-existing-course-linking/quickstart.md` after T012-T013; the separate trace-export test requires its tracing profile and collector

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No changes required; existing workspaces and tools are already initialized.
- **Foundational (Phase 2)**: No changes required; existing sessions, route guard, database transaction helper, and invitation-locking pattern provide the foundation.
- **User Story 1 (Phase 3)**: Can begin immediately; it is the only story and depends on no other feature story.
- **Polish (Phase 4)**: Depends on the US1 implementation and tests being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Independent MVP; no dependencies on other feature stories.

### Within User Story 1

1. T001–T004 are already implemented; T004 was rerun and confirmed red because the login URL lacks the required `activationCode` parameter. T012 adds explicit telemetry redaction coverage before changes.
2. T005 implements the claim transaction; T006 exposes it through the protected route.
3. T007 and T008 can proceed in parallel with the API service/route work after the contract tests are defined; T009 depends on T007 and the claim route contract.
4. T010 documentation updates can proceed independently after the claim semantics are agreed.
5. T013 follows the failing Playwright assertion in T004; T012 can proceed independently. Run T014 only after both are integrated; use a disposable PostgreSQL database.

### Parallel Opportunities

- **Before implementation**: T001, T002, T003, and T004 touch separate test files and can be authored in parallel from the approved contract.
- **During implementation**: T007 (web API client) and T008 (login continuation) can proceed independently of T005/T006; T010 (baseline spec/OpenAPI documentation) is also independent of code changes.
- T005 and T006 are sequential because the route depends on the service behavior; T009 follows T007 and uses the authenticated claim flow.
- T012 can run in parallel with T013 because they touch separate test and UI source files; T014 depends on both.
- There is only one user story, so there is no cross-story parallelism.

---

## Parallel Example: User Story 1

```text
Task: T001 API claim success, changed-year, and mismatch integration coverage
Task: T002 concurrent claim integration coverage
Task: T003 browser API-client claim coverage
Task: T004 end-to-end login-continuation and automatic-claim coverage (done; currently red on missing activationCode)
Task: T012 activationCode telemetry-redaction regression coverage
```

After these tests are written and confirmed failing for the missing behavior, implementation can split across the API transaction, web API/login flow, and contract documentation as described above.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. No project setup or foundational changes are required.
2. Write and run the user-story tests first, using a disposable PostgreSQL database for transactional tests.
3. Implement the authenticated claim operation and invitation-preserving sign-in flow.
4. Complete T012-T013: confirm the activation code is in the login URL, used to resume the invitation after authentication, and excluded from telemetry.
5. Run T014 to validate PostgreSQL, web, E2E, lint, and build checks.

## Notes

- `[P]` means the task touches a separate file and has no dependency on unfinished work.
- Every user-story task carries `[US1]` for traceability.
- Verify the tests fail for the missing claim behavior before implementing it, then rerun against PostgreSQL.
- The pre-existing untracked `apps/api/tests/identity/invitation-claim.integration.test.ts` is a draft for T001; review and complete it rather than replacing unrelated local work.

---

## Phase 5: Clarified Activation-Code-Only Continuation (US1)

**Purpose**: Remove the duplicate return parameter while retaining safe automatic invitation continuation.

**Independent Test**: Open an invitation while signed out, follow the existing-account sign-in link, and verify its URL contains `activationCode` but no `returnTo`. After sign-in, verify the app derives `/invite/{activationCode}`, automatically claims the invitation once, and reaches the learner dashboard with the new course available.

### Tests First

- [X] T015 [US1] Update the returning-learner Playwright case in `apps/web/tests/parent-to-lms.spec.ts` to assert that the login URL contains `activationCode`, has no `returnTo`, and automatically claims the invitation after sign-in

### Implementation

- [X] T016 [US1] Change the sign-in links in `apps/web/src/pages/InvitationPage.tsx` to include only the `activationCode` query parameter
- [X] T017 [US1] Update `apps/web/src/pages/LoginPage.tsx` to validate `activationCode` and derive the local `/invite/{activationCode}` continuation path without reading a `returnTo` parameter

### Validation

- [X] T018 [US1] Run the returning-learner Playwright test against the rebuilt app plus web unit tests, lint, and build per `specs/003-existing-course-linking/quickstart.md`

**Checkpoint**: A signed-out learner returns to and claims only the invitation identified by `activationCode`; ordinary sign-in has no invitation continuation.

### Follow-up Dependencies

1. T015 establishes the regression expectation before implementation.
2. T016 and T017 implement the link and login changes in separate files and may proceed in parallel after T015 is in place.
3. T018 depends on T015-T017.

### Parallel Opportunity

```text
After T015:
Task: T016 Remove returnTo from invitation sign-in links
Task: T017 Derive invitation continuation in LoginPage from activationCode
```
