
### Simplified architecture

```
┌──────────────┐        ┌───────────────────────────────┐      ┌──────────┐
│ React (Vite) │ ─HTTP─▶│ Node API (TypeScript/Express  │ ───▶ │ Postgres │
│  SPA         │        │  or Fastify)                  │      └──────────┘
└──────────────┘        │ ┌─────────┬──────────┬──────┐ │
                        │ │Catalog  │Commerce  │Identity│ │
                        │ │         │(orders,  │(auth, │ │
                        │ │         │invites)  │students)│
                        │ ├─────────┴──────────┴──────┤ │
                        │ │ Learning (enrollments,    │ │
                        │ │ lessons, access)          │ │
                        │ └───────────────────────────┘ │
                        └───────────────────────────────┘
```


### Enhanced architecture (out of scope)

```flowchart TD
    SPA["React SPA"] --> API["Node API"]
    API --> DB["Postgres: application data and outbox"]
    DB --> Relay["Outbox publisher"]
    Relay --> Broker["RabbitMQ"]
    Broker --> Notifications["Notification worker"]
    Broker --> Analytics["Analytics worker"]
    Notifications --> Email["Email provider"]
```

The API still contains Catalog, Commerce, Identity, and Learning. Adding a broker doesn’t require splitting them into separate services.
Keep the core journey synchronous:
Operation	Execution	Reason
Create order and invitation	Database transaction	Return the invitation immediately
Activate student, enrol, consume invitation	Database transaction	Student gets access immediately
Check lesson access	API + database	Needs an immediate, authoritative answer
Send invitation email	Background worker	Provider delays shouldn’t block checkout
Record analytics	Background worker	Doesn’t affect access


For reliable event delivery, use a transactional outbox:
1. Checkout saves the order, invitation, and an InvitationCreated event in the same Postgres transaction.
2. A publisher reads pending outbox entries and sends them to RabbitMQ.
3. After broker confirmation, it marks the entry as published.
4. The notification worker processes the event, with retries and a dead-letter queue for persistent failures.
Delivery can happen more than once—for example, if the publisher crashes after sending but before marking the event published. Give each event a unique ID and make consumers idempotent. For email, use provider-supported idempotency where available; otherwise acknowledge that duplicate sends remain possible.
I’d improve the architecture in this order:
Stage	Improvement	Trigger
Assignment	Module boundaries, atomic onboarding, session and enrolment checks	Required for a correct core flow
Background processing	Outbox, broker, notification worker	Email delivery and other slow integrations
Operational reliability	Retry limits, DLQ, structured logs, queue/outbox monitoring	Running workers in production
Independent services	Extract selected modules	Independent scaling, releases, or team ownership




### Hi-level architecture

```flowchart TD
    Clients["Browser clients"] --> Edge["CDN + WAF"]
    Edge --> Static["React static assets"]
    Edge --> Gateway["API gateway: routing and rate limits"]
    Gateway --> LB["Internal load balancer"]

    subgraph Region["One region"]
        subgraph AZA["Availability zone A"]
            APIA["Stateless API replicas"]
            WorkerA["Worker replicas"]
        end
        subgraph AZB["Availability zone B"]
            APIB["Stateless API replicas"]
            WorkerB["Worker replicas"]
        end
        subgraph AZC["Availability zone C"]
            APIC["Stateless API replicas"]
            WorkerC["Worker replicas"]
        end

        LB --> APIA
        LB --> APIB
        LB --> APIC

        APIA & APIB & APIC --> Cache["Redis: replicated cache"]
        APIA & APIB & APIC --> DB["Postgres: primary + cross-zone standby"]
        DB --> Publisher["Outbox publisher replicas"]
        Publisher --> MQ["RabbitMQ: three-node quorum queues"]
        MQ --> WorkerA & WorkerB & WorkerC
    end

    WorkerA & WorkerB & WorkerC --> Providers["Email and external integrations"]
    APIA & APIB & APIC --> Storage["Object storage: lesson files"]
```

The API replicas initially run the same modular monolith: Catalog, Commerce, Identity, and Learning. Workers are separate processes so background work can scale independently.
Component	Purpose	Design decision
CDN + object storage	Deliver frontend and lesson assets	Keep large files away from API nodes
API gateway	Public API routing, throttling, request limits	Application still checks student identity and enrolment
Load balancer	Distribute requests across healthy replicas	Remove unhealthy instances using readiness checks
API nodes	Execute the core product flow	Stateless replicas; no local session or file dependency
Postgres	Store accounts, purchases, invitations, enrolments	Authoritative source; atomic checkout and onboarding
Redis	Reduce repeated database reads	Cache course catalog and lesson metadata with TTLs
RabbitMQ	Deliver background jobs	Durable quorum queues, acknowledgements, bounded retries
Worker nodes	Send emails and process events	Idempotent handlers; failed jobs go to a DLQ
Outbox publisher	Reliably bridge database commits to messaging	Multiple publishers claim different rows safely


Cache content, but be careful with access decisions. For this design, check enrolments against Postgres so revoked access takes effect immediately. Redis can fail without breaking correctness: fall back to database reads, with limits to prevent overwhelming it.
Reliability comes from how these components behave during failures:
Failure	Expected behaviour
API node fails	Load balancer routes to healthy replicas
One availability zone fails	Remaining zones serve traffic, provided they have sufficient spare capacity
Postgres primary fails	Managed cross-zone failover; some requests may fail during recovery
Redis fails	Cache misses fall back to Postgres
Broker is unavailable	Checkout/onboarding continue; committed events accumulate in the outbox
Worker crashes	Unacknowledged messages are redelivered
Email provider fails	Retry with backoff, then DLQ; invitation remains available on the purchase outcome page


### Observability flow

```flowchart TD
    API["API nodes"] --> Collector["Telemetry collector"]
    Workers["Workers and outbox publisher"] --> Collector
    Infrastructure["Database, cache and broker"] --> Collector
    Collector --> Logs["Centralised structured logs"]
    Collector --> Metrics["Metrics and dashboards"]
    Collector --> Traces["Distributed traces"]
    Metrics --> Alerts["Alert rules"]
    Alerts --> OnCall["On-call notifications"]
```

Area	Signals	When to notify
External email service	Errors, timeouts, delivery failures	Sustained failures or delivery backlog
API	Error rate, latency, availability	Sustained increase affecting users
Onboarding	Unexpected failures, successful activations	Failures rise or a synthetic journey fails
Internal processing	Retry count, DLQ entries, oldest pending job	Jobs stop progressing or exhaust retries
Outbox	Oldest unpublished event, pending count	Publication falls behind
Database	Connections, query latency, replication lag	Capacity or availability is threatened


Alert on impact and sustained failures, rather than every exception. An email timeout that succeeds on retry can remain a metric; a growing invitation backlog needs attention. Route urgent incidents to an on-call service, with lower-priority issues going to a team channel or ticket. Each alert should include severity, affected component, dashboard link, and a short recovery runbook.
For logging, use an allowlist of structured fields:
{
  "level": "error",
  "event": "invitation_delivery_failed",
  "requestId": "req_123",
  "traceId": "trace_456",
  "jobId": "job_789",
  "provider": "email",
  "errorCode": "PROVIDER_TIMEOUT",
  "attempt": 3,
  "durationMs": 5000
}

Avoid logging:
- Passwords or password hashes.
- Session cookies, authorization headers, invitation tokens.
- Request/response bodies by default.
- Student names, emails, or other onboarding data.
- Raw external-service responses and unsanitised error objects.
Invitation URLs deserve particular care: tokens can leak through access logs, query strings, traces, and analytics. Log the route template—such as /invitations/:token—rather than the actual URL, and configure the gateway and telemetry tools accordingly.
To make this enforceable, centralise the logger, redact sensitive fields as a second defence, and add a focused test that sends dummy secrets through failure paths and checks that they never appear in captured logs. Apply the same rules to traces and incident notifications, restrict log access, and define retention.


#### Distributed tracing

Use OpenTelemetry with W3C traceparent propagation, so browser and backend operations can belong to the same trace. OpenTelemetry
For checkout, the trace would contain:
Operation	Span
User clicks “Purchase”	Frontend action
Browser sends checkout request	HTTP client
API processes checkout	HTTP server
Database saves order, invitation, and outbox event	Database operation
Publisher sends event	Message producer
Worker processes invitation email	Message consumer
Worker calls email provider	HTTP client


The mechanism should work like this:
1. React starts an action span and keeps related requests within its context.
2. The HTTP client injects traceparent; the gateway preserves it.
3. Node extracts that context and creates child spans. Without valid incoming context, it starts a new trace.
4. The logger automatically includes the active traceId and spanId.
5. Save trace context in the outbox event, then propagate it through broker message headers.
6. Workers extract the context before processing the message.
OpenTelemetry provides injection and extraction APIs for crossing these boundaries. OpenTelemetry
A structured log could look like:
{
  "event": "invitation_delivery_failed",
  "service": "notification-worker",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "eventId": "evt_123",
  "errorCode": "PROVIDER_TIMEOUT",
  "attempt": 2
}

Then your observability platform lets you search by trace_id to see the timeline and correlated logs. That means collected diagnostic data, not raw request bodies or student information.
A few important design details:
- Cross-origin requests: allow tracing headers in CORS and propagate them only to approved API destinations.
- Frontend errors: attach the active trace ID to the error report; optionally return a diagnostic ID from the API for support.
- Privacy: sanitise URLs, span attributes, logs, and errors. Never put invitation tokens, emails, or passwords into tracing baggage.
- Sampling: sampled-out traces won’t have a complete timeline. Define retention and sampling explicitly; IDs alone don’t guarantee every span is stored.
- Security: a trace ID is diagnostic metadata, never proof of identity or permission.
Finally, checkout and onboarding should be separate traces—the student might open the invitation days later. Correlate that longer business journey using an internal purchase_id or invitation_id. For delayed jobs or retries, you can also create a new trace linked to the original span. OpenTelemetry supports links across traces.