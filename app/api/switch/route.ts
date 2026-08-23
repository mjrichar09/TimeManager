import { NextResponse } from 'next/server'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'
import { switchTo, UnknownCategoryError, type SwitchSource } from '@/lib/switch'
import { cookies } from 'next/headers'

/**
 * POST /api/switch  — the capture endpoint (build-plan §4).
 *
 *   Authorization: Bearer <SHORTCUT_TOKEN>   (phone shortcut)
 *   or a valid session cookie                (the PWA)
 *
 *   Body: { "category": "deep-work" }  — a slug
 *   Also accepts form-encoded `category`, so a shortcut app that can only post
 *   a form still works.
 *
 * This route is excluded from the proxy's auth check; it authenticates itself.
 */

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7).trim()
}

function tokenMatches(candidate: string): boolean {
  const expected = process.env.SHORTCUT_TOKEN
  if (!expected) return false
  const a = new TextEncoder().encode(candidate)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

async function authorize(request: Request): Promise<SwitchSource | null> {
  const token = bearerToken(request)
  if (token) return tokenMatches(token) ? 'shortcut' : null

  const jar = await cookies()
  if (await sessionIsValid(jar.get(SESSION_COOKIE)?.value)) return 'pwa'
  return null
}

async function readCategory(request: Request): Promise<string | null> {
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) {
      const body = await request.json()
      const value = body?.category
      return typeof value === 'string' && value.trim() ? value.trim() : null
    }
    const form = await request.formData()
    const value = form.get('category')
    return typeof value === 'string' && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const source = await authorize(request)
  if (!source) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const category = await readCategory(request)
  if (!category) {
    return NextResponse.json(
      { ok: false, error: 'missing_category', hint: 'Send { "category": "<slug>" }' },
      { status: 400 }
    )
  }

  try {
    const result = await switchTo(category, source)

    // A shortcut shows this string in a notification, so it has to read well on
    // its own: "Deep work started. Meetings closed at 47m."
    const message = result.unchanged
      ? `${result.now.name} already running.`
      : result.closed
        ? `${result.now.name} started. ${result.closed.name} closed at ${result.closed.minutes}m.`
        : `${result.now.name} started.`

    return NextResponse.json({ ...result, message })
  } catch (error) {
    if (error instanceof UnknownCategoryError) {
      return NextResponse.json({ ok: false, error: 'unknown_category', category }, { status: 404 })
    }
    console.error('switch failed', error)
    return NextResponse.json({ ok: false, error: 'switch_failed' }, { status: 500 })
  }
}
