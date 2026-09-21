'use client'

import { useParams } from 'next/navigation'
import { InvoiceListPage } from '@/components/invoices/invoice-list'

export default function InvoicesPage() {
  const { ws } = useParams<{ ws: string }>()
  return <InvoiceListPage ws={ws} />
}
