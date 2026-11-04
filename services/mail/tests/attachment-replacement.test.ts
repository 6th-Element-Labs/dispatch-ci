import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { GmailConnectorProvider } from '../src/gmail-provider.js'
import { LocalMailStore } from '../src/local-mail-store.js'
import type { DraftAttachment } from '../src/model.js'

const originalFile = { name: 'report.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from('original bytes').toString('base64') }
const extraFile = { name: 'résumé.txt', mediaType: 'text/plain', contentBase64: Buffer.from('new bytes').toString('base64') }
type Remote = { id: string; message: string; text: string; html: string; marker?: string; files: DraftAttachment[] }

async function setup(mode: 'normal' | 'lost-create' | 'lost-cleanup' | 'gate' | 'wrong-bytes' = 'normal') {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-file-replacement-'))
  let creates = 0, updates = 0, loss = false, cleanupLoss = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const remote = new Map<string, Remote>([['original', { id: 'original', message: 'message-original', text: 'Original body', html: '<p>Original body</p>', files: [originalFile] }]])
  const deleted: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    res.setHeader('content-type', 'application/json')
    const result = (value: unknown) => res.end(JSON.stringify({ structuredContent: value }))
    const item = () => [...remote.values()].find(item => item.message === input.messageId)
    if (req.url === '/v1/connectors/gmail') return res.end(JSON.stringify({ accounts: [{ linkId: 'one', email: 'me@example.com' }], draftWrites: { create: { htmlBody: true, attachmentFiles: true }, update: { htmlBody: true, attachmentFiles: false } } }))
    if (req.url === '/v1/connectors/gmail/drafts/list') return result({ drafts: [...remote.values()].map(value => ({ draft_id: value.id, message_id: value.message, thread_id: 'same-thread', to: ['recipient@example.com'], cc: ['copy@example.com'], bcc: ['hidden@example.com'], subject: 'Subject', has_attachment: value.files.length > 0 })) })
    if (req.url === '/v1/connectors/gmail/read-thread') return result({ messages: [{ id: 'received-original', label_ids: ['INBOX'] }] })
    if (req.url === '/v1/connectors/gmail/read') {
      const value = item()
      if (!value) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' })) }
      return result({ id: value.message, thread_id: 'same-thread', label_ids: ['DRAFT'], internal_date: '1793750000000', payload: {
        mime_type: 'multipart/mixed', headers: [{ name: 'From', value: 'me@example.com' }, { name: 'To', value: 'recipient@example.com' }, { name: 'Cc', value: 'copy@example.com' }, { name: 'Bcc', value: 'hidden@example.com' }, { name: 'Subject', value: 'Subject' }],
        parts: [{ mime_type: 'text/html', body: { content: value.html + (value.marker ? `<!--dispatch-draft:${value.marker}-->` : '') } },
          ...value.files.map((file, index) => ({ part_id: String(index + 1), filename: file.name, mime_type: file.mediaType, body: { attachment_id: `file-${index}`, size: Buffer.from(file.contentBase64!, 'base64').length } }))],
      } })
    }
    if (req.url === '/v1/connectors/gmail/attachment') {
      const value = item(), file = value?.files[Number(String(input.attachmentId).slice(5))]
      return result({ base64_url_content: Buffer.from(file?.contentBase64 ?? '', 'base64').toString('base64url') })
    }
    if (req.url === '/v1/connectors/gmail/drafts/create') {
      creates++; if (mode === 'gate') await gate
      const id = `replacement-${creates}`
      const files = (input.attachments ?? []).map((file: Record<string, string>) => ({ name: file.filename, mediaType: file.mime_type, contentBase64: mode === 'wrong-bytes' ? 'd3Jvbmc=' : file.data }))
      // Reproduce the real connector's automatic reply history, even with HTML.
      remote.set(id, { id, message: `message-${id}`, marker: input.draftContentId, text: input.bodyMarkdown,
        html: `${input.bodyHtml}<blockquote>On Tue, 3 Nov 2026 Steve wrote:<br>Original body</blockquote>`, files })
      if (mode === 'lost-create' && !loss) { loss = true; res.statusCode = 502; return res.end(JSON.stringify({ error: 'response lost after create' })) }
      return result({ draft_id: id, message_id: `message-${id}`, thread_id: 'same-thread' })
    }
    if (req.url === '/v1/connectors/gmail/drafts/update') {
      updates++; const value = remote.get(input.draftId)!
      if (value.files.length) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'Drafts with attachments are not editable through this action.' })) }
      expect(input.attachmentsChanged).toBe(false)
      remote.set(value.id, { ...value, text: input.bodyMarkdown, html: input.bodyHtml })
      return result({ draft_id: value.id, message_id: value.message, thread_id: 'same-thread' })
    }
    if (req.url === '/v1/connectors/gmail/drafts/discard') { res.statusCode = 503; return res.end(JSON.stringify({ error: 'gmail_draft_discard_unavailable' })) }
    if (req.url === '/v1/connectors/gmail/delete') {
      for (const id of input.messageIds) for (const value of remote.values()) if (value.message === id) { deleted.push(value.id); remote.delete(value.id) }
      if (mode === 'lost-cleanup' && !cleanupLoss) { cleanupLoss = true; res.statusCode = 502; return res.end(JSON.stringify({ error: 'response lost after cleanup' })) }
      return result({ responses: input.messageIds.map((id: string) => ({ message_id: id, success: true })) })
    }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const open = () => new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { indexPath: false, localPath: join(dir, 'mail.sqlite'), draftListLagMs: 0 })
  let provider = open()
  const source = await provider.readGmailDraft('one', 'original', true)
  return { get provider() { return provider }, source, remote, deleted, get creates() { return creates }, get updates() { return updates }, release,
    restart() { provider.stopBackgroundSync(); provider = open(); provider.requestRefresh('manual') },
    async close() { release(); provider.stopBackgroundSync(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }) },
    record(id: string) { const store = new LocalMailStore(join(dir, 'mail.sqlite')); try { return store.draftSave('one', id) } finally { store.close() } },
  }
}

it.each(['normal', 'lost-create', 'lost-cleanup'] as const)('preserves files, recipients, body and thread across safe replacement/restart (%s)', async mode => {
  const f = await setup(mode)
  try {
    const queued = f.provider.enqueueDraftSave('one', '', { attachments: [...f.source.attachments, extraFile] }, 'original', undefined, f.source)
    await f.provider.flushDraftSaves('one')
    if (mode !== 'normal') { expect((await f.provider.readGmailDraft('one', queued.id)).syncState).toBe('pending'); f.restart(); await f.provider.flushDraftSaves('one') }
    const saved = await f.provider.readGmailDraft('one', queued.id)
    expect(saved.syncState).toBeUndefined()
    expect(saved).toMatchObject({ id: 'replacement-1', gmailThreadId: 'same-thread', bodyMarkdown: 'Original body', cc: 'copy@example.com', bcc: 'hidden@example.com' })
    expect(saved.attachments).toMatchObject([{ name: originalFile.name, contentBase64: originalFile.contentBase64 }, { name: extraFile.name, contentBase64: extraFile.contentBase64 }])
    expect(f.creates).toBe(1); expect(f.updates).toBe(0)
    expect([...f.remote.keys()]).toEqual(['replacement-1'])
    expect((await f.provider.readGmailDraft('one', 'original', true)).id).toBe(saved.id)
    f.provider.enqueueDraftSave('one', '', { attachments: [saved.attachments[1]!] }, queued.id)
    await f.provider.flushDraftSaves('one')
    const removed = await f.provider.readGmailDraft('one', queued.id)
    expect(removed.syncState).toBeUndefined(); expect(removed.attachments).toHaveLength(1)
    expect(removed.attachments[0]?.name).toBe(extraFile.name)
    expect((await f.provider.readGmailDraft('one', 'original', true)).id).toBe(removed.id)
    expect(f.remote.size).toBe(1)
  } finally { await f.close() }
})

it('retains the original and pending file bytes when replacement readback differs', async () => {
  const f = await setup('wrong-bytes')
  try {
    const queued = f.provider.enqueueDraftSave('one', '', { attachments: [...f.source.attachments, extraFile] }, 'original', undefined, f.source)
    await f.provider.flushDraftSaves('one')
    expect(f.remote.has('original')).toBe(true); expect(f.deleted).toEqual([])
    expect(f.record(queued.id)?.draft.attachments).toContainEqual(expect.objectContaining({ name: extraFile.name, contentBase64: extraFile.contentBase64 }))
    expect((await f.provider.readGmailDraft('one', queued.id)).syncState).toBeDefined()
  } finally { await f.close() }
})

it('preserves newer typing accepted during replacement creation', async () => {
  const f = await setup('gate')
  try {
    const queued = f.provider.enqueueDraftSave('one', '', { attachments: [...f.source.attachments, extraFile] }, 'original', undefined, f.source)
    const work = f.provider.flushDraftSaves('one')
    await expect.poll(() => f.creates).toBe(1)
    f.provider.enqueueDraftSave('one', '', { bodyMarkdown: 'Newer user text' }, queued.id)
    f.release(); await work; await f.provider.flushDraftSaves('one')
    const saved = await f.provider.readGmailDraft('one', queued.id)
    expect(saved.syncState).toBeUndefined(); expect(saved.bodyMarkdown).toBe('Newer user text'); expect(saved.attachments).toHaveLength(2)
  } finally { await f.close() }
})

it('cancels both physical drafts when Discard arrives during replacement', async () => {
  const f = await setup('gate')
  try {
    const queued = f.provider.enqueueDraftSave('one', '', { attachments: [...f.source.attachments, extraFile] }, 'original', undefined, f.source)
    const work = f.provider.flushDraftSaves('one'); await expect.poll(() => f.creates).toBe(1)
    await f.provider.discardGmailDraft('one', queued.id); f.release(); await work; await f.provider.flushDraftSaves('one')
    expect(f.remote.size).toBe(0)
    expect(f.record(queued.id)).toMatchObject({ state: 'cancelled', cleanupDone: true })
  } finally { await f.close() }
})
