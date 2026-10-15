# Tasks: Parent Contact and Mock Payment

**Input**: Design documents from `specs/002-parent-checkout/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml`, and `quickstart.md`

**Tests**: Included because the specification requires automated coverage, the existing browser journey is part of acceptance, and payment/idempotency behavior is transaction-critical.

**Execution constraint**: Execute tasks one at a time in listed order. No parallel task markers are used.

## Phase 1: Setup

**Purpose**: Reuse the existing React/Vite, Fastify, PostgreSQL, and Playwright setup; no project initialization or new dependencies are required.

## Phase 2: Foundational

**Purpose**: No shared infrastructure changes are required. The existing checkout, mock payment gateway, and invitation flow provide the foundation.

---

## Phase 3: User Story 1 - Enter Parent Contact Details (Priority: P1)

**Goal**: Present parent/guardian name, email, and email confirmation as a clear contact group and prevent invalid details from advancing.

**Independent Test**: In the browser, verify the three parent contact fields are grouped, valid matching details advance, and missing, malformed, or mismatched values block progression with a useful error.

### Tests for User Story 1

- [X] T001 [US1] Extend parent checkout browser assertions for grouped parent contact fields and invalid/mismatched email blocking in `apps/web/tests/parent-to-lms.spec.ts`.

### Implementation for User Story 1

- [X] T002 [US1] Refactor the parent/guardian name, email, and confirm-email controls into a clearly labeled parent contact section and keep validation tied to the continue action in `apps/web/src/pages/CheckoutPage.tsx`.

**Checkpoint**: Parent contact details are understandable and invalid details cannot proceed to payment.

---

## Phase 4: User Story 2 - Complete a Mock Payment (Priority: P1)

**Goal**: Add a distinct payment stage with Visa, Mastercard, and Apple Pay mock choices, without real credentials or charges.

**Independent Test**: Choose an eligible course and valid contact details, continue to the payment stage, verify the amount and mock-only choices, then complete payment and verify success; invalid methods and failed payment must not grant access.

### Tests for User Story 2

- [X] T003 [US2] Add checkout integration and gateway unit cases for supported and unsupported `paymentMethod` values, method persistence, and same-idempotency-key requests with different methods in `apps/api/tests/commerce/checkout.integration.test.ts` and `apps/api/tests/commerce/payment-gateway.test.ts`.
- [X] T004 [US2] Extend the browser journey to verify the separate payment stage, displayed total, mock-only method choices, required selection, and no checkout submission before payment confirmation in `apps/web/tests/parent-to-lms.spec.ts`.

### Implementation for User Story 2

- [X] T005 [US2] Update the checkout request contract with the required allowlisted `paymentMethod` field and document that it is not a real provider integration in `specs/002-parent-checkout/contracts/openapi.yaml`.
- [X] T006 [US2] Add the required `paymentMethod` field and finite method allowlist to checkout validation, carry the selected mock label through the gateway, and persist it with the existing payment record in `apps/api/src/modules/commerce/checkout.service.ts` and `apps/api/src/modules/commerce/payment-gateway.ts`.
- [X] T007 [US2] Update checkout request types and submission payload for the selected mock method in `apps/web/src/api/checkout.ts`.
- [X] T008 [US2] Implement the separate payment step, method selection, back-to-contact navigation, visible mock/no-charge notice, and explicit payment confirmation in `apps/web/src/pages/CheckoutPage.tsx`.

**Checkpoint**: The parent can complete the existing purchase through a clearly simulated payment choice; backend pricing, payment failure behavior, and idempotency remain enforced.

---

## Phase 5: User Story 3 - Confirm Course Details and Activation (Priority: P1)

**Goal**: After successful mock payment, show a prominent confirmation naming the parent's email, explicitly labeling email sending as simulated, and stating the seven-day activation window.

**Independent Test**: Complete a successful mock checkout and verify the confirmation text, parent email, simulated-send notice, and seven-day window. Verify failed/cancelled payments do not show it and invitation links remain available in the receipt.

### Tests for User Story 3

- [X] T009 [US3] Extend the browser journey to assert the post-payment confirmation copy, parent email, simulated delivery wording, seven-day activation period, and absence of confirmation on payment failure in `apps/web/tests/parent-to-lms.spec.ts`.

### Implementation for User Story 3

- [X] T010 [US3] Render the prominent successful-purchase confirmation with the validated parent email, simulated course/link-sending message, seven-day activation deadline, and existing invitation links in `apps/web/src/pages/CheckoutPage.tsx`.

**Checkpoint**: Successful payment has a clear, accurate confirmation; failure does not imply success and the existing onboarding path remains usable.

---

## Phase 6: Polish & Cross-Cutting Validation

**Purpose**: Validate the integrated flow and ensure the feature remains runnable and maintainable.

- [X] T011 Run API tests, web unit tests, Playwright journey tests, build, and lint sequentially using scripts in `apps/api/package.json`, `apps/web/package.json`, and the root `package.json`; fix any regressions in the affected source and test files.
- [X] T012 Walk through the successful and failure scenarios in `specs/002-parent-checkout/quickstart.md` and update that file only if the documented acceptance behavior needs correction.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No initialization work; reuse the current repository toolchain.
- **Foundational (Phase 2)**: No blocking infrastructure work is needed.
- **User Story 1 (Phase 3)**: Starts immediately; establishes parent contact navigation/validation.
- **User Story 2 (Phase 4)**: Follows US1 because it extends the same checkout page and adds backend payment-method validation.
- **User Story 3 (Phase 5)**: Follows US2 because the confirmation is only reached after payment succeeds.
- **Polish (Phase 6)**: Run after all three stories are complete.

### User Story Dependencies

- **US1**: No dependency on other stories; validates and organizes parent contact information.
- **US2**: Depends on US1's validated contact details and uses the same checkout form and request.
- **US3**: Depends on US2's successful payment outcome and existing invitation receipt.

### Sequential Execution Order

Complete tasks strictly by ascending ID. Each story's regression test task precedes its implementation task(s). Do not run API, database, build, or browser test commands concurrently.

### Parallel Opportunities

None are scheduled. Tasks may touch shared checkout files and validation should not overload the API/database environment; work sequentially.

## Implementation Strategy

### MVP First

1. Complete US1 to provide clear and validated parent contact details.
2. Complete US2 to demonstrate a distinct mock payment stage while preserving server-side pricing and payment failure guarantees.
3. Complete US3 to show the specified simulated email confirmation and activation period.
4. Stop at each story checkpoint and validate before continuing.

### Incremental Delivery

Deliver US1 → US2 → US3 in order. The purchase journey remains runnable after each slice; complete the final quickstart walkthrough and sequential validation commands before considering the feature ready.

## Notes

- Every task line follows `- [ ] T### [US#] Description with file path` for story tasks; polish tasks omit a story label as required.
- No `[P]` markers are used, honoring the repository's sequential-execution preference.
- The existing checkout service's canonical request hash includes the parsed request, so adding `paymentMethod` to the validated request makes the selected method part of idempotency comparison; T003 verifies this behavior.
- Do not add a real payment SDK, real payment fields, an email provider, or an email delivery-status endpoint.
