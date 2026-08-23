import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Load .env.local into process.env for standalone scripts.
 *
 * Next.js does this itself; plain Node scripts don't. We parse and assign
 * explicitly rather than using `process.loadEnvFile()` or node's `--env-file`,
 * because tsx substitutes its own `process.env` object — the runtime loaders
 * write to the real one and the script then reads the substitute, silently
 * seeing nothing. Assigning to `process.env` directly hits whichever object is
 * actually in scope.
 *
 * A missing file is fine — in CI the variables are already in the environment.
 * Existing variables win, so a real environment is never clobbered by the file.
 */
export function loadLocalEnv(file = '.env.local') {
  const path = join(process.cwd(), file)
  if (!existsSync(path)) return

  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (!key || key in process.env) continue

    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1)
      if (quote === '"') value = value.replace(/\\n/g, '\n')
    }

    process.env[key] = value
  }
}
