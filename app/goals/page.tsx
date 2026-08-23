import { getGoalsView } from '@/lib/goals'
import GoalsClient from './goals-client'

export const dynamic = 'force-dynamic'

export default async function GoalsPage() {
  return <GoalsClient initial={await getGoalsView()} />
}
