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

const conversations = messages.map((message) => ({
  ...message,
  id: `demo:${message.threadId}`,
  latestMessageId: message.id,
  messageCount: 1,
}))

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [] } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    const filtered = conversations.filter((conversation) => state === 'all' || (state === 'unread' ? conversation.unread : !conversation.unread))
    return route.fulfill({ json: { source: 'demo', conversations: filtered } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/(.+)/, (route) => {
    const threadId = new URL(route.request().url()).pathname.split('/').pop()
    const summary = conversations.find((conversation) => conversation.threadId === threadId) ?? conversations[0]!
    const message = { ...messages.find((item) => item.threadId === summary.threadId)!, source: 'demo', body: { kind: 'sanitized-html', content: '<p>Hello <strong>Steve</strong>.</p><blockquote>Earlier message</blockquote><script>window.attacked=true</script>' }, attachments: [] }
    const threadMessages = summary.threadId === 't1'
      ? [{ ...message, id: 'm0', receivedAt: '2026-09-03T07:30:00+12:00', receivedLabel: 'Sep 3, 7:30 AM', receivedFullLabel: 'September 3, 2026 at 7:30 AM' }, message]
      : [message]
    return route.fulfill({ json: { conversation: { ...summary, messageCount: threadMessages.length, source: 'demo', messages: threadMessages } } })
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
  await expect(page.locator('[data-conversation-id="demo:t1"] time')).toHaveText('Sep 4, 9:42 AM')
  await expect(page.locator('[data-time]')).toHaveText('September 4, 2026 at 9:42 AM')
  await expect(page.locator('[data-body] script')).toHaveCount(0)
  await expect(page.locator('.dispatch-thread-message')).toHaveCount(2)
  await expect(page.getByText('Quoted history')).toHaveCount(2)
  await expect(page.locator('.dispatch-thread-message time').first()).toHaveText('September 3, 2026 at 7:30 AM')
  await expect(page.locator('[data-agent-status]')).toHaveText('Reconnecting')
})

test('changes selection and opens a mail-service-owned draft', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t2"]').click()
  await expect(page.getByRole('heading', { name: 'Services agreement' })).toBeVisible()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Draft body' })).toHaveValue('Thanks.')
})

test('renders a connector-selected Gmail account without trusting list markup', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const hostile = {
    ...conversations[0]!,
    sender: { name: '<img src=x onerror=window.attacked=true>', address: 'sender@example.com', initials: 'X' },
    subject: '<script>window.attacked=true</script>',
    accountId: 'link-one',
    accountLabel: 'work@example.com',
  }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', scope: 'unified', conversations: [hostile] } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...hostile, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'sanitized-html', content: '<p>Safe body</p>' }, attachments: [] }] } } }))
  await page.goto('/')
  await expect(page.locator('[data-mail-source]')).toHaveText(/^Gmail connected · /)
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

test('filters conversations by all, unread, and read state', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id="demo:t1"]')).toHaveClass(/dispatch-message-unread/)
  await page.getByRole('button', { name: 'Unread', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(0)
  await expect(page.locator('.dispatch-message-list-empty')).toHaveText('No read messages in the connected inboxes.')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
})

test('shows cached conversations immediately while Gmail refreshes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.fulfill({ json: { source: 'demo', conversations } })
  })
  await page.reload()
  await expect(page.locator('[data-mail-source]')).toHaveText(/^Refreshing · cached /)
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await expect(page.locator('[data-mail-source]')).toHaveText('Demo mail')
})

test('derives an immediate unread view from the cached All inbox', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=unread/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.fulfill({ json: { source: 'demo', conversations } })
  })
  await page.getByRole('button', { name: 'Unread', exact: true }).click()
  await expect(page.locator('[data-mail-source]')).toHaveText(/^Refreshing · cached /)
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await expect(page.locator('[data-mail-source]')).toHaveText('Demo mail')
})

test('labels cached mail stale and exposes the refresh failure', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({
    status: 502, json: { error: 'gmail_conversation_list_failed', detail: 'connector timed out' },
  }))
  await page.reload()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await expect(page.locator('[data-mail-source]')).toHaveText(/^STALE · /)
  await expect(page.locator('[data-mail-error]')).toContainText('connector timed out')
  await expect(page.locator('[data-mail-error]')).toContainText('Showing data last confirmed')
})

test('answers Codex approval requests without changing the request id type', async ({ page }) => {
  let approval: unknown
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads', (route) => route.fulfill({ status: 201, json: { thread: { id: 'thread-test' } } }))
  await page.route('http://127.0.0.1:8412/v1/server-requests/respond', async (route) => {
    approval = await route.request().postDataJSON()
    await route.fulfill({ json: { status: 'resolved' } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: [
      'data: {"method":"turn/started","params":{"threadId":"thread-test","turn":{"status":"inProgress"}}}\n\n',
      'data: {"id":42,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-test","reason":"Read a local note"}}\n\n',
    ].join(''),
  }))
  await page.goto('/')
  await expect(page.getByText('Approve command?')).toBeVisible()
  await page.getByRole('button', { name: 'Allow once' }).first().click()
  await expect.poll(() => approval).toEqual({ id: 42, result: { decision: 'accept' } })
  await expect(page.getByText('Allow once', { exact: true })).toBeDisabled()
})

test('marks a conversation selected before its full thread finishes loading', async ({ page }) => {
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t2/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const summary = conversations[1]!
    return route.fulfill({ json: { conversation: { ...summary, source: 'demo', messages: [{ ...messages[1]!, source: 'demo', body: { kind: 'plain-text', content: 'Loaded.' }, attachments: [] }] } } })
  })
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t2"]').click()
  await expect(page.locator('[data-conversation-id="demo:t2"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Services agreement' })).toBeVisible()
  await expect(page.getByText('Loading conversation…')).toBeVisible()
  await expect(page.getByText('Loaded.')).toBeVisible()
})
