import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GmailConnectorProvider, projectGmailMessage } from '../src/gmail-provider.js'

const email = {
  id: 'message-1', thread_id: 'thread-1', from_: 'Ana <ana@example.com>',
  to: ['Steve <steve@example.com>', 'Ops <ops@example.com>'], cc: ['manager@example.com'], bcc: [],
  subject: 'Appointment', snippet: 'Hello', body: 'Hello from Gmail.',
  labels: ['INBOX', 'UNREAD'], email_ts: '2026-10-30T21:31:40',
  attachments: [], inline_images: [], raw_mime: null, raw_mime_base64url: null,
}
const account = { id: 'account-1', connectorId: 'gmail', email: 'steve@example.com', name: 'Work' }

describe('normalized Gmail connector messages', () => {
  it('preserves normalized headers, recipients, body, labels and UTC received time', () => {
    const result = projectGmailMessage({ structuredContent: email }, true, account)
    expect(result).toMatchObject({ id: 'message-1', threadId: 'thread-1',
      sender: { name: 'Ana', address: 'ana@example.com' }, subject: 'Appointment',
      receivedAt: '2026-10-30T21:31:40.000Z', unread: true, labels: ['INBOX', 'UNREAD'],
      body: { kind: 'plain-text', content: email.body }, bodyText: email.body,
      accountId: 'account-1', to: [{ address: 'steve@example.com' }, { address: 'ops@example.com' }],
      cc: [{ address: 'manager@example.com' }], bcc: [],
    })
  })

  it('reads original MIME alternatives and retains attachment ids and CID images', () => {
    const raw = [
      'From: Ana <ana@example.com>', 'To: steve@example.com', 'Subject: Appointment',
      'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="outer"', '',
      '--outer', 'Content-Type: multipart/alternative; boundary="body"', '',
      '--body', 'Content-Type: text/plain; charset=utf-8', '', 'Original plain text.',
      '--body', 'Content-Type: text/html; charset=utf-8', '', '<p><b>Original HTML</b><img src="cid:logo@example.com"></p>',
      '--body--', '--outer', 'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"', 'Content-ID: <logo@example.com>',
      'Content-Transfer-Encoding: base64', '', 'aGk=', '--outer--', '',
    ].join('\r\n')
    const result = projectGmailMessage({ structuredContent: { ...email,
      raw_mime_base64url: Buffer.from(raw).toString('base64url'),
      attachments: [{ filename: 'logo.png', mime_type: 'image/png', size_bytes: 2, attachment_id: 'gmail-attachment' }],
    } }, true, account)
    expect(result.body.kind).toBe('sanitized-html')
    expect(result.body.content).toContain('<b>Original HTML</b>')
    expect(result.body.content).toContain('/v1/messages/message-1/attachments/gmail-attachment?account=account-1&filename=logo.png')
    expect(result.bodyText).toBe('Original plain text.')
    expect(result.attachments).toMatchObject([{ id: 'gmail-attachment', name: 'logo.png', contentId: 'logo@example.com' }])
  })

  it('decodes legacy charset MIME bytes instead of showing connector mojibake', () => {
    const raw = ['From: Ana <ana@example.com>', 'Content-Type: text/plain; charset=windows-1252', '', 'R\xe9union'].join('\r\n')
    const result = projectGmailMessage({ structuredContent: { ...email, body: 'RÃ©union',
      raw_mime_base64url: Buffer.from(raw, 'latin1').toString('base64url') } }, true, account)
    expect(result.body.content).toBe('Réunion')
  })

  it('retains normalized attachment identities even without raw MIME', () => {
    const result = projectGmailMessage({ structuredContent: { ...email,
      attachments: [{ filename: 'report.pdf', mime_type: 'application/pdf', size_bytes: 1200, attachment_id: 'file-1' }],
    } }, true, account)
    expect(result.attachments).toMatchObject([{ id: 'file-1', name: 'report.pdf', mediaType: 'application/pdf' }])
  })

  it('retains a provider-named calendar file and does not decode attachment text as the body', () => {
    const raw = ['From: Ana <ana@example.com>', 'Content-Type: multipart/mixed; boundary="mail"', '',
      '--mail', 'Content-Type: text/html; charset=utf-8', '', '<p>Meeting invitation</p>',
      '--mail', 'Content-Type: text/calendar; charset=x-private-calendar', '', 'BEGIN:VCALENDAR',
      '--mail--', ''].join('\r\n')
    const result = projectGmailMessage({ structuredContent: { ...email,
      raw_mime_base64url: Buffer.from(raw).toString('base64url'),
      attachments: [{ filename: 'invite.ics', mime_type: 'text/calendar', attachment_id: 'calendar', size_bytes: 15 }],
    } }, true, account)
    expect(result.body).toEqual({ kind: 'sanitized-html', content: '<p>Meeting invitation</p>' })
    expect(result.attachments).toMatchObject([{ id: 'calendar', name: 'invite.ics', mediaType: 'text/calendar' }])
  })

  it('rejects missing sender and invalid labels instead of inventing successful mail', () => {
    expect(() => projectGmailMessage({ structuredContent: { ...email, from_: '' } }, true)).toThrow(/From|sender/)
    expect(() => projectGmailMessage({ structuredContent: { ...email, labels: 'INBOX' } }, true)).toThrow(/labels/)
  })

  it('reads full MIME for normalized thread rows and preserves the provider truncation signal', async () => {
    const reads: string[] = []
    const raw = ['From: Ana <ana@example.com>', 'Content-Type: multipart/mixed; boundary="full"', '',
      '--full', 'Content-Type: text/html; charset=utf-8', '', '<p>Full <b>HTML</b> message.</p>',
      '--full', 'Content-Type: text/plain; name="empty.txt"', 'Content-Disposition: attachment; filename="empty.txt"',
      '', '', '--full--', ''].join('\r\n')
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (request.url === '/v1/connectors/gmail') return response.end(JSON.stringify({ accounts: [{ linkId: account.id, email: account.email, name: account.name }] }))
      if (request.url === '/v1/connectors/gmail/read-thread') return response.end(JSON.stringify({ structuredContent: { messages: [email], total_messages: 3, truncated: true } }))
      if (request.url === '/v1/connectors/gmail/read') {
        reads.push(input.messageId)
        return response.end(JSON.stringify({ structuredContent: { ...email, raw_mime_base64url: Buffer.from(raw).toString('base64url') } }))
      }
      response.statusCode = 404; response.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false })
    try {
      const result = await provider.readConversation(account.id, 'thread-1')
      expect(result.messages[0]?.body).toEqual({ kind: 'sanitized-html', content: '<p>Full <b>HTML</b> message.</p>' })
      expect(reads).toEqual(['message-1'])
      expect(result.completeness).toMatchObject({ complete: false, knownCount: 3, loadedCount: 1 })
      expect(result.completeness?.reason).toContain('partial thread')
      const attachment = await provider.readAttachment(account.id, 'message-1', 'mime-part:1', 'empty.txt')
      expect(attachment).toMatchObject({ structuredContent: { base64_url_content: '', size_bytes: 0 } })
    } finally {
      provider.stopBackgroundSync()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
