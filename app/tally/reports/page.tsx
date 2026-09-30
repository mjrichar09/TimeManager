import { getReports } from '@/lib/reports'
import ReportsClient from './reports-client'

export const dynamic = 'force-dynamic'

/** The whole log to date. The client narrows it; the server never guesses. */
const BASELINE_START = '2026-08-23'

export default async function ReportsPage() {
  const to = new Date().toISOString().slice(0, 10)
  return <ReportsClient reports={await getReports(BASELINE_START, to)} />
}
