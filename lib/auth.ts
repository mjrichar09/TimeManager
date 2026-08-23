import { SignJWT, jwtVerify } from 'jose'

// Single-user auth: one password in an env var, exchanged for a signed cookie.
// No provider, no accounts table, no RLS — see db/migrations/0001_init.sql.
// The iOS Shortcut does not use this path; it carries its own bearer token.

export const SESSION_COOKIE = 'tally_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters')
  }
  return new TextEncoder().encode(value)
}

/** Constant-time compare, so a wrong password leaks nothing through timing. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.TALLY_PASSWORD
  if (!expected) throw new Error('TALLY_PASSWORD is not set')

  const a = new TextEncoder().encode(candidate)
  const b = new TextEncoder().encode(expected)
  // Fold length into the result rather than returning early on a mismatch.
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export async function issueSession(): Promise<string> {
  return new SignJWT({ sub: 'tally' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret())
}

export async function sessionIsValid(token: string | undefined): Promise<boolean> {
  if (!token) return false
  try {
    await jwtVerify(token, secret())
    return true
  } catch {
    return false
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
}
