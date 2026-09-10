import { getRenewalsView } from '@/lib/renewals'
import { getSettings, todayIn } from '@/lib/rounds'
import RenewalsClient from './renewals-client'

export const dynamic = 'force-dynamic'

export default async function RenewalsPage() {
  const settings = await getSettings()
  return <RenewalsClient initial={await getRenewalsView(todayIn(settings.timezone))} />
}
