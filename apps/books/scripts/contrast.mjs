// Every token pair in `app/globals.css`, measured against WCAG AA.
//
//     node scripts/contrast.mjs        (from apps/books)
//
// ===========================================================================
// IT READS THE CSS. IT DOES NOT RESTATE IT.
// ===========================================================================
// The palette moved on 2026-08-21 — cream to cool paper, both themes — and
// three separate things had to be re-earned rather than assumed to carry over:
// `--chip-mix` (which pulls a SERVED colour toward `--foreground`, so it moves
// when the foreground does), `--primary-strong`, and every muted label.
//
// A one-off script would have been thrown away and the next palette change
// would start from "it was fine last time". This one parses the values out of
// the stylesheet, so it measures what SHIPPED and cannot drift from it. Run it
// after touching any colour token.
//
// ── ITS OWN GRANULARITY LESSON ────────────────────────────────────────────
// The first version sliced the dark block with `css.indexOf('@theme inline')`
// and matched that string inside a COMMENT 168 lines above the declaration. The
// slice ran backwards, the dark block came out empty, and every dark token read
// `null`. It CRASHED rather than skipping dark silently, which is the only
// reason it was caught — a scan that had defaulted to "no checks to run" would
// have printed a clean light-theme report and been believed. The anchors are
// line-start regexes now.
//
// Exit code is non-zero on any failure, so it can be wired into a gate.
import { readFileSync } from 'node:fs'
const css = readFileSync('app/globals.css', 'utf8')
// Anchored on LINE STARTS. The first version searched for '@theme inline' as a
// substring and found it in a COMMENT 168 lines above the declaration, so the
// dark slice ran backwards and came out empty — the script's own version of the
// granularity lesson. It crashed rather than skipping dark silently, which is
// the only reason it was noticed.
const at = (re) => css.search(re)
const root = css.slice(at(/^:root \{/m), at(/^\.dark \{/m))
const dark = css.slice(at(/^\.dark \{/m), at(/^@theme inline/m))
const grab = (block, name) => {
  const m = block.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  return m ? m[1].trim() : null
}
const hex = (h) => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255) }
const lin = (c) => c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4)
const unlin = (c) => c <= 0.0031308 ? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055
const lum = ([r,g,b]) => 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
const ratio = (a,b) => { const [x,y]=[lum(a)+0.05,lum(b)+0.05]; return x>y?x/y:y/x }
function toOklab(rgb){const[r,g,b]=rgb.map(lin)
 const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b)
 const m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b)
 const s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b)
 return [0.2104542553*l+0.793617785*m-0.0040720468*s,1.9779984951*l-2.428592205*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.808675766*s]}
function fromOklab([L,a,bb]){const l=(L+0.3963377774*a+0.2158037573*bb)**3,m=(L-0.1055613458*a-0.0638541728*bb)**3,s=(L-0.0894841775*a-1.291485548*bb)**3
 return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.707614701*s].map(c=>Math.min(1,Math.max(0,unlin(c))))}
const mix=(c1,c2,p)=>{const A=toOklab(c1),B=toOklab(c2);return fromOklab(A.map((v,i)=>v*p+B[i]*(1-p)))}
const over=(c,s,p)=>c.map((v,i)=>v*p+s[i]*(1-p))
const SERVED = ['#3fb27f','#f0b66b','#ef6f6f','#7a8595']

let fail = 0
for (const [theme, block] of [['LIGHT', root], ['DARK', dark]]) {
  const fg = grab(block,'foreground'), bg = grab(block,'background'),
        card = grab(block,'card'), muted = grab(block,'muted'),
        mutedFg = grab(block,'muted-foreground'), strong = grab(block,'primary-strong'),
        success = grab(block,'success'),
        chipMix = parseFloat(grab(block,'chip-mix'))/100
  console.log(`\n${theme}  bg ${bg} card ${card} muted ${muted} fg ${fg}  chip-mix ${Math.round(chipMix*100)}%`)
  const checks = [
    ['--foreground on --background', fg, bg, 4.5],
    ['--foreground on --card',       fg, card, 4.5],
    ['--muted-foreground on --background', mutedFg, bg, 4.5],
    ['--muted-foreground on --card', mutedFg, card, 4.5],
    ['--muted-foreground on --muted', mutedFg, muted, 4.5],
    ['--primary-strong on --background', strong, bg, 4.5],
    ['--primary-strong on --card',   strong, card, 4.5],
    // `--success` is drawn BOTH as plain text and as a chip at a 15% tint of
    // itself. The tint is the harsher of the two and is the case that chose the
    // value — the served green (#3fb27f) measures 2.10:1 there and could not be
    // reused. See the token's own note in globals.css.
    ['--success on --card',          success, card, 4.5],
    ['--success on --background',    success, bg, 4.5],
    ['--success on --muted',         success, muted, 4.5],
  ]
  for (const [what, a, b, min] of checks) {
    const r = ratio(hex(a), hex(b)); const ok = r >= min
    if (!ok) fail++
    console.log(`  ${ok?'ok  ':'FAIL'} ${what.padEnd(38)} ${r.toFixed(2)}:1`)
  }
  // The success chip, at its own 15% tint — the treatment `<StateChip>` uses.
  {
    const r = ratio(hex(success), over(hex(success), hex(muted), 0.15))
    const ok = r >= 4.5
    if (!ok) fail++
    console.log(`  ${ok?'ok  ':'FAIL'} ${'--success as a chip on --muted'.padEnd(38)} ${r.toFixed(2)}:1`)
  }

  let worst = Infinity, who = ''
  for (const c of SERVED) for (const [sn, s] of [['card',card],['page',bg],['muted',muted]]) {
    const r = ratio(mix(hex(c), hex(fg), chipMix), over(hex(c), hex(s), 0.15))
    if (r < worst) { worst = r; who = `${c} on ${sn}` }
  }
  const ok = worst >= 4.5
  if (!ok) fail++
  console.log(`  ${ok?'ok  ':'FAIL'} ${'served chips, worst case'.padEnd(38)} ${worst.toFixed(2)}:1  (${who})`)
}
console.log(fail ? `\n${fail} FAILURES` : '\nevery token pair on the shipped palette passes WCAG AA')

process.exit(fail ? 1 : 0)
