import { getDayStates } from '@/lib/calendar'
import CalendarClient from './calendar-client'

export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
  return <CalendarClient states={await getDayStates()} />
}
