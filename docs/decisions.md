# Design decisions and alternatives

This document explains the tradeoffs in the current implementation for reviewers of the assignment. It is a rationale for the code as it stands, not a claim that every alternative was prototyped or benchmarked. The [assignment](task.md) values a working end-to-end journey, clarity, and pragmatism within a 3–4-hour time box.

The guiding priority is correctness at the purchase, activation, and access boundaries. The outbox and read-pool seam go beyond the minimum journey; they demonstrate extension points rather than requirements for a small mock. See [implementation status](implementation-status.md) for the distinction between implemented behavior and future work.

## 1. Modular monolith instead of microservices

**Context and choice:** Catalog, commerce, identity, and learning are modules in one Fastify API backed by PostgreSQL. Purchase completion and learner activation change several related records and benefit from local transactions.

**Alternative and cost:** Separate services could have independent releases and scaling, but would introduce network failures, distributed consistency, and more local infrastructure. The monolith accepts a shared deployment and database. Module boundaries are organizational boundaries, not independently enforced data ownership.

**Revisit when:** Measured scaling needs, release independence, or team ownership justify extracting a specific module. A future broker does not itself require microservices.

**Evidence:** `apps/api/src/modules/`, `docker-compose.yml`.

## 2. PostgreSQL and explicit SQL instead of a document store or ORM

**Context and choice:** Orders, purchased items, students, invitations, and enrollments have relational constraints. PostgreSQL provides foreign keys, uniqueness, row locking, and transactions. Parameterized SQL makes authorization joins and concurrency behavior explicit.

**Alternative and cost:** A document store could simplify some aggregate reads, but these relationships and cross-record invariants fit a relational model directly. An ORM could still use PostgreSQL and preserve those guarantees; explicit SQL instead trades generated mappings and migration conveniences for visible queries and fewer abstraction layers. Query result types and schema changes must be maintained manually.

**Revisit when:** Repetitive data mapping becomes a significant maintenance cost. Introducing an ORM should preserve the transaction and locking semantics, not obscure them.

**Evidence:** `db/migrations/001_core.sql`, `apps/api/src/modules/commerce/checkout.service.ts`.

## 3. Native UUID identifiers instead of auto-increment integers

**Context and choice:** Resource identifiers appear in API responses and URLs. Random UUIDs provide opaque identifiers without exposing sequential record numbers. PostgreSQL's native `uuid` type validates their representation and stores them more compactly than UUID text. The schema defaults to `gen_random_uuid()`.

**Alternative and cost:** Integer identity columns would be entirely reasonable for this single-database application. They are smaller, easier to inspect manually, and have better insertion locality. UUIDs occupy 16 bytes before index overhead, compared with 4-byte integers or 8-byte bigints; random insertion can also increase index maintenance costs. Those costs are acceptable for this demonstration, not evidence that UUIDs are faster or necessary for scale.

**Revisit when:** Measured index size or write performance warrants a different strategy. UUID opacity is never an access-control mechanism: learning queries still check the authenticated student's enrollment.

**Evidence:** `db/migrations/001_core.sql`.

## 4. Student slots instead of creating accounts at checkout

**Context and choice:** A parent purchases before the learner has established an account. A student slot represents one intended child within one order, groups their purchased courses, and owns one invitation. Activation links that slot to an account and activates its eligible enrollments together.

**Alternative and cost:** Creating an account at checkout would conflate purchase information with established identity. Issuing one invitation per course would give a child buying Maths and English two onboarding links. The slot adds a table and linking logic, but models the actual lifecycle rather than forcing either shortcut.

**Revisit when:** A parent portal introduces persistent family relationships. A purchase-specific slot should not silently become a verified child identity.

**Evidence:** `db/migrations/001_core.sql`, `apps/api/src/modules/identity/onboarding.service.ts`.

## 5. Enrollments instead of treating login or payment as access

**Context and choice:** An order records the commercial event; a session identifies the learner; an enrollment grants current course access. Pending, active, and revoked enrollment states keep those responsibilities distinct. Every learning read checks active enrollment using session-derived identity against the primary database.

**Alternative and cost:** A paid-order check cannot by itself establish which authenticated learner should receive access. Putting course permissions in a JWT or caching them avoids database reads but can retain revoked permissions. Replica lag can also hide newly activated access. The implementation accepts a primary-database lookup for an authoritative answer at query time.

**Revisit when:** Access-query load becomes significant. Optimize queries and indexes first; any caching proposal must explicitly define acceptable revocation delay. Catalog reads can tolerate a different consistency policy.

**Evidence:** `apps/api/src/modules/learning/`, `db/migrations/001_core.sql`.

## 6. Minor-unit money and purchase-price snapshots

**Context and choice:** Prices and totals use integer minor units: £199 is 19900 pence. Checkout obtains prices from the server-side catalog, and order items retain the unit price used for that purchase.

**Alternative and cost:** Binary floating-point amounts can introduce rounding errors. Exact decimal arithmetic would also be valid, but integer pence are simple for this GBP mock. Looking up the current catalog price for historical orders would incorrectly change the apparent purchase amount after a price edit. Snapshots intentionally duplicate price data; broader currency support would require currency-specific minor units and amount limits.

**Revisit when:** Tax, discounts, refunds, or multiple currencies require an explicit rounding and accounting policy.

**Evidence:** `db/migrations/001_core.sql`, `apps/api/src/modules/commerce/checkout.service.ts`.

## 7. Database-enforced redemption and checkout idempotency

**Context and choice:** Invitation claim, account linking, and enrollment activation run in one transaction with locking and conditional updates. Checkout uses a unique idempotency key and a request hash: the same request can reuse an order, while a different request with the same key is rejected.

**Alternative and cost:** Disabling a button only affects one browser interaction. Application-level checks alone can race across concurrent requests. Database constraints enforce uniqueness across callers, while transactions prevent partial activation. The cost is explicit handling of in-progress, failed, conflicting, and replayed requests.

**Revisit when:** A real payment provider introduces asynchronous state transitions. Database idempotency alone cannot guarantee a charge occurs exactly once across an external service.

**Evidence:** `apps/api/src/modules/commerce/checkout.service.ts`, `apps/api/src/modules/identity/onboarding.service.ts`, `db/migrations/001_core.sql`.

## 8. Hashed invitations instead of storing reusable plaintext links

**Context and choice:** Invitations are high-entropy bearer credentials with an expiry and single-use claim. The invitation table stores a hash rather than the usable token, so possession of that table alone does not reveal working links.

**Alternative and cost:** Plaintext tokens would make resend and response replay convenient but expose usable credentials. Hashes cannot reconstruct the original URL: an idempotent checkout replay returns the receipt without invitation links. If the initial response is lost, the current mock has a recovery limitation. The delivery implementation rotates invitations and temporarily keeps authenticated-encrypted retry material in the outbox so retries can reuse the same new link; that is sensitive recoverable material, not another hash.

**Revisit when:** Real delivery and recovery are introduced. Define resend behavior, verified recipient binding, and dedicated encryption-key rotation. Currently the retry encryption key is derived from `JWT_SECRET`, so rotating it can make pending encrypted payloads unreadable. The local sender is disabled and does not rotate links.

**Evidence:** `apps/api/src/modules/identity/invitation.service.ts`, `apps/api/src/modules/commerce/checkout.service.ts`, `apps/api/src/worker/`.

## 9. HttpOnly cookie JWT instead of browser-stored tokens or server sessions

**Context and choice:** A one-hour JWT identifies the student and is sent in an HttpOnly, SameSite cookie, with Secure enabled in production mode. Same-origin API routing keeps browser credential handling straightforward. Course access is checked separately rather than embedded in the token.

**Alternative and cost:** A token in localStorage is directly readable by JavaScript, including injected scripts. HttpOnly prevents direct token reads, although it does not prevent injected scripts from making authenticated requests. An opaque server-side session would support immediate revocation but requires session state and lifecycle management. The stateless JWT avoids that store; logout clears the browser cookie but cannot revoke a copied token before expiry. Cookie authentication also requires attention to CSRF, not just token storage.

**Revisit when:** Immediate logout/revocation, account recovery, or device-session management becomes a requirement. Those may favor server sessions or a fuller identity solution.

**Evidence:** `apps/api/src/modules/identity/session.ts`, `README.md`.

## 10. Payment calls outside database transactions

**Context and choice:** Checkout persists a pending order, invokes the mock gateway outside the transaction, then commits successful purchase records, invitations, enrollments, and notification intent together. The gateway interface separates payment behavior from the purchase flow.

**Alternative and cost:** Holding a database transaction open during a provider call consumes database resources while waiting and still cannot atomically commit the external payment. The chosen boundary avoids that coupling but leaves a failure window: a provider may succeed before database completion fails. A process interruption can also leave an order pending. The mock does not implement recovery for a real provider.

**Revisit when:** Replacing the mock. Provider-side idempotency, verified webhooks, reconciliation, and explicit recovery states are required; changing the gateway adapter alone is insufficient.

**Evidence:** `apps/api/src/modules/commerce/checkout.service.ts`, `apps/api/src/modules/commerce/payment-gateway.ts`.

## 11. Transactional outbox instead of inline email or a broker

**Context and choice:** Purchase completion writes notification intent in the same transaction as the purchase records. A separate worker handles scheduled work using leases and bounded retries. PostgreSQL supplies the durable queue without another infrastructure service.

**Alternative and cost:** Sending email inline couples checkout latency to the provider and risks a committed purchase with no recorded notification work. A broker can support multiple consumers and higher throughput, but introduces deployment and operational work and does not remove the database-to-message consistency problem. An outbox adds its own scheduling, retry, and monitoring complexity. It is optional scope for this assignment, included to demonstrate a reliability pattern rather than because the mock needs a messaging platform.

Delivery is at-least-once: a crash after sending but before recording completion can cause a duplicate. A provider should use the outbox row ID for idempotency where supported. Local email delivery is disabled, so the confirmation page supplies the usable invitation links.

**Revisit when:** Real email delivery is needed; first establish provider behavior and operational ownership. Add a broker only when throughput, fan-out, or independent consumers justify it.

**Evidence:** `db/migrations/002_outbox.sql`, `apps/api/src/worker/`, `README.md`.
