'use client'

import { useQuery } from '@tanstack/react-query'

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/me/inbox?count_only=true')
  if (!res.ok) return 0
  const j = await res.json()
  return j.unread_count ?? 0
}

export function InboxBadge() {
  const { data } = useQuery({
    queryKey: ['inbox-unread'],
    queryFn: fetchUnreadCount,
    // No polling: a timer here kept the database awake for as long as any tab
    // was open. The count refreshes on window focus, on navigation and after an
    // inbox mutation, and the inbox page has a manual refresh button.
    refetchOnWindowFocus: true,
  })
  if (!data || data <= 0) return null
  return (
    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
      {data > 99 ? '99+' : data}
    </span>
  )
}
