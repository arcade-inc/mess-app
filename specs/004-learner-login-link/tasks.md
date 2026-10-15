# Tasks: Learner Login Entry on Main Page

**Input**: Design documents from `specs/004-learner-login-link/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui-navigation.md`, `quickstart.md`

**Tests**: Included because the specification defines independently testable signed-out/signed-in journeys and the constitution requires tests first for authorization-sensitive behavior.

**Organization**: Tasks are grouped by user story. The stories share one header component, so implementation proceeds sequentially after each story's tests.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

No setup tasks are required; the React web application, identity API, Playwright projects, and test runner already exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure required before user stories

No foundational tasks are required; this feature adds no shared service, backend route, dependency, or persisted data model.

---

## Phase 3: User Story 1 - Signed-out learner opens sign-in (Priority: P1) 🎯 MVP

**Goal**: Show a clearly emphasized “Sign in” header button to signed-out visitors and route them to the existing sign-in form.

**Independent Test**: With `/api/me` returning unauthenticated, verify the button moves from “Checking…” to “Sign in,” is keyboard operable at desktop and mobile widths, and opens `/login`; verify initial session-check failures remain visible and retryable.

### Tests for User Story 1

> Write and observe the browser tests fail before implementing the initial header state.

- [X] T001 [US1] Add Playwright coverage for the initial “Checking…” state, signed-out “Sign in” label, keyboard navigation to `/login`, and retry after an initial session-check failure in `apps/web/tests/parent-to-lms.spec.ts`.

### Implementation for User Story 1

- [X] T002 [US1] Resolve the initial learner session in `BrandHeader`, show and disable the “Checking…” state while pending, show “Sign in” after an unauthenticated response, surface retryable errors, and keep the existing fresh server check on activation in `apps/web/src/pages/CheckoutPage.tsx`.

**Checkpoint**: A signed-out visitor sees “Sign in” after server confirmation and can reach the existing learner sign-in form with keyboard or pointer input.

---

## Phase 4: User Story 2 - Signed-in learner goes to dashboard (Priority: P1)

**Goal**: Show “Dashboard” only after a valid learner session is confirmed, then route the learner to the dashboard after a fresh activation check.

**Independent Test**: With a valid server session and no local-storage hint, verify the header says “Dashboard” and activation reaches `/dashboard`; if the session expires between initial check and activation, verify the visitor is sent to `/login` rather than receiving dashboard access.

### Tests for User Story 2

> Write and observe these browser regressions fail before adding the authorized header label.

- [X] T003 [US2] Add Playwright coverage for the “Dashboard” label with a valid server session and absent local hint, successful dashboard navigation, and a session expiring before activation in `apps/web/tests/parent-to-lms.spec.ts`.

### Implementation for User Story 2

- [X] T004 [US2] Display “Dashboard” only for the server-confirmed learner state and preserve fresh session verification and fail-closed routing on activation in `apps/web/src/pages/CheckoutPage.tsx`.

**Checkpoint**: Signed-out and signed-in labels are correct, while the dashboard continues to enforce its own authentication and enrollment-entitlement checks.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validate the completed journeys and preserve security/accessibility guarantees.

- [X] T005 Run unit tests, focused and full browser regression commands, web build, and lint from `specs/004-learner-login-link/quickstart.md`; resolve any regressions in the affected web files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No work; existing project infrastructure is used.
- **Foundational (Phase 2)**: No work; no shared prerequisite is introduced.
- **User Story 1 (Phase 3)**: Can start immediately.
- **User Story 2 (Phase 4)**: Depends on the initial server-verified header state introduced in User Story 1.
- **Polish (Phase 5)**: Depends on both user stories.

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies; provides initial session resolution, the signed-out label, and login route.
- **User Story 2 (P1)**: Extends the shared header state with the server-confirmed “Dashboard” label and authenticated route.

### Within Each User Story

- Tests MUST be written and observed failing before their implementation task.
- T002 precedes T003/T004 because the initial session lookup and signed-out behavior are shared prerequisites; T003 must fail on the missing “Dashboard” label before T004.
- T005 runs after both user stories.

### Parallel Opportunities

- No tasks are marked parallel: each story's test and implementation touch the same browser spec or header component, and User Story 2 depends on User Story 1's initial session state.

---

## Parallel Example: User Story 1

```text
Execute sequentially:
T001 — add and verify failing signed-out browser tests
T002 — implement initial session resolution and signed-out header behavior
```

---

## Implementation Strategy

### MVP First

1. Complete User Story 1 and validate the signed-out label, pending/error states, and sign-in route.
2. Complete User Story 2 and validate the authorized label and dashboard navigation.
3. Run T005 before considering the feature complete.

User Story 1 is a useful first slice, but both P1 stories are required for the full feature.

## Notes

- Task count: 5 total — 2 for User Story 1, 2 for User Story 2, and 1 cross-cutting validation task.
- Every task has a sequential ID, checkbox, correct story label where applicable, and an exact repository path.
- The implementation reuses the existing forced server session lookup; no identity API, schema, backend endpoint, dependency, parent checkout, or invitation changes are planned.
- Validation completed: 22/22 web unit tests, 12/12 focused login-entry browser checks across desktop/mobile, 28/28 non-tracing browser regressions, web build, and lint passed. The optional tracing-specific test was not rerun; it requires the tracing Compose overlay.
