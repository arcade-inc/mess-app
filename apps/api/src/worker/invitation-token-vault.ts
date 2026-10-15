import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new Error('Invitation token encryption secret is too short')
  return createHash('sha256').update('mes-outbox-invitation-token-v1\0').update(secret).digest()
}

export function encryptInvitationToken(token: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptInvitationToken(envelope: string, secret: string): string {
  const [version, ivPart, tagPart, ciphertextPart, ...extra] = envelope.split('.')
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart || extra.length > 0) {
    throw new Error('Invalid encrypted invitation token envelope')
  }
  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  const ciphertext = Buffer.from(ciphertextPart, 'base64url')
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted invitation token envelope')
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
