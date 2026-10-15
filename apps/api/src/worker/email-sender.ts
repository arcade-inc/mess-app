export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  idempotencyKey: string
}

export interface EmailSender {
  /** False means this environment intentionally has no delivery provider configured. */
  enabled?: boolean
  send(email: OutgoingEmail): Promise<void>
}

// Local mode deliberately does not emit recipient addresses, links, or message bodies to logs.
export function createMockEmailSender(): EmailSender {
  return { enabled: false, async send() {} }
}
