import type { ProvidedFile } from './codex-file-upload.js'
import type { GmailDraftWrite } from './gmail-inventory.js'

/**
 * Arguments the Gmail connector's create_draft / update_draft schema accepts.
 * The schema is strict: unknown keys (an earlier `text_plain`, a top-level
 * `attachments`) fail argument binding before the draft is touched. Text and
 * HTML travel as a multipart/alternative payload; attachments wrap it in
 * multipart/mixed as base64url parts. Empty cc/bcc and a missing reply id are
 * omitted rather than sent as '' or null.
 */
export function draftArguments(payload: Record<string, unknown>): Record<string, unknown> {
  const html = String(payload.bodyHtml ?? '')
  const inlineContentIds = new Set([...html.matchAll(/cid:([^"'>\s]+)/gi)].map(match => match[1]))
  const textBody = String(payload.bodyMarkdown ?? payload.bodyText ?? '')
  const alternative = {
    mime_type: 'multipart/alternative',
    parts: [
      { mime_type: 'text/plain', charset: 'UTF-8', body: { content: textBody }, ...typeof payload.draftContentId === 'string' ? { content_id: payload.draftContentId } : {} },
      { mime_type: 'text/html', charset: 'UTF-8', body: { content: html } },
    ],
  }
  const attachments = (Array.isArray(payload.attachments) ? payload.attachments : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      mime_type: String(item.mime_type ?? item.mediaType ?? 'application/octet-stream'),
      filename: String(item.filename ?? item.name ?? 'attachment'),
      content_disposition: item.contentId && inlineContentIds.has(String(item.contentId)) ? 'inline' : 'attachment',
      ...item.contentId ? { content_id: String(item.contentId) } : {},
      body: { base64_url_content: base64Url(String(item.data ?? item.contentBase64 ?? '')) },
    }))
  const args: Record<string, unknown> = {
    to: String(payload.to ?? ''),
    subject: String(payload.subject ?? ''),
    payload: attachments.length > 0 ? { mime_type: 'multipart/mixed', parts: [alternative, ...attachments] } : alternative,
    response_fields: ['id', 'message'],
  }
  for (const key of ['cc', 'bcc'] as const) {
    const value = String(payload[key] ?? '').trim()
    if (value) args[key] = value
  }
  if (typeof payload.replyMessageId === 'string' && payload.replyMessageId) args.reply_message_id = payload.replyMessageId
  return args
}

function base64Url(value: string): string {
  return value.replaceAll(/\s/g, '').replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '')
}


/** Select the installed connector contract before any write; never retry with another format. */
export function draftArgumentsForConnector(payload: Record<string, unknown>, capability: GmailDraftWrite | undefined, operation: 'create' | 'update', uploaded: readonly ProvidedFile[] = []) {
  if (!capability) return draftArguments(payload)
  const files = Array.isArray(payload.attachments) ? payload.attachments : []
  if (operation === 'update' && !capability.attachmentFiles && (payload.attachmentsChanged === true || files.length > 0)) {
    throw Object.assign(new Error('gmail_attachment_unsupported: The installed Gmail connector cannot edit a draft with attachments. Your files and edits are kept; nothing was sent.'), { code: 'gmail_invalid_arguments' })
  }
  const html = String(payload.bodyHtml ?? '')
  // The modern API cannot set MIME Content-ID. A non-rendered HTML marker provides
  // the same exact-draft recovery identity after an uncertain create.
  const marker = typeof payload.draftContentId === 'string' ? payload.draftContentId : ''
  if (marker && !/^[a-zA-Z0-9@._-]+$/.test(marker)) throw Object.assign(new Error('Invalid draft recovery marker'), { code: 'gmail_invalid_arguments' })
  const args: Record<string, unknown> = {
    to: String(payload.to ?? ''), subject: String(payload.subject ?? ''),
    body: String(payload.bodyMarkdown ?? payload.bodyText ?? ''),
    html_body: html + (marker ? `<!--dispatch-draft:${marker}-->` : ''),
    cc: String(payload.cc ?? ''), bcc: String(payload.bcc ?? ''),
  }
  if (operation === 'create' && typeof payload.replyMessageId === 'string' && payload.replyMessageId) args.reply_message_id = payload.replyMessageId
  // App Server's direct MCP route does not resolve openai/fileParams paths to
  // hosted file objects. Never send raw paths/base64 or silently drop files.
  if (files.length && (operation === 'create' || capability.attachmentFiles)) {
    if (!capability.attachmentFiles || uploaded.length !== files.length) throw Object.assign(new Error('Gmail attachment upload is incomplete. Your files and edits are kept; nothing was sent.'), { code: 'gmail_invalid_arguments' })
    args.attachment_files = uploaded
  }
  return args
}
