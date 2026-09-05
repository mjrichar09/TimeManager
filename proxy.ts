import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'

// Next 16 renamed middleware.ts -> proxy.ts. Same contract.
export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (await sessionIsValid(token)) return NextResponse.next()

  // Carry where they were going. One login now serves two apps, and an expired
  // session in Rounds that dumps you into Tally is a small thing that feels
  // like a bug every time it happens.
  const login = new URL('/login', request.url)
  const { pathname, search } = request.nextUrl
  if (pathname !== '/') login.searchParams.set('next', pathname + search)

  return NextResponse.redirect(login)
}

export const config = {
  // Everything except the login page, the login/switch endpoints, and static assets.
  // /api/switch authenticates itself with a bearer token so the Shortcut never
  // touches the cookie flow; /api/cron/* checks CRON_SECRET, which is what
  // Vercel sends instead of a cookie.
  //
  // sw.js and both manifests are excluded because a 307 to /login is not a
  // service worker and not a manifest: the browser fetches them outside any
  // page's session and would silently fail to install the app.
  matcher: [
    '/((?!login|api/login|api/switch|api/cron|sw.js|_next/static|_next/image|favicon.ico|manifest.webmanifest|rounds/manifest.webmanifest|icons/).*)',
  ],
}
