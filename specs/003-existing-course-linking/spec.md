# Feature Specification: Existing Account Course Linking

**Feature Branch**: `003-existing-course-linking`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Allow a learner with an existing account to add a newly purchased course from its invitation without creating another account. Keep the activation code in the invitation URL. If the learner is signed out, return them to the invitation after sign-in and activate the purchase automatically. Match learners by name, ignoring letter case and extra whitespace; do not compare school year or age, since these may change between purchases. If the invitation belongs to another learner, show: ‘This course belongs to another learner.’"

## Clarifications

### Session 2026-10-15

- Q: Should the activation code stay in the invitation URL through sign-in and automatically activate the course after successful sign-in? → A: Keep the activation code in the URL and use the existing authenticated session only to identify the learner; opening the invitation while signed in or returning to it after sign-in automatically claims the course without a separate claim action.
- Q: Should the sign-in link include the activation code as an explicit parameter as well as returning to the invitation URL? → A: Include an explicit `activationCode` parameter and use it to resume automatic claiming after sign-in; do not store it in a cookie.
- Q: Should the sign-in continuation be covered by a browser end-to-end test? → A: Yes. A Playwright test must verify that the sign-in link contains the activation code and that signing in automatically returns to the invitation and claims it.

- Q: Should sign-in carry only `activationCode` and derive the invitation return path from it, rather than duplicating the same code in a `returnTo` parameter? → A: Yes. The login link carries only `activationCode`; after successful sign-in, the app constructs `/invite/{activationCode}` as the return path and automatically resumes claiming.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a Purchased Course to an Existing Account (Priority: P1)

A learner with an existing account opens a valid invitation for a new purchase. If they are signed in and the learner name on the invitation matches the name on their account, the purchased course is automatically added to their account—even if the school year differs from the one currently on the account. If they are signed out, they can sign in from the invitation; the course is added automatically when they return to it.

**Why this priority**: A learner must be able to use a paid course through their existing account. Requiring a duplicate account would be confusing and keep their courses split across accounts.

**Independent Test**: Create an account and purchase another course for the same learner. In a Playwright end-to-end test, open the new invitation while signed out and verify that the sign-in link contains `activationCode` without a duplicate return parameter. Sign in and verify that the app returns to the matching invitation, claims it automatically, and displays the course in the existing account without requiring a separate claim action. Repeat with a different learner name and verify that access is not granted.

**Acceptance Scenarios**:

1. **Given** a valid unused invitation and an authenticated account whose learner name matches after trimming whitespace, collapsing repeated spaces, and ignoring letter case, **When** the learner opens the invitation, **Then** its purchased course access is linked to that account and becomes available without creating another account or requiring another claim action.
2. **Given** the invitation learner name matches but its school year differs from the account's current school year, **When** the authenticated learner opens the invitation, **Then** the purchase is still added to the account.
3. **Given** an existing-account learner opens an invitation while signed out, **When** they follow a sign-in link containing the explicit activation code, **Then** after sign-in the app derives the invitation path from that code and automatically claims the invitation if the learner name matches, without a separate claim action.
4. **Given** an authenticated account whose learner name does not match the invitation after normalization, **When** the learner opens the invitation, **Then** the system refuses the claim and displays “This course belongs to another learner.”
5. **Given** an invitation is invalid, expired, superseded, or already claimed, **When** the learner opens it, **Then** no new access is granted and a clear error is shown.
6. **Given** two claim attempts race for the same invitation, **When** both are submitted, **Then** at most one claim succeeds and the purchase is not partially linked.

### Edge Cases

- The account name and invitation name differ only in letter case, leading/trailing whitespace, or repeated spaces; these differences do not prevent a match.
- The authenticated account belongs to a different learner; the invitation remains unused and no access changes.
- School year has changed since the previous purchase; it is not used to reject a matching learner.
- The learner signs in from an invitation link, but the invitation expires or is claimed before they return; the claim fails without changing account access.
- A learner visits an invitation while already signed in; a valid matching invitation is automatically claimed, while a name mismatch is refused.
- A claim is retried after success; the invitation cannot grant access a second time.
- Ordinary sign-in without an invitation does not change course access.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authenticated learner to add a valid, unused purchased course invitation to their existing account without creating a second account.
- **FR-002**: The system MUST require an authenticated learner and possession of the valid invitation before linking its purchased access to the account.
- **FR-003**: The system MUST compare the invitation learner name with the authenticated account name after trimming leading/trailing whitespace, collapsing repeated whitespace, and ignoring letter case.
- **FR-004**: The system MUST NOT use school year or age as a condition for matching an invitation to an existing account.
- **FR-005**: When the learner names do not match, the system MUST refuse to link the purchase, leave the invitation and access unchanged, and display “This course belongs to another learner.”
- **FR-006**: When an existing-account learner must sign in, the sign-in link MUST include the activation code as an explicit `activationCode` parameter and MUST NOT duplicate it in a separate return parameter. After successful sign-in, the system MUST construct the invitation path from the validated activation code and resume the automatic claim. The code MUST NOT be stored in a cookie.
- **FR-007**: When an authenticated learner opens a valid invitation, the system MUST automatically claim it if the learner name matches; after sign-in from an invitation, the system MUST automatically resume and claim that invitation if it matches.
- **FR-008**: Claiming an invitation MUST link the invitation's purchased student access to the authenticated account and grant access only to those purchased courses.
- **FR-009**: Invitation claiming MUST preserve existing single-use and expiration behavior and MUST NOT allow invalid, expired, superseded, or previously claimed invitations to grant access.
- **FR-010**: The system MUST keep the claim all-or-nothing so that invitation state, account association, and purchased course access cannot be left partially updated.
- **FR-011**: The system MUST ensure retries or concurrent attempts cannot claim the same invitation more than once.
- **FR-012**: The system MUST NOT expose invitation secrets or account credentials in user-visible errors, logs, or telemetry.

### Key Entities *(include if data involved)*

- **Learner Account**: The existing authenticated identity to which purchased course access may be added; its learner name is used for matching.
- **Invitation**: A time-limited, single-use proof of a paid student purchase, associated with a learner name and school year.
- **Student Purchase Slot**: The purchased learner details associated with one or more course access grants.
- **Course Access Grant**: The purchased access for a course, initially pending and made available to the matched learner account after a successful claim.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested valid, matching-name cases, a learner can add a later purchase to their existing account without creating a duplicate account.
- **SC-002**: In 100% of tested cases where the learner names do not match, no access is added and the specified “This course belongs to another learner.” message is shown.
- **SC-003**: In 100% of tested cases with matching names and changed school year, the learner can claim the purchase.
- **SC-004**: In 100% of tested sign-in continuation cases, the sign-in link contains the explicit activation code without a duplicate return parameter, and the matching invitation is automatically claimed after sign-in; ordinary sign-in without an invitation leaves course access unchanged.
- **SC-005**: In 100% of invalid, expired, superseded, reused, repeated, or concurrent claim cases, no invitation grants more than one activation and no partial account/access state is left behind.
- **SC-006**: At least 9 out of 10 participants in a usability walkthrough can sign in from a new course invitation and add it to the right existing account without assistance or creating a duplicate account.

## Assumptions

- The current email/password account and authenticated session remain the means of identifying an existing learner; this feature does not add account recovery or new authentication methods. The sign-in link carries only the activation code for continuation; the app derives the invitation path from it, while the authenticated session establishes learner identity. The code is not stored in a cookie.
- The invitation is a bearer credential for a paid purchase; possession of it and a matching authenticated learner name are required to claim.
- Name matching is case-insensitive and ignores leading, trailing, and repeated whitespace, but does not attempt fuzzy matching, nickname matching, or transliteration.
- A learner may have multiple student purchase slots over time; each invitation retains the purchased learner details, and school year may differ from the account's current year.
- The existing purchase, invitation lifetime, and course entitlement rules remain in force; this feature changes how valid purchased access can be associated with an existing learner account.
- Signing in from an invitation returns the learner to `/invite/{activationCode}` derived from the activation code; if the code is still valid and its learner name matches, the course is automatically added without a separate review/claim action.
