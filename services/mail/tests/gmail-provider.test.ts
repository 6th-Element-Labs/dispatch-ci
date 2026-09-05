import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { projectDraft } from '../src/draft.js'
import { GmailConnectorProvider, projectGmailMessage, projectGmailSearchEmail } from '../src/gmail-provider.js'

const servers: ReturnType<typeof createServer>[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

const gmailMessage = {
  structuredContent: {
    id: 'gmail-message-1', thread_id: 'gmail-thread-1', label_ids: ['INBOX', 'UNREAD'], snippet: 'A short preview', internal_date: '1788486120000',
    payload: {
      mime_type: 'multipart/alternative',
      headers: [{ name: 'From', value: 'Ana Morales <ana@example.com>' }, { name: 'To', value: 'Steve <work@example.com>, Ops <ops@example.com>' }, { name: 'Cc', value: 'Manager <manager@example.com>' }, { name: 'Subject', value: 'Berth confirmation' }],
      parts: [
        { part_id: 'plain', mime_type: 'text/plain', filename: '', body: { content: 'Hello.' } },
        { part_id: 'html', mime_type: 'text/html', filename: '', body: { content: '<p>Hello.</p>' } },
        { part_id: 'file', mime_type: 'application/pdf', filename: 'arrival.pdf', body: { size: 824000, attachment_id: 'a1' } },
      ],
    },
  },
}

const gmailDraftMessage = {
  structuredContent: {
    ...gmailMessage.structuredContent,
    payload: {
      ...gmailMessage.structuredContent.payload,
      parts: gmailMessage.structuredContent.payload.parts.filter((part) => !part.filename),
    },
  },
}

describe('GmailConnectorProvider', () => {
  it('projects Gmail headers, MIME, attachments, and stable identity', () => {
    expect(projectGmailMessage(gmailMessage, true)).toMatchObject({
      id: 'gmail-message-1', threadId: 'gmail-thread-1', subject: 'Berth confirmation', unread: true,
      sender: { name: 'Ana Morales', address: 'ana@example.com', initials: 'AM' },
      to: [{ name: 'Steve', address: 'work@example.com' }, { name: 'Ops', address: 'ops@example.com' }],
      cc: [{ name: 'Manager', address: 'manager@example.com' }],
      body: { kind: 'sanitized-html', content: '<p>Hello.</p>' },
      attachments: [{ id: 'a1', name: 'arrival.pdf', sizeLabel: '824 KB' }], source: 'gmail',
    })
    expect(projectGmailMessage({ structuredContent: { ...gmailMessage.structuredContent, label_ids: null } }, true)).toMatchObject({ id: 'gmail-message-1', unread: false })
  })

  it('projects bounded Gmail search results without a second read call', () => {
    expect(projectGmailSearchEmail({
      id: 'm1', thread_id: 't1', from_: 'Ana <ana@example.com>', subject: 'Hello', snippet: 'Preview', labels: ['INBOX', 'UNREAD'], email_ts: '2026-09-03T21:42:00Z',
    }, { id: 'one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' })).toMatchObject({
      id: 'm1', threadId: 't1', unread: true, accountId: 'one', receivedAt: '2026-09-03T21:42:00.000Z', sender: { name: 'Ana', address: 'ana@example.com' },
    })
    expect(projectGmailSearchEmail({
      id: 'm2', thread_id: 't2', from_: 'Daniel Campbell daniel@example.com', subject: 'Hello', labels: ['INBOX'], email_ts: '2026-09-03T21:42:00Z',
    }, { id: 'one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' })).toMatchObject({ sender: { name: 'Daniel Campbell', address: 'daniel@example.com' } })
  })

  it('rejects missing state labels and invalid timestamps during normalization', () => {
    const account = { id: 'one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' }
    expect(() => projectGmailSearchEmail({
      id: 'm1', thread_id: 't1', from_: 'Ana <ana@example.com>', email_ts: '2026-09-03T21:42:00Z',
    }, account)).toThrow('missing labels')
    expect(() => projectGmailSearchEmail({
      id: 'm1', thread_id: 't1', from_: 'Ana <ana@example.com>', labels: ['INBOX'], email_ts: 'not-a-date',
    }, account)).toThrow('invalid or missing received timestamp')
  })

  it('uses the agent service instead of reading connector state directly', async () => {
    const searches: Array<{ query?: string; labelIds?: string[] }> = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      if (request.url === '/v1/connectors/gmail/search-messages') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        searches.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: string; labelIds?: string[] })
        return response.end(JSON.stringify({ structuredContent: { emails: [{
          id: 'gmail-message-1', thread_id: 'gmail-thread-1', from_: 'Ana Morales <ana@example.com>', subject: 'Berth confirmation', snippet: 'A short preview', labels: ['INBOX', 'UNREAD'], email_ts: '2026-09-03T21:42:00Z',
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail/modify') return response.end(JSON.stringify({ ok: true }))
      if (request.url === '/v1/connectors/gmail/read-thread') return response.end(JSON.stringify({ structuredContent: { messages: [gmailMessage.structuredContent] } }))
      if (request.url === '/v1/connectors/gmail/read') return response.end(JSON.stringify(gmailMessage))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    expect(await provider.accounts()).toEqual([{ id: 'link-one', connectorId: '', name: 'Work', email: 'work@example.com' }])
    expect(await provider.listMessages('link-one', 1)).toHaveLength(1)
    await provider.listConversations('link-one', 'all', 1)
    await provider.listConversations('link-one', 'unread', 1)
    await provider.listConversations('link-one', 'read', 1)
    await provider.listMailboxConversations('sent', 'all', 'link-one')
    await provider.listMailboxConversations('archive', 'all', 'link-one')
    expect(searches).toEqual([
      expect.objectContaining({ query: '-in:spam -in:trash', labelIds: ['INBOX'] }),
      expect.objectContaining({ query: '(in:inbox OR is:unread) -in:spam -in:trash', labelIds: [] }),
      expect.objectContaining({ query: 'is:unread -in:spam -in:trash', labelIds: ['UNREAD'] }),
      expect.objectContaining({ query: 'in:inbox is:read -in:spam -in:trash', labelIds: ['INBOX'] }),
      expect.objectContaining({ query: '-in:trash', labelIds: ['SENT'] }),
      expect.objectContaining({ query: '-in:inbox -in:sent -in:drafts -in:spam -in:trash', labelIds: [] }),
    ])
    expect(await provider.readMessage('link-one', 'gmail-message-1')).toMatchObject({ id: 'gmail-message-1', source: 'gmail' })
    expect(await provider.readConversation('link-one', 'gmail-thread-1')).toMatchObject({ threadId: 'gmail-thread-1', messageCount: 1, source: 'gmail' })
  })

  it('paginates Gmail into the durable index and serves the indexed result', async () => {
    const requests: Array<{ labelIds?: string[]; nextPageToken?: string }> = []
    let failSearch = false
    let failInventory = false
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        if (failInventory) {
          response.statusCode = 502
          return response.end(JSON.stringify({ error: 'inventory_failed' }))
        }
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/search-messages') {
        if (failSearch) {
          response.statusCode = 502
          return response.end(JSON.stringify({ error: 'connector_failed' }))
        }
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { labelIds?: string[]; nextPageToken?: string }
        requests.push(payload)
        const unread = payload.labelIds?.includes('UNREAD') === true && payload.labelIds.includes('INBOX') !== true
        const second = payload.nextPageToken === 'page-2'
        const emails = unread
          ? [{ id: 'm3', thread_id: 't3', from_: 'Cara <cara@example.com>', subject: 'Archived unread', snippet: 'Three', labels: ['UNREAD'], email_ts: '2026-09-04T07:00:00Z' }]
          : [{ id: second ? 'm2' : 'm1', thread_id: second ? 't2' : 't1', from_: 'Ana <ana@example.com>', subject: second ? 'Unread' : 'Inbox', snippet: 'One', labels: second ? ['INBOX', 'UNREAD'] : ['INBOX'], email_ts: second ? '2026-09-04T08:00:00Z' : '2026-09-04T09:00:00Z' }]
        return response.end(JSON.stringify({ structuredContent: { emails, next_page_token: !unread && !second ? 'page-2' : '' } }))
      }
      if (request.url === '/v1/connectors/gmail/modify') return response.end(JSON.stringify({ ok: true }))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-sync-'))
    directories.push(directory)
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: join(directory, 'gmail.sqlite') })
    await provider.syncNow()
    expect(provider.syncStatus()).toMatchObject({ state: 'ready', messageCount: 3 })
    expect(await provider.listUnifiedConversations('all')).toHaveLength(3)
    expect(await provider.listUnifiedConversations('unread')).toHaveLength(2)
    await provider.setConversationUnread('link-one', 't2', false)
    expect(await provider.listUnifiedConversations('unread')).toHaveLength(1)
    expect(requests.filter((request) => request.labelIds?.includes('INBOX'))).toHaveLength(2)
    expect(requests.filter((request) => request.labelIds?.includes('UNREAD') === true && request.labelIds.includes('INBOX') !== true)).toHaveLength(1)
    expect(requests.some((request) => request.nextPageToken === 'page-2')).toBe(true)
    await provider.refreshNow()
    expect(provider.syncStatus()).toMatchObject({ state: 'ready', messageCount: 3, pagesFetched: 2 })
    expect(await provider.listUnifiedConversations('all')).toHaveLength(3)
    failSearch = true
    await expect(provider.syncNow()).rejects.toThrow('Gmail connector request failed (502)')
    expect(provider.syncStatus()).toMatchObject({ state: 'failed', messageCount: 3 })
    await expect(provider.listUnifiedConversations('all')).resolves.toHaveLength(3)
    failInventory = true
    await expect(provider.accounts()).resolves.toMatchObject([{ id: 'link-one', email: 'work@example.com' }])
    expect(provider.syncStatus()).toMatchObject({ state: 'failed', error: expect.stringContaining('Gmail account refresh failed') })
    provider.stopBackgroundSync()
  })

  it('rejects create and update attachments before contacting Gmail', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      requests.push({ path: request.url ?? '', body })
      if (request.url === '/v1/connectors/gmail/drafts/create') {
        return response.end(JSON.stringify({ structuredContent: { draft_id: 'draft-1' } }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/update') return response.end(JSON.stringify({ ok: true }))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    await expect(provider.createGmailDraft('link-one', 'message-1', 'to@example.com', '', '', 'Hello', '**Hi**', [
      { id: 'attachment-1', name: 'arrival.pdf', mediaType: 'application/pdf' },
    ])).rejects.toMatchObject({
      message: 'Gmail compose attachments are unsupported',
      code: 'gmail_attachment_unsupported',
    })
    const draft = projectDraft({ id: 'draft-1', inReplyToMessageId: 'message-1', to: [], subject: 'Hello', bodyMarkdown: 'Hi', accountId: 'link-one', attachments: [
      { id: 'attachment-1', name: 'arrival.pdf', mediaType: 'application/pdf' },
    ] })
    await expect(provider.updateGmailDraft(draft)).rejects.toMatchObject({
      message: 'Gmail compose attachments are unsupported',
      code: 'gmail_attachment_unsupported',
    })
    expect(requests).toEqual([])

    const created = await provider.createGmailDraft('link-one', 'message-1', 'to@example.com', '', '', 'Hello', '**Hi**')
    expect(created).toMatchObject({ id: 'draft-1', bodyMarkdown: '**Hi**', bodyHtml: expect.stringContaining('<strong>Hi</strong>') })
    const updated = projectDraft({ ...created, subject: 'Updated', bodyMarkdown: '_Updated_' })
    await provider.updateGmailDraft(updated)
    const createRequest = requests[0]!
    const updateRequest = requests[1]!
    expect(createRequest).toMatchObject({
      path: '/v1/connectors/gmail/drafts/create',
      body: { linkId: 'link-one', bodyMarkdown: '**Hi**', bodyText: '**Hi**' },
    })
    expect(createRequest.body).not.toHaveProperty('attachments')
    expect(updateRequest).toMatchObject({
      path: '/v1/connectors/gmail/drafts/update',
      body: { draftId: 'draft-1', bodyMarkdown: '_Updated_', bodyText: '_Updated_' },
    })
    expect(updateRequest.body).not.toHaveProperty('attachments')
  })

  it('opens an existing Gmail draft by its listed message ID', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      requests.push({ path: request.url ?? '', body })
      if (request.url === '/v1/connectors/gmail/drafts/list') {
        const second = body.nextPageToken === 'page-2'
        return response.end(JSON.stringify({ structuredContent: {
          drafts: second
            ? [{ draft_id: 'draft-opened', message_id: 'gmail-message-1', thread_id: 'gmail-thread-1', to: 'client@example.com', cc: 'copy@example.com', bcc: 'audit@example.com', subject: 'Saved draft' }]
            : [{ draft_id: 'other-draft', message_id: 'other-message', thread_id: 'other-thread', to: 'other@example.com', subject: 'Other' }],
          next_page_token: second ? '' : 'page-2',
        } }))
      }
      if (request.url === '/v1/connectors/gmail/read') return response.end(JSON.stringify(gmailDraftMessage))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    const draft = await provider.openGmailDraft('link-one', 'gmail-message-1')
    expect(draft).toMatchObject({
      id: 'draft-opened',
      inReplyToMessageId: 'gmail-message-1',
      to: [{ address: 'client@example.com' }],
      cc: 'copy@example.com',
      bcc: 'audit@example.com',
      subject: 'Saved draft',
      bodyMarkdown: 'Hello.',
      attachments: [],
    })
    expect(requests.map((request) => request.path)).toEqual([
      '/v1/connectors/gmail/drafts/list',
      '/v1/connectors/gmail/drafts/list',
      '/v1/connectors/gmail/read',
    ])
    expect(requests).not.toContainEqual(expect.objectContaining({ path: '/v1/connectors/gmail/drafts/create' }))
  })

  it('rejects opening a listed Gmail draft that reports has_attachment', async () => {
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/list') {
        return response.end(JSON.stringify({ structuredContent: { drafts: [{
          draft_id: 'draft-attached', message_id: 'gmail-message-1', thread_id: 'gmail-thread-1',
          to: 'client@example.com', subject: 'Saved draft', has_attachment: true,
        }] } }))
      }
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    await expect(provider.openGmailDraft('link-one', 'gmail-message-1')).rejects.toMatchObject({
      message: 'Gmail draft attachments are unsupported',
      code: 'gmail_attachment_unsupported',
    })
  })

  it('rejects refreshing a Gmail draft whose read message includes attachments', async () => {
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail/drafts/list') {
        return response.end(JSON.stringify({ structuredContent: { drafts: [{
          draft_id: 'draft-1', message_id: 'gmail-message-1', thread_id: 'gmail-thread-1',
          to: 'client@example.com', subject: 'Saved draft',
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/read') return response.end(JSON.stringify(gmailMessage))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    await expect(provider.readGmailDraft('link-one', 'draft-1')).rejects.toMatchObject({
      message: 'Gmail draft attachments are unsupported',
      code: 'gmail_attachment_unsupported',
    })
  })

  it('refreshes a Gmail draft from the connector instead of returning stale local state', async () => {
    let listedSubject = 'Original subject'
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail/drafts/create') {
        return response.end(JSON.stringify({ structuredContent: { draft_id: 'draft-1' } }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/list') {
        return response.end(JSON.stringify({ structuredContent: { drafts: [{
          draft_id: 'draft-1', message_id: 'gmail-message-1', thread_id: 'gmail-thread-1',
          to: 'client@example.com', cc: '', bcc: '', subject: listedSubject,
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/read') return response.end(JSON.stringify(gmailDraftMessage))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    await provider.createGmailDraft('link-one', '', 'old@example.com', '', '', 'Local subject', 'Local body')
    listedSubject = 'Codex revised subject'

    await expect(provider.readGmailDraft('link-one', 'draft-1')).resolves.toMatchObject({
      id: 'draft-1',
      subject: 'Codex revised subject',
      bodyMarkdown: 'Hello.',
    })
  })

  it('clears the mailbox cache after each Gmail draft write', async () => {
    let searches = 0
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/search-messages') {
        searches += 1
        return response.end(JSON.stringify({ structuredContent: { emails: [{
          id: `message-${searches}`, thread_id: `thread-${searches}`, from_: 'Ana <ana@example.com>',
          subject: 'Sent', snippet: '', labels: ['SENT'], email_ts: '2026-09-05T01:00:00Z',
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/create') {
        return response.end(JSON.stringify({ structuredContent: { draft_id: 'draft-1' } }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/update'
        || request.url === '/v1/connectors/gmail/drafts/discard'
        || request.url === '/v1/connectors/gmail/drafts/send') {
        return response.end(JSON.stringify({ ok: true }))
      }
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    const listSent = () => provider.listMailboxConversations('sent', 'all', 'link-one')

    await listSent()
    await listSent()
    expect(searches).toBe(1)

    const draft = await provider.createGmailDraft('link-one', '', 'client@example.com', '', '', 'Subject', 'Body')
    await listSent()
    await provider.updateGmailDraft(projectDraft({ ...draft, bodyMarkdown: 'Updated' }))
    await listSent()
    await provider.discardGmailDraft('link-one', 'draft-1')
    await listSent()
    await provider.sendGmailDraft('link-one', 'draft-1')
    await listSent()

    expect(searches).toBe(5)
  })

  it('discards Gmail drafts and maps connector failures to typed errors', async () => {
    let failure = ''
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      if (failure) {
        response.statusCode = 503
        return response.end(JSON.stringify({ error: failure }))
      }
      response.end(JSON.stringify({ ok: true }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    await expect(provider.discardGmailDraft('link-one', 'draft-1')).resolves.toBeUndefined()

    failure = 'gmail_html_unsupported'
    await expect(provider.createGmailDraft('link-one', '', '', '', '', '', 'Hi')).rejects.toMatchObject({ code: 'gmail_html_unsupported' })
    failure = 'attachment upload failed'
    await expect(provider.createGmailDraft('link-one', '', '', '', '', '', 'Hi')).rejects.toMatchObject({ code: 'gmail_attachment_unsupported' })
    failure = 'gmail_draft_discard_unavailable'
    await expect(provider.discardGmailDraft('link-one', 'draft-1')).rejects.toMatchObject({ code: 'gmail_draft_discard_unavailable' })
  })
})
