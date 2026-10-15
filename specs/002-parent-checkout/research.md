# Research: Parent Contact and Mock Payment

## Existing checkout behavior

- **Decision**: Extend the current checkout operation and avoid a separate payment resource unless
  required by the user-visible flow. The browser can present a payment screen, then submit once the
  parent confirms a selected mock method.
- **Rationale**: `apps/web/src/pages/CheckoutPage.tsx` already gathers parent name/email/email
  confirmation, validates the matching email, displays a mock purchase price, and calls
  `POST /api/checkout`. `apps/api/src/modules/commerce/checkout.service.ts` validates the request,
  calculates prices from the catalog, invokes a replaceable payment gateway outside the database
  transaction, and commits invitations only after successful payment.
- **Alternatives considered**: A new payment-intent API would introduce extra state and lifecycle
  handling without a real provider; retain a single idempotent checkout request.

## Mock payment methods

- **Decision**: Use a finite set of display options (Visa, Mastercard, Apple Pay) and submit an
  allowlisted method identifier. Do not request card data, call payment services, or imply provider
  integration.
- **Rationale**: The feature requires an understandable payment stage, while the project constitution
  explicitly excludes real payment integration. Server validation prevents arbitrary method labels
  from being recorded; the server remains authoritative for amount and currency.
- **Alternatives considered**: Free-form method text and card-number fields were rejected because
  they are ambiguous, needlessly collect sensitive data, and could suggest real payment processing.

## Invitation email and purchase confirmation

- **Decision**: Show a prominent purchase confirmation immediately after successful mock payment.
  Explicitly identify the email sending as simulated, name the validated parent email, and state the
  seven-day activation window. Keep the receipt's invitation links as the immediate onboarding path.
- **Rationale**: `finishSuccessfulCheckout` enqueues a `purchase_confirmation` outbox message and
  returns to the browser immediately. The worker later sends that email. In the current local setup,
  `createMockEmailSender()` has `enabled: false`, so the worker marks messages skipped rather than
  delivered. The user clarified that the requested confirmation is simulated, so it is not a claim
  about the asynchronous worker or a real email provider. No delivery-status API is necessary.
- **Alternatives considered**: Waiting for actual outbox delivery was rejected because the user wants
  an immediate confirmation in this mock journey and the local sender is intentionally disabled.
  Adding a real email provider or blocking a database transaction on email I/O remains out of scope.

## Parent email confirmation

- **Decision**: Retain client and server validation of the repeated address, compare case-insensitively
  after trimming, and persist only the canonical parent email (not the confirmation field).
- **Rationale**: Existing Zod validation and database insertion already follow this rule; confirmation
  is intended to catch typing mistakes, not create a second contact address.
- **Alternatives considered**: Persisting both values or using a separate parent account is outside
  this checkout-only flow.

## Existing test strategy

- **Decision**: Add regression tests to the existing API integration and browser journey suites.
- **Rationale**: Current tests already cover checkout success/failure, idempotency, and outbox delivery;
  Playwright has a full parent-to-LMS journey that can exercise the added payment step.
- **Alternatives considered**: A new test harness would duplicate established project tooling.
