# Implementation Plan: Learner Login Link on Main Page

**Branch**: `004-learner-login-link` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-learner-login-link/spec.md`

## Summary

Add a keyboard-accessible, slightly emphasized learner-access button at the far right of the root landing-page header after “For curious minds.” Resolve its label from the server-confirmed learner session: “Sign in” when signed out and “Dashboard” when signed in. The initial session check determines the label; activating the button performs a fresh server check before navigating, so the label or a browser hint never grants dashboard access. Reuse existing login, session, and dashboard behavior; make no persisted data-model, backend endpoint, or dependency changes. Preserve the dashboard’s server-side authentication and entitlement checks.

## Technical Context

**Language/Version**: TypeScript 6.0, React 19

**Primary Dependencies**: Existing React web application, browser Fetch API, and Playwright; no new dependencies

**Storage**: No new or changed persistence. Existing learner session is cookie-backed; local storage contains only an optimization hint.

**Testing**: Node.js built-in test runner for web API/session utility tests; Playwright desktop and mobile browser tests; TypeScript/Vite build and ESLint

**Target Platform**: Responsive web browsers, desktop and mobile

**Project Type**: Web application; scope is the frontend landing-page navigation and session-aware routing

**Performance Goals**: One current-student check to resolve the header label per landing-page load and one fresh server session check per activation; prevent duplicate activation while navigation is pending

**Constraints**: Must not treat the local-storage authentication hint as proof of identity. Session verification errors must fail closed and provide a visible retry/error path. Keep existing dashboard authorization unchanged.

**Scale/Scope**: One stateful header button and its two navigation outcomes on `/`; no account, checkout, invitation, backend, or database scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Ship the Complete Core Journey**: PASS — adds an entry point without interrupting checkout, invitation, onboarding, or learning journeys.
- **II. Entitlement Is the Authorization Boundary**: PASS — the button label and navigation destination follow server-confirmed learner identity; the dashboard continues enforcing session and enrollment entitlements itself. A client-side hint is never accepted as authorization.
- **III. Specify Risky Behavior with Tests First**: PASS — browser coverage exercises signed-out and signed-in labels, missing-hint session detection, activation routing, and session-check failure outcomes before implementation is considered complete.
- **IV. Protect Identity, Secrets, and Children's Data**: PASS — no new personal data or secrets; no credentials or session values are logged.
- **V. Prefer Explicit Seams and the Smallest Adequate Design**: PASS — reuse existing identity API and page structure; no new dependency, service, or endpoint.
- **Gate result**: PASS; no constitution exceptions or complexity justification required.

## Phase 0: Research

Research is consolidated in [research.md](research.md). Existing root-page composition, identity APIs, session hints, login/dashboard behavior, and test patterns were inspected. No unresolved technical questions remain.

## Phase 1: Design & Contracts

- [Data model](data-model.md): no persisted model or schema changes.
- [UI navigation contract](contracts/ui-navigation.md): specifies the stateful button’s label, placement, verification, routing, failure, and accessibility behavior.
- [Quickstart](quickstart.md): provides focused test, browser, build, and lint verification steps.

### Implementation Structure

```text
apps/web/src/pages/CheckoutPage.tsx       # Root page and local BrandHeader
apps/web/src/api/identity.ts              # Existing learner session lookup
apps/web/src/pages/LoginPage.tsx          # Existing signed-out destination
apps/web/src/pages/DashboardPage.tsx      # Existing session/entitlement-guarded destination
apps/web/tests/identity-api.test.ts       # Session lookup behavior tests
apps/web/tests/parent-to-lms.spec.ts      # Desktop/mobile end-to-end coverage
```

**Structure Decision**: Keep the change in the existing web app. Reuse the identity current-student lookup in the root page header to resolve the initial label and revalidate on activation; add coverage to the established web API and Playwright test suites. Keep the existing identity abstraction; do not create a shared navigation framework for this single entry point.

## Constitution Check (Post-Design)

- **I. Core journey**: PASS — all existing purchase and learning paths remain unchanged.
- **II. Authorization boundary**: PASS — server verification controls the header label and destination; the dashboard independently authenticates and enforces entitlements.
- **III. Tests first**: PASS — tests cover state-dependent labels, server-confirmed session state, absent/stale client hints, failed checks, and activation behavior.
- **IV. Identity and privacy**: PASS — no new stored personal information; do not log session or credential data.
- **V. Smallest adequate design**: PASS — no schema, backend route, dependency, or broad navigation abstraction.
- **Gate result**: PASS.

## Complexity Tracking

No constitution violations; no additional complexity is introduced.
