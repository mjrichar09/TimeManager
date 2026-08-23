export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className="flex min-h-dvh flex-col justify-center px-8">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Tally</h1>
        <p className="mt-2 text-sm text-ink-3">One user. One password.</p>

        <form action="/api/login" method="post" className="mt-8">
          <label htmlFor="password" className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
            PASSWORD
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="mt-2 w-full border border-rule bg-surface px-3 py-3 text-base outline-none focus:border-rule-strong"
          />
          <button
            type="submit"
            className="mt-3 w-full border border-ink bg-ink px-3 py-4 text-sm text-surface"
          >
            Open
          </button>
        </form>

        {error ? (
          <p className="mt-4 font-mono text-[10px] tracking-[0.12em] text-drain-ink">
            NOT THAT ONE
          </p>
        ) : null}
      </div>
    </main>
  )
}
