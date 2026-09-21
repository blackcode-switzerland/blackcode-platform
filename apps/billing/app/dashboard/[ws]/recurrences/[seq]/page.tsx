'use client'

// `GET/PATCH …/recurrences/{seq}`, `…/generate` — see
// components/recurrences/recurrence-detail.tsx.
import { useParams } from 'next/navigation'
import { RecurrenceDetail } from '@/components/recurrences/recurrence-detail'

export default function Page() {
  const { ws, seq } = useParams<{ ws: string; seq: string }>()
  return <RecurrenceDetail ws={ws} seq={seq} />
}
