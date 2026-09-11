import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { GmailConnectorProvider } from '../src/gmail-provider.js'
import { GmailIndex } from '../src/gmail-index.js'
import { LocalMailStore } from '../src/local-mail-store.js'

it('can retry after the agent could not be reached at all', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-refused-draft-'))
  const path = join(dir, 'index.sqlite')
  const index = new GmailIndex(path)
  index.replaceAccounts([{ id: 'one', name: 'Work', email: 'work@example.com', connectorId: 'gmail' }], new Date().toISOString())
  index.close()
  const unused = createServer()
  await new Promise<void>(resolve => unused.listen(0, '127.0.0.1', resolve))
  const port = (unused.address() as AddressInfo).port
  await new Promise<void>(resolve => unused.close(() => resolve()))
  const provider = new GmailConnectorProvider(`http://127.0.0.1:${port}`, { indexPath: path })
  try {
    await expect(provider.createGmailDraft('one', '', 'work@example.com', '', '', 'Subject', 'Body', [], 'refused-key')).rejects.toThrow()
    const store = new LocalMailStore(`${path}.local`)
    expect(store.draftCreate('one', 'refused-key')).toBeUndefined()
    store.close()
  } finally { provider.stopBackgroundSync(); await rm(dir, { recursive: true, force: true }) }
})

it.each([false, true])('reuses one draft across response loss and restart (lost=%s)', async lost => {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-draft-sync-'))
  let creates = 0
  let payload: Record<string, any> = {}
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/connectors/gmail') return res.end(JSON.stringify({ accounts: [{ linkId: 'one', name: 'Work', email: 'work@example.com' }] }))
    if (req.url === '/v1/connectors/gmail/drafts/create') {
      creates++; payload = input
      if (lost) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'timeout after provider accepted the draft' })) }
      return res.end(JSON.stringify({ structuredContent: { draft_id: 'saved', message: { id: 'm1', thread_id: 't1' } } }))
    }
    if (req.url === '/v1/connectors/gmail/drafts/list') return res.end(JSON.stringify({ structuredContent: { drafts: creates ? [{ draft_id: 'saved', message_id: 'm1', thread_id: 't1', to: ['work@example.com'], subject: 'Subject' }] : [] } }))
    if (req.url === '/v1/connectors/gmail/read') return res.end(JSON.stringify({ structuredContent: { id: 'm1', thread_id: 't1', label_ids: ['DRAFT'], internal_date: '1788486120000', payload: { mime_type: 'text/plain', headers: [{ name: 'From', value: 'work@example.com' }, { name: 'Subject', value: 'Subject' }, { name: 'Content-ID', value: `<${payload.draftContentId}>` }], body: { content: payload.bodyMarkdown } } } }))
    if (req.url === '/v1/connectors/gmail/drafts/update') { payload = { ...payload, ...input }; return res.end(JSON.stringify({ structuredContent: { id: 'saved' } })) }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const open = () => new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false, localPath: join(dir, 'local.sqlite') })
  let provider = open()
  try {
    const first = provider.createGmailDraft('one', '', 'work@example.com', '', '', 'Subject', 'First', [], 'stable-save-key')
    if (lost) await expect(first).rejects.toThrow('timeout')
    else expect((await first).id).toBe('saved')
    provider.stopBackgroundSync(); provider = open()
    const saved = await provider.createGmailDraft('one', '', 'work@example.com', '', '', 'Subject', 'Newer text', [], 'stable-save-key')
    expect(saved.id).toBe('saved')
    expect(payload.bodyMarkdown).toBe('Newer text')
    expect(creates).toBe(1)
  } finally { provider.stopBackgroundSync(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }) }
})
