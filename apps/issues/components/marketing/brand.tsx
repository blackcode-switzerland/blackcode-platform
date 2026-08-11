import Image from 'next/image'
import Link from 'next/link'
import { cn } from "@blackcode/platform-ui/utils"

interface BrandProps {
  href?: string
  className?: string
  size?: 'sm' | 'md'
}

export function Brand({ href = '/', className, size = 'md' }: BrandProps) {
  const dim = size === 'sm' ? 24 : 28
  return (
    <Link
      href={href}
      aria-label="b/issues home"
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight',
        size === 'sm' ? 'text-base' : 'text-lg',
        className,
      )}
    >
      <Image
        src="/logo.png"
        alt=""
        width={dim}
        height={dim}
        className="rounded-[6px]"
        priority
      />
      {/* Lowercase, and no `blackcode` — the mark to its left already draws the
          `b/`. Same treatment as the app sidebar and as apps/sales. */}
      <span>issues</span>
    </Link>
  )
}
