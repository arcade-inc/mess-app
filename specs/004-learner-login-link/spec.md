# Feature Specification: Learner Login Link on Main Page

**Feature Branch**: `004-learner-login-link`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Add a learner sign-in link to the main page so learners can easily reach their dashboard. Show the sign-in form to learners who are not signed in; show the dashboard to learners with a valid session. Use a sign-in link in the page header."

## Clarifications

### Session 2026-10-15

- Q: What label, placement, and visual emphasis should the main-page learner sign-in entry use? → A: Use “Sign in,” place the button at the far right of the header after “For curious minds,” and give it the same style with slightly more emphasis.
- Q: What should the header button say when a learner is authorized? → A: Display “Dashboard” when the server confirms a valid learner session; otherwise display “Sign in.”

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Signed-out learner opens sign-in (Priority: P1)

A learner who is signed out visits the main page and selects the visible “Sign in” button to open the learner sign-in form.

**Why this priority**: It makes the existing learner sign-in flow easy to find from the main page.

**Independent Test**: Visit the main page without a learner session, select “Sign in,” and verify that the learner sign-in form appears.

**Acceptance Scenarios**:

1. **Given** a visitor without a valid learner session is on the main page, **When** the server confirms no valid session, **Then** the header button says “Sign in.”
2. **Given** a visitor without a valid learner session activates “Sign in,” **When** navigation completes, **Then** the learner sign-in form is displayed.
3. **Given** a visitor without a valid learner session activates “Sign in,” **When** the sign-in form is displayed, **Then** they can use the existing learner credentials to sign in.

---

### User Story 2 - Signed-in learner goes to dashboard (Priority: P1)

A learner with a valid session visits the main page, sees the “Dashboard” button, and selects it to open their dashboard.

**Why this priority**: Returning learners should be able to reach their dashboard without signing in again.

**Independent Test**: Visit the main page with a valid learner session, verify that the header button says “Dashboard,” select it, and verify that the learner's dashboard appears.

**Acceptance Scenarios**:

1. **Given** a learner with a valid session is on the main page, **When** the server confirms the session, **Then** the header button says “Dashboard.”
2. **Given** a learner with a valid session is on the main page, **When** they activate “Dashboard,” **Then** they are taken directly to their dashboard.
3. **Given** the visitor has no valid learner session, **When** they activate “Sign in,” **Then** dashboard content is not shown and the sign-in form is displayed instead.

---

### Edge Cases

- If the learner’s session cannot be confirmed, the visitor is not treated as authenticated and does not receive dashboard access; the existing sign-in/session error behavior is shown.
- If a session expires after the main page is loaded but before the learner reaches the dashboard, the existing authentication behavior asks the learner to sign in.
- The “Sign in” button appears at the far right of the main-page header, after “For curious minds,” and is slightly more emphasized than the surrounding header styling.
- The “Sign in” entry remains usable on narrow/mobile layouts and through keyboard navigation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The main page MUST provide a visible learner-access button at the far right of its header, after “For curious minds,” with slightly greater visual emphasis than the surrounding header styling.
- **FR-002**: Activating “Sign in” without a valid learner session MUST take the visitor to the existing learner sign-in form.
- **FR-003**: Activating “Dashboard” with a valid learner session MUST take the learner directly to their dashboard.
- **FR-004**: The system MUST NOT display learner dashboard content until a valid learner session has been confirmed.
- **FR-005**: The header button MUST remain perceivable and operable at supported screen sizes and without pointer input, whether it displays “Sign in” or “Dashboard.”
- **FR-006**: The header button MUST display “Dashboard” when the server confirms a valid learner session and “Sign in” when no valid learner session is confirmed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of signed-out test journeys, a learner can reach the sign-in form from the main page with one activation of “Sign in.”
- **SC-002**: In 100% of valid-session test journeys, the header displays “Dashboard” and the learner reaches their dashboard with one activation, without entering credentials again.
- **SC-003**: In 100% of unauthenticated or unverified-session test journeys, dashboard content remains unavailable until the learner signs in.
- **SC-004**: Learners can identify and operate the header button using both keyboard navigation and a narrow/mobile viewport, whether it displays “Sign in” or “Dashboard.”

## Assumptions

- The main page is the site’s root landing page.
- The existing learner sign-in form, credentials, session handling, and dashboard remain the source of truth; this feature adds an entry point rather than a new authentication flow.
- The link is for learners. Parent checkout and invitation activation are unchanged.
- Existing session-check and sign-in error messages are reused when session status cannot be confirmed.
