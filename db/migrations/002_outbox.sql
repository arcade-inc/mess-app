CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL CHECK (message_type IN ('purchase_confirmation', 'invitation_reminder')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  dedupe_key text NOT NULL UNIQUE,
  last_error text,
  trace_context jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    trace_context IS NULL OR (
      jsonb_typeof(trace_context) = 'object'
      AND trace_context ? 'traceparent'
      AND (trace_context - 'traceparent' - 'tracestate') = '{}'::jsonb
    )
  ),
  CHECK (
    (status = 'PROCESSING' AND locked_until IS NOT NULL)
    OR (status <> 'PROCESSING' AND locked_until IS NULL)
  )
);

CREATE INDEX outbox_due_messages_idx ON outbox_messages (scheduled_at, created_at)
  WHERE status = 'PENDING';
CREATE INDEX outbox_expired_leases_idx ON outbox_messages (locked_until)
  WHERE status = 'PROCESSING';

CREATE TRIGGER trg_outbox_messages_updated
  BEFORE UPDATE ON outbox_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
