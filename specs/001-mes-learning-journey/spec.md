# Feature Specification: MES Parent-to-LMS Journey

**Feature Branch**: `001-mes-learning-journey`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Build a small web application that demonstrates the core MES journey: a parent purchases a course, a student activates an account, and the student accesses the learning platform. Follow good development practices and provide test coverage. Use the task and blueprint in `docs/` as guidance."

## Clarifications

### Session 2026-10-15

- Q: Should the frontend use Tailwind CSS as a required styling choice, or should the implementation choose its own styling approach? → A: Require Tailwind CSS for the frontend.
- Q: Should the project require typescript-eslint as its linter, or require a linter but leave the choice open? → A: Require typescript-eslint.
- Q: How should the application prepare for future event-driven processing and scaling without expanding this mock's infrastructure? → A: Keep clear module and replaceable service boundaries; mark likely asynchronous, external-service, retry, messaging, payment, and CPU-heavy seams with code comments and document future producer/worker/broker options in the README; do not add a message broker or claim production scaling capabilities.
- Q: Should setup follow the official TypeScript guides while retaining the planned React/Vite frontend and Fastify backend? → A: Keep React/Vite and Fastify; use the official TypeScript project-setup guidance for both.
- Q: Should rate limiting be based on requests per time window, concurrent resource use, or both? → A: Requests per time window.
- Q: Should course access use a general role/permission framework or student identity with course-enrollment checks? → A: Use student authentication and backend enrollment checks for dashboard and lesson access; student authentication alone grants no course access. Do not add parent accounts, role tables, configurable permissions, or a general-purpose RBAC framework in this scope. If authenticated parent functionality is added later, use simple `PARENT | STUDENT` roles.
- Q: Should this project run a separate PostgreSQL read replica in local Compose, or use separate read/write database paths that can point to replicas in a deployed environment? → A: Implement separate read/write database paths; local Compose may point both to the same database, while deployed configuration may direct reads to replicas.
- Q: Which reads may use replicas when replication lag could delay changes or leave access decisions stale? → A: Use replicas only for lag-tolerant reads; route enrollment authorization checks and reads that must immediately reflect a write to the primary.
- Q: For this 3–4-hour mock, should we implement a privacy-safe logger and OTLP-ready telemetry, or also deploy a collector, dashboards, alert rules, and on-call integrations? → A: Centralize an allowlisted structured logger, sanitize errors and traces, and test that dummy secrets do not appear; use local console export with optional OTLP. Document production alert signals and runbooks, but do not deploy a collector, dashboards, or alerting services.
- Q: Should the spec set a fixed log-retention period now, or require each deployment to choose and document one before production? → A: Require each deployment to configure and document a finite retention period before production, consistent with its applicable privacy, compliance, and operational policies.
- Q: Should this feature require browser-to-API-to-database tracing now, with outbox and worker spans when those components are implemented, or require the full worker trace path in this scope? → A: Require browser, API, and database tracing for the core journey; define trace-context propagation for outbox work and instrument outbox/worker operations when those components are implemented.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Purchase a Course for a Student (Priority: P1)

A parent browses the available courses, selects one suitable for the student's school year, enters the parent and student details, and completes a mock purchase. The system confirms the order and provides an invitation for the student to begin onboarding.

**Why this priority**: The purchase creates the access entitlement required for every later step and begins the core journey.

**Independent Test**: Complete a mock checkout for an eligible student and verify that the order is confirmed and a usable invitation is provided, with no real charge.

**Acceptance Scenarios**:

1. **Given** a parent is viewing the available courses, **When** they choose an eligible course and submit valid parent and student details, **Then** the mock purchase is confirmed and an invitation path is shown to the parent.
2. **Given** a course has a server-defined price, **When** the parent submits checkout, **Then** the order uses the listed price regardless of any price supplied by the browser.
3. **Given** a course is not suitable for the student's school year, **When** checkout is submitted, **Then** the purchase is rejected with a clear explanation and no confirmed order or invitation is created.
4. **Given** a checkout request is repeated with the same request identity and details, **When** it is processed again, **Then** only one order and one set of student access grants are created.

---

### User Story 2 - Onboard the Student (Priority: P2)

The student opens the invitation provided after purchase, reviews the course and student details, and activates an account by completing the onboarding form and setting a password.

**Why this priority**: The purchase is not useful until the intended student can claim access and establish an account.

**Independent Test**: Redeem a valid invitation and verify that the student can sign in, while invalid or previously redeemed invitations cannot be used to activate another account.

**Acceptance Scenarios**:

1. **Given** a valid, unused invitation, **When** the student completes onboarding with valid information and a password, **Then** the account is activated and the student is signed in.
2. **Given** an invitation has expired, been used, or been replaced, **When** it is opened or submitted, **Then** activation is refused with a user-understandable message and no second activation occurs.
3. **Given** two activation attempts race to redeem the same invitation, **When** both are submitted, **Then** exactly one succeeds.
4. **Given** the submitted email belongs to an existing student account, **When** onboarding is submitted, **Then** no duplicate account is created and the student is directed to sign in.
5. **Given** an existing student opens a later purchase invitation, **When** their name matches the invitation after case and whitespace normalization, **Then** the course is automatically linked to their account when they open the invitation while signed in or return to it after sign-in; school year is not compared and the invitation code remains in the URL.

---

### User Story 3 - Access Entitled Learning (Priority: P3)

An onboarded student signs in, views a dashboard of their active courses, opens a course's lesson list, and views a lesson. The student cannot access learning material outside their active enrollments.

**Why this priority**: This completes the core journey and demonstrates that a purchase grants access to the intended student, rather than merely recording an order.

**Independent Test**: Sign in as an activated student and verify that lessons covered by their enrollment are available, while lessons belonging to another student or an unenrolled course are denied.

**Acceptance Scenarios**:

1. **Given** an authenticated student with an active enrollment, **When** they open the LMS dashboard and an included lesson, **Then** their course and lesson content are available.
2. **Given** a student is not authenticated, **When** they request the LMS, **Then** they are directed to sign in and receive no protected lesson content.
3. **Given** an authenticated student requests another student's lesson or a course without an active enrollment, **When** the request is processed, **Then** access is denied without disclosing whether the resource exists.
4. **Given** a student signs out, **When** they attempt to reopen a protected page, **Then** access is denied until they sign in again.

### Edge Cases

- A checkout includes a malformed email, mismatched email confirmation, missing student details, or an unsupported school year; it is rejected without partial purchase records.
- A course disappears or changes price between browsing and checkout; eligibility and price are revalidated using the current server-side catalog.
- A repeated checkout request uses the same idempotency identity but different details; it is rejected rather than silently changing the original order.
- Payment simulation fails; no student access grants or invitations are issued.
- An invitation is forwarded, guessed, redeemed twice, or used after its expiry; only the first valid, timely redemption can activate access.
- A student attempts to alter a URL or identifier to reach another student's course, enrollment, or lesson; the request is denied.
- An email delivery attempt fails or is delayed; the purchase outcome still provides the invitation path and retries do not create duplicate access grants.
- The application or database is unavailable during a journey step; the user receives a recoverable error and no partial state is presented as successful.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present the available courses with subject, eligible school-year range, and price.
- **FR-002**: The system MUST allow a parent to select a course and submit parent and student details for a mock purchase.
- **FR-003**: The system MUST validate submitted details and course eligibility before confirming a purchase.
- **FR-004**: The system MUST determine course prices itself and MUST NOT trust a price supplied by the user or browser.
- **FR-005**: The system MUST create no more than one confirmed purchase and access grant for equivalent retries of the same checkout request.
- **FR-006**: The system MUST clearly identify checkout as simulated and MUST NOT initiate a real payment.
- **FR-007**: After a successful purchase, the system MUST provide an invitation path for each student and a purchase confirmation.
- **FR-008**: An invitation MUST be single-use and expire after a bounded period; invalid, expired, superseded, or already-used invitations MUST NOT grant access.
- **FR-009**: The system MUST allow a student to complete onboarding and activate an account through a valid invitation.
- **FR-010**: The system MUST prevent duplicate student accounts and direct a student with an existing account to sign in; a matching later-purchase invitation MUST automatically link its access to that account when opened or resumed after sign-in, without storing the invitation code in a cookie.
- **FR-011**: The system MUST allow an activated student to sign in and sign out.
- **FR-012**: The system MUST provide an LMS dashboard showing the signed-in student's active course enrollments and available lessons.
- **FR-013**: The system MUST grant lesson access only when the authenticated student has an active enrollment for the lesson's course, checking this relationship on the backend for each protected request; student authentication alone MUST NOT grant access to all courses.
- **FR-014**: The system MUST deny unauthenticated access and access to another student's or unentitled learning content without exposing protected content or resource existence.
- **FR-015**: The system MUST preserve data consistency when checkout, invitation redemption, or delivery operations fail or are retried.
- **FR-016**: The system MUST collect only personal information needed for this mock journey and MUST NOT expose passwords, raw invitation tokens, or session credentials in logs or user-visible errors.
- **FR-017**: The project MUST include automated tests for the complete primary journey and for critical pricing, eligibility, idempotency, invitation, concurrency, and entitlement denial behaviors.
- **FR-018**: The application MUST be runnable locally from a clean checkout using one documented startup command, with no undocumented manual database setup.
- **FR-019**: Project documentation MUST describe the system boundaries, key decisions, scope limitations, how to run the application and tests, and material AI-assisted contributions.
- **FR-020**: The web client MUST use Tailwind CSS to style a responsive interface across the purchase, onboarding, and LMS journeys.
- **FR-021**: The project MUST configure and use typescript-eslint to lint TypeScript source, with a documented command that runs the linter.
- **FR-022**: The implementation MUST preserve clear module and replaceable-service boundaries and add concise code comments at operations that may later need asynchronous/event-driven handling, including external-service calls, retries, message delivery, payment processing, and CPU-intensive work. The README MUST describe these candidate producer/worker boundaries and possible future broker-backed scaling, while making clear that this mock does not implement a message broker or production-scale processing.
- **FR-023**: Project setup MUST follow the official TypeScript project-creation guidance for the planned React/Vite frontend and Fastify backend. The README MUST identify the official guidance and document the actual setup commands used.
- **FR-024**: The Fastify backend MUST use `@fastify/otel` for request tracing and OpenTelemetry metrics for HTTP request counts, durations, and errors, plus business metrics for order creation/payment, invitation issuance/redemption/claiming, activation failures, and denied lesson access. Telemetry MUST NOT include passwords, raw invitation tokens, session credentials, email addresses, or student identifiers. It MUST use `@fastify/rate-limit` to limit request volume per user over a configured time window.
- **FR-025**: The Fastify backend MUST use `@fastify/cors` to configure cross-origin access; the allowed origins MUST be explicitly configured rather than unrestricted.
- **FR-026**: The application MUST use separate database access paths for reads and writes; local Compose MAY configure both paths to the same PostgreSQL instance, while deployed environments MAY direct lag-tolerant reads to PostgreSQL replicas. Enrollment authorization checks and reads that must immediately reflect a write MUST use the primary.
- **FR-027**: Application logs MUST use a centralized structured logger with an explicit field allowlist (such as level, event, request ID, trace ID, span ID, job ID, provider, error code, attempt, and duration). Request/response bodies MUST be excluded by default; raw errors and external-service responses MUST be sanitized rather than logged. Application logs and traces MUST use route templates instead of resolved invitation URLs or query strings; any configured gateway or analytics logging MUST follow the same rule. The same secret-redaction rules MUST apply to incident notifications. A second-layer redaction policy MUST cover passwords and hashes, session cookies, authorization headers, invitation tokens, and student-identifying/onboarding data. Automated tests MUST send dummy secrets through failure paths and verify that captured logs and traces do not contain them.
- **FR-028**: Local observability MUST use console export with optional OTLP configuration and MUST NOT require a deployed collector, dashboard, alert manager, or on-call integration. The README MUST document production alert guidance for API health/errors/latency, onboarding failures and synthetic-journey failures, email delivery failures/backlogs, internal processing and outbox progress, and database capacity/latency/replication lag. Guidance MUST prioritize sustained user impact over isolated transient errors and describe alert severity, affected component, dashboard link, recovery runbook, and urgent on-call versus lower-priority team/ticket routing.
- **FR-029**: Before production use, each deployment MUST restrict access to centrally stored logs to authorized personnel and MUST configure and document a finite log-retention period consistent with its applicable privacy, compliance, and operational policies.
- **FR-030**: Distributed traces MUST use W3C Trace Context (`traceparent`, and `tracestate` when used) from approved browser destinations through the API and database spans. The frontend MUST create action spans and inject trace context into API requests only for approved destinations; CORS MUST allow the required trace headers only for configured origins. The API MUST extract valid incoming context and create child spans, or start a new trace when context is missing or invalid. Gateway forwarding MUST preserve trace context where a gateway is used. Active `traceId` and `spanId` MUST be included in structured logs when available, and frontend error reports MUST attach the active trace ID; the API MAY return a diagnostic ID for support. Trace IDs MUST remain diagnostic metadata and MUST NOT be used for identity or authorization.
- **FR-031**: When outbox or worker processing is implemented, the system MUST persist trace context with the outbox event and propagate/extract it through publisher and worker boundaries. A delayed job or retry MAY start a new trace linked to its originating span. Checkout and later student onboarding MUST use separate traces and MAY be correlated using opaque internal purchase or invitation IDs in trace links or allowlisted logs, not invitation secrets or student data.
- **FR-032**: Trace context, span attributes, logs, and incident notifications MUST exclude invitation tokens, emails, passwords, and student-identifying data; trace baggage MUST NOT carry those values. Cross-trace correlation IDs MUST be opaque internal IDs and MUST NOT be added to metric labels. Local validation MUST retain sampled traces for automated checks. Before production use, each deployment MUST document its trace sampling policy and finite trace-retention period, alongside the log policy in FR-029.

### Key Entities *(include if feature involves data)*

- **Parent**: The purchaser, represented by the minimum details needed to place an order; does not need an account in this version.
- **Student**: The learner who completes onboarding and uses the LMS; has an identity and protected account credentials.
- **Course**: A purchasable learning offering with a subject, eligible school-year range, and price.
- **Order**: A parent's mock purchase, with a confirmation state and itemized course prices captured at purchase time.
- **Student Access Grant**: The purchased right for one student to access a course, initially pending and active after successful onboarding.
- **Invitation**: A time-limited, single-use claim path that connects a purchased access grant to the student who onboards.
- **Lesson**: Learning content belonging to a course; it is available only to a student with an active access grant for that course.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A parent can complete the mock purchase and receive a student invitation in under 3 minutes in a usability walkthrough.
- **SC-002**: A student can complete invitation-based onboarding and reach their LMS dashboard in under 3 minutes after opening a valid invitation.
- **SC-003**: A clean-checkout validation can start the application with the documented single command and complete the full parent-to-lesson journey without manual database edits.
- **SC-004**: All automated critical-path tests pass, including valid and invalid invitation redemption, duplicate and concurrent checkout, server-side pricing, year eligibility, payment failure consistency, and cross-student lesson denial.
- **SC-005**: In 100% of tested cases, a student cannot retrieve lesson content without authentication and an active enrollment for that course.
- **SC-006**: In 100% of repeated or concurrent attempts covered by tests, one invitation produces at most one student activation and one checkout identity produces at most one purchase.
- **SC-007**: A reviewer can identify how to start the application and run its tests from the README without seeking additional instructions.
- **SC-008**: A reviewer can identify the application's module boundaries and documented candidate asynchronous/worker seams from code comments and the README, with no message broker required to run the mock.
- **SC-009**: Local validation emits request telemetry and each defined business metric, while automated checks confirm telemetry contains no secrets or student-identifying values.
- **SC-010**: Automated tests confirm per-user request limits return 429 and replenish after the configured time window, and that CORS grants access only to explicitly allowed origins.
- **SC-011**: Automated checks confirm that valid W3C trace context links browser, API, and database spans; missing or invalid context starts a new trace; approved CORS origins allow trace headers; and trace/log output contains no sensitive values.

## Assumptions

- This is a time-boxed demonstration of the core journey, not a production-ready payment or learning platform.
- Payment is simulated; real payment providers, webhooks, refunds, and reconciliation are out of scope.
- The parent does not create an account in this version; purchase confirmation and invitation are shown directly, with email delivery treated as a supporting channel.
- One parent may purchase courses for one or more children, with multiple course enrollments associated with a student.
- Students activate new accounts through invitations; later purchases can be linked to an existing account by automatically claiming a matching invitation after sign-in. The invitation code remains in the URL and school year/age is not used to match the learner.
- Course authorization in this student-only scope is enrollment-based, not a general-purpose role/permission system; explicit `PARENT | STUDENT` roles are only needed if authenticated parent functionality is added later.
- Course availability, year eligibility, and prices are supplied by the application and rechecked when a purchase is submitted.
- Lesson content is simple text content, and lessons do not require video hosting or external content services.
- The implementation follows the stack described in the project docs, uses Tailwind CSS for web styling, and uses a locally runnable Docker Compose setup.
- TypeScript linting uses typescript-eslint; no other linter is required unless a concrete need arises.
- Future event-driven processing and scale-out are architectural preparation only: external effects remain behind replaceable interfaces, candidate asynchronous/worker seams are commented in code and described in the README, and no message broker or production worker infrastructure is added solely for this mock.
- Frontend and backend setup retain the planned React/Vite and Fastify stack and follow each framework/tool's official TypeScript project-creation guidance; the README records the guidance and commands used.
- Fastify telemetry, per-user request rate limiting over a configured time window, and explicit CORS configuration use the corresponding Fastify plugins; production exporter and policy values are determined during planning.
- Centralized logs and telemetry follow an allowlist and secret-sanitization policy. This mock does not deploy central observability or alerting infrastructure.
- Automated coverage prioritizes business-critical behaviors and repeatable end-to-end verification; this specification does not impose a numeric line-coverage threshold.
- Production privacy, consent, retention, deletion, and regulatory compliance workflows require separate review and are not claimed by this mock.
