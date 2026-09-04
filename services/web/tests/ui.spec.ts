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
  await page.route('http://127.0.0.1:8411/v1/sync/status', (route) => route.fulfill({ json: { sync: { state: 'ready', startedAt: '2026-09-04T09:00:00+12:00', completedAt: '2026-09-04T09:01:00+12:00', error: null, messageCount: 2 } } }))
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
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
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
  await expect(page.locator('[data-mail-source]')).toHaveText(/^(Gmail connected|Gmail synced) · /)
  await expect(page.getByRole('combobox', { name: 'Gmail account' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Gmail account' }).locator('option').first()).toHaveText('All Gmail inboxes (1)')
  await expect(page.locator('[data-message-list] img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { attacked?: boolean }).attacked)).not.toBe(true)
})

test('navigates native Gmail folders and routes accepted message actions', async ({ page }) => {
  let requestedMailbox = ''
  let action: unknown
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?.*/, (route) => {
    requestedMailbox = new URL(route.request().url()).searchParams.get('mailbox') ?? ''
    return route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/conversations/t1/actions', async (route) => {
    action = await route.request().postDataJSON()
    await route.fulfill({ status: 202, json: { accepted: true } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Sent', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible()
  await expect.poll(() => requestedMailbox).toBe('sent')
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.locator('[data-archive]').click()
  await expect.poll(() => action).toEqual({ accountId: 'link-one', messageIds: ['m1'], action: 'archive' })
})

test('previews a new compose draft with account, Cc, and Bcc before saving', async ({ page }) => {
  let draftRequest: unknown
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    draftRequest = await route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { draft: { id: 'compose-1', inReplyToMessageId: '', to: [{ name: 'client@example.com', address: 'client@example.com', initials: '@' }], cc: 'cc@example.com', bcc: 'audit@example.com', subject: 'Project update', bodyText: 'Draft preview', state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByRole('heading', { name: 'New message' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Draft account' })).toHaveValue('link-one')
  await page.getByRole('textbox', { name: 'Draft recipient' }).fill('client@example.com')
  await page.getByRole('textbox', { name: 'Draft Cc' }).fill('cc@example.com')
  await page.getByRole('textbox', { name: 'Draft Bcc' }).fill('audit@example.com')
  await page.getByRole('textbox', { name: 'Draft subject' }).fill('Project update')
  await page.getByRole('textbox', { name: 'Draft body' }).fill('Draft preview')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect.poll(() => draftRequest).toEqual({ messageId: '', accountId: 'link-one', to: 'client@example.com', cc: 'cc@example.com', bcc: 'audit@example.com', subject: 'Project update', bodyText: 'Draft preview' })
})

test('creates a threaded reply-all draft without addressing the active account', async ({ page }) => {
  let draftRequest: Record<string, unknown> | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all.*/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', to: [{ name: 'Work', address: 'work@example.com', initials: 'W' }, { name: 'Colleague', address: 'colleague@example.com', initials: 'C' }], cc: [{ name: 'Manager', address: 'manager@example.com', initials: 'M' }], body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    draftRequest = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: { draft: { id: 'reply-all-1', inReplyToMessageId: 'm1', to: [], cc: draftRequest.cc, bcc: '', subject: 'Re: Opua berth confirmation', bodyText: '', state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Reply all' }).click()
  await expect.poll(() => draftRequest).toMatchObject({ messageId: 'm1', accountId: 'link-one', to: 'ana@example.com, colleague@example.com', cc: 'manager@example.com', bcc: '' })
})

test('updates read state only after the Gmail command is accepted', async ({ page }) => {
  let command: unknown
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/conversations/t1/read-state', async (route) => {
    command = await route.request().postDataJSON()
    await route.fulfill({ json: { accepted: true, result: { unread: false } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Mark read' }).click()
  await expect.poll(() => command).toEqual({ accountId: 'link-one', messageIds: ['m1'], unread: false })
})

test('edits, saves, and sends a Gmail draft from the middle panel', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: { id: 'draft-1', inReplyToMessageId: 'm1', to: [messages[0]!.sender], subject: 'Re: Opua berth confirmation', bodyText: '', state: 'draft', accountId: 'link-one' } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts/draft-1', async (route) => route.fulfill({ json: { draft: { id: 'draft-1', inReplyToMessageId: 'm1', to: [messages[0]!.sender], subject: 'Re: Opua berth confirmation', bodyText: 'Approved reply', state: 'draft', accountId: 'link-one' } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/drafts\/draft-1\?action=send.*/, (route) => route.fulfill({ json: { delivery: { id: 'sent-1' } } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('textbox', { name: 'Draft body' }).fill('Approved reply')
  await page.getByRole('button', { name: 'Send draft' }).click()
  await expect(page.getByText('Gmail confirmed that the draft was sent.')).toBeVisible()
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
  const agentPanel = page.getByRole('complementary', { name: 'Codex' })
  const agentBefore = await agentPanel.boundingBox()
  const agentDivider = await page.locator('[data-divider="agent"]').boundingBox()
  expect(agentBefore).not.toBeNull()
  expect(agentDivider).not.toBeNull()
  await page.mouse.move(agentDivider!.x + 4, agentDivider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(agentDivider!.x - 42, agentDivider!.y + 100)
  await page.mouse.up()
  const agentAfter = await agentPanel.boundingBox()
  expect(agentAfter!.width).toBeGreaterThan(agentBefore!.width + 30)
  await page.reload()
  const persistedMessages = await messagesPanel.boundingBox()
  const persistedAgent = await agentPanel.boundingBox()
  expect(persistedMessages!.width).toBeGreaterThan(before!.width + 30)
  expect(persistedAgent!.width).toBeGreaterThan(agentBefore!.width + 30)
})

test('restores structured Codex history as readable text', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-history/resume', (route) => route.fulfill({ json: { thread: { id: 'thread-history' } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-history', (route) => route.fulfill({ json: {
    thread: { turns: [{ items: [
      { type: 'userMessage', content: [{ type: 'input_text', text: 'Summarize this thread.' }] },
      { type: 'agentMessage', content: { type: 'output_text', text: '## Here is the summary.\n\n- First fact\n- Second fact\n\n| Source | Date |\n| --- | --- |\n| Gmail | Sep 3 |\n\n`thread/read`\n\n[Open evidence](https://example.com)' } },
      { type: 'userMessage', content: [{ type: 'input_text', text: `Long context ${'x'.repeat(320)}` }] },
      { type: 'agentMessage', content: { type: 'output_text', text: `Long response ${'y'.repeat(320)}\n\nhttps://example.com/${'path'.repeat(80)}` } },
    ] }] },
  } }))
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
  await page.addInitScript(() => localStorage.setItem('dispatch.codex.threadId', 'thread-history'))
  await page.goto('/')
  await expect(page.getByText('Summarize this thread.', { exact: true })).toBeVisible()
  await expect(page.getByText('Here is the summary.', { exact: true })).toBeVisible()
  await expect(page.locator('.ai-response h2')).toHaveText('Here is the summary.')
  await expect(page.locator('.ai-response table')).toContainText('Gmail')
  await expect(page.locator('.ai-response code')).toHaveText('thread/read')
  await expect(page.getByRole('link', { name: 'Open evidence' })).toHaveAttribute('target', '_blank')
  await expect(page.getByText('[object Object]', { exact: true })).toHaveCount(0)
  expect(await page.locator('[data-agent-stream]').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  for (const message of await page.locator('.dispatch-agent-message').all()) {
    expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('filters conversations by all, unread, and read state', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id="demo:t1"]')).toHaveClass(/dispatch-message-unread/)
  await page.getByRole('button', { name: 'Unread', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(0)
  await expect(page.locator('.dispatch-message-list-empty')).toHaveText('No read messages in inbox.')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
})

test('loads indexed conversation pages without rendering the full mailbox at once', async ({ page }) => {
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    return route.fulfill({ json: { source: 'demo', conversations: [cursor ? conversations[1] : conversations[0]], nextCursor: cursor ? null : '1', total: 2 } })
  })
  await page.goto('/')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Load more · 1 remaining' })).toBeVisible()
  await page.getByRole('button', { name: 'Load more · 1 remaining' }).click()
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2)
  await expect(page.locator('.dispatch-load-more')).toHaveCount(0)
})

test('searches the unified Gmail index from the message pane', async ({ page }) => {
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')
    return route.fulfill({ json: { source: 'demo', conversations: query ? [conversations[1]] : conversations, nextCursor: null, total: query ? 1 : 2 } })
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Search mail' }).fill('from:james@example.com')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Services agreement' })).toBeVisible()
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

test('recovers the mail list automatically after a transient service failure', async ({ page }) => {
  let attempts = 0
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => {
    attempts += 1
    return attempts === 1
      ? route.fulfill({ status: 502, json: { error: 'gmail_unavailable', detail: 'temporary outage' } })
      : route.fulfill({ json: { source: 'demo', conversations, nextCursor: null, total: conversations.length } })
  })
  await page.goto('/')
  await expect(page.locator('[data-mail-source]')).toHaveText('Unavailable')
  await expect(page.locator('[data-mail-error]')).toContainText('temporary outage')
  await expect(page.locator('[data-conversation-id]')).toHaveCount(2, { timeout: 5_000 })
  expect(attempts).toBeGreaterThanOrEqual(2)
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
