import { getRoundsView } from '@/lib/rounds'
import ChoresClient from './chores-client'

export const dynamic = 'force-dynamic'

export default async function ChoresPage() {
  return <ChoresClient initial={await getRoundsView()} />
}
