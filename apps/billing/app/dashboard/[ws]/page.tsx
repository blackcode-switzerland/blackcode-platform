'use client'

// The workspace overview. `GET …/overview` — see components/overview/overview-page.tsx.
import { useParams } from 'next/navigation'
import { OverviewPage } from '@/components/overview/overview-page'

export default function Page() {
  const { ws } = useParams<{ ws: string }>()
  return <OverviewPage ws={ws} />
}
