import { getRoundsView } from '@/lib/rounds'
import SettingsClient from './settings-client'

export const dynamic = 'force-dynamic'

export default async function RoundsSettingsPage() {
  return (
    <SettingsClient
      initial={await getRoundsView()}
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
    />
  )
}
