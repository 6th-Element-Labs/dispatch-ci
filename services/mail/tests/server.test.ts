import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createMailServer } from '../src/server.js'

const servers: ReturnType<typeof createMailServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function start() {
  const server = createMailServer({
    accounts: async () => [],
    listMessages: async () => [],
    listUnifiedMessages: async () => [],
    readMessage: async () => { throw new Error('not configured') },
    listConversations: async () => [],
    listUnifiedConversations: async () => [],
    readConversation: async () => { throw new Error('not configured') },
  }, { demoEnabled: true })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${port}`
}

describe('dispatch-mail', () => {
  it('exposes health, readiness, and explicit demo projections', async () => {
    const base = await start()
    expect((await fetch(`${base}/health`)).status).toBe(200)
    const ready = await (await fetch(`${base}/ready`)).json()
    expect(ready).toMatchObject({ status: 'ready', provider: 'demo' })
    const list = await (await fetch(`${base}/v1/messages`)).json()
    expect(list.source).toBe('demo')
    expect(list.messages).toHaveLength(3)
  })

  it('creates a draft owned by the mail service', async () => {
    const base = await start()
    const response = await fetch(`${base}/v1/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 'demo-message-opua' }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.draft).toMatchObject({ state: 'draft', inReplyToMessageId: 'demo-message-opua' })
  })

  it('exposes threaded conversations with read-state filters', async () => {
    const base = await start()
    const unread = await (await fetch(`${base}/v1/conversations?state=unread`)).json()
    expect(unread.conversations).toHaveLength(2)
    const read = await (await fetch(`${base}/v1/conversations?state=read`)).json()
    expect(read.conversations).toHaveLength(1)
    const thread = await (await fetch(`${base}/v1/conversations/demo-thread-opua`)).json()
    expect(thread.conversation).toMatchObject({ threadId: 'demo-thread-opua', messageCount: 1 })
  })

  it('paginates indexed conversation responses with an explicit total', async () => {
    const base = await start()
    const first = await (await fetch(`${base}/v1/conversations?state=all&limit=1`)).json()
    expect(first).toMatchObject({ total: 3, nextCursor: '1' })
    expect(first.conversations).toHaveLength(1)
    const second = await (await fetch(`${base}/v1/conversations?state=all&limit=1&cursor=1`)).json()
    expect(second).toMatchObject({ total: 3, nextCursor: '2' })
    expect(second.conversations).toHaveLength(1)
  })

  it('uses the Gmail provider as one unified inbox when accounts are available', async () => {
    const listUnifiedMessages = async () => [{
      id: 'm1', threadId: 't1', sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' },
      subject: 'Hello', receivedAt: '2026-09-04T09:42:00Z', receivedLabel: 'Sep 4, 9:42 AM',
      receivedFullLabel: 'September 4, 2026 at 9:42 AM', preview: 'Hello', unread: true,
      accountId: 'one', accountLabel: 'one@example.com',
    }]
    const server = createMailServer({
      accounts: async () => [{ id: 'one', connectorId: 'gmail', name: 'One', email: 'one@example.com' }],
      listMessages: async () => [],
      listUnifiedMessages,
      readMessage: async () => { throw new Error('not configured') },
      listConversations: async () => [],
      listUnifiedConversations: async () => [],
      readConversation: async () => { throw new Error('not configured') },
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const value = await (await fetch(`${base}/v1/messages`)).json()
    expect(value).toMatchObject({ source: 'gmail', scope: 'unified', messages: [{ accountId: 'one' }] })
  })

  it('routes mailbox reads and accepted Gmail actions through the mail owner', async () => {
    const calls: unknown[] = []
    const server = createMailServer({
      accounts: async () => [{ id: 'one', connectorId: 'gmail', name: 'One', email: 'one@example.com' }],
      listMessages: async () => [], listUnifiedMessages: async () => [],
      readMessage: async () => { throw new Error('not configured') },
      listConversations: async () => [], listUnifiedConversations: async () => [],
      listMailboxConversations: async (mailbox, state, accountId, query) => { calls.push({ mailbox, state, accountId, query }); return [] },
      mutateConversation: async (accountId, threadId, messageIds, action) => { calls.push({ accountId, threadId, messageIds, action }) },
      readConversation: async () => { throw new Error('not configured') },
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    expect((await fetch(`${base}/v1/conversations?state=all&mailbox=sent&account=one&q=invoice`)).status).toBe(200)
    expect((await fetch(`${base}/v1/conversations/t1/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 'one', messageIds: ['m1'], action: 'archive' }) })).status).toBe(202)
    expect(calls).toEqual([
      { mailbox: 'sent', state: 'all', accountId: 'one', query: 'invoice' },
      { accountId: 'one', threadId: 't1', messageIds: ['m1'], action: 'archive' },
    ])
  })

  it('fails visibly instead of substituting demo mail when Gmail is disconnected', async () => {
    const server = createMailServer({
      accounts: async () => [],
      listMessages: async () => [], listUnifiedMessages: async () => [],
      readMessage: async () => { throw new Error('not configured') },
      listConversations: async () => [], listUnifiedConversations: async () => [],
      readConversation: async () => { throw new Error('not configured') },
    }, { demoEnabled: false })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    expect((await fetch(`${base}/ready`)).status).toBe(503)
    const response = await fetch(`${base}/v1/conversations?state=all`)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'gmail_not_connected' })
  })

  it('fails readiness on its deadline when the Gmail dependency stalls', async () => {
    const server = createMailServer({
      accounts: async () => new Promise(() => undefined),
      listMessages: async () => [], listUnifiedMessages: async () => [],
      readMessage: async () => { throw new Error('not configured') },
      listConversations: async () => [], listUnifiedConversations: async () => [],
      readConversation: async () => { throw new Error('not configured') },
    }, { demoEnabled: false, readinessTimeoutMs: 5 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ready`)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'gmail_connection_failed', detail: expect.stringContaining('timed out after 5 ms') })
  })

  it('fails readiness when the durable Gmail synchronization failed', async () => {
    const server = createMailServer({
      accounts: async () => [{ id: 'one', connectorId: 'gmail', name: 'One', email: 'one@example.com' }],
      listMessages: async () => [], listUnifiedMessages: async () => [],
      readMessage: async () => { throw new Error('not configured') },
      listConversations: async () => [], listUnifiedConversations: async () => [],
      readConversation: async () => { throw new Error('not configured') },
      syncStatus: () => ({ state: 'failed', startedAt: '2026-09-04T09:00:00Z', completedAt: null, error: 'page token repeated', messageCount: 100 }),
    }, { demoEnabled: false })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ready`)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'gmail_sync_failed', detail: 'page token repeated' })
  })
})
