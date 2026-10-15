# Data Model: Parent Contact and Mock Payment

This feature extends the existing logical entities from
[the parent-to-LMS data model](../001-mes-learning-journey/data-model.md); it does not introduce a
new persistence subsystem.

## Entities

### Parent Contact

- **Purpose**: Identifies the purchaser and destination for purchase/invitation communication.
- **Fields**: Existing parent identifier, name, canonical email. The email-confirmation input is
  transient form data and is not persisted.
- **Relationships**: Belongs to an order through the existing parent/order relationship.
- **Validation**: Name is required; email must be valid; normalized confirmation must match before
  checkout proceeds. The server persists the trimmed, lower-case email used by existing behavior.

### Mock Payment Attempt

- **Purpose**: Captures the result of the simulated payment associated with an order.
- **Fields**: Existing payment identifier, order, method/provider label, reference, outcome, and
  server-calculated amount.
- **Relationships**: Belongs to one order.
- **State**: Existing order lifecycle remains `PENDING_PAYMENT → PAID | FAILED`; payment outcome is
  `SUCCEEDED | FAILED`.
- **Validation**: Method identifier must be one of the supported mock choices. Amount and currency
  are derived from the server catalog and cannot be overridden by the browser. No real payment
  credentials are accepted or stored.

### Simulated Invitation Confirmation

- **Purpose**: Gives the parent immediate confirmation after successful mock payment and explains
  where student activation details are represented as having been sent.
- **Fields**: Validated parent email for display, number of student activation links, and the
  seven-day activation period. This is transient presentation data, not a new persisted entity.
- **Relationships**: Derived from the successful order, parent contact, and invitation set.
- **Validation**: Show only after payment succeeds; label the email sending as simulated and do not
  claim a real email provider delivered the message. Do not store email-confirmation values or expose
  invitation tokens in logs or telemetry.

## Invariants

- Parent contact must pass validation before the payment stage is reachable.
- Returning from payment to edit parent contact invalidates/rechecks the confirmation before payment
  submission.
- Each user-initiated checkout attempt retains the existing idempotency guarantees; repeated submit
  or page refresh must not create another order or set of invitations.
- Failed or cancelled mock payment creates no successful invitation grant or purchase confirmation.
- The simulated confirmation appears after successful mock payment and does not alter the existing
  asynchronous email/outbox lifecycle.
