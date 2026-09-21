'use client'

// `GET/POST …/recurrences` — see components/recurrences/recurrences-page.tsx.
import { useParams } from 'next/navigation'
import { RecurrencesPage } from '@/components/recurrences/recurrences-page'

export default function Page() {
  const { ws } = useParams<{ ws: string }>()
  return <RecurrencesPage ws={ws} />
}
