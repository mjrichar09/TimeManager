import { redirect } from 'next/navigation'

/**
 * The origin root is no longer an app — it is a signpost.
 *
 * Tally used to live here, and the installed home-screen app, any bookmark and
 * the old manifest's start_url all still point at '/'. They land here and get
 * sent on, so moving Tally under /tally costs nobody a dead link.
 */
export default function RootPage() {
  redirect('/tally')
}
