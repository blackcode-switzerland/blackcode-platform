'use client'

// `GET/PATCH …/companies/{slug}` — see components/companies/company-detail.tsx.
import { useParams } from 'next/navigation'
import { CompanyDetail } from '@/components/companies/company-detail'

export default function Page() {
  const { ws, slug } = useParams<{ ws: string; slug: string }>()
  return <CompanyDetail ws={ws} slug={slug} />
}
