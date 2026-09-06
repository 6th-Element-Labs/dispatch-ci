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

async function stubAgent(page: import('@playwright/test').Page, bindings: Record<string, { threadId: string }> = {}) {
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', async (route) => {
    const body = await route.request().postDataJSON() as { kind?: string; accountId?: string; gmailThreadId?: string }
    const key = body.kind === 'conversation' ? `conversation:${body.accountId}:${body.gmailThreadId}` : 'unbound'
    const threadId = bindings[key]?.threadId ?? `thread-${key}`
    await route.fulfill({ json: { binding: { key: body, threadId, created: false, replaced: false } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const id = route.request().url().split('/').pop()
    await route.fulfill({ json: { thread: { turns: [{ items: [{ type: 'agentMessage', text: `History for ${id}` }] }] } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
}

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
  await page.route('http://127.0.0.1:8411/v1/drafts/preview', async (route) => {
    const request = await route.request().postDataJSON() as { bodyMarkdown: string }
    await route.fulfill({ json: { bodyHtml: `<p>${request.bodyMarkdown}</p>` } })
  })
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ status: 503, json: { status: 'not_ready' } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/recipients/, (route) => route.fulfill({ json: { recipients: [] } }))
})

test('renders the three-panel mail surface and sanitizes provider HTML', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await expect(page.locator('.dispatch-toolbar')).toBeVisible()
  await expect(page.locator('.dispatch-titlebar')).toHaveCount(0)
  await expect(page.locator('.dispatch-statusbar')).toHaveCount(0)
  await expect(page.getByText('Dispatch', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Codex' })).toBeVisible()
  await expect(page.getByText('GPT-5.6 Sol · Medium')).toBeVisible()
  await expect(page.locator('[data-context]')).toContainText('Opua berth confirmation · Ana Morales')
  await expect(page.locator('[data-conversation-id="demo:t1"] time')).toHaveText('Sep 4, 9:42 AM')
  await expect(page.locator('[data-body] script')).toHaveCount(0)
  await expect(page.locator('.dispatch-thread-message')).toHaveCount(2)
  await expect(page.locator('.dispatch-thread-message.dispatch-thread-collapsed')).toHaveCount(1)
  await expect(page.getByText('Quoted history')).toHaveCount(1)
  await page.locator('.dispatch-thread-message.dispatch-thread-collapsed').click()
  await expect(page.getByText('Quoted history')).toHaveCount(2)
  await expect(page.locator('[data-thread-meta]')).toContainText('2 messages')
  await expect(page.locator('.dispatch-reader-header .subheader')).toHaveCount(0)
  await expect(page.locator('.dispatch-reader-actions')).toHaveCount(0)
  await expect(page.locator('.dispatch-thread-message time').first()).toHaveText('September 4, 2026 at 9:42 AM')
  await expect(page.locator('[data-agent-status]')).toHaveText('Reconnecting')
})

test('opens folders from the toolbar popover and keeps the account scope in the toolbar', async ({ page }) => {
  await page.goto('/')
  const folder = page.locator('[data-folder-toggle]')
  await expect(folder).toHaveText('Inbox')
  await expect(page.locator('[data-folder-menu]')).toBeHidden()
  await folder.click()
  await expect(page.locator('[data-folder-menu]')).toBeVisible()
  await page.locator('[data-folder-menu] [data-mailbox="sent"]').click()
  await expect(page.locator('[data-folder-menu]')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible()
  await expect(page.locator('.dispatch-toolbar').getByRole('combobox', { name: 'Gmail account' })).toBeVisible()
  await expect(page.locator('.dispatch-toolbar').getByRole('textbox', { name: 'Search mail' })).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('textbox', { name: 'Search mail' })).toBeFocused()
  await expect(page.locator('.dispatch-toolbar [data-panel]')).toHaveCount(3)
})

test('shows a live Tabler activity indicator while Codex is working', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => { const status = document.querySelector('[data-agent-status]'); if (status) status.textContent = 'Working' })
  await expect(page.locator('[data-agent-activity]')).toBeVisible()
  await page.evaluate(() => { const status = document.querySelector('[data-agent-status]'); if (status) status.textContent = 'Connected' })
  await expect(page.locator('[data-agent-activity]')).toBeHidden()
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
  await expect(page.getByRole('combobox', { name: 'Gmail account' }).locator('option').first()).toHaveText('All inboxes (1)')
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
  await expect.poll(() => draftRequest).toEqual({ messageId: '', accountId: 'link-one', to: 'client@example.com', cc: 'cc@example.com', bcc: 'audit@example.com', subject: 'Project update', bodyMarkdown: 'Draft preview', bodyText: 'Draft preview', attachments: [] })
})

test('autosaves each saved-draft header and keeps the account locked', async ({ page }) => {
  const updates: Record<string, unknown>[] = []
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: {
    id: 'autosave-1', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: '', bodyMarkdown: '', bodyHtml: '<p></p>', bodyText: '', attachments: [], state: 'draft', accountId: 'link-one',
  } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts/autosave-1', async (route) => {
    const fields = await route.request().postDataJSON() as Record<string, unknown>
    updates.push(fields)
    await route.fulfill({ json: { draft: {
      id: 'autosave-1', inReplyToMessageId: '', to: [], cc: fields.cc, bcc: fields.bcc, subject: fields.subject,
      bodyMarkdown: fields.bodyMarkdown, bodyHtml: '<p></p>', bodyText: fields.bodyText, attachments: [], state: 'draft', accountId: 'link-one',
    } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Compose' }).click()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('combobox', { name: 'Draft account' })).toBeDisabled()

  const changes: Array<[string, string, string]> = [
    ['Draft recipient', 'client@example.com', 'to'],
    ['Draft Cc', 'copy@example.com', 'cc'],
    ['Draft Bcc', 'audit@example.com', 'bcc'],
    ['Draft subject', 'Updated subject', 'subject'],
  ]
  for (const [name, value, field] of changes) {
    const count = updates.length
    await page.getByRole('textbox', { name }).fill(value)
    await expect.poll(() => updates.length).toBe(count + 1)
    expect(updates.at(-1)?.[field]).toBe(value)
  }
})

test('saves a new draft before asking Codex to revise its real Gmail draft ID', async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined
  const operationOrder: string[] = []
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: {
    id: 'gmail-draft-42', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: 'Plan', bodyMarkdown: 'Original',
    bodyHtml: '<p>Original</p>', bodyText: 'Original', attachments: [], state: 'draft', accountId: 'link-one',
  } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts/gmail-draft-42', async (route) => {
    operationOrder.push('update')
    const fields = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { draft: {
      id: 'gmail-draft-42', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: 'Plan',
      bodyMarkdown: fields.bodyMarkdown, bodyHtml: '<p>Revised locally</p>', bodyText: fields.bodyText,
      attachments: [], state: 'draft', accountId: 'link-one',
    } } })
  })
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/threads', (route) => route.fulfill({ status: 201, json: { thread: { id: 'thread-revise' } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-revise', created: false, replaced: false } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/thread-revise$/, (route) => route.fulfill({ json: { thread: { turns: [] } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-revise/turns', async (route) => {
    operationOrder.push('turn')
    turnRequest = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 202, json: { turn: { id: 'turn-1' } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
  await page.goto('/')
  await expect(page.locator('[data-connector]')).toHaveText('Gmail available')
  await page.getByRole('button', { name: 'Compose' }).click()
  await page.getByRole('textbox', { name: 'Draft subject' }).fill('Plan')
  await page.getByRole('textbox', { name: 'Draft body' }).fill('Original')
  await page.getByRole('button', { name: 'Ask Codex to revise' }).click()

  await expect.poll(() => turnRequest).toBeDefined()
  const text = String(turnRequest?.text)
  expect(text).toContain('gmail-draft-42')
  expect(text).toContain('link-one')
  expect(text).toContain('update_draft')
  expect(text).toContain('text_plain')
  expect(text).toContain('payload')
  expect(text).toContain('Never send')

  operationOrder.length = 0
  turnRequest = undefined
  await page.getByRole('textbox', { name: 'Draft body' }).fill('Revised locally')
  await page.getByRole('button', { name: 'Ask Codex to revise' }).click()
  await expect.poll(() => operationOrder).toEqual(['update', 'turn'])
})

test('picks Luna Reserve when Sol has hit its usage limit and sends it with the next turn', async ({ page }) => {
  const turns: Record<string, unknown>[] = []
  let catalogReads = 0
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads', (route) => route.fulfill({ status: 201, json: { thread: { id: 'thread-model' } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-model', created: false, replaced: false } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/thread-model$/, (route) => route.fulfill({ json: { thread: { turns: [] } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-model/turns', async (route) => {
    turns.push(await route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 202, json: { turn: { id: `turn-${turns.length}` } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
  await page.route('http://127.0.0.1:8412/v1/models', (route) => {
    catalogReads += 1
    return route.fulfill({ json: {
      defaults: { model: 'gpt-5.6-sol', effort: 'medium' },
      rateLimitsError: null,
      models: [
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], exhausted: true, resetsAt: 1788754468 },
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], exhausted: true, resetsAt: 1788754468 },
        { id: 'gpt-reserve', label: 'Luna Reserve', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], exhausted: false, resetsAt: 1789252467 },
      ],
    } })
  })
  await page.goto('/')
  await expect(page.locator('[data-connector]')).toHaveText('No Gmail connector')
  const toggle = page.locator('[data-model-toggle]')
  await expect(toggle).toHaveText('GPT-5.6 Sol · Medium')
  await expect(toggle).toHaveClass(/bg-yellow-lt/)
  await expect(page.locator('[data-model-menu]')).toBeHidden()

  await toggle.click()
  const menu = page.locator('[data-model-menu]')
  await expect(menu).toBeVisible()
  await expect(menu.locator('[data-model-summary]')).toContainText('GPT-5.6 Sol has reached its usage limit')
  await expect(menu.locator('[data-model-id="gpt-5.6-sol"]')).toBeDisabled()
  await expect(menu.locator('[data-model-id="gpt-5.6-sol"]')).toContainText('Limit reached · resets')
  await expect(menu.locator('[data-model-id="gpt-reserve"]')).toBeEnabled()
  await expect(menu.locator('[data-effort="ultra"]')).toBeVisible()
  expect(page.getByText('Full reset')).toHaveCount(0)

  await menu.locator('[data-model-id="gpt-reserve"]').click()
  await expect(menu.locator('[data-model-id="gpt-reserve"]')).toHaveAttribute('aria-checked', 'true')
  await expect(menu.locator('[data-effort="ultra"]')).toHaveCount(0)
  await menu.locator('[data-effort="max"]').click()
  await expect(toggle).toHaveText('Luna Reserve · Max')
  await expect(toggle).toHaveClass(/bg-blue-lt/)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  await page.getByRole('textbox', { name: 'Ask Codex' }).fill('Summarize this thread.')
  await page.keyboard.press('Enter')
  await expect.poll(() => turns.length).toBe(1)
  expect(turns[0]).toMatchObject({ text: 'Summarize this thread.', model: 'gpt-reserve', effort: 'max' })

  await page.reload()
  await expect(page.locator('[data-model-toggle]')).toHaveText('Luna Reserve · Max')
  expect(catalogReads).toBeGreaterThan(0)
})

test('tells the user the model list needs Codex when the agent is down', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-agent-status]')).toHaveText('Reconnecting')
  await page.locator('[data-model-toggle]').click()
  await expect(page.locator('[data-model-summary]')).toHaveText('Codex not connected')
  await expect(page.locator('[data-model-id="gpt-5.6-sol"]')).toBeEnabled()
})

test('does not ask Codex to revise when Gmail does not return a draft ID', async ({ page }) => {
  let turnCount = 0
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: {
    id: '', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: '', bodyMarkdown: '', bodyHtml: '<p></p>',
    bodyText: '', attachments: [], state: 'draft', accountId: 'link-one',
  } } }))
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/threads', (route) => route.fulfill({ status: 201, json: { thread: { id: 'thread-no-id' } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-no-id', created: false, replaced: false } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/thread-no-id$/, (route) => route.fulfill({ json: { thread: { turns: [] } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-no-id/turns', async (route) => {
    turnCount += 1
    await route.fulfill({ status: 202, json: {} })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
  await page.goto('/')
  await expect(page.locator('[data-connector]')).toHaveText('Gmail available')
  await page.getByRole('button', { name: 'Compose' }).click()
  await page.getByRole('button', { name: 'Ask Codex to revise' }).click()

  await expect(page.locator('[data-draft-error]')).toContainText('did not return a draft ID')
  expect(turnCount).toBe(0)
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

test('uses the newest message for a reply-all draft', async ({ page }) => {
  let draftRequest: Record<string, unknown> | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const newest = {
    ...messages[0]!,
    id: 'newest-message',
    accountId: 'link-one',
    source: 'gmail',
    sender: { name: 'Newest Sender', address: 'newest@example.com', initials: 'NS' },
    to: [{ name: 'Work', address: 'work@example.com', initials: 'W' }],
    body: { kind: 'plain-text', content: 'Newest words' },
    attachments: [],
  }
  const oldest = {
    ...messages[0]!,
    id: 'oldest-message',
    accountId: 'link-one',
    source: 'gmail',
    sender: { name: 'Older Sender', address: 'older@example.com', initials: 'OS' },
    to: [{ name: 'Work', address: 'work@example.com', initials: 'W' }],
    body: { kind: 'plain-text', content: 'Older words' },
    attachments: [],
  }
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', latestMessageId: newest.id, messageCount: 2 }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all.*/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [newest, oldest] } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    draftRequest = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: { draft: { id: 'newest-reply-all', inReplyToMessageId: newest.id, to: [newest.sender], cc: '', bcc: '', subject: 'Re: Opua berth confirmation', bodyMarkdown: '', bodyHtml: '', bodyText: '', attachments: [], state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Reply all' }).click()
  await expect.poll(() => draftRequest).toMatchObject({ messageId: 'newest-message', to: 'newest@example.com' })
  expect(String(draftRequest?.to)).not.toContain('older@example.com')
})

test('opens a Drafts row in the editor and discards it', async ({ page }) => {
  let requestedMailbox = ''
  let openRequest: unknown
  let discarded = false
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const draftSummary = {
    ...conversations[0]!,
    id: 'gmail:draft-thread-9',
    threadId: 'draft-thread-9',
    latestMessageId: 'draft-message-9',
    accountId: 'link-one',
    accountLabel: 'work@example.com',
    subject: 'Saved draft',
  }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?.*/, (route) => {
    requestedMailbox = new URL(route.request().url()).searchParams.get('mailbox') ?? ''
    const draftConversations = requestedMailbox === 'drafts' && !discarded ? [draftSummary] : []
    return route.fulfill({ json: { source: 'gmail', conversations: draftConversations, nextCursor: null, total: draftConversations.length } })
  })
  await page.route('http://127.0.0.1:8411/v1/drafts/open', async (route) => {
    openRequest = await route.request().postDataJSON()
    if (discarded) return route.fulfill({ status: 404, json: { error: 'draft_not_found' } })
    await route.fulfill({ json: { draft: { id: 'draft-9', inReplyToMessageId: 'draft-message-9', to: [messages[0]!.sender], cc: '', bcc: '', subject: 'Saved draft', bodyMarkdown: 'Saved words', bodyHtml: '<p>Saved words</p>', bodyText: 'Saved words', attachments: [], state: 'draft', accountId: 'link-one' } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/drafts\/draft-9\?action=discard&account=link-one/, async (route) => {
    discarded = true
    await route.fulfill({ json: {} })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Drafts', exact: true }).click()
  await expect.poll(() => requestedMailbox).toBe('drafts')
  await page.locator('[data-conversation-id="gmail:draft-thread-9"]').click()
  await expect.poll(() => openRequest).toEqual({ accountId: 'link-one', messageId: 'draft-message-9' })
  await expect(page.getByRole('textbox', { name: 'Draft body' })).toHaveValue('Saved words')
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect.poll(() => discarded).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Draft body' })).toHaveCount(0)
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
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Mark read' }).click()
  await expect.poll(() => command).toEqual({ accountId: 'link-one', messageIds: ['m1'], unread: false })
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark unread' })).toBeVisible()
})

test('marks an unread Gmail conversation read after a 5 second selection dwell', async ({ page }) => {
  let command: unknown
  await page.clock.install()
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const first = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  const second = { ...conversations[1]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  let listed = [first, second]
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: listed, nextCursor: null, total: listed.length } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...first, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t2\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...second, source: 'gmail', messages: [{ ...messages[1]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Other' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/conversations/t1/read-state', async (route) => {
    command = await route.request().postDataJSON()
    listed = [{ ...first, unread: false }, second]
    await route.fulfill({ json: { accepted: true, result: { unread: false } } })
  })
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await page.clock.fastForward(4999)
  expect(command).toBeUndefined()
  await page.clock.fastForward(1)
  await expect.poll(() => command).toEqual({ accountId: 'link-one', messageIds: ['m1'], unread: false })
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark unread' })).toBeVisible()
  await expect(page.locator('[data-conversation-id="demo:t1"]')).not.toHaveClass(/dispatch-message-unread/)
})

test('does not mark read when the user leaves before 5 seconds', async ({ page }) => {
  let command: unknown
  await page.clock.install()
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const first = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  const second = { ...conversations[1]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [first, second], nextCursor: null, total: 2 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...first, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t2\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...second, source: 'gmail', messages: [{ ...messages[1]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Other' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/.+\/read-state/, async (route) => {
    command = await route.request().postDataJSON()
    await route.fulfill({ json: { accepted: true, result: { unread: false } } })
  })
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await page.clock.fastForward(2000)
  await page.locator('[data-conversation-id="demo:t2"]').click()
  await page.clock.fastForward(5000)
  await expect.poll(() => command).toEqual({ accountId: 'link-one', messageIds: ['m2'], unread: false })
})

test('keeps the conversation unread when the dwell mark-read command fails', async ({ page }) => {
  await page.clock.install()
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/conversations/t1/read-state', (route) => route.fulfill({ status: 502, json: { error: 'gmail_read_state_failed' } }))
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await page.clock.fastForward(5000)
  await expect(page.locator('[data-conversation-id="demo:t1"]')).toHaveClass(/dispatch-message-unread/)
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark read' })).toBeVisible()
  await expect(page.locator('[data-mail-error]')).toBeVisible()
})

test('removes a dwell-marked conversation from Unread and keeps the reader open', async ({ page }) => {
  await page.clock.install()
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const first = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  const second = { ...conversations[1]!, accountId: 'link-one', accountLabel: 'work@example.com', unread: true }
  let unreadConversations = [first, second]
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=unread/, (route) => route.fulfill({ json: { source: 'gmail', conversations: unreadConversations, nextCursor: null, total: unreadConversations.length } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...first, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t2\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...second, source: 'gmail', messages: [{ ...messages[1]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Other' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/conversations/t1/read-state', async (route) => {
    unreadConversations = [second]
    await route.fulfill({ json: { accepted: true, result: { unread: false } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Unread', exact: true }).click()
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await page.clock.fastForward(5000)
  await expect(page.locator('[data-conversation-id="demo:t1"]')).toHaveCount(0)
  await expect(page.locator('[data-conversation-id="demo:t2"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark unread' })).toBeVisible()
})

test('makes unread conversation rows bolder and tinted', async ({ page }) => {
  const read = {
    ...conversations[1]!,
    unread: false,
    subject: 'Invoice status update',
    sender: { name: 'OpenInvoice', address: 'notifications@openinvoice.example', initials: 'OP' },
  }
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'demo', conversations: [conversations[0], read], nextCursor: null, total: 2 } }))
  await page.goto('/')
  const unread = page.locator('[data-conversation-id="demo:t1"]')
  const readRow = page.locator('[data-conversation-id="demo:t2"]')
  await expect(unread).toHaveClass(/dispatch-message-unread/)
  await expect(readRow).not.toHaveClass(/dispatch-message-unread/)
  await expect(unread.locator('strong')).toHaveCSS('font-weight', '700')
  await expect(readRow.locator('strong')).toHaveCSS('font-weight', /^(400|500)$/)
  const unreadBg = await unread.evaluate((node) => getComputedStyle(node).backgroundColor)
  const readBg = await readRow.evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(unreadBg).not.toBe(readBg)
})

test('edits, saves, and sends a Gmail draft from the middle panel', async ({ page }) => {
  let sendCount = 0
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', (route) => route.fulfill({ status: 201, json: { draft: { id: 'draft-1', inReplyToMessageId: 'm1', to: [messages[0]!.sender], cc: '', bcc: '', subject: 'Re: Opua berth confirmation', bodyText: '', state: 'draft', accountId: 'link-one' } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts/draft-1', async (route) => route.fulfill({ json: { draft: { id: 'draft-1', inReplyToMessageId: 'm1', to: [messages[0]!.sender], cc: 'manager@example.com', bcc: 'audit@example.com', subject: 'Re: Opua berth confirmation', bodyText: 'Approved reply', state: 'draft', accountId: 'link-one' } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/drafts\/draft-1\?action=send.*/, async (route) => {
    sendCount += 1
    await route.fulfill({ json: { delivery: { id: 'sent-1' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/[^/]+\/turns/, () => {
    throw new Error('Send must not call the agent service')
  })
  await page.getByRole('textbox', { name: 'Draft body' }).fill('**Approved reply**')
  await page.getByRole('textbox', { name: 'Draft Cc' }).fill('manager@example.com')
  await page.getByRole('textbox', { name: 'Draft Bcc' }).fill('audit@example.com')
  await page.getByRole('button', { name: 'Send draft' }).click()
  await expect(page.getByRole('button', { name: 'Send now' })).toBeVisible()
  await expect(page.locator('[data-send-confirm-text]')).toHaveText('To: ana@example.com\nCc: manager@example.com\nBcc: audit@example.com\nSubject: Re: Opua berth confirmation')
  expect(sendCount).toBe(0)
  await page.getByRole('button', { name: 'Send now' }).click()
  await expect.poll(() => sendCount).toBe(1)
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
  await page.getByRole('button', { name: 'Collapse thread list' }).click()
  await expect(messagesPanel).toBeHidden()
  await messagesToggle.click()
  await expect(messagesPanel).toBeVisible()
  await page.locator('[data-divider="agent"]').dblclick()
  await expect(agentPanel).toBeHidden()
  await codexToggle.click()
  await expect(agentPanel).toBeVisible()
  await page.keyboard.press('Control+Backquote')
  await expect(messagesPanel).toBeHidden()
  await page.keyboard.press('Control+Backquote')
  await expect(messagesPanel).toBeVisible()
})

test('waits for the mail service at startup instead of flashing a request failure', async ({ page }) => {
  let attempts = 0
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => {
    attempts += 1
    if (attempts <= 2) return route.abort('connectionrefused')
    return route.fulfill({ json: { accounts: [] } })
  })
  await page.goto('/')
  await expect(page.locator('[data-mail-source]')).toHaveText('Starting mail service…')
  await expect(page.locator('[data-mail-error]')).toBeHidden()
  await expect(page.locator('[data-conversation-id]').first()).toBeVisible()
  await expect(page.locator('[data-mail-error]')).toBeHidden()
  expect(attempts).toBeGreaterThanOrEqual(3)
})

test('toolbar icon buttons are large enough to hit and the bar drags the native window', async ({ page }) => {
  await page.goto('/')
  const buttons = page.locator('.dispatch-toolbar .btn-icon:visible')
  expect(await buttons.count()).toBeGreaterThanOrEqual(6)
  for (const box of await buttons.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()))) {
    expect(box.width).toBeGreaterThanOrEqual(36)
    expect(box.height).toBeGreaterThanOrEqual(36)
  }
  const readerButtons = page.locator('.dispatch-reader-toolbar .btn-icon')
  await page.locator('[data-conversation-id="demo:t1"]').click()
  for (const box of await readerButtons.evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.getBoundingClientRect()))) {
    expect(box.width).toBeGreaterThanOrEqual(36)
    expect(box.height).toBeGreaterThanOrEqual(36)
  }
  const dragRegions = page.locator('.dispatch-toolbar [data-tauri-drag-region]')
  await expect(page.locator('.dispatch-toolbar-cluster:not([data-tauri-drag-region])')).toHaveCount(0)
  await expect(page.locator('.dispatch-toolbar-spacer:not([data-tauri-drag-region])')).toHaveCount(0)
  expect(await dragRegions.count()).toBeGreaterThanOrEqual(5)
  await expect(page.locator('.dispatch-toolbar button[data-tauri-drag-region], .dispatch-toolbar input[data-tauri-drag-region], .dispatch-toolbar select[data-tauri-drag-region]')).toHaveCount(0)
})

test('a long sync label never widens the page past the window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/')
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await expect(page.locator('.dispatch-thread-message').first()).toBeVisible()
  await page.evaluate(() => { document.querySelector('[data-mail-source]')!.textContent = 'Syncing Gmail · account 1/3 · 2449 fetched, still indexing older conversations' })
  const layout = await page.evaluate(() => ({
    inner: window.innerWidth,
    page: document.documentElement.scrollWidth,
    header: document.querySelector('.dispatch-toolbar')!.getBoundingClientRect().right,
    controls: document.querySelector('.dispatch-panel-controls')!.getBoundingClientRect().right,
    agent: document.querySelector('.dispatch-agent')!.getBoundingClientRect().right,
  }))
  expect(layout.page).toBeLessThanOrEqual(layout.inner)
  expect(layout.header).toBeLessThanOrEqual(layout.inner)
  expect(layout.controls).toBeLessThanOrEqual(layout.inner - 4)
  expect(layout.agent).toBeLessThanOrEqual(layout.inner)
  for (const name of ['Messages', 'Email', 'Codex']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport()
  const compose = await page.getByRole('button', { name: 'Compose' }).boundingBox()
  const folder = await page.locator('[data-folder-toggle]').boundingBox()
  expect(compose!.x + compose!.width).toBeLessThanOrEqual(folder!.x)
})

test('dragging a divider past its minimum closes that panel', async ({ page }) => {
  await page.goto('/')
  const messagesPanel = page.getByRole('complementary', { name: 'Messages' })
  const agentPanel = page.getByRole('complementary', { name: 'Codex' })
  const divider = await page.locator('[data-divider="messages"]').boundingBox()
  expect(divider).not.toBeNull()
  await page.mouse.move(divider!.x + 4, divider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(divider!.x - 320, divider!.y + 100, { steps: 12 })
  await page.mouse.up()
  await expect(messagesPanel).toBeHidden()
  await page.getByRole('button', { name: 'Messages', exact: true }).click()
  await expect(messagesPanel).toBeVisible()
  expect((await messagesPanel.boundingBox())!.width).toBeGreaterThanOrEqual(220)
  const agentDivider = await page.locator('[data-divider="agent"]').boundingBox()
  expect(agentDivider).not.toBeNull()
  await page.mouse.move(agentDivider!.x + 4, agentDivider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(agentDivider!.x + 420, agentDivider!.y + 100, { steps: 12 })
  await page.mouse.up()
  await expect(agentPanel).toBeHidden()
  await page.getByRole('button', { name: 'Codex', exact: true }).click()
  await expect(agentPanel).toBeVisible()
  expect((await agentPanel.boundingBox())!.width).toBeGreaterThanOrEqual(280)
})

test('reflows pane content instead of overflowing when a divider narrows it', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-conversation-id]').first()).toBeVisible()
  const divider = await page.locator('[data-divider="messages"]').boundingBox()
  expect(divider).not.toBeNull()
  await page.mouse.move(divider!.x + 4, divider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(divider!.x - 400, divider!.y + 100, { steps: 10 })
  await page.mouse.up()
  const messages = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.dispatch-messages')!
    const widths = [...panel.children, ...panel.querySelectorAll('.dispatch-message')].map((child) => child.getBoundingClientRect().width)
    return { panel: panel.getBoundingClientRect().width, scrollWidth: panel.scrollWidth, maxChild: Math.max(...widths) }
  })
  expect(messages.panel).toBeLessThanOrEqual(221)
  expect(messages.scrollWidth).toBeLessThanOrEqual(Math.ceil(messages.panel))
  expect(messages.maxChild).toBeLessThanOrEqual(Math.ceil(messages.panel))
  const agentDivider = await page.locator('[data-divider="agent"]').boundingBox()
  expect(agentDivider).not.toBeNull()
  await page.mouse.move(agentDivider!.x + 4, agentDivider!.y + 100)
  await page.mouse.down()
  await page.mouse.move(agentDivider!.x + 400, agentDivider!.y + 100, { steps: 10 })
  await page.mouse.up()
  const agent = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.dispatch-agent')!
    return { panel: panel.getBoundingClientRect().width, scrollWidth: panel.scrollWidth, maxChild: Math.max(...[...panel.children].map((child) => child.getBoundingClientRect().width)) }
  })
  expect(agent.panel).toBeLessThanOrEqual(281)
  expect(agent.scrollWidth).toBeLessThanOrEqual(Math.ceil(agent.panel))
  expect(agent.maxChild).toBeLessThanOrEqual(Math.ceil(agent.panel))
})

test('uses one native Tabler pane at a time on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const messagesPanel = page.getByRole('complementary', { name: 'Messages' })
  const readerPanel = page.getByRole('main', { name: 'Selected email' })
  const agentPanel = page.getByRole('complementary', { name: 'Codex' })
  await expect(messagesPanel).toBeVisible()
  await expect(readerPanel).toBeHidden()
  await expect(agentPanel).toBeHidden()
  await expect(page.locator('[data-folder-toggle]')).toBeVisible()
  await page.locator('[data-conversation-id="demo:t1"]').click()
  await expect(messagesPanel).toBeHidden()
  await expect(readerPanel).toBeVisible()
  await page.getByRole('button', { name: 'Back to Inbox' }).click()
  await expect(messagesPanel).toBeVisible()
  await page.getByRole('button', { name: 'Codex', exact: true }).click()
  await expect(agentPanel).toBeVisible()
  await expect(messagesPanel).toBeHidden()
  await page.keyboard.press('Control+Backquote')
  await expect(messagesPanel).toBeVisible()
  await page.keyboard.press('Control+Backquote')
  await expect(agentPanel).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('restores structured Codex history as readable text', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-history', created: false, replaced: false } } }))
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

test('does not read history for a brand-new Codex task', async ({ page }) => {
  let historyReads = 0
  await page.unroute('http://127.0.0.1:8412/ready')
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ json: { status: 'ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-new', created: true, replaced: false } } }))
  await page.route('http://127.0.0.1:8412/v1/threads/thread-new', (route) => { historyReads += 1; return route.fulfill({ status: 502, json: { error: 'thread_unavailable' } }) })
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/events\?threadId=.*/, (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }))
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dispatch.codex.threadId'))).toBe('thread-new')
  expect(historyReads).toBe(0)
  await expect(page.getByText(/Could not restore Codex history/)).toHaveCount(0)
})

test('switches the Codex pane when the selected conversation changes', async ({ page }) => {
  const turns: string[] = []
  await stubAgent(page, {
    unbound: { threadId: 'thread-unbound' },
    'conversation:link-one:t1': { threadId: 'thread-t1' },
    'conversation:link-one:t2': { threadId: 'thread-t2' },
  })
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/(.+)/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const one = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  const two = { ...conversations[1]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [one, two], nextCursor: null, total: 2 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1/, (route) => route.fulfill({ json: { conversation: { ...one, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'A' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t2/, (route) => route.fulfill({ json: { conversation: { ...two, source: 'gmail', messages: [{ ...messages[1]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'B' }, attachments: [] }] } } }))
  await page.route(/http:\/\/127\.0\.0\.1:8412\/v1\/threads\/.*\/turns/, async (route) => {
    turns.push(route.request().url())
    await route.fulfill({ status: 202, json: { accepted: true } })
  })
  await page.goto('/')
  await expect(page.getByText('History for thread-t1')).toBeVisible()
  await page.locator('[data-conversation-id="demo:t2"]').click()
  await expect(page.getByText('History for thread-t2')).toBeVisible()
  await expect(page.getByText('History for thread-t1')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Ask Codex' }).fill('Work on B')
  await page.getByRole('textbox', { name: 'Ask Codex' }).press('Enter')
  await expect.poll(() => turns.some((url) => url.includes('thread-t2'))).toBe(true)
  expect(turns.some((url) => url.includes('thread-t1'))).toBe(false)
})

test('uses the unbound Codex thread for a new compose', async ({ page }) => {
  await stubAgent(page, { unbound: { threadId: 'thread-unbound' } })
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByText('History for thread-unbound')).toBeVisible()
})

test('replaces a stale Codex binding cache from agent', async ({ page }) => {
  await stubAgent(page, { unbound: { threadId: 'thread-agent' } })
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=(all|read|unread)/)
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'demo', conversations: [], nextCursor: null, total: 0 } }))
  await page.addInitScript(() => {
    localStorage.setItem('dispatch.codex.threadId', 'thread-stale')
    localStorage.setItem('dispatch.codex.bindings.v1', JSON.stringify({ unbound: 'thread-stale' }))
  })
  await page.goto('/')
  await expect(page.getByText('History for thread-agent')).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dispatch.codex.threadId'))).toBe('thread-agent')
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

test('Refresh fetches Gmail heads and preserves the selected thread', async ({ page }) => {
  let refreshed = false
  await page.route('http://127.0.0.1:8411/v1/sync', async (route) => {
    refreshed = true
    await route.fulfill({ json: { sync: { state: 'ready', startedAt: '2026-09-05T09:10:00Z', completedAt: '2026-09-05T09:10:02Z', error: null, messageCount: 3 } } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => refreshed).toBe(true)
  await expect(page.getByRole('heading', { name: 'Opua berth confirmation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
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
  await page.route('http://127.0.0.1:8412/v1/threads/bindings', (route) => route.fulfill({ json: { binding: { key: { kind: 'unbound' }, threadId: 'thread-test', created: true, replaced: false } } }))
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

test('forwards source message attachments and lists them on the draft', async ({ page }) => {
  let draftRequest: Record<string, unknown> | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  const attachment = { id: 'a1', name: 'arrival.pdf', mediaType: 'application/pdf', sizeLabel: '824 KB' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'plain-text', content: 'Body' }, attachments: [attachment] }] } } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    draftRequest = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: { draft: { id: 'fwd-1', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: 'Fwd: Opua berth confirmation', bodyMarkdown: '', bodyHtml: '<p></p>', bodyText: '', attachments: draftRequest.attachments, state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Forward' }).click()
  await expect.poll(() => draftRequest?.attachments).toEqual([{ ...attachment, sourceMessageId: 'm1' }])
  await expect(page.getByLabel('Draft attachments')).toContainText('arrival.pdf')
})

test('attaches a local file to the open draft', async ({ page }) => {
  let saved: Record<string, unknown> | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    saved = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: { draft: { id: 'attach-1', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: '', bodyMarkdown: '', bodyHtml: '<p></p>', bodyText: '', attachments: saved.attachments, state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Compose' }).click()
  await page.locator('[data-draft-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect.poll(() => saved?.attachments).toEqual([expect.objectContaining({ name: 'notes.txt', mediaType: 'text/plain', contentBase64: 'aGVsbG8=' })])
  await expect(page.getByLabel('Draft attachments')).toContainText('notes.txt')
})

test('adds a recipient chip from mail autocomplete', async ({ page }) => {
  let draftRequest: Record<string, unknown> | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.unroute('http://127.0.0.1:8411/v1/drafts')
  await page.unroute(/http:\/\/127\.0\.0\.1:8411\/v1\/recipients/)
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/recipients/, (route) => route.fulfill({ json: { recipients: [{ name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' }] } }))
  await page.route('http://127.0.0.1:8411/v1/drafts', async (route) => {
    draftRequest = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: { draft: { id: 'chip-1', inReplyToMessageId: '', to: [{ name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' }], cc: '', bcc: '', subject: '', bodyMarkdown: '', bodyHtml: '<p></p>', bodyText: '', attachments: [], state: 'draft', accountId: 'link-one' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Compose' }).click()
  await page.getByRole('textbox', { name: 'Draft recipient' }).fill('ana')
  await page.getByRole('option', { name: 'Ana Morales <ana@example.com>' }).click()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect.poll(() => draftRequest?.to).toBe('ana@example.com')
  await expect(page.getByRole('button', { name: 'Remove ana@example.com' })).toBeVisible()
})

test('opens a desktop attachment through mail instead of downloading it', async ({ page }) => {
  let opened: { method: string; url: string } | undefined
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1/, (route) => {
    if (route.request().url().includes('/actions') || route.request().url().includes('/read-state')) return route.fallback()
    return route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{
      ...messages[0]!,
      accountId: 'link-one',
      source: 'gmail',
      body: { kind: 'plain-text', content: 'Body' },
      attachments: [{ id: 'att-9', name: 'arrival.pdf', mediaType: 'application/pdf', sizeLabel: '12 KB' }],
    }] } } })
  })
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\/m1\/attachments\/att-9\/open/, async (route) => {
    opened = { method: route.request().method(), url: route.request().url() }
    await route.fulfill({ json: { opened: true, filename: 'arrival.pdf', path: '/tmp/arrival.pdf' } })
  })
  const warmed: string[] = []
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/messages\/m1\/attachments\/att-9\/cache/, async (route) => {
    warmed.push(route.request().url())
    await route.fulfill({ json: { cached: true, reused: false, filename: 'arrival.pdf', mediaType: 'application/pdf' } })
  })
  await page.goto('/')
  await expect.poll(() => warmed).toEqual(['http://127.0.0.1:8411/v1/messages/m1/attachments/att-9/cache?filename=arrival.pdf&account=link-one'])
  await page.getByRole('button', { name: 'arrival.pdf 12 KB' }).click()
  await expect.poll(() => opened).toEqual({
    method: 'POST',
    url: 'http://127.0.0.1:8411/v1/messages/m1/attachments/att-9/open?filename=arrival.pdf&account=link-one',
  })
  await expect(page.getByText('Opened arrival.pdf')).toBeVisible()
  const preview = page.getByRole('button', { name: 'Preview arrival.pdf' })
  await preview.click()
  await expect(page.locator('iframe.dispatch-attachment-frame')).toHaveAttribute('src', 'http://127.0.0.1:8411/v1/messages/m1/attachments/att-9?filename=arrival.pdf&account=link-one')
  await preview.click()
  await expect(page.locator('iframe.dispatch-attachment-frame')).toHaveCount(0)
})

test('shows image attachments inline from the mail cache', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1/, (route) => {
    if (route.request().url().includes('/actions') || route.request().url().includes('/read-state')) return route.fallback()
    return route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{
      ...messages[0]!,
      accountId: 'link-one',
      source: 'gmail',
      body: { kind: 'plain-text', content: 'Photos attached' },
      attachments: [
        { id: 'img-a', name: 'image.png', mediaType: 'image/png', sizeLabel: '3 KB' },
        { id: 'img-b', name: 'image.png', mediaType: 'image/png', sizeLabel: '97 KB' },
      ],
    }] } } })
  })
  await page.route(/8411\/v1\/messages\/m1\/attachments\/img-[ab]\/cache/, (route) => route.fulfill({ json: { cached: true } }))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await page.route(/8411\/v1\/messages\/m1\/attachments\/img-[ab]\?/, (route) => route.fulfill({ body: png, contentType: 'image/png' }))
  await page.goto('/')
  const images = page.locator('.dispatch-attachment-preview img')
  await expect(images).toHaveCount(2)
  await expect(images.nth(1)).toHaveAttribute('src', 'http://127.0.0.1:8411/v1/messages/m1/attachments/img-b?filename=image.png&account=link-one')
  await expect.poll(() => images.nth(0).evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1)
})

test('renders rewritten CID images in the thread reader', async ({ page }) => {
  await page.unroute('http://127.0.0.1:8411/v1/accounts')
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [{ id: 'link-one', connectorId: 'gmail-app', name: 'Work', email: 'work@example.com' }] } }))
  const summary = { ...conversations[0]!, accountId: 'link-one', accountLabel: 'work@example.com' }
  const src = 'http://127.0.0.1:8411/v1/messages/m1/attachments/img-1?account=link-one&filename=logo.png'
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=all/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [summary], nextCursor: null, total: 1 } }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\/t1\?account=link-one/, (route) => route.fulfill({ json: { conversation: { ...summary, source: 'gmail', messages: [{ ...messages[0]!, accountId: 'link-one', source: 'gmail', body: { kind: 'sanitized-html', content: `<p><img src="${src}" alt="logo"></p>` }, attachments: [{ id: 'img-1', name: 'logo.png', mediaType: 'image/png', sizeLabel: '1 KB', contentId: 'logo@mail' }] }] } } }))
  await page.goto('/')
  await expect(page.locator('.dispatch-thread-body img')).toHaveAttribute('src', src)
})
