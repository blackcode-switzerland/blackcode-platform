'use client'

// The imported archive — `GET/POST …/history`. See components/history/history-page.tsx.
import { useParams } from 'next/navigation'
import { HistoryPage } from '@/components/history/history-page'

export default function Page() {
  const { ws } = useParams<{ ws: string }>()
  return <HistoryPage ws={ws} />
}
