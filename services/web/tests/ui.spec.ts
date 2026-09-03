import { expect, test } from '@playwright/test'

const messages = [
  {
    id: 'm1', threadId: 't1', sender: { name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' },
    subject: 'Opua berth confirmation', receivedAt: '2026-09-04T09:42:00+12:00', receivedLabel: 'Sep 4, 9:42 AM', receivedFullLabel: 'September 4, 2026 at 9:42 AM', preview: 'Confirmed', unread: true,
  },
  {
    id: 'm2', threadId: 't2', sender: { name: 'James Liu', address: 'james@example.com', initials: 'JL' },
    subject: 'Services agreement', receivedAt: '2026-09-04T08:16:00+12:00', receivedLabel: 'Sep 4, 8:16 AM', receivedFullLabel: 'September 4, 2026 at 8:16 AM', preview: 'Comments added', unread: true,
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
  await expect(page.locator('[data-message-id="m1"] time')).toHaveText('Sep 4, 9:42 AM')
  await expect(page.locator('[data-time]')).toHaveText('September 4, 2026 at 9:42 AM')
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
    accountId: 'link-one',
    accountLabel: 'work@example.com',
  }
  await page.unroute('http://127.0.0.1:8411/v1/messages')
  await page.route('http://127.0.0.1:8411/v1/messages', (route) => route.fulfill({ json: { source: 'gmail', scope: 'unified', messages: [hostile] } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\/m1\?account=link-one/, (route) => route.fulfill({ json: { message: { ...hostile, source: 'gmail', body: { kind: 'sanitized-html', content: '<p>Safe body</p>' }, attachments: [] } } }))
  await page.goto('/')
  await expect(page.locator('[data-mail-source]')).toHaveText('Gmail connected')
  await expect(page.getByRole('combobox', { name: 'Gmail account' })).toHaveValue('')
  await expect(page.locator('[data-message-list] img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { attacked?: boolean }).attacked)).not.toBe(true)
})

test('allows one, two, or three adjustable panels while keeping one visible', async ({ page }) => {
  await page.goto('/')
  const messagesToggle = page.getByRole('button', { name: 'Messages', exact: true })
  const emailToggle = page.getByRole('button', { name: 'Email', exact: true })
  const codexToggle = page.getByRole('button', { name: 'Codex', exact: true })
  await messagesToggle.click()
  await expect(page.getByRole('complementary', { name: 'Messages' })).toBeHidden()
  await emailToggle.click()
  await expect(page.getByRole('main', { name: 'Selected email' })).toBeHidden()
  await codexToggle.click()
  await expect(codexToggle).toHaveAttribute('aria-pressed', 'true')
  await messagesToggle.click()
  await expect(page.getByRole('complementary', { name: 'Messages' })).toBeVisible()
  await emailToggle.click()
  await expect(page.getByRole('main', { name: 'Selected email' })).toBeVisible()
  await expect(page.locator('[role="separator"]')).toHaveCount(2)
  const messagesPanel = page.getByRole('complementary', { name: 'Messages' })
  const before = await messagesPanel.boundingBox()
  const divider = await page.locator('[data-divider="messages"]').boundingBox()
  expect(before).not.toBeNull()
  expect(divider).not.toBeNull()
  await page.mouse.move(divider!.x + 2, divider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(divider!.x + 42, divider!.y + 100)
  await page.mouse.up()
  const after = await messagesPanel.boundingBox()
  expect(after!.width).toBeGreaterThan(before!.width + 30)
})
