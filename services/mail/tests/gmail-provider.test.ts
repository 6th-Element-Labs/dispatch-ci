import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
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
    await provider.listConversations('link-one', 'unread', 1)
    await provider.listConversations('link-one', 'read', 1)
    await provider.listMailboxConversations('sent', 'all', 'link-one')
    await provider.listMailboxConversations('archive', 'all', 'link-one')
    expect(searches).toEqual([
      expect.objectContaining({ query: '-in:spam -in:trash', labelIds: ['INBOX'] }),
      expect.objectContaining({ query: '-in:spam -in:trash is:unread', labelIds: ['INBOX', 'UNREAD'] }),
      expect.objectContaining({ query: '-in:spam -in:trash is:read', labelIds: ['INBOX'] }),
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
        const unread = payload.labelIds?.includes('UNREAD')
        const second = payload.nextPageToken === 'page-2'
        const emails = unread
          ? [{ id: 'm2', thread_id: 't2', from_: 'Bea <bea@example.com>', subject: 'Unread', snippet: 'Two', labels: ['UNREAD'], email_ts: '2026-09-04T08:00:00Z' }]
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
    expect(provider.syncStatus()).toMatchObject({ state: 'ready', messageCount: 2 })
    expect(await provider.listUnifiedConversations('all')).toHaveLength(2)
    expect(await provider.listUnifiedConversations('unread')).toHaveLength(1)
    await provider.setConversationUnread('link-one', 't2', false)
    expect(await provider.listUnifiedConversations('unread')).toHaveLength(0)
    expect(requests.filter((request) => request.labelIds?.includes('INBOX'))).toHaveLength(2)
    expect(requests.some((request) => request.nextPageToken === 'page-2')).toBe(true)
    await provider.refreshNow()
    expect(provider.syncStatus()).toMatchObject({ state: 'ready', messageCount: 2, pagesFetched: 1 })
    expect(await provider.listUnifiedConversations('all')).toHaveLength(2)
    failSearch = true
    await expect(provider.syncNow()).rejects.toThrow('Gmail connector request failed (502)')
    expect(provider.syncStatus()).toMatchObject({ state: 'failed', messageCount: 2 })
    await expect(provider.listUnifiedConversations('all')).resolves.toHaveLength(2)
    failInventory = true
    await expect(provider.accounts()).resolves.toMatchObject([{ id: 'link-one', email: 'work@example.com' }])
    expect(provider.syncStatus()).toMatchObject({ state: 'failed', error: expect.stringContaining('Gmail account refresh failed') })
    provider.stopBackgroundSync()
  })
})
