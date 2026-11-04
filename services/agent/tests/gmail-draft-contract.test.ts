import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { createAgentServer } from '../src/server.js'
import { draftArgumentsForConnector } from '../src/gmail-draft-arguments.js'
import { assertGmailCompatibility } from '../src/gmail-contract.js'
import { readGmailInventory } from '../src/gmail-inventory.js'

// Installed native Gmail input schemas captured 2026-11-04, with descriptive
// account metadata removed. Unknown arguments fail binding in the connector.
const schemas = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/gmail-draft-inputs.json', import.meta.url)), 'utf8'))
const tools = Object.fromEntries(Object.entries(schemas).map(([name, inputSchema]) => [name, {
  inputSchema, _meta: { connector_name: 'Gmail', link_id: 'one', ...(name === 'gmail.create_draft' ? { 'openai/fileParams': ['body_file', 'attachment_files'] } : {}) },
}]))
const nativeInventory = { data: [{ name: 'codex_apps', tools }] }
const servers: ReturnType<typeof createAgentServer>[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))) })

async function start(fail = false, inventory = nativeInventory) {
  const request = vi.fn(async (method: string, raw?: unknown): Promise<unknown> => {
    if (method === 'mcpServerStatus/list') return inventory
    if (method === 'thread/start') return { thread: { id: 'connector' } }
    if (method === 'mcpServer/tool/call') {
      const params = raw as { tool: string; arguments: Record<string, unknown> }
      const schema = schemas[params.tool]
      expect(schema).toBeDefined()
      expect(Object.keys(params.arguments).filter(key => !(key in schema.properties))).toEqual([])
      for (const required of schema.required) expect(params.arguments[required]).toBeDefined()
      if (fail) throw new Error('connector unavailable')
      return { structuredContent: { draft_id: 'draft', message_id: 'message', thread_id: 'mail-thread' } }
    }
    return {}
  })
  const uploadFiles = vi.fn(async (files: readonly Record<string, unknown>[]) => { if (fail) throw new Error('Temporary upload failure'); return files.map((_, index) => ({ file_id: `file_${index}`, download_url: `https://files.example.com/${index}`, file_name: String(files[index]!.filename) })) })
  const server = createAgentServer({ request, ready: async () => {}, lastError: () => null, subscribe: () => () => {}, respond: () => {}, close: () => {} }, { uploadFiles })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (kind: string, input: Record<string, unknown>) => fetch(`${base}/v1/connectors/gmail/drafts/${kind}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkId: 'one', ...input }),
  })
  return { request, post, uploadFiles }
}
const body = { to: 'test@example.com', cc: '', bcc: '', subject: 'Reply', bodyMarkdown: '**Reply**', bodyHtml: '<p><b>Reply</b></p>', replyMessageId: 'original-message' }

it('detects create and update capabilities independently from native schemas', () => {
  expect(readGmailInventory(nativeInventory).draftWrites).toEqual({
    create: { htmlBody: true, attachmentFiles: true }, update: { htmlBody: true, attachmentFiles: false },
  })
})

it('creates and updates a threaded formatted reply without any obsolete arguments', async () => {
  const { post, request } = await start()
  expect((await post('create', { ...body, draftContentId: 'dispatch-stable@draft.dispatch.local' })).status).toBe(200)
  expect((await post('update', { ...body, draftId: 'draft', attachments: [], attachmentsChanged: false })).status).toBe(200)
  const calls = request.mock.calls.filter(([method]) => method === 'mcpServer/tool/call').map(([, params]) => params as { arguments: Record<string, unknown> })
  expect(calls[0]!.arguments).toEqual({ link_id: 'one', to: body.to, subject: 'Reply', cc: '', bcc: '', body: '**Reply**',
    html_body: body.bodyHtml + '<!--dispatch-draft:dispatch-stable@draft.dispatch.local-->', reply_message_id: 'original-message' })
  expect(calls[1]!.arguments).toEqual({ link_id: 'one', draft_id: 'draft', to: body.to, subject: 'Reply', cc: '', bcc: '', body: '**Reply**', html_body: body.bodyHtml })
})

it('uploads declared files and passes handles, never local paths or base64, to Gmail', async () => {
  const { post, request, uploadFiles } = await start()
  const attachments = [{ filename: 'review.txt', mime_type: 'text/plain', data: Buffer.from('test attachment').toString('base64') }]
  const response = await post('create', { ...body, attachments })
  expect(response.status).toBe(200)
  expect(uploadFiles).toHaveBeenCalledWith(attachments)
  const call = request.mock.calls.find(([method]) => method === 'mcpServer/tool/call')?.[1] as { arguments: Record<string, unknown> }
  expect(call.arguments.attachment_files).toEqual([{ file_id: 'file_0', download_url: 'https://files.example.com/0', file_name: 'review.txt' }])
})

it('does not issue a Gmail write after a failed upload and reports that preparation can safely retry', async () => {
  const { post, request } = await start(true)
  const response = await post('create', { ...body, attachments: [{ filename: 'review.txt', data: 'aGk=' }] })
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ providerWriteStarted: false })
  expect(request.mock.calls.filter(([method]) => method === 'mcpServer/tool/call')).toHaveLength(0)
})

it('refuses all unsupported edits to attachment drafts before writing', async () => {
  const { post, request } = await start()
  const attachments = [{ filename: 'saved.txt', data: 'aGk=' }]
  expect((await post('update', { ...body, draftId: 'draft', attachments, attachmentsChanged: false })).status).toBe(400)
  expect((await post('update', { draftId: 'draft', preserveContent: true, cc: '', bcc: '' })).status).toBe(200)
  const before = request.mock.calls.filter(([method]) => method === 'mcpServer/tool/call').length
  const changed = await post('update', { ...body, draftId: 'draft', attachments, attachmentsChanged: true })
  expect(changed.status).toBe(400)
  expect(await changed.text()).toContain('cannot edit a draft with attachments')
  expect((await post('update', { ...body, draftId: 'draft', attachments: [], attachmentsChanged: true })).status).toBe(400)
  expect(request.mock.calls.filter(([method]) => method === 'mcpServer/tool/call')).toHaveLength(before)
})

it('rejects malformed recovery markers before a connector write', async () => {
  expect(() => draftArgumentsForConnector({ ...body, draftContentId: 'bad-->marker' }, { htmlBody: true, attachmentFiles: true }, 'create')).toThrow('recovery marker')
})

it.each(['required-field', 'body-type', 'missing-file-metadata', 'file-type'] as const)('rejects a future incompatible Gmail contract (%s)', drift => {
  const inventory = structuredClone(nativeInventory)
  const create = inventory.data[0]!.tools['gmail.create_draft']! as { inputSchema: any; _meta: Record<string, unknown> }
  if (drift === 'required-field') create.inputSchema.required.push('new_required_provider_field')
  if (drift === 'body-type') create.inputSchema.properties.body = { type: 'object' }
  if (drift === 'missing-file-metadata') delete create._meta['openai/fileParams']
  if (drift === 'file-type') create.inputSchema.properties.attachment_files = { type: 'string' }
  const gmail = readGmailInventory(inventory)
  expect(() => assertGmailCompatibility(gmail.contracts!, gmail.tools)).toThrow(/Gmail connector changed/)
})

it('accepts the captured current Gmail draft, attachment and send contracts', () => {
  const gmail = readGmailInventory(nativeInventory)
  expect(() => assertGmailCompatibility(gmail.contracts!, gmail.tools)).not.toThrow()
})

it('refreshes the native contract before the next write and rejects drift before another upload', async () => {
  const inventory = structuredClone(nativeInventory)
  const { post, request, uploadFiles } = await start(false, inventory)
  const input = { ...body, attachments: [{ filename: 'review.txt', data: 'aGk=' }] }
  expect((await post('create', input)).status).toBe(200)
  const schema = inventory.data[0]!.tools['gmail.create_draft']!.inputSchema as { required: string[] }
  schema.required.push('new_provider_requirement')
  const rejected = await post('create', input)
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toMatchObject({ providerWriteStarted: false })
  expect(uploadFiles).toHaveBeenCalledOnce()
  expect(request.mock.calls.filter(([method]) => method === 'mcpServer/tool/call')).toHaveLength(1)
  expect(request.mock.calls.filter(([method]) => method === 'mcpServerStatus/list')).toHaveLength(2)
})
