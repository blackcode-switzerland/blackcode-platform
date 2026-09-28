import { Suspense } from 'react'
import { WorkspacesView } from '@/components/workspaces-view'

export const dynamic = 'force-dynamic'

export default function WorkspacesPage() {
  // `useSearchParams` in the view needs a Suspense boundary.
  return (
    <Suspense>
      <WorkspacesView />
    </Suspense>
  )
}
