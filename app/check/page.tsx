import { Suspense } from 'react'
import CheckClient from './check-client'

export const dynamic = 'force-dynamic'

export default function CheckPage() {
  return (
    <Suspense fallback={null}>
      <CheckClient />
    </Suspense>
  )
}
