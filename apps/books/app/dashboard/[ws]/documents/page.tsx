'use client'

// Supporting documents — the nav item routes, the screen is sprint 2.
//
// A nav item pointing at a page that does not exist is a 404 installed in the
// chrome every page inherits (`apps/sales` learned it the same way). The nine
// items are the shape of the product and they ship together; what is not built
// says so, in `<NotBuiltYet>`, which nothing should still be rendering once
// sprint 2 is done.
//
// `<ScreenFrame>` is what makes this page correct rather than merely present:
// loading, error, no-books and unknown-book are all handled before the body,
// so `?entity=typo` refuses here exactly as it will when there is data.

import { ScreenFrame } from '@/components/screen-frame'
import { NotBuiltYet } from '@/components/states'

export default function Page() {
  return (
    <ScreenFrame title="Supporting documents">
      <NotBuiltYet screen="Supporting documents" mockup="app-pieces.html" />
    </ScreenFrame>
  )
}
