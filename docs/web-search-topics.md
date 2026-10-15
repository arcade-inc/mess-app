Research findings and what they change in the design

I ran all five searches. Four produced primary sources (Stripe, OWASP, AWS, Docker). The PostgreSQL search returned mostly blog posts and library source, not the official docs, so treat that section as lower-confidence and verify it against the PostgreSQL manual (SELECT → “The Locking Clause”, INSERT → “ON CONFLICT Clause”, Explicit Locking). One query in the batch was cancelled earlier, so I re-ran it in a simpler form.

1. PostgreSQL: ON CONFLICT and SKIP LOCKED
PostgreSQL guarantees that ON CONFLICT runs atomically with the conflict check, so another transaction cannot slip in a conflicting row between the check and the insert. This supports the atomic claim-and-insert approach for idempotency keys and dedupe_key. 
nordeus
A cautionary note from one engineer: an INSERT ... ON CONFLICT UPDATE ... WHERE was still exposed to a race condition even inside a transaction, and SELECT ... FOR UPDATE was the fix. This is one anecdote, but it matters for token rotation, where we read state and then write. 
alexhyett
SKIP LOCKED treats locked rows as if they did not exist for that statement, and the lock disappears at the first commit. So claiming a row in one transaction and updating it in another leaves a window for a second worker. 
chat2db
Another source makes the related point that you should poll outbox rows without holding a transaction over the network. 
oneuptime

Design change: my blueprint’s worker said “select with SKIP LOCKED, send, mark”. That implies holding a transaction open across the email call, which is the wrong shape. The better design is a lease:

sql
-- Short transaction: claim
UPDATE outbox SET status='PROCESSING', locked_until = now() + interval '2 minutes',
                  attempts = attempts + 1
WHERE id IN (SELECT id FROM outbox
             WHERE (status='PENDING' AND run_at <= now())
                OR (status='PROCESSING' AND locked_until < now())   -- crashed worker recovery
             ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED)
RETURNING *;
-- then call the email provider OUTSIDE any transaction, then mark SENT / retry / FAILED

This needs a new locked_until timestamptz column on outbox. Without it, a worker that crashes mid-send leaves a row stuck in PROCESSING forever.

2. Stripe idempotency

What the docs say, and how it maps to us:

Stripe saves the status code and body of the first request for a key, whether it succeeded or failed, and replays that for later requests with the same key, including 500 errors. Our consequence: if a checkout fails (FAILED order), retrying with the same key returns the same failure. The frontend must generate a new key per user attempt and reuse it only for network retries and double-clicks. 
stripe
Keys are limited to 255 characters, and Stripe only saves a result once execution begins, so validation failures and requests that collide with a concurrent one with the same key are not saved and can be retried. Our consequence: validate before claiming the key (a malformed request must not burn a key), and treat a concurrent duplicate as a retryable 409, not as a cached failure. 
stripe
Stripe generates a new request if a key is reused after the original has been pruned. Keys expire upstream, so a reconciliation job cannot rely on replaying an old key forever. 
stripe
All POST requests accept idempotency keys, while GET and DELETE do not need them. This matches our scope: only POST /checkout needs one. 
stripe

Design change: add a key length cap (255) to the zod schema. Make the request_hash mismatch behaviour explicit in the README (same key, different body → 422). That behaviour is my design choice, and the retrieved Stripe text does not describe it, so don’t attribute it to Stripe. Document the “new key per attempt” rule.

3. OWASP authorization
The Authorization Cheat Sheet says permissions must be validated on every request, whether it comes from an AJAX call, server-side code, or anywhere else, and that validating only most requests is not enough. 
owasp
The OWASP developer guide checklist adds: force every non-public request through access checks, deny by default, use a single site-wide component for authorization, fail securely, and log authorization events. It also says that long-lived sessions should have authorization periodically re-validated and sessions terminated when authorization ceases. 
owasp
owasp
The same cheat sheet recommends writing tests that validate the permissions mapped out at design time are actually enforced. 
owasp

Design changes:

Deny by default: register a global auth hook so every route requires a student session unless it is on an explicit public allowlist (/courses, /checkout, /invitations/*, /auth/login, health). A forgotten route then fails closed, not open.
One authorization component: a single canAccessLesson(studentId, lessonId) in the learning module. No route does its own check.
Do not put entitlements in the JWT. The token carries only the student ID, and enrollment status is read from the DB on each request. That way a future REVOKED takes effect immediately, which also covers the re-validation point above.
The entitlement-matrix test (test 5) already matches the “test your permissions” advice. Add a test that every non-allowlisted route returns 401 without a cookie.
4. Outbox and duplicates (AWS and others)
AWS notes that the event-processing service may send duplicates, and recommends making the consumer idempotent by tracking processed messages. 
amazon
If a relay publishes and crashes before recording success, it must publish again. Marking a row sent before publishing avoids the duplicate but can lose the event, so a correct outbox chooses at-least-once with a stable event ID and idempotent consumers. This confirms the trade-off I described earlier. 
oneuptime
The classic pattern description also says consumers should track the IDs of messages they have already processed. 
microservices
The same article warns to require exactly one returned outbox row before committing, meaning the insert must be checked, not assumed. 
oneuptime

Design changes:

Our dedupe_key prevents duplicate enqueueing, but a crash after sending still duplicates the send. Email cannot be made exactly-once, so state this in the README as an accepted trade-off: a rare duplicate email beats a lost one. Pass the outbox row id as the provider’s idempotency/message key when a real provider supports it.
Handlers re-check state at run time (already designed), which makes duplicate reminders harmless in practice.
AWS also flags message ordering as a design concern, and we already avoid depending on it. Keep that sentence in the README.
In markPaid(), assert that the outbox inserts succeeded before committing.
5. Docker Compose startup
Compose only waits until a container is running, not until it is ready, so an app can start before its database can accept connections. 
docker
The fix is condition: service_healthy, where Compose waits for the dependency’s healthcheck to pass. One of the secondary sources also lists service_completed_successfully, which suits one-shot jobs. 
docker

Design change: my blueprint had the API run migrations on start. With a separate worker service, both could migrate at once and race. Better:

db (healthcheck) → migrate (one-shot: migrate + seed) → api  &  worker
                   depends_on: db: service_healthy
                   api/worker depends_on: migrate: service_completed_successfully

Note that depends_on governs startup order, not later restarts. For the fresh-clone test, run docker compose down -v first (clears the DB volume) and docker compose build --no-cache. That advice comes from my own experience; the search didn’t cover it, so verify it.

Summary of changes to the blueprint
#	Change	Source
1	Add outbox.locked_until; claim with a short lease transaction, send outside any transaction, recover stale PROCESSING rows	Postgres lock behaviour, outbox guidance
2	Frontend generates a new idempotency key per user attempt; validate before claiming the key; concurrent duplicate → retryable 409; cap key length at 255	Stripe docs
3	Deny-by-default global auth hook with a public allowlist; single canAccessLesson; keep entitlements out of the JWT; add a “401 on every non-public route” test	OWASP
4	Document at-least-once email as a deliberate trade-off; assert outbox insert success in markPaid(); use the outbox id as the provider message key	AWS and microservices.io
5	Replace “api migrates on start” with a one-shot migrate service and service_completed_successfully	Docker docs
6	Use SELECT ... FOR UPDATE in token rotation instead of read-then-write	Postgres race-condition note (single source)