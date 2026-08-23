import { NextResponse } from 'next/server'
import { issueSession, passwordMatches, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export async function POST(request: Request) {
  const form = await request.formData()
  const password = String(form.get('password') ?? '')

  if (!passwordMatches(password)) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), { status: 303 })
  }

  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 })
  response.cookies.set(SESSION_COOKIE, await issueSession(), sessionCookieOptions)
  return response
}
