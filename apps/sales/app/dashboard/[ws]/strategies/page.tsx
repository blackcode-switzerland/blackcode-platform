import { StrategiesPage } from '@/components/strategies/strategies-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <StrategiesPage ws={ws} />
}
