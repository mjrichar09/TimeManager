import { getRoundsView } from '@/lib/rounds'
import TodayClient from './today-client'

export const dynamic = 'force-dynamic'

export default async function RoundsTodayPage() {
  return <TodayClient initial={await getRoundsView()} />
}
