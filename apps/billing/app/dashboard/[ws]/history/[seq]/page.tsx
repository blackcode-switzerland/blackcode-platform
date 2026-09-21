'use client'

// One imported bill — `GET …/history/{seq}`. See components/history/history-detail-page.tsx.
import { useParams } from 'next/navigation'
import { HistoryDetailPage } from '@/components/history/history-detail-page'

export default function Page() {
  const { ws, seq } = useParams<{ ws: string; seq: string }>()
  return <HistoryDetailPage ws={ws} seq={seq} />
}
