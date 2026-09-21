import Image from 'next/image'

// The platform mark every app carries — `public/logo.png`, the same file as
// apps/books and apps/sales. The palette is where this app differs; the logo is
// the family. A rebranded copy replaces the file, not this component.
export function BrandMark({ size = 20 }: { size?: number }) {
  return <Image src="/logo.png" alt="" width={size} height={size} className="shrink-0 rounded-[14%]" />
}

/**
 * The word beside the mark: `b/billing` → `billing`, because the mark already
 * says `b/` (books shows "books" the same way). Read from `APP_NAME`, never a
 * literal, so an env-renamed deployment still shows its own name.
 */
export function wordmark(appName: string): string {
  return appName.replace(/^b\//, '')
}
