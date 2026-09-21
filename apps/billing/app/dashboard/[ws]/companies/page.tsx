'use client'

// `GET/POST …/companies` — see components/companies/companies-page.tsx.
import { useParams } from 'next/navigation'
import { CompaniesPage } from '@/components/companies/companies-page'

export default function Page() {
  const { ws } = useParams<{ ws: string }>()
  return <CompaniesPage ws={ws} />
}
