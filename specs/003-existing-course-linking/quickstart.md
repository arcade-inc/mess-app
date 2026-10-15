# Quickstart: Validate Existing Account Course Linking

This guide defines an end-to-end acceptance walkthrough for adding a later purchase to an existing learner account. It supplements the [feature API contract](contracts/openapi.yaml) and [data model](data-model.md).

## Prerequisites

- Docker and Docker Compose, or the repository's documented local development setup
- A browser
- A disposable test database for PostgreSQL integration tests
- The repository's web and API dependencies installed

## Start the application

1. Follow the root `README.md` setup instructions and start the application with `docker compose up`.
2. Wait for API readiness and open the local application.
3. Use a separate test deployment/database for test runs that create purchases; do not point cleanup tests at data that must be retained.

Expected result: the catalog and learner invitation journey are available.

## Automatic existing-account activation

1. Purchase a course for a learner and open its invitation.
2. Activate the learner's first account and confirm its course is available.
3. Purchase a different course for the same learner, using the learner's matching name but a changed school year if available.
4. Open the new invitation while signed out and choose “Already have an account? Sign in.” Confirm the sign-in URL contains `activationCode=<invitation-token>` and no separate `returnTo` parameter, and that the code is not saved in a cookie.
5. Sign in to the existing learner account.
6. Confirm the browser constructs `/invite/<invitation-token>` from `activationCode`, returns to that invitation, and automatically activates the purchase for the matching learner account.
7. Confirm the new course is available in the existing account and no duplicate account or separate claim action was required.
8. Repeat by opening an invitation while already signed in; confirm the matching purchase is automatically activated.

## Rejection and safety checks

- Change the invitation learner name to a different learner and open it while signed in. Confirm the exact message “This course belongs to another learner.” and verify the invitation remains unclaimed and no access changes.
- Attempt to activate without a session and confirm sign-in is required; after sign-in, confirm the same invitation is resumed and checked.
- Open an expired, superseded, or previously used invitation and confirm no access is added.
- Sign in without opening an invitation and confirm course access is unchanged.
- Trigger two claim requests concurrently and confirm at most one succeeds, with no partial slot or enrollment update.
- Confirm the claim uses the authenticated session account, not a student identifier supplied by the browser.
- Confirm invitation secrets, credentials, and learner-identifying details are absent from logs and telemetry.

## Automated validation

- Run `npm test --workspace @mes/api` with `TEST_DATABASE_URL` pointing to the disposable PostgreSQL test database. Expected result: claim success, mismatch rollback, invalid-state, unauthenticated, and concurrent single-use checks pass.
- Run `npm test --workspace @mes/web` for browser-client API tests.
- Run `npm run test:e2e --workspace @mes/web` against the running disposable application. The Playwright sign-in continuation case must assert that the login URL contains only `activationCode`, then verify the derived invitation route, automatic claim, and course availability after sign-in.
- Run the repository lint/build commands documented in `README.md` after implementation.
