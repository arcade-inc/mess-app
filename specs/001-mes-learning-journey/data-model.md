# Data Model: MES Parent-to-LMS Journey

This is the logical model for the feature; implementation details and physical constraints follow
the existing schema direction in `docs/blueprint-draft.md`.

## Entities

### Parent

- **Purpose**: Purchases one or more courses for one or more children.
- **Fields**: identifier, name, email.
- **Relationships**: places orders.
- **Rules**: No parent account is required in this version; collect only checkout-required details.

### Order

- **Purpose**: Records a mock purchase and its result.
- **Fields**: identifier, parent, status, total amount, currency, idempotency identity, canonical request fingerprint, timestamps.
- **Relationships**: belongs to one parent; contains student slots and course items; may have payment records.
- **State**: `PENDING_PAYMENT → PAID | FAILED`.
- **Rules**: Prices and total are computed from the current catalog by the server. Validate before claiming an idempotency identity (maximum 255 characters). The client creates a fresh identity for each user attempt and reuses it only for transport retries. A repeated identity with a different request is rejected with 422; a concurrent in-progress duplicate is retryable with 409. Payment failure creates no entitlements or invitations.

### Student Slot

- **Purpose**: Represents one child in one order before the student account exists.
- **Fields**: identifier, order, student name, school year, optional activated student identity.
- **Relationships**: belongs to one order; groups course items, pending/active enrollments, and its invitation; may be linked to one student after onboarding.
- **Rules**: School year is in the supported range; selected courses must be eligible for that year.

### Order Item

- **Purpose**: Captures one purchased course for a student slot.
- **Fields**: identifier, order, student slot, course, snapshotted unit price.
- **Relationships**: belongs to one order and one student slot; refers to one course; produces one enrollment.
- **Rules**: A slot cannot purchase the same course twice in one order.

### Course

- **Purpose**: A catalog offering available for purchase and learning.
- **Fields**: identifier, subject, minimum and maximum eligible school year, price in currency minor units, currency.
- **Relationships**: has lessons; may appear in order items and enrollments.
- **Rules**: Minimum year does not exceed maximum; purchase price is never taken from the browser.

### Student

- **Purpose**: The learner identity that authenticates to the LMS.
- **Fields**: identifier, unique email, name, school year, password hash.
- **Relationships**: owns active enrollments; may be linked to the originating student slot.
- **Rules**: Credentials are never stored or logged in plaintext; an existing email cannot create a duplicate account through onboarding.

### Enrollment (Student Access Grant)

- **Purpose**: Expresses the student's entitlement to one purchased course.
- **Fields**: identifier, order item, student slot, course, optional student, status, activation time.
- **Relationships**: belongs to one order item, slot, and course; linked to a student on activation.
- **State**: `PENDING → ACTIVE`; `REVOKED` is reserved for future refund handling.
- **Rules**: Only an `ACTIVE` enrollment belonging to the authenticated student grants course/lesson access.

### Invitation

- **Purpose**: Allows the intended student to claim a student slot and activate its enrollments.
- **Fields**: identifier, student slot, token hash, expiry, used time, superseded time.
- **Relationships**: belongs to one student slot; may be replaced by a later reminder invitation.
- **Rules**: Token has high entropy; only its hash is persisted; it is single-use, expires within a bounded period, and only one invitation is live per slot. Claiming is atomic. Token rotation locks the current invitation state before superseding it and inserting its replacement.

### Payment

- **Purpose**: Records the mock payment attempt and outcome.
- **Fields**: identifier, order, provider label, provider reference, status, amount.
- **Relationships**: belongs to one order.
- **Rules**: The v1 provider is simulated; no real payment is initiated.

### Lesson

- **Purpose**: Learning content inside a course.
- **Fields**: identifier, course, position, title, text body.
- **Relationships**: belongs to one course.
- **Rules**: Content is available only through an active enrollment; text content is not interpreted as executable markup.

### Outbox Message (T2)

- **Purpose**: Durable work item for purchase confirmation and optional invitation reminders.
- **Fields**: identifier, message type, payload, state, attempt count, scheduled time, dedupe identity, lease expiry (`locked_until`), last error, optional sanitized W3C `trace_context` carrier (`traceparent` and optional `tracestate`; no baggage). A pending delivery may carry an authenticated-encrypted invitation token envelope for retry stability; plaintext tokens are never stored in the outbox.
- **Relationships**: describes a committed domain event such as paid order or invitation reminder.
- **State**: `PENDING → PROCESSING → SENT | SKIPPED | FAILED`; retry returns to pending with a future run time.
- **Rules**: Created with related domain changes in one transaction, and insertion success is checked before commit. Checkout creates one confirmation and one reminder per student slot; reminders are due seven days after purchase. Claiming sets a bounded lease (initially two minutes) in a short transaction; network delivery happens after commit; completion/retry is recorded in a separate short transaction. Expired leases permit crash recovery. Invitation emails replace the prior invitation with a newly generated seven-day link; encrypted token material is reused across retries and removed after successful delivery. Handlers tolerate at-least-once delivery and recheck invitation state; duplicate email is an accepted rare trade-off, not an exactly-once guarantee. A real provider receives the outbox row ID as its idempotency/message key when supported.

## Core Relationships and Invariants

- One parent may place many orders; one order may contain many student slots.
- A student slot may contain multiple purchased courses; activation claims one invitation and activates all its pending enrollments together.
- One enrollment grants access to one course for one student; identity is obtained from the authenticated session, never from request input.
- A lesson belongs to one course. Access requires a join from the requested lesson to an active enrollment for the session student.
- Checkout retries cannot produce duplicate orders for the same idempotency key; reusing a key with a different request is an error.
- A failed simulated payment leaves no usable invitations or active/pending access grants.
- Invitation redemption and student/enrollment activation are all-or-nothing, with only one winner under concurrent attempts.
- Outbox workers claim rows through a short lock-and-lease transaction; no transaction remains open during provider I/O.
- If implemented, an outbox message may carry only W3C trace propagation fields needed to continue/link trace context; it MUST NOT contain personal data or baggage.
- Raw invitation secrets, passwords, and session credentials are never included in logs.
