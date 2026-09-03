import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GmailConnectorProvider, projectGmailMessage, projectGmailSearchEmail } from '../src/gmail-provider.js'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))))

const gmailMessage = {
  structuredContent: {
    id: 'gmail-message-1', thread_id: 'gmail-thread-1', label_ids: ['INBOX', 'UNREAD'], snippet: 'A short preview', internal_date: '1788486120000',
    payload: {
      mime_type: 'multipart/alternative',
      headers: [{ name: 'From', value: 'Ana Morales <ana@example.com>' }, { name: 'Subject', value: 'Berth confirmation' }],
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
      body: { kind: 'sanitized-html', content: '<p>Hello.</p>' },
      attachments: [{ id: 'file', name: 'arrival.pdf', sizeLabel: '824 KB' }], source: 'gmail',
    })
  })

  it('projects bounded Gmail search results without a second read call', () => {
    expect(projectGmailSearchEmail({
      id: 'm1', thread_id: 't1', from_: 'Ana <ana@example.com>', subject: 'Hello', snippet: 'Preview', labels: ['INBOX', 'UNREAD'], email_ts: '2026-09-03T21:42:00Z',
    }, { id: 'one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' })).toMatchObject({
      id: 'm1', threadId: 't1', unread: true, accountId: 'one', receivedAt: '2026-09-03T21:42:00.000Z',
    })
  })

  it('uses the agent service instead of reading connector state directly', async () => {
    const searchQueries: string[] = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', name: 'Work', email: 'work@example.com' }] }))
      if (request.url === '/v1/connectors/gmail/search-messages') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        searchQueries.push(String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: unknown }).query ?? ''))
        return response.end(JSON.stringify({ structuredContent: { emails: [{
          id: 'gmail-message-1', thread_id: 'gmail-thread-1', from_: 'Ana Morales <ana@example.com>', subject: 'Berth confirmation', snippet: 'A short preview', labels: ['INBOX', 'UNREAD'], email_ts: '2026-09-03T21:42:00Z',
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail/read-thread') return response.end(JSON.stringify({ structuredContent: { messages: [gmailMessage.structuredContent] } }))
      if (request.url === '/v1/connectors/gmail/read') return response.end(JSON.stringify(gmailMessage))
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    expect(await provider.accounts()).toEqual([{ id: 'link-one', connectorId: '', name: 'Work', email: 'work@example.com' }])
    expect(await provider.listMessages('link-one', 1)).toHaveLength(1)
    await provider.listConversations('link-one', 'unread', 1)
    await provider.listConversations('link-one', 'read', 1)
    expect(searchQueries).toEqual([
      'in:inbox -in:spam -in:trash',
      'in:inbox -in:spam -in:trash is:unread',
      'in:inbox -in:spam -in:trash is:read',
    ])
    expect(await provider.readMessage('link-one', 'gmail-message-1')).toMatchObject({ id: 'gmail-message-1', source: 'gmail' })
    expect(await provider.readConversation('link-one', 'gmail-thread-1')).toMatchObject({ threadId: 'gmail-thread-1', messageCount: 1, source: 'gmail' })
  })
})
