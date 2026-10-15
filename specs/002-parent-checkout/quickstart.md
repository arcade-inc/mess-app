# Quickstart: Validate Parent Contact and Mock Payment

This is an acceptance walkthrough for the checkout extension. It assumes the local application is
started using the repository's documented Docker Compose workflow.

## Prerequisites

- Docker and Docker Compose
- A browser
- Application started with the commands documented in `README.md`

## Successful journey

1. Open the course purchase page and select an eligible course for a learner.
2. Confirm parent/guardian name, email, and confirm-email are grouped under parent contact details.
3. Submit empty, malformed, and mismatched contact details in turn; verify checkout is blocked and
   actionable validation is shown.
4. Enter valid parent and learner details, then continue to the distinct payment stage.
5. Verify the total is shown and Visa, Mastercard, and Apple Pay appear as mock-only choices; verify
   there are no card-number or security-code inputs and the page says no real charge will be made.
6. Attempt to continue without choosing a method; verify payment does not submit.
7. Choose each mock method in separate fresh attempts and confirm the payment. Verify one successful
   order and one invitation per learner, with the selected method reflected only as a mock choice.
8. Verify the user sees a prominent post-purchase confirmation naming the validated parent email,
   stating that sending is simulated, and giving the seven-day activation period. Confirm this
   notification does not claim real email delivery and that invitation links remain accessible on
   the receipt.
9. Use each receipt invitation link to continue the existing onboarding and LMS journey.

## Failure and retry checks

- Return from payment to contact details, change the address, and confirm the updated address is
  used for delivery and display.
- Simulate failed/cancelled payment and verify no success confirmation, invitations, or access grants are
  created.
- Re-submit the same idempotent request and refresh the receipt; verify there is no duplicate order
  or invitation set.
- Verify that the purchase confirmation is immediate after mock payment and remains explicitly
  simulated regardless of the asynchronous worker's pending or disabled email-sender state.
- Attempt an unsupported payment method at the API boundary; verify it is rejected without charging
  or creating access.

## Automated validation

Run the documented frontend lint, API tests, and web tests from the repository README. Include
existing checkout PostgreSQL integration tests and Playwright parent-to-LMS coverage. Assertions
must cover matching/mismatching contact email, each supported method, unsupported method rejection,
payment failure, duplicate submission, and notification behavior for pending and sent email states.
