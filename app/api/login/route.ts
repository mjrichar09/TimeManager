import { NextResponse } from 'next/server'
import { issueSession, passwordMatches, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

/**
 * Where to send someone after they log in.
 *
 * Only same-origin paths are honoured. A `next` of `//evil.example` or
 * `https://evil.example` parses as an absolute URL in the browser, so an open
 * redirect is one missing check away — refuse anything that isn't a single
 * leading slash followed by a non-slash.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/tally'
  }
  return value
}

export async function POST(request: Request) {
  const form = await request.formData()
  const password = String(form.get('password') ?? '')
  const next = safeNext(String(form.get('next') ?? '') || null)

  if (!passwordMatches(password)) {
    const back = new URL('/login', request.url)
    back.searchParams.set('error', '1')
    if (next !== '/tally') back.searchParams.set('next', next)
    return NextResponse.redirect(back, { status: 303 })
  }

  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 })
  response.cookies.set(SESSION_COOKIE, await issueSession(), sessionCookieOptions)
  return response
}
