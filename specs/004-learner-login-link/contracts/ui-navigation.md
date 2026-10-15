# UI Navigation Contract: Learner Login Link

## Entry Point

- The root landing page presents a visible, semantic learner-access button at the far right of its header, after “For curious minds,” with slightly greater visual emphasis than the surrounding header styling.
- After the initial server check, the button says “Sign in” when no valid learner session exists and “Dashboard” when a valid learner session is confirmed.
- While the initial session check is pending, the button says “Checking…” and cannot be activated.
- The button is keyboard focusable, has an accessible name, and remains usable at desktop and mobile viewport widths.

## Activation Outcomes

1. On landing-page load, the application confirms the learner session with the server to determine the button label; a local-storage hint alone MUST NOT determine the label.
2. On activation, the application MUST perform a fresh server session check; a local-storage hint alone MUST NOT determine the destination.
3. If the server confirms a learner session, show “Dashboard” and navigate to `/dashboard` on activation.
4. If the server confirms there is no learner session, show “Sign in” and navigate to `/login` on activation.
5. While session verification is pending, prevent duplicate activation/navigation.
6. If session verification fails unexpectedly, do not show an authenticated label or navigate to the dashboard; show a visible error and allow retry.
7. The dashboard independently authenticates the learner and checks course entitlements; this UI contract does not grant access.

## Out of Scope

- New authentication methods, password recovery, account creation, parent checkout, and invitation activation.
- Changes to login, dashboard, or server authorization behavior beyond the session lookup needed to select the destination.
