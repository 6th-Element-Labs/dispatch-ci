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
      model: 'gpt-5.6-sol',
      approvalPolicy: 'on-request',
      sandboxPolicy: expect.objectContaining({ type: 'readOnly' }),
      developerInstructions: expect.stringContaining('Never call gmail.send_draft'),
    }))
    expect(fake.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      developerInstructions: expect.stringContaining('update that Gmail draft id'),
    }))
  })

  it('resumes an existing Codex thread after an adapter restart', async () => {
    const { base, fake } = await start()
    fake.request.mockResolvedValueOnce({ thread: { id: 'thread-1' } })
    const response = await fetch(`${base}/v1/threads/thread-1/resume`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
      threadId: 'thread-1', model: 'gpt-5.6-sol', approvalPolicy: 'on-request', developerInstructions: expect.stringContaining('untrusted data'),
    }))
  })

  it('defaults Dispatch turns to GPT-5.6 Sol with medium effort', async () => {
    const { base, fake } = await start()
    const response = await fetch(`${base}/v1/threads/thread-1/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Summarize this email.', model: '', effort: '  ' }) })
    expect(response.status).toBe(202)
    expect(fake.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'thread-1', model: 'gpt-5.6-sol', effort: 'medium' }))
  })

  it('forwards the model and effort the client chose for a turn', async () => {
    const { base, fake } = await start()
    const response = await fetch(`${base}/v1/threads/thread-1/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Summarize this email.', model: 'gpt-reserve', effort: 'max' }) })
    expect(response.status).toBe(202)
    expect(fake.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'thread-1', model: 'gpt-reserve', effort: 'max' }))
  })

  it('serves the model catalog joined with usage buckets', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'model/list') return { data: [
        { id: 'gpt-reserve', displayName: 'GPT-Reserve', hidden: true, supportedReasoningEfforts: [{ reasoningEffort: 'max' }] },
        { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
      ] }
      if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 100, resetsAt: 1788754468 }, rateLimitReachedType: 'rate_limit_reached' },
        base_model_inference: { primary: { usedPercent: 0, resetsAt: 1789252467 }, rateLimitReachedType: null },
      } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/models`)
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('model/list', expect.objectContaining({ includeHidden: true }))
    await expect(response.json()).resolves.toEqual({
      defaults: { model: 'gpt-5.6-sol', effort: 'medium' },
      rateLimitsError: null,
      models: [
        { id: 'gpt-reserve', label: 'Luna Reserve', efforts: ['max'], exhausted: false, resetsAt: 1789252467 },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['medium'], exhausted: true, resetsAt: 1788754468 },
      ],
    })
    expect(fake.request.mock.calls.map(([method]) => method)).not.toContain('account/rateLimitResetCredit/consume')
  })

  it('reports a failed rate-limit read without hiding the catalog', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'model/list') return { data: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', hidden: false, supportedReasoningEfforts: [] }] }
      if (method === 'account/rateLimits/read') throw new Error('limits offline')
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/models`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ rateLimitsError: 'limits offline', models: [{ id: 'gpt-5.6-sol', exhausted: null }] })
  })

  it('fails visibly when the catalog is unavailable', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => { if (method === 'model/list') throw new Error('app-server gone'); return {} })
    const response = await fetch(`${base}/v1/models`)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'model_catalog_unavailable', detail: 'app-server gone' })
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

  it('routes archive and Trash through their explicit Gmail tools', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.archive_emails': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
        'gmail.delete_emails': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    expect((await fetch(`${base}/v1/connectors/gmail/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkId: 'link-one', threadIds: ['t1'] }) })).status).toBe(200)
    expect((await fetch(`${base}/v1/connectors/gmail/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkId: 'link-one', messageIds: ['m1'] }) })).status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({ tool: 'gmail.archive_emails', arguments: { link_id: 'link-one', thread_ids: ['t1'] } }))
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({ tool: 'gmail.delete_emails', arguments: { link_id: 'link-one', message_ids: ['m1'] } }))
  })

  it('sends HTML and Markdown payloads for Gmail drafts and forbids Codex sending', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.create_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', to: 'to@example.com', subject: 'Hello', bodyMarkdown: '**Hi**', bodyHtml: '<p><strong>Hi</strong></p>' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      arguments: expect.objectContaining({
        payload: { mime_type: 'text/html', charset: 'UTF-8', body: { content: '<p><strong>Hi</strong></p>' } },
        text_plain: '**Hi**',
      }),
    }))

    await fetch(`${base}/v1/threads`, { method: 'POST' })
    expect(fake.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      developerInstructions: expect.stringContaining('Never call gmail.send_draft'),
    }))
  })

  it('reads a Gmail attachment by id without a filename selector', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.read_attachment': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { structuredContent: { mime_type: 'image/png', download_url: 'https://files.example.com/x' } }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/attachment`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', messageId: 'm1', attachmentId: 'att-1', filename: 'image.png' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.read_attachment',
      arguments: { link_id: 'link-one', message_id: 'm1', attachment_id: 'att-1' },
    }))
  })

  it('passes draft attachments to the Gmail connector', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.create_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
        'gmail.update_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const attachments = [{ filename: 'arrival.pdf', mime_type: 'application/pdf', data: 'cGRm' }]
    expect((await fetch(`${base}/v1/connectors/gmail/drafts/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', to: 'to@example.com', subject: 'Hello', bodyMarkdown: 'Hi', bodyHtml: '<p>Hi</p>', attachments }),
    })).status).toBe(200)
    expect((await fetch(`${base}/v1/connectors/gmail/drafts/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', draftId: 'draft-1', subject: 'Hello', bodyMarkdown: 'Hi', bodyHtml: '<p>Hi</p>', attachments }),
    })).status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.create_draft',
      arguments: expect.objectContaining({ attachments }),
    }))
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.update_draft',
      arguments: expect.objectContaining({ attachments }),
    }))
  })

  it('updates a Gmail draft with HTML and plain-text payloads', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.update_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', draftId: 'draft-1', subject: 'Updated', bodyMarkdown: '**Updated**', bodyHtml: '<p><strong>Updated</strong></p>' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.update_draft',
      arguments: expect.objectContaining({
        payload: { mime_type: 'text/html', charset: 'UTF-8', body: { content: '<p><strong>Updated</strong></p>' } },
        text_plain: '**Updated**',
      }),
    }))
  })

  it('lists Gmail drafts through the connector with pagination', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.list_drafts': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      if (method === 'mcpServer/tool/call') return { structuredContent: { drafts: [] } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/list`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', maxResults: 25, nextPageToken: 'next-1' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      server: 'codex_apps',
      tool: 'gmail.list_drafts',
      arguments: { link_id: 'link-one', max_results: 25, next_page_token: 'next-1' },
    }))
  })

  it('rejects Gmail draft create when linkId is missing', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.create_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'to@example.com', subject: 'Hello', bodyHtml: '<p>Hi</p>' }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'linkId_required' })
    expect(fake.request).not.toHaveBeenCalledWith('mcpServer/tool/call', expect.anything())
  })

  it('rejects Gmail draft create and update when HTML is missing', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.create_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
        'gmail.update_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const request = (path: string, payload: Record<string, string>) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    const create = await request('/v1/connectors/gmail/drafts/create', { linkId: 'link-one', bodyText: 'Plain text only' })
    const update = await request('/v1/connectors/gmail/drafts/update', { linkId: 'link-one', draftId: 'draft-1', bodyMarkdown: '**Plain text only**' })
    expect(create.status).toBe(400)
    await expect(create.json()).resolves.toEqual({ error: 'gmail_html_unsupported' })
    expect(update.status).toBe(400)
    await expect(update.json()).resolves.toEqual({ error: 'gmail_html_unsupported' })
    expect(fake.request).not.toHaveBeenCalledWith('mcpServer/tool/call', expect.anything())
  })

  it('discards a Gmail draft through the explicit delete draft tool', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.delete_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      if (method === 'thread/start') return { thread: { id: 'connector-thread' } }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/discard`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', draftId: 'draft-1' }),
    })
    expect(response.status).toBe(200)
    expect(fake.request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({
      tool: 'gmail.delete_draft',
      arguments: { link_id: 'link-one', draft_id: 'draft-1' },
    }))
  })

  it('returns a service error when Gmail draft discard is unavailable', async () => {
    const { base, fake } = await start()
    fake.request.mockImplementation(async (method: string) => {
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: {
        'gmail.create_draft': { _meta: { connector_name: 'Gmail', connector_id: 'gmail', link_id: 'link-one' } },
      } }] }
      return { ok: true }
    })
    const response = await fetch(`${base}/v1/connectors/gmail/drafts/discard`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkId: 'link-one', draftId: 'draft-1' }),
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'gmail_draft_discard_unavailable' })
  })

  it('reads history, steers, and interrupts the active Codex turn', async () => {
    const { base, fake } = await start()
    await fetch(`${base}/v1/threads/thread-1`)
    await fetch(`${base}/v1/threads/thread-1/steer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedTurnId: 'turn-1', text: 'Change focus' }) })
    await fetch(`${base}/v1/threads/thread-1/interrupt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'turn-1' }) })
    expect(fake.request).toHaveBeenCalledWith('thread/read', { threadId: 'thread-1', includeTurns: true })
    expect(fake.request).toHaveBeenCalledWith('turn/steer', { threadId: 'thread-1', expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'Change focus' }] })
    expect(fake.request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' })
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
  it('allows the browser origin by default and honors DISPATCH_ALLOWED_ORIGIN', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/health`)).headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8410')
    vi.stubEnv('DISPATCH_ALLOWED_ORIGIN', 'tauri://localhost')
    vi.resetModules()
    try {
      const { createAgentServer: fresh } = await import('../src/server.js')
      const server = fresh(runtime())
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      expect((await fetch(`http://127.0.0.1:${port}/health`)).headers.get('access-control-allow-origin')).toBe('tauri://localhost')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
