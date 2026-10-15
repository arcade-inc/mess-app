# Data Model: Existing Account Course Linking

This feature reuses the existing logical entities and tables; it is not expected to require a database migration.

## Entities

### Learner Account (Student)

- **Relevant fields**: identifier, name, email, current school year, credential hash.
- **Relationships**: May be linked to multiple student purchase slots and owns active enrollments.
- **Validation**: Identity is taken from the verified session. The name participates in invitation matching; school year does not.

### Student Purchase Slot

- **Relevant fields**: identifier, learner name, school year, nullable linked student identifier.
- **Relationships**: Belongs to one purchase and groups one or more enrollments and an invitation.
- **Validation**: A successful claim links an unlinked slot to the authenticated student. Existing learner details on the slot remain the purchase record; they are not overwritten with the account profile.

### Invitation

- **Relevant fields**: identifier, slot identifier, stored token hash, expiration time, used time, superseded time.
- **Relationships**: Identifies the student purchase slot the learner may claim.
- **Validation**: Must be paid, unused, unsuperseded, and unexpired at claim time. Its secret is never stored in plaintext or a cookie, or exposed in logs/telemetry; it remains in the invitation URL and is carried as the sole `activationCode` query parameter on the sign-in link. The post-login invitation path is derived from this code.
- **State transition**: `usable → claimed` automatically when the matching authenticated learner opens or resumes the invitation; failed validation does not consume the invitation.

### Enrollment (Course Access Grant)

- **Relevant fields**: slot identifier, course identifier, nullable student identifier, status, activation time.
- **Relationships**: Belongs to a purchase slot and course; after a successful claim it is assigned to the authenticated student.
- **State transition**: For every pending enrollment in the claimed slot, `PENDING → ACTIVE`, with the authenticated student and activation time set.
- **Validation**: Only active enrollments for the session student grant course access.

## Claim invariants

1. A claim's student identifier is the authenticated session subject, never request-provided data.
2. The invitation slot's learner name matches the existing student's name after trimming, collapsing whitespace, and ignoring case; school year is intentionally excluded.
3. Name mismatch, invalid invitation state, or any inconsistent row count leaves invitation, slot, and enrollments unchanged.
4. Opening a valid invitation while signed in, or returning to it after sign-in, triggers the claim automatically; no separate confirmation action is required.
5. Invitation use, slot association, and enrollment activation commit or roll back together.
6. A single invitation can be claimed at most once, including under retry and concurrent requests.
7. Claiming one slot cannot activate enrollments from another purchase slot.

## Schema impact

No new entity or migration is expected. Existing nullable `student_slots.student_id` and `enrollments.student_id` support multiple purchased slots attached to one learner account. Existing invitation `used_at`, `expires_at`, and `superseded_at` fields support single-use, expiration, and replacement checks.
