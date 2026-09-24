import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { GmailConnectorProvider } from '../src/gmail-provider.js'
import { ResumeClock } from '../src/resume-clock.js'
import { createMailServer } from '../src/server.js'

const message = (id: string) => ({ id, thread_id: id, from_: 'test@example.com', subject: id, labels: ['INBOX'], email_ts: '2026-09-12T00:00:00Z' })

it('detects a sleep gap and the background service requests wake refresh without a window', async () => {
  vi.useFakeTimers()
  const clock = new ResumeClock(1000)
  expect(clock.observe(6000)).toBe(false)
  expect(clock.observe(8 * 3600_000)).toBe(true)
  const p = new GmailConnectorProvider('http://127.0.0.1:1', { indexPath: ':memory:' })
  vi.spyOn(p, 'syncNow').mockResolvedValue()
  const refresh = vi.spyOn(p, 'requestRefresh').mockImplementation(() => {})
  try {
    p.startBackgroundSync()
    await vi.advanceTimersByTimeAsync(5000)
    vi.setSystemTime(Date.now() + 8 * 3600_000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledWith('wake')
  } finally { p.stopBackgroundSync(); vi.restoreAllMocks(); vi.useRealTimers() }
})

it('publishes healthy Inbox results before another account or folder finishes', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let releaseTail!: () => void
  const tail = new Promise<void>(resolve => { releaseTail = resolve })
  const agent = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') { res.end(JSON.stringify({ accounts: [{ linkId: 'slow', email: 'slow@example.com' }, { linkId: 'fast', email: 'fast@example.com' }] })); return }
    if (input.linkId === 'slow') { res.end(JSON.stringify({ isError: true, structuredContent: { error: 'RATE_LIMITED' } })); return }
    if (!input.labelIds.includes('INBOX')) await gate
    if (input.labelIds.includes('SPAM')) await tail
    res.end(JSON.stringify({ structuredContent: { emails: input.labelIds.includes('INBOX') ? [message('fresh')] : input.labelIds.includes('SENT') ? [{ ...message('fresh'), labels: ['SENT'] }] : [] } }))
  })
  await new Promise<void>(resolve => agent.listen(0, '127.0.0.1', resolve))
  const p = new GmailConnectorProvider(`http://127.0.0.1:${(agent.address() as AddressInfo).port}`, { indexPath: ':memory:' })
  const running = p.refreshNow().catch(error => error)
  try {
    await expect.poll(async () => (await p.listMailboxConversations('inbox', 'all', 'fast')).map(row => row.subject)).toEqual(['fresh'])
    expect(p.syncStatus()?.state).toBe('syncing')
    release()
    await expect.poll(() => p.syncStatus()?.pagesFetched).toBe(4)
    expect((await p.listMailboxConversations('inbox', 'all', 'fast'))[0]?.subject).toBe('fresh')
    releaseTail(); expect(String(await running)).toMatch(/^Error: slow@example\.com: .*RATE_LIMITED/)
    expect((await p.listMailboxConversations('inbox', 'all', 'fast'))[0]?.subject).toBe('fresh')
  } finally { release(); releaseTail(); await running; p.stopBackgroundSync(); await new Promise<void>(resolve => agent.close(() => resolve())) }
})

const FOLDERS = ['INBOX', 'UNREAD', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'ARCHIVE']
type FakeMail = { id: string; labels: string[]; email_ts: string }
const mail = (id: string, labels: string[], hour = 0): FakeMail => ({ id, labels, email_ts: `2026-09-12T0${hour}:00:00Z` })

/** A fake agent over labelled mail: folders follow INDEX_STREAMS, and modify changes labels. */
async function gmailAgent() {
  const state = {
    mail: [] as FakeMail[], accounts: ['one'], more: new Set<string>(),
    calls: { ids: [] as string[], details: [] as string[] },
    idsGate: undefined as Promise<void> | undefined,
    inboxGate: undefined as Promise<void> | undefined,
  }
  const has = (item: FakeMail, label: string) => item.labels.includes(label)
  const inFolder = (item: FakeMail, folder: string) => folder === 'SPAM' ? has(item, 'SPAM')
    : folder === 'TRASH' ? has(item, 'TRASH')
      : folder === 'ARCHIVE' ? !['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].some(label => has(item, label))
        : has(item, folder) && !has(item, 'TRASH') && (folder === 'SENT' || folder === 'DRAFT' || !has(item, 'SPAM'))
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') { res.end(JSON.stringify({ accounts: state.accounts.map(linkId => ({ linkId, email: `${linkId}@example.com` })) })); return }
    const folder = (input.labelIds as string[] | undefined)?.[0] ?? 'ARCHIVE'
    const page = state.mail.filter(item => inFolder(item, folder))
    const next_page_token = state.more.has(folder) ? 'more' : ''
    if (req.url === '/v1/connectors/gmail/search') {
      state.calls.ids.push(folder); if (state.idsGate) await state.idsGate
      res.end(JSON.stringify({ structuredContent: { message_ids: page.map(item => item.id), next_page_token } })); return
    }
    if (req.url === '/v1/connectors/gmail/search-messages') {
      state.calls.details.push(folder); if (folder === 'INBOX' && state.inboxGate) await state.inboxGate
      res.end(JSON.stringify({ structuredContent: { emails: page.map(item => ({ id: item.id, thread_id: item.id, from_: 'test@example.com', subject: item.id, labels: item.labels, email_ts: item.email_ts })), next_page_token } })); return
    }
    if (req.url === '/v1/connectors/gmail/modify') {
      for (const item of state.mail.filter(candidate => input.messageIds.includes(candidate.id))) item.labels = [...item.labels.filter(label => !input.removeLabels.includes(label)), ...input.addLabels.filter((label: string) => !item.labels.includes(label))]
      res.end(JSON.stringify({ structuredContent: { responses: input.messageIds.map((id: string) => ({ message_id: id, success: true })) } })); return
    }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    state, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    reset: () => { state.calls.ids.length = 0; state.calls.details.length = 0 },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

it('re-reads a folder only when its message IDs or next-page flag changed, or on Refresh', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX', 'UNREAD'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    expect(g.state.calls).toEqual({ ids: [], details: FOLDERS })

    g.reset(); await p.refreshNow()
    expect(g.state.calls).toEqual({ ids: FOLDERS, details: [] })

    // New mail changes Inbox and Unread; reading the first message elsewhere drops it from Unread.
    g.state.mail = [mail('second', ['INBOX', 'UNREAD'], 1), mail('first', ['INBOX'])]
    g.reset(); await p.refreshNow()
    expect(g.state.calls.details).toEqual(['INBOX', 'UNREAD'])
    expect((await p.listMailboxConversations('inbox', 'all')).map(row => [row.subject, row.unread])).toEqual([['second', true], ['first', false]])
    expect(p.syncStatus()?.state).toBe('ready')

    // A folder whose first page is unchanged but now has another page.
    g.state.more.add('SENT')
    g.reset(); await p.refreshNow()
    expect(g.state.calls.details).toEqual(['SENT'])

    g.reset(); await p.refreshNow({ details: true })
    expect(g.state.calls).toEqual({ ids: [], details: FOLDERS })
  } finally { p.stopBackgroundSync(); await g.close() }
})

it('re-reads Inbox and Unread after ten minutes and the other folders after an hour', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX', 'UNREAD'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    vi.setSystemTime(Date.now() + 11 * 60_000); g.reset(); await p.refreshNow()
    expect(g.state.calls).toEqual({ ids: ['SENT', 'DRAFT', 'SPAM', 'TRASH', 'ARCHIVE'], details: ['INBOX', 'UNREAD'] })
    vi.setSystemTime(Date.now() + 50 * 60_000); g.reset(); await p.refreshNow()
    expect(g.state.calls).toEqual({ ids: [], details: FOLDERS })
  } finally { vi.useRealTimers(); p.stopBackgroundSync(); await g.close() }
})

it('a manual Refresh replaces a quick check that is already running', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  let release!: () => void
  try {
    await p.refreshNow()
    g.state.idsGate = new Promise<void>(resolve => { release = resolve })
    g.reset()
    const quick = p.refreshNow().catch(error => error)
    await expect.poll(() => g.state.calls.ids.length).toBe(1)
    g.state.idsGate = undefined
    p.requestRefresh('manual')
    await expect.poll(() => g.state.calls.details).toEqual(FOLDERS)
    release()
    expect((await quick).name).toBe('AbortError')
    await expect.poll(() => p.syncStatus()?.state).toBe('ready')
  } finally { release?.(); p.stopBackgroundSync(); await g.close() }
})

it('re-reads an account that left the Gmail inventory and came back', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX'])]; g.state.accounts = ['one', 'two']
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    g.state.accounts = ['one']; await p.refreshNow()
    expect(await p.listMailboxConversations('inbox', 'all', 'two')).toEqual([])
    g.state.accounts = ['one', 'two']; g.reset(); await p.refreshNow()
    expect(g.state.calls.details).toEqual(FOLDERS)
    expect((await p.listMailboxConversations('inbox', 'all', 'two')).map(row => row.subject)).toEqual(['first'])
  } finally { p.stopBackgroundSync(); await g.close() }
})

it('re-reads Inbox once a read-state change lands, and nothing extra after a move', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX', 'UNREAD'], 1), mail('old', ['INBOX'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    g.reset(); await p.setConversationUnread('one', 'first', false, ['first'])
    // Unread's IDs change by themselves; Inbox's do not, so Inbox is read again to confirm.
    // The follow-up refresh runs a second after the change lands.
    await expect.poll(() => g.state.calls.details, { timeout: 5_000 }).toEqual(['INBOX', 'UNREAD'])
    // Every folder but Inbox is checked by ID; only Unread's IDs changed.
    await expect.poll(() => g.state.calls.ids).toEqual(['UNREAD', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'ARCHIVE'])
    g.reset(); await p.mutateConversation('one', 'old', ['old'], 'archive')
    await expect.poll(() => g.state.calls.details, { timeout: 5_000 }).toEqual(['INBOX', 'ARCHIVE'])
    await expect.poll(() => g.state.calls.ids.length).toBe(7)
    expect(g.state.calls.details).toEqual(['INBOX', 'ARCHIVE'])
  } finally { p.stopBackgroundSync(); await g.close() }
})

it('confirms a read-state change outside Inbox, so a later change on another device shows', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('kept', ['UNREAD'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    g.reset(); await p.setConversationUnread('one', 'kept', false, ['kept'])
    await expect.poll(() => g.state.calls.details, { timeout: 5_000 }).toEqual(['UNREAD', 'ARCHIVE'])
    g.state.mail[0]!.labels = ['UNREAD']
    await p.refreshNow()
    expect((await p.listMailboxConversations('archive', 'all')).map(row => [row.subject, row.unread])).toEqual([['kept', true]])
  } finally { p.stopBackgroundSync(); await g.close() }
}, 10_000)

it('does not keep an Inbox copy read while a read-state change was landing', async () => {
  const g = await gmailAgent(); g.state.mail = [mail('first', ['INBOX', 'UNREAD'])]
  const p = new GmailConnectorProvider(g.base, { indexPath: ':memory:' })
  let release!: () => void
  try {
    await p.refreshNow()
    // New mail sends the next check into a detailed Inbox read; hold it while the change lands.
    g.state.mail = [mail('second', ['INBOX'], 1), ...g.state.mail]
    g.state.inboxGate = new Promise<void>(resolve => { release = resolve })
    g.reset()
    const running = p.refreshNow()
    await expect.poll(() => g.state.calls.details).toEqual(['INBOX'])
    await p.setConversationUnread('one', 'first', false, ['first'])
    await p.flushActions()
    g.state.inboxGate = undefined; release(); await running
    g.reset()
    await expect.poll(() => g.state.calls.details, { timeout: 5_000 }).toContain('INBOX')
    await expect.poll(async () => (await p.listMailboxConversations('inbox', 'all')).find(row => row.subject === 'first')?.unread).toBe(false)
  } finally { release?.(); p.stopBackgroundSync(); await g.close() }
})

it('rejects a Gmail ID search without message IDs instead of treating the folder as unchanged', async () => {
  let idsReply: unknown = { structuredContent: { next_page_token: '' } }
  const agent = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') { res.end(JSON.stringify({ accounts: [{ linkId: 'one', email: 'test@example.com' }] })); return }
    if (req.url === '/v1/connectors/gmail/search') { res.end(JSON.stringify(idsReply)); return }
    res.end(JSON.stringify({ structuredContent: { emails: [message('only')], next_page_token: '' } }))
  })
  await new Promise<void>(resolve => agent.listen(0, '127.0.0.1', resolve))
  const p = new GmailConnectorProvider(`http://127.0.0.1:${(agent.address() as AddressInfo).port}`, { indexPath: ':memory:' })
  try {
    await p.refreshNow()
    await expect(p.refreshNow()).rejects.toThrow('Gmail ID search for test@example.com returned no message_ids')
    expect(p.syncStatus()?.state).toBe('failed')
    idsReply = { structuredContent: { message_ids: ['only'], next_page_token: '' } }
    await p.refreshNow()
    expect(p.syncStatus()?.state).toBe('ready')
  } finally { p.stopBackgroundSync(); agent.closeAllConnections(); await new Promise<void>(resolve => agent.close(() => resolve())) }
})

it('wake replaces a pre-sleep read without cancelling draft writes, and refresh returns 202', async () => {
  let entered!: () => void; let release!: () => void
  const firstRead = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  let releaseWrite!: () => void; let writing!: () => void
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
  const writeStarted = new Promise<void>(resolve => { writing = resolve })
  let calls = 0
  const agent = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') { res.end(JSON.stringify({ accounts: [{ linkId: 'one', email: 'test@example.com' }] })); return }
    if (req.url?.endsWith('/drafts/update')) { writing(); await writeGate; res.end(JSON.stringify({ structuredContent: { id: 'd' } })); return }
    if (req.url?.endsWith('/drafts/list')) { res.end(JSON.stringify({ structuredContent: { drafts: [] } })); return }
    if (++calls === 1) { entered(); await gate; res.end(JSON.stringify({ structuredContent: { emails: [message('obsolete')] } })); return }
    res.end(JSON.stringify({ structuredContent: { emails: input.labelIds.includes('INBOX') ? [message('after-wake')] : [] } }))
  })
  await new Promise<void>(resolve => agent.listen(0, '127.0.0.1', resolve))
  const p = new GmailConnectorProvider(`http://127.0.0.1:${(agent.address() as AddressInfo).port}`, { indexPath: ':memory:' })
  const old = p.refreshNow().catch(error => error)
  await firstRead
  let writeSettled = false
  const updating = p.updateGmailDraft({ id: 'd', accountId: 'one', inReplyToMessageId: '', to: [], subject: 'Kept', bodyMarkdown: 'Keep my edits', bodyHtml: '<p>Keep my edits</p>', bodyText: 'Keep my edits', attachments: [], state: 'draft' }).then(result => { writeSettled = true; return result }, error => { writeSettled = true; return error })
  await writeStarted
  p.startBackgroundSync = () => {}
  const mail = createMailServer(p)
  await new Promise<void>(resolve => mail.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(mail.address() as AddressInfo).port}/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'wake' }), signal: AbortSignal.timeout(1000) })
    expect(response.status).toBe(202)
    // A second detector joins the replacement even when the old scan was young.
    p.requestRefresh('wake')
    await p.refreshNow()
    expect(calls).toBe(8)
    expect((await old).name).toBe('AbortError')
    release()
    expect((await p.listMailboxConversations('inbox', 'all')).map(row => row.subject)).toEqual(['after-wake'])
    expect(p.syncStatus()?.state).toBe('ready')
    expect(writeSettled).toBe(false)
    releaseWrite(); expect((await updating).bodyMarkdown).toBe('Keep my edits')
  } finally { release(); releaseWrite(); await updating; await old; p.stopBackgroundSync(); mail.closeAllConnections(); await new Promise<void>(resolve => mail.close(() => resolve())); agent.closeAllConnections(); await new Promise<void>(resolve => agent.close(() => resolve())) }
})
