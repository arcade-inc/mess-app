# Research: Learner Login Link on Main Page

## Existing Flow and Structure

- The root URL renders `CheckoutPage` through `apps/web/src/router.tsx`.
- `CheckoutPage` owns a local `BrandHeader`, making it the narrowest place to expose this main-page-only learner access button.
- `/login` renders `LoginPage`; `/dashboard` renders `DashboardPage`.
- `DashboardPage` checks the learner session and redirects unauthenticated visitors to `/login`; it remains the authoritative guard for dashboard content.
- The project uses React and TypeScript, Node's built-in test runner, and Playwright desktop/mobile projects.

## Decision: Resolve the Header Label from a Server-Confirmed Session

**Decision**: On landing-page load, check the current learner with the server and display “Dashboard” only after a valid learner session is confirmed; otherwise display “Sign in.” While the initial check is pending, show a temporary “Checking…” label and prevent activation until the destination is known. When the learner activates the button, perform a fresh server-backed current-student check before navigation: route a confirmed learner to `/dashboard`, an unauthenticated visitor to `/login`, and on unexpected failure remain on the main page with a visible retryable error.

**Rationale**: The label itself communicates the learner's session state, so it must be based on server confirmation rather than a local hint. The existing `getCurrentStudent()` function avoids calling `/api/me` when its local-storage hint is absent. A valid cookie session can exist even if that hint was cleared, so both initial label resolution and activation must use explicit server verification. Rechecking on activation prevents a stale label from becoming authorization. Keeping the dashboard's own guard ensures that a client-side navigation decision cannot grant access.

**Alternatives considered**:

- **Display “Dashboard” based only on the local-storage hint**: rejected because the hint can be absent, stale, or modified and must not be trusted as authentication.
- **Check only when the button is activated**: rejected because the button must show “Dashboard” for an already-authorized learner before activation.
- **Add a new backend endpoint or global navigation/authentication framework**: rejected because the existing identity session endpoint and page-local header are sufficient.

## Decision: Keep Scope Frontend-Only

**Decision**: Reuse the existing cookie-backed session, login form, dashboard, and entitlement checks. Add no database, API contract, dependency, or account-flow changes.

**Rationale**: The requested behavior is discoverability and destination selection, not a new authentication mechanism. This is the smallest change consistent with the project constitution.

**Alternatives considered**: New login form on the landing page, new sign-in method, and parent checkout/invitation changes were excluded because the user chose a stateful header button and existing learner authentication.

## Verification Research

- Unit/session API tests can cover explicit server verification when the local hint is absent and error handling when `/api/me` fails.
- Existing Playwright tests mock `/api/me`; cover signed-out and signed-in header labels, no-hint-but-valid-cookie detection, fresh activation verification, and verification failure. Existing Playwright projects provide desktop and mobile browser coverage.
- Run the web test suite, focused and full browser tests, build, and lint as documented in [quickstart.md](quickstart.md).
