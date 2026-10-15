# Data Model: Learner Login Link on Main Page

This feature introduces no persisted entities, fields, relationships, or database state transitions. It reads the existing learner session to choose the header label and navigation destination; the session and course-entitlement data models remain unchanged.

## Transient Header State

- **Checking**: The initial server session check is pending; show “Checking…” and do not activate navigation.
- **Signed out**: The server confirms no learner session; show “Sign in.”
- **Signed in**: The server confirms the learner session; show “Dashboard.”
- **Verification error**: Do not infer a signed-in state; show a visible error and allow the learner to retry.

## Validation and Authorization

- A learner is treated as signed in only after the server confirms the existing session.
- A browser-side authentication hint is not authoritative.
- The dashboard continues to validate the session and active-course entitlements independently.
