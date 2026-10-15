# Implementation Plan: Parent Contact and Mock Payment

**Branch**: `002-parent-checkout` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-parent-checkout/spec.md`

## Summary

Extend the existing checkout UI with a clearly grouped parent contact section and a separate mock
payment step. Let the parent select a mock method (Visa, Mastercard, or Apple Pay), then submit the
existing checkout operation only after confirmation. Keep all payment behavior simulated and use
the server-calculated total. After a successful mock purchase, show a prominent confirmation that
explicitly presents the email sending as simulated, names the parent's email, and gives the existing
seven-day activation window. Preserve the existing receipt and invitation links as immediate access
to the student onboarding flow; do not imply real email delivery.

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS; React with TypeScript

**Primary Dependencies**: Existing React/Vite/Tailwind frontend; Fastify API; existing mock payment
gateway, PostgreSQL, outbox worker, and email-sender interfaces. No real payment SDK or card-entry UI.

**Storage**: Existing PostgreSQL `parents`, `orders`, `payments`, `student_slots`, `invitations`,
and outbox records. Parent confirmation email is validation-only and is not stored. Selected mock
method may be recorded as the payment provider label on the existing payment record.

**Testing**: Existing Vitest/API and PostgreSQL integration tests; Playwright journey tests; lint
with typescript-eslint. Extend coverage for form validation, step navigation, method allowlist,
payment outcomes, invitation-delivery confirmation, and duplicate submission behavior.

**Target Platform**: Browser-based web application and existing local Docker Compose environment

**Project Type**: Full-stack web application (React/Vite client plus Fastify API)

**Performance Goals**: Parent can complete contact and mock-payment steps within the existing
checkout usability goal; payment-step transitions do not trigger checkout prematurely.

**Constraints**: Mock payment only; no card numbers or payment credentials; no real charge; prices
remain server-authoritative; retain checkout idempotency and failure consistency; avoid duplicate
orders when navigating back, retrying, or refreshing. Email sending in the confirmation is explicitly
simulated; it does not depend on the asynchronous email worker or claim that a real email was sent.

**Scale/Scope**: One existing checkout flow; three illustrative selectable payment methods; no
parent account, real payment processor, email-provider integration, or payment-provider branding
claim beyond mock method names.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / constraint | Gate result | Evidence in this plan |
|---|---|---|
| Ship the complete core journey | PASS | Existing purchase, student invitation, onboarding, and LMS journey remains intact. |
| Entitlement is the authorization boundary | PASS | No change to student authorization or enrollment checks. |
| Test risky behavior first | PASS | Payment failure, checkout idempotency, and successful delivery-vs-failure behavior receive regression tests. |
| Protect identity, secrets, and children's data | PASS | Collect only parent name/email; do not collect card data; do not log new contact/payment data. |
| Explicit seams and smallest adequate design | PASS | Reuse current mock gateway and outbox/email seams; no new provider or infrastructure. |
| Product constraints and reproducibility | PASS | Existing React/Fastify/PostgreSQL/Compose stack is retained; no real payment. |
| Delivery and quality | PASS | Incremental UI/API tests and full browser walkthrough required. |

No constitution violations identified. The local email sender is disabled and the purchase endpoint
returns before the outbox worker runs; the user clarified that the confirmation is an immediate,
explicitly simulated message after successful mock payment. No real delivery status API or email
provider is needed for this user-facing confirmation.

**Post-design re-check**: PASS, provided payment selection remains a finite allowlist of mock labels,
the server continues to determine the order total, and the confirmation clearly identifies email
sending as simulated. No new infrastructure or sensitive payment data is introduced.

## Project Structure

### Documentation (this feature)

```text
specs/002-parent-checkout/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── openapi.yaml
```

### Source Code (repository root)

```text
apps/
├── web/
│   ├── src/pages/CheckoutPage.tsx       # Parent form, payment step, purchase confirmation
│   ├── src/api/checkout.ts              # Checkout request/response types
│   └── tests/parent-to-lms.spec.ts      # End-to-end purchase journey
└── api/
    ├── src/modules/commerce/
    │   ├── checkout.routes.ts            # Existing public checkout route
    │   ├── checkout.service.ts           # Request validation and payment persistence
    │   └── payment-gateway.ts            # Replaceable mock adapter
    ├── src/worker/                       # Existing asynchronous email/outbox processing
    └── tests/commerce/                   # Checkout and payment integration tests
```

**Structure Decision**: Extend the existing modular monolith and checkout page. Keep the payment
selection as client-visible state until the parent confirms; send only an allowlisted mock method
identifier with the existing idempotent checkout request. Keep any email-delivery status changes at
the existing outbox boundary; the immediate user confirmation is explicitly simulated and does not
add a delivery-status endpoint.

## Complexity Tracking

No constitution violations or new architectural components are proposed.
