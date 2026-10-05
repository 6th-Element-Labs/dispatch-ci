import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GmailConnectorProvider } from '../src/gmail-provider.js'

it.each(['accepted', 'unknown', 'save-failed', 'rejected'])('background Send accepts immediately, preserves the submitted reply and does not replay %s', async outcome => {
  let releaseCreate!: () => void
  const createGate = new Promise<void>(resolve => { releaseCreate = resolve })
  let sends = 0
  let creates = 0
  let payload: Record<string, any> = {}
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') return res.end(JSON.stringify({ accounts: [{ linkId: 'one', email: 'test@example.com' }] }))
    if (req.url?.endsWith('/drafts/create')) {
      creates++; payload = input; await createGate
      if (outcome === 'save-failed') { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid Gmail draft' })) }
      return res.end(JSON.stringify({ structuredContent: { draft_id: 'saved', message: { id: 'm1', thread_id: 't1' } } }))
    }
    if (req.url?.endsWith('/drafts/list')) return res.end(JSON.stringify({ structuredContent: { drafts: [{ draft_id: 'saved', message_id: 'm1', thread_id: 't1', to: [payload.to], cc: [], bcc: [], subject: payload.subject }] } }))
    if (req.url?.endsWith('/read')) return res.end(JSON.stringify({ structuredContent: { id: 'm1', thread_id: 't1', label_ids: ['DRAFT'], internal_date: '1788486120000', payload: { mime_type: 'text/plain', headers: [{ name: 'From', value: 'test@example.com' }, { name: 'To', value: payload.to }, { name: 'Subject', value: payload.subject }, { name: 'Content-ID', value: `<${payload.draftContentId}>` }], body: { content: payload.bodyMarkdown } } } }))
    if (req.url?.endsWith('/drafts/send')) {
      sends++; expect(input.draftId ?? input.draft_id).toBe('saved')
      if (outcome === 'rejected') { res.statusCode = 403; return res.end(JSON.stringify({ error: 'Provider rejected the send' })) }
      if (outcome === 'unknown') { res.statusCode = 502; return res.end(JSON.stringify({ error: 'timeout after provider accepted send' })) }
      return res.end(JSON.stringify({ structuredContent: { id: 'sent' } }))
    }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false, localPath: ':memory:', draftListLagMs: 0 })
  try {
    const draft = provider.enqueueDraftSave('one', '', { to: 'test@example.com', subject: 'Instant', bodyMarkdown: 'The exact reply', attachments: [] })
    const started = performance.now()
    const receipt = provider.beginGmailDraftSend('one', draft.id, draft.draftRevision)
    expect(performance.now() - started).toBeLessThan(100)
    expect(receipt.status).toBe('preparing')
    expect(provider.beginGmailDraftSend('one', draft.id).id).toBe(receipt.id)
    expect(sends).toBe(0)
    expect(() => provider.enqueueDraftSave('one', '', { bodyMarkdown: 'Stale edit' }, draft.id)).toThrow('already sending')
    releaseCreate()
    await expect.poll(() => provider.sendReceipt(receipt.id)?.status).toBe(outcome === 'accepted' ? 'accepted' : outcome === 'unknown' ? 'unknown' : 'failed')
    expect(payload.bodyMarkdown).toBe('The exact reply')
    expect(creates).toBe(1)
    expect(sends).toBe(outcome === 'save-failed' ? 0 : 1)
    if (outcome === 'accepted' || outcome === 'unknown') {
      expect(provider.beginGmailDraftSend('one', draft.id).id).toBe(receipt.id)
      expect(provider.beginGmailDraftSend('one', 'saved').id).toBe(receipt.id)
      expect(sends).toBe(1)
    }
  } finally { releaseCreate(); provider.stopBackgroundSync(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
