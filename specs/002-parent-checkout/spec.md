# Feature Specification: Parent Contact and Mock Payment

**Feature Branch**: `002-parent-checkout`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Group the parent's or guardian's name, email address, and email confirmation fields together. Add a separate mock payment step with recognizable options such as Visa, Mastercard, and Apple Pay, making clear that no real payment is taken. After a successful mock payment, show a confirmation saying that the invitation links were sent to the parent's email address, while making clear that email delivery is simulated."

## Clarifications

### Session 2026-10-15

- Q: Should the confirmation appear as soon as mock payment succeeds, treating email delivery as simulated, or only after the email sender confirms delivery? → A: Show it immediately after successful mock payment and label it as simulated; include the parent's email and the existing 7-day activation period.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enter Parent Contact Details (Priority: P1)

The parent enters their name, email address, and matching email confirmation in a clearly grouped contact section before proceeding to payment.

**Why this priority**: The parent's email address is where student invitation links are sent; an incorrect address could send them to the wrong recipient.

**Independent Test**: Submit valid parent contact details and verify that checkout can proceed. Then submit a malformed email address or mismatched email fields and verify that checkout is blocked.

**Acceptance Scenarios**:

1. **Given** a parent is completing checkout, **When** they enter a name and matching valid email and confirmation, **Then** the parent details are accepted and clearly associated with the purchase.
2. **Given** the email is malformed or the confirmation differs, **When** the parent attempts to continue, **Then** checkout is blocked and the relevant field receives a clear explanation.
3. **Given** a required parent field is empty, **When** the parent attempts to continue, **Then** checkout is blocked and the missing information is identified.

---

### User Story 2 - Complete a Mock Payment (Priority: P1)

A parent proceeds to a separate payment stage, sees that payment is simulated, selects a clearly labeled mock payment method such as Visa, Mastercard, or Apple Pay, and completes the mock payment.

**Why this priority**: A separate payment step makes the purchase journey clear without connecting to a real payment provider or collecting payment credentials.

**Independent Test**: Complete checkout using a mock method and verify that success appears only after the simulated payment succeeds and that no real charge is made.

**Acceptance Scenarios**:

1. **Given** valid parent and purchase details, **When** the parent continues, **Then** a separate payment stage shows the purchase total, mock method choices, and a clear indication that no real payment will be taken.
2. **Given** the parent has not selected a mock payment method, **When** they try to pay, **Then** payment does not complete and they are asked to choose a method.
3. **Given** the parent selects a mock method and confirms payment, **When** the simulation succeeds, **Then** checkout reaches its success outcome.
4. **Given** the mock payment is unsuccessful, **When** checkout reports the failure, **Then** the parent sees a recoverable message and no success confirmation or student invitation is issued.

---

### User Story 3 - Confirm Invitation Email Delivery (Priority: P1)

After a successful mock payment, the parent sees a prominent purchase confirmation saying that the course details and student activation links were sent to their email address. The notice makes clear that email delivery is simulated and that student accounts must be activated within seven days.

**Why this priority**: The parent needs a clear confirmation of the purchase and information about where to find the student links.

**Independent Test**: Complete a successful mock purchase and verify that the confirmation names the parent's email address, identifies email delivery as simulated, and states the seven-day activation period. Also verify that the confirmation is not shown when payment fails.

**Acceptance Scenarios**:

1. **Given** a successful mock payment and parent email, **When** the purchase completes, **Then** a prominent confirmation states that course details and student activation link(s) were sent to that address as a simulation, and that activation must occur within 7 days.
2. **Given** payment fails, **When** the checkout outcome is displayed, **Then** no successful-payment or email-sent confirmation is shown.
3. **Given** the purchase includes multiple students, **When** payment succeeds, **Then** the confirmation indicates that activation links for all purchased students were sent to the parent email as a simulation.

### Edge Cases

- Parent email and confirmation differ by case, whitespace, or a single character; comparison follows normalized email input and still rejects genuinely different addresses.
- The parent changes the email after confirming it; the confirmation must be revalidated before proceeding.
- The parent returns from the payment stage to edit contact details; the displayed payment destination and final delivery confirmation use the latest accepted address.
- A payment attempt is repeated or the success screen is refreshed; the journey must not imply multiple purchases or issue duplicate invitations.
- The payment simulation fails or is cancelled; no invitation-sent confirmation is displayed.
- Email delivery is simulated in this flow; the confirmation must not imply that a real email provider delivered a message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Checkout MUST present the parent's name, email address, and email confirmation as a clearly grouped set of parent contact fields.
- **FR-002**: Checkout MUST require a non-empty parent name and a valid email address before the parent can proceed.
- **FR-003**: Checkout MUST require the parent email confirmation to match the entered email address and MUST explain validation errors in context.
- **FR-004**: The parent MUST be able to review and correct contact information before confirming payment; changes MUST be revalidated.
- **FR-005**: Checkout MUST present a distinct payment stage showing the amount due and selectable mock payment methods, including recognizable options such as Visa, Mastercard, and Apple Pay.
- **FR-006**: The payment stage MUST clearly state that methods and payment are simulated and MUST NOT collect real card details or initiate a real charge.
- **FR-007**: The system MUST not report payment success until the mock payment action has completed successfully.
- **FR-008**: After successful mock payment, the system MUST show a prominent purchase confirmation stating that course details and student activation link(s) were sent to the validated parent email as a simulation, and that activation must occur within 7 days.
- **FR-009**: The system MUST NOT show a successful payment or email-sent confirmation when payment fails or is cancelled.
- **FR-010**: The purchase outcome MUST remain consistent with existing checkout behavior: payment failure MUST NOT create confirmed access grants or invitations.
- **FR-011**: The mock methods MUST be presented as examples of payment choices, not as evidence of real provider integrations.

### Key Entities *(include if feature involves data)*

- **Parent Contact**: The purchaser's name and validated email address used for purchase communication and invitation delivery.
- **Mock Payment Attempt**: A simulated attempt to pay the displayed purchase total using a selected mock method, ending in success, failure, or cancellation.
- **Invitation Delivery Confirmation**: The user-visible, explicitly simulated confirmation associated with successful purchase, naming the parent email and 7-day activation period.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability walkthroughs, at least 9 out of 10 participants can identify the parent's name and email fields and complete valid parent contact entry without assistance.
- **SC-002**: All tested malformed, missing, or non-matching email inputs prevent checkout from advancing and provide an actionable explanation.
- **SC-003**: At least 9 out of 10 participants can distinguish the mock payment stage from a real payment and complete it using a mock method in under 1 minute.
- **SC-004**: In 100% of tested successful mock purchases, the parent sees a prominent, explicitly simulated confirmation naming the validated email address and stating the 7-day activation period.
- **SC-005**: In 100% of tested failed or cancelled payment attempts, no successful-payment or invitation-sent confirmation is shown and no access grant or invitation is issued.

## Assumptions

- Parent contact information is part of the existing unauthenticated purchase flow; this feature does not add parent accounts or sign-in.
- Mock payment method names and marks are illustrative only; no real payment provider integration, card data entry, or charge is in scope.
- The existing checkout handles purchase pricing, student details, and invitation creation; this feature clarifies the parent contact and payment stages and their user-facing outcomes.
- The confirmation is shown immediately after successful mock payment and represents email sending as simulated; no real email delivery is claimed. The existing invitation expiration is seven days.
- Email address normalization may ignore surrounding whitespace and letter case, but must not treat distinct addresses as matching.
- This remains a demonstration flow and makes no claim of production payment, email-delivery, or regulatory readiness.
