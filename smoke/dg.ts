import { normalizePhone, isWholeAmount, normalizeStatus } from '../api/_lib/dgateway'
const cases: [string, string | null][] = [
  ['0771234567', '0771234567'],
  ['+256771234567', '+256771234567'],
  ['256771234567', '256771234567'],
  ['07 71 234 567', '0771234567'],
  ['0771-234-567', '0771234567'],
  ['0751234567', '0751234567'],
  ['+254712345678', '+254712345678'],
  ['+255671234567', '+255671234567'],
  ['+250781234567', '+250781234567'],
  ['12345', null],
  ['', null],
  ['0971234567', null],
]
let fail = 0
for (const [input, want] of cases) {
  const got = normalizePhone(input)
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} "${input}" -> ${got} (want ${want})`)
}
// leading zero must survive
console.log(normalizePhone('0771234567')!.startsWith('0') ? 'ok   leading 0 preserved' : 'FAIL leading 0 stripped')
// amounts
for (const [v, want] of [[5000, true], [0, false], [-1, false], [10.5, false], ['5000', false]] as [any, boolean][]) {
  const ok = isWholeAmount(v) === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} amount ${JSON.stringify(v)} valid=${isWholeAmount(v)}`)
}
// statuses: only completed/failed are terminal
for (const [v, want] of [['completed','completed'],['COMPLETED','completed'],['failed','failed'],['pending','pending'],['processing','pending'],['','pending']] as [string,string][]) {
  const ok = normalizeStatus(v) === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} status "${v}" -> ${normalizeStatus(v)}`)
}
console.log(fail ? `\n${fail} FAILED` : '\nall dgateway checks passed')
process.exit(fail ? 1 : 0)
