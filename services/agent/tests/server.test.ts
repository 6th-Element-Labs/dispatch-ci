import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createAgentServer } from '../src/server.js'

const servers: ReturnType<typeof createAgentServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function runtime() {
  const request = vi.fn(async (method: string): Promise<unknown> => method === 'thread/start' ? { thread: { id: 'thread-1' } } : { ok: true })
  return {
    ready: vi.fn(async () => undefined),
    lastError: vi.fn(() => null),
    lastWarning: vi.fn(() => 'non-fatal diagnostic'),
    request,
    subscribe: vi.fn(() => () => undefined),
    respond: vi.fn(),
    close: vi.fn(),
  }
}

async function start() {
  const fake = runtime()
  const server = createAgentServer(fake)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fake }
}

describe('dispatch-agent', () => {
  it('reports the real harness boundary', async () => {
    const { base } = await start()
    const health = await (await fetch(`${base}/health`)).json()
    expect(health).toMatchObject({ appServerError: null, appServerWarning: 'non-fatal diagnostic' })
    const response = await fetch(`${base}/ready`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ harness: 'codex-app-server' })
  })

  it('starts a restricted Codex thread', async () => {
    const { base, fake } = await start()
    const response = await fetch(`${base}/v1/threads`, { method: 'POST' })
    expect(response.status).toBe(201)
    expect(fake.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      approvalPolicy: 'on-request',
      sandboxPolicy: expect.objectContaining({ type: 'readOnly' }),
      developerInstructions: expect.stringContaining('first show the complete proposed recipient, subject, and body as a preview'),
    }))
  })

  it('resumes an existing Codex thread after an adapter restart', async () => {
    const { base, fake } = await start()
    fake.request.mockResolvedValueOnce({ thread: { id: 'thread-1' } })
    const response = await fetch(`${base}/v1/threads/thread-1/resume`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
      threadId: 'thread-1', approvalPolicy: 'on-request', developerInstructions: expect.stringContaining('untrusted data'),
    }))
  })

  it('normalizes installed connector state for the thin client', async () => {
    const { base, fake } = await start()
    fake.request.mockResolvedValueOnce({ apps: [{ id: 'gmail', runtimeName: 'Gmail', enabled: true, callable: true }] })
    const response = await fetch(`${base}/v1/apps`)
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'gmail', name: 'Gmail', isAccessible: true, isEnabled: true, callable: true }] })
  })

  it('falls back to app/list for installed Codex versions without app/installed', async () => {
    const { base, fake } = await start()
    fake.request
      .mockRejectedValueOnce(new Error('Invalid request: unknown variant `app/installed`'))
      .mockResolvedValueOnce({ data: [{ id: 'gmail', name: 'Gmail', isAccessible: true, isEnabled: true }] })
    const response = await fetch(`${base}/v1/apps`)
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'gmail', name: 'Gmail', isAccessible: true, isEnabled: true, callable: true }] })
    expect(fake.request).toHaveBeenNthCalledWith(2, 'app/list', { cursor: null, limit: 20, forceRefetch: false })
  })

  it('reads a complete Gmail thread through the Codex connector', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.read_email_thread': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one', link_owner_profile: { email: 'work@example.com' } } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      if (method === 'mcpServer/tool/call') return { structuredContent: { messages: [] } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/read-thread`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', threadId: 'gmail-thread', maxMessages: 20 }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      server: 'codex_apps', tool: 'gmail.read_email_thread',
      arguments: { link_id: 'link-one', thread_id: 'gmail-thread', max_messages: 20 },
    }))
  })

  it('passes exact Gmail system label IDs to message search', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.search_emails': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      if (method === 'mcpServer/tool/call') return { structuredContent: { emails: [] } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/search-messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', query: '-in:spam', labelIds: ['INBOX', 'UNREAD'], maxResults: 20, nextPageToken: 'next-1' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      arguments: { link_id: 'link-one', query: '-in:spam', label_ids: ['INBOX', 'UNREAD'], max_results: 20, next_page_token: 'next-1' },
    }))
  })

  it('applies accepted Gmail read-state label changes', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.batch_modify_email': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/modify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', messageIds: ['m1'], removeLabels: ['UNREAD'] }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.batch_modify_email', arguments: { link_id: 'link-one', message_ids: ['m1'], add_labels: [], remove_labels: ['UNREAD'] },
    }))
  })

  it('returns a user decision to a server-initiated Codex request', async () => {
    const { base, fake } = await start()
    const response = await fetch(`${base}/v1/server-requests/respond`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'approval-1', result: { decision: 'decline' } }),
    })
    expect(response.status).toBe(200)
    expect(fake.respond).toHaveBeenCalledWith('approval-1', { decision: 'decline' })
  })
})
