import { expect, test } from '@playwright/test'

const messages = [
  {
    id: 'm1', threadId: 't1', sender: { name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' },
    subject: 'Opua berth confirmation', receivedAt: '2026-09-04T09:42:00+12:00', receivedLabel: '9:42 AM', preview: 'Confirmed', unread: true,
  },
  {
    id: 'm2', threadId: 't2', sender: { name: 'James Liu', address: 'james@example.com', initials: 'JL' },
    subject: 'Services agreement', receivedAt: '2026-09-04T08:16:00+12:00', receivedLabel: '8:16 AM', preview: 'Comments added', unread: true,
  },
]

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [] } }))
  await page.route('http://127.0.0.1:8411/v1/messages', (route) => route.fulfill({ json: { source: 'demo', messages } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\/(.+)/, (route) => {
    const id = route.request().url().split('/').pop()
    const summary = messages.find((message) => message.id === id) ?? messages[0]!
    return route.fulfill({ json: { message: { ...summary, source: 'demo', body: { kind: 'sanitized-html', content: '<p>Hello <strong>Steve</strong>.</p><script>window.attacked=true</script>' }, attachments: [] } } })
  })
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: { id: 'd1', inReplyToMessageId: 'm1', to: [messages[0]!.sender], subject: 'Re: Opua berth confirmation', bodyText: 'Thanks.', state: 'draft' } } }))
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ status: 503, json: { status: 'not_ready' } }))
})

test('renders the three-panel mail surface and sanitizes provider HTML', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Codex' })).toBeVisible()
  await expect(page.locator('[data-context]')).toContainText('Opua berth confirmation · Ana Morales')
  await expect(page.locator('[data-body] script')).toHaveCount(0)
  await expect(page.locator('[data-agent-status]')).toHaveText('Unavailable')
})

test('changes selection and opens a mail-service-owned draft', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-message-id="m2"]').click()
  await expect(page.getByRole('heading', { name: 'Services agreement' })).toBeVisible()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Draft body' })).toHaveValue('Thanks.')
})

test('renders a connector-selected Gmail account without trusting list markup', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const hostile = {
    ...messages[0]!,
    sender: { name: '<img src=x onerror=window.attacked=true>', address: 'sender@example.com', initials: 'X' },
    subject: '<script>window.attacked=true</script>',
  }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\?account=link-one/, (route) => route.fulfill({ json: { source: 'gmail', messages: [hostile] } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\/m1\?account=link-one/, (route) => route.fulfill({ json: { message: { ...hostile, source: 'gmail', body: { kind: 'sanitized-html', content: '<p>Safe body</p>' }, attachments: [] } } }))
  await page.goto('/')
  await expect(page.locator('[data-mail-source]')).toHaveText('Gmail connected')
  await expect(page.getByRole('combobox', { name: 'Gmail account' })).toHaveValue('link-one')
  await expect(page.locator('[data-message-list] img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { attacked?: boolean }).attacked)).not.toBe(true)
})
