import { expect, test } from '@playwright/test'

const base = {
  sender: { name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' },
  receivedAt: '2026-09-04T09:42:00+12:00', receivedLabel: 'Sep 4, 9:42 AM', receivedFullLabel: 'September 4, 2026 at 9:42 AM', preview: 'Confirmed', unread: true, messageCount: 1,
}
const first = { ...base, id: 'demo:t1', threadId: 't1', latestMessageId: 'm1', subject: 'Berth' }
const second = { ...base, id: 'demo:t2', threadId: 't2', latestMessageId: 'm2', subject: 'New arrival' }

test('chimes once when a live refresh brings an unread conversation', async ({ page }) => {
  let list = [first]
  let completedAt = '2026-09-04T09:01:00+12:00'
  await page.addInitScript(() => {
    const w = window as unknown as { __toneStarts: number[]; AudioContext: typeof AudioContext }
    w.__toneStarts = []
    class FakeOsc { type = 'sine'; frequency = { value: 0 }; connect() {} start(at: number) { w.__toneStarts.push(at) } stop() {} }
    class FakeGain { gain = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; connect() {} }
    class FakeContext { currentTime = 0; destination = {}; state = 'running'; async resume() {} createOscillator() { return new FakeOsc() } createGain() { return new FakeGain() } }
    w.AudioContext = FakeContext as unknown as typeof AudioContext
  })
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'a1', name: 'Steve', email: 'steve@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/sync/status', (route) => route.fulfill({ json: { sync: { state: 'ready', startedAt: '2026-09-04T09:00:00+12:00', completedAt, error: null, messageCount: list.length } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=/, (route) => route.fulfill({ json: { source: 'gmail', conversations: list, nextCursor: null, total: list.length } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/(.+)/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    const summary = list.find((c) => c.id === id) ?? first
    return route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [] } } })
  })
  await page.route('http://127.0.0.1:8412/**', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Berth' })).toBeVisible()
  const startsAfterLoad = await page.evaluate(() => (window as unknown as { __toneStarts: number[] }).__toneStarts.length)
  expect(startsAfterLoad).toBe(0)
  list = [second, first]
  completedAt = '2026-09-04T09:06:00+12:00'
  await expect(page.getByRole('button', { name: /New arrival/ })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __toneStarts: number[] }).__toneStarts.length)).toBe(9)
  completedAt = '2026-09-04T09:11:00+12:00'
  await page.waitForTimeout(6_000)
  expect(await page.evaluate(() => (window as unknown as { __toneStarts: number[] }).__toneStarts.length)).toBe(9)
})
