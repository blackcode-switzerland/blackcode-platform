'use client'

import { useParams } from 'next/navigation'
import { InvoiceDetailPage } from '@/components/invoices/invoice-detail'

export default function InvoicePage() {
  const { ws, ref } = useParams<{ ws: string; ref: string }>()
  return <InvoiceDetailPage ws={ws} ref={ref} />
}
