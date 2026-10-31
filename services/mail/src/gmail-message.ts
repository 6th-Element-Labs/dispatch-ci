import { decodeRawMessage, decodeText, parseMime, type MimePart } from './mime-part.js'

type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
const text = (value: unknown): string => typeof value === 'string' ? value : ''

function recipients(value: unknown, field: string): string {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`Gmail message ${field} must be an array of recipient strings`)
  return value.join(', ')
}

/** Adapt the connector's normalized email to the mail owner's existing MIME projection boundary. */
export function normalizeGmailMessage(value: RecordValue, includeBody = true): RecordValue {
  if (object(value.payload) || !('from_' in value || 'labels' in value || 'email_ts' in value)) return value
  if (!text(value.from_)) throw new Error('Gmail message is missing its From header')
  if (!Array.isArray(value.labels) || !value.labels.every(label => typeof label === 'string')) throw new Error('Gmail message labels must be an array of strings')
  for (const field of ['attachments', 'inline_images']) {
    if (value[field] != null && !Array.isArray(value[field])) throw new Error(`Gmail message ${field} must be an array`)
  }
  const files = [...(Array.isArray(value.attachments) ? value.attachments : []), ...(Array.isArray(value.inline_images) ? value.inline_images : [])]
    .map(item => { const file = object(item); if (!file) throw new Error('Invalid Gmail attachment metadata'); return file })
  const used = new Set<RecordValue>()
  const mimeHeaders = [
    { name: 'From', value: text(value.from_) }, { name: 'Subject', value: text(value.subject) },
    ...(['to', 'cc', 'bcc'] as const).map(field => ({ name: field, value: recipients(value[field], field) })),
  ]
  const raw = text(value.raw_mime_base64url)
  const source = raw ? decodeRawMessage(raw) : text(value.raw_mime) ? Buffer.from(text(value.raw_mime), 'utf8') : undefined
  function mimePart(part: MimePart, id = ''): RecordValue {
    const cid = (part.headers.get('content-id') ?? '').replace(/^<|>$/g, '')
    const file = files.find(file => !used.has(file) && cid && text(file.content_id).replace(/^<|>$/g, '') === cid)
      ?? files.find(file => !used.has(file) && text(file.filename) === part.filename && text(file.mime_type) === part.mimeType)
      ?? files.find(file => !used.has(file) && !part.filename && !['text/plain', 'text/html'].includes(part.mimeType) && text(file.mime_type) === part.mimeType)
    if (file) used.add(file)
    return { part_id: id, mime_type: part.mimeType, filename: part.filename || text(file?.filename),
      headers: [...part.headers].map(([name, value]) => ({ name, value })),
      body: { size: part.body.length, attachment_id: text(file?.attachment_id) || undefined,
        ...(!part.children.length && !part.filename && !file && ['text/plain', 'text/html'].includes(part.mimeType)
          ? { content: decodeText(part) } : part.body.length === 0 ? { content: '' } : {}) },
      parts: part.children.map((child, index) => mimePart(child, id ? `${id}.${index}` : String(index))),
    }
  }
  let payload: RecordValue
  if (source) {
    payload = mimePart(parseMime(source))
    const existing = Array.isArray(payload.headers) ? payload.headers : []
    const replaced = new Set(mimeHeaders.map(header => header.name.toLowerCase()))
    payload.headers = [...existing.filter(header => !replaced.has(text(object(header)?.name).toLowerCase())), ...mimeHeaders]
  } else {
    if (includeBody && typeof value.body !== 'string') throw new Error('Gmail message is missing its body')
    payload = { mime_type: 'multipart/mixed', headers: mimeHeaders, parts: [
      { part_id: '0', mime_type: 'text/plain', filename: '', body: { content: text(value.body) } },
      ...files.map((file, index) => {
        if (!text(file.filename) || !text(file.attachment_id)) throw new Error('Gmail attachment is missing filename or attachment_id')
        return { part_id: String(index + 1), mime_type: text(file.mime_type), filename: text(file.filename),
          headers: text(file.content_id) ? [{ name: 'Content-ID', value: text(file.content_id) }] : [],
          body: { attachment_id: text(file.attachment_id), size: file.size_bytes } }
      }),
    ] }
  }
  // Connector email_ts is a UTC ISO timestamp whose serialized form omits Z.
  const timestamp = text(value.email_ts)
  const internalDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(timestamp) ? `${timestamp}Z` : timestamp
  return { ...value, label_ids: value.labels, internal_date: internalDate, payload }
}

export function rawGmailMessage(value: RecordValue): string {
  return text(value.raw) || text(value.raw_mime_base64url)
    || (text(value.raw_mime) ? Buffer.from(text(value.raw_mime), 'utf8').toString('base64url') : '')
}
