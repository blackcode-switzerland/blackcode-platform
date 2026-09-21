// Render the fixture invoice and print the sha256 of its bytes.
//
//   npx tsx lib/pdf/render-hash.ts
//
// `pdf.test.ts` runs this in TWO SEPARATE PROCESSES and compares the output.
// Comparing two renders inside one process would pass on a memoised buffer, a
// shared font object or a cached date — none of which is what position P10
// needs. Two processes share nothing but the repository.

import { createHash } from 'node:crypto'
import { renderInvoicePdf } from './invoice'
import { sampleCompany, sampleInvoice } from './fixtures'

// No top-level await: tsx transpiles this file to CommonJS.
async function main(): Promise<void> {
  const bytes = await renderInvoicePdf({ invoice: sampleInvoice(), company: sampleCompany })
  process.stdout.write(`${createHash('sha256').update(bytes).digest('hex')} ${bytes.length}\n`)
}

void main()
