import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'

// Next 16 renamed middleware.ts -> proxy.ts. Same contract.
export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (await sessionIsValid(token)) return NextResponse.next()

  const login = new URL('/login', request.url)
  return NextResponse.redirect(login)
}

export const config = {
  // Everything except the login page, the login/switch endpoints, and static assets.
  // /api/switch authenticates itself with a bearer token so the Shortcut never
  // touches the cookie flow.
  matcher: ['/((?!login|api/login|api/switch|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)'],
}
