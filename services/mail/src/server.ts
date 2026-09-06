import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { DemoMailProvider } from './demo-provider.js'
import { renderDraftMarkdown } from './draft-markdown.js'
import { projectDraft } from './draft.js'
import { GmailConnectorProvider } from './gmail-provider.js'
import type { DraftAttachment, GmailConversationAction, GmailMailbox, MailStateFilter } from './model.js'
import { defaultAttachmentCacheDir, defaultOpenPath, openAttachmentFile } from './open-attachment.js'

const provider = new DemoMailProvider()
const allowedOrigin = process.env.DISPATCH_ALLOWED_ORIGIN ?? 'http://127.0.0.1:8410'

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

type GmailProvider = Pick<GmailConnectorProvider, 'accounts' | 'listMessages' | 'listUnifiedMessages' | 'readMessage' | 'listConversations' | 'listUnifiedConversations' | 'readConversation'> & Partial<Pick<GmailConnectorProvider, 'startBackgroundSync' | 'stopBackgroundSync' | 'syncStatus' | 'syncNow' | 'refreshNow' | 'setConversationUnread' | 'searchConversations' | 'listMailboxConversations' | 'listRecipients' | 'mutateConversation' | 'createGmailDraft' | 'updateGmailDraft' | 'readGmailDraft' | 'openGmailDraft' | 'discardGmailDraft' | 'sendGmailDraft' | 'readAttachment'>>

function draftError(error: unknown, fallback: string): { error: string; detail: string } {
  const value = error as { code?: unknown; message?: unknown }
  return {
    error: typeof value?.code === 'string' ? value.code : fallback,
    detail: error instanceof Error ? error.message : String(error),
  }
}

function draftStatus(error: unknown, fallback = 502): number {
  const code = (error as { code?: unknown })?.code
  if (code === 'gmail_draft_not_found') return 404
  if (code === 'gmail_draft_open_unavailable' || code === 'gmail_draft_refresh_unavailable') return 503
  return fallback
}

function draftAttachments(value: unknown): readonly DraftAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const attachment = item as Record<string, unknown>
    if (typeof attachment.name !== 'string' || typeof attachment.mediaType !== 'string') return []
    return [{
      id: typeof attachment.id === 'string' ? attachment.id : undefined,
      name: attachment.name,
      mediaType: attachment.mediaType,
      contentBase64: typeof attachment.contentBase64 === 'string' ? attachment.contentBase64 : undefined,
      sizeLabel: typeof attachment.sizeLabel === 'string' ? attachment.sizeLabel : undefined,
      sourceMessageId: typeof attachment.sourceMessageId === 'string' ? attachment.sourceMessageId : undefined,
    }]
  })
}

function draftObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stateFilter(value: string | null): MailStateFilter | undefined {
  if (value === null || value === 'all') return 'all'
  if (value === 'read' || value === 'unread') return value
  return undefined
}

function mailboxFilter(value: string | null): GmailMailbox | undefined {
  if (value === null || value === 'inbox') return 'inbox'
  if (value === 'sent' || value === 'drafts' || value === 'archive' || value === 'spam' || value === 'trash') return value
  return undefined
}

async function within<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createMailServer(
  gmail: GmailProvider = new GmailConnectorProvider(),
  options: {
    demoEnabled?: boolean
    readinessTimeoutMs?: number
    attachmentCacheDir?: string
    openPath?: (path: string) => Promise<void>
  } = { demoEnabled: process.env.DISPATCH_DEMO_MAIL === '1' },
) {
  const demoEnabled = options.demoEnabled === true
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 3_000
  const attachmentCacheDir = options.attachmentCacheDir ?? defaultAttachmentCacheDir()
  const openPath = options.openPath ?? defaultOpenPath

  async function attachmentPayload(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<unknown> {
    if (accountId && gmail.readAttachment) {
      return gmail.readAttachment(accountId, messageId, attachmentId, filename)
    }
    if (demoEnabled) {
      const attachment = provider.readAttachment(messageId, attachmentId)
      if (!attachment) {
        throw Object.assign(new Error('Demo attachment was not found'), { code: 'attachment_not_found' })
      }
      return attachment
    }
    throw Object.assign(new Error('Gmail attachment read is not available'), { code: 'gmail_attachment_unavailable' })
  }
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') return writeJson(response, 204, {})
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && url.pathname === '/health') {
      return writeJson(response, 200, { service: 'dispatch-mail', status: 'healthy' })
    }
    if (request.method === 'GET' && url.pathname === '/ready') {
      if (demoEnabled) return writeJson(response, 200, { service: 'dispatch-mail', status: 'ready', provider: 'demo' })
      const sync = gmail.syncStatus?.()
      if (sync?.state === 'failed') {
        return writeJson(response, 503, { service: 'dispatch-mail', status: 'not_ready', error: 'gmail_sync_failed', detail: sync.error, sync })
      }
      try {
        const accounts = await within(gmail.accounts(), readinessTimeoutMs, 'Gmail readiness check')
        const refreshedSync = gmail.syncStatus?.()
        if (refreshedSync?.state === 'failed') {
          return writeJson(response, 503, { service: 'dispatch-mail', status: 'not_ready', error: 'gmail_sync_failed', detail: refreshedSync.error, sync: refreshedSync })
        }
        return accounts.length > 0
          ? writeJson(response, 200, { service: 'dispatch-mail', status: 'ready', provider: 'gmail', accountCount: accounts.length })
          : writeJson(response, 503, { service: 'dispatch-mail', status: 'not_ready', error: 'gmail_not_connected' })
      } catch (error) {
        return writeJson(response, 503, { service: 'dispatch-mail', status: 'not_ready', error: 'gmail_connection_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/conversations') {
      const state = stateFilter(url.searchParams.get('state'))
      if (!state) return writeJson(response, 400, { error: 'invalid_state_filter' })
      const mailbox = mailboxFilter(url.searchParams.get('mailbox'))
      if (!mailbox) return writeJson(response, 400, { error: 'invalid_mailbox' })
      const limitValue = Number(url.searchParams.get('limit') ?? 100)
      const cursorValue = Number(url.searchParams.get('cursor') ?? 0)
      if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200 || !Number.isInteger(cursorValue) || cursorValue < 0) {
        return writeJson(response, 400, { error: 'invalid_pagination' })
      }
      const accountId = url.searchParams.get('account')
      const query = url.searchParams.get('q')?.trim() ?? ''
      try {
        const accounts = await gmail.accounts()
        if (accounts.length > 0) {
          const conversations = gmail.listMailboxConversations
            ? await gmail.listMailboxConversations(mailbox, state, accountId ?? undefined, query)
            : query && gmail.searchConversations ? await gmail.searchConversations(query, state, accountId ?? undefined)
              : accountId ? await gmail.listConversations(accountId, state) : await gmail.listUnifiedConversations(state)
          const page = conversations.slice(cursorValue, cursorValue + limitValue)
          const nextCursor = cursorValue + page.length < conversations.length ? String(cursorValue + page.length) : null
          return writeJson(response, 200, { source: 'gmail', scope: accountId ? 'account' : 'unified', state, mailbox, coverage: 'indexed', conversations: page, nextCursor, total: conversations.length, sync: gmail.syncStatus?.() })
        }
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_conversation_list_failed', detail: error instanceof Error ? error.message : String(error) })
      }
      return demoEnabled
        ? (() => {
            const conversations = provider.listConversations(state)
            const page = conversations.slice(cursorValue, cursorValue + limitValue)
            const nextCursor = cursorValue + page.length < conversations.length ? String(cursorValue + page.length) : null
            return writeJson(response, 200, { source: 'demo', scope: 'demo', state, conversations: page, nextCursor, total: conversations.length })
          })()
        : writeJson(response, 503, { error: 'gmail_not_connected', detail: 'No Gmail connector accounts are available.' })
    }
    const conversationMatch = /^\/v1\/conversations\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && conversationMatch?.[1]) {
      const threadId = decodeURIComponent(conversationMatch[1])
      const accountId = url.searchParams.get('account')
      if (accountId) {
        try {
          return writeJson(response, 200, { conversation: await gmail.readConversation(accountId, threadId) })
        } catch (error) {
          return writeJson(response, 502, { error: 'gmail_conversation_read_failed', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      if (!demoEnabled) return writeJson(response, 400, { error: 'gmail_account_required' })
      const conversation = provider.readConversation(threadId)
      return conversation ? writeJson(response, 200, { conversation }) : writeJson(response, 404, { error: 'conversation_not_found' })
    }
    const readStateMatch = /^\/v1\/conversations\/([^/]+)\/read-state$/.exec(url.pathname)
    if (request.method === 'POST' && readStateMatch?.[1]) {
      if (!gmail.setConversationUnread) return writeJson(response, 501, { error: 'gmail_read_state_not_configured' })
      try {
        const payload = await readJson(request) as { accountId?: unknown; unread?: unknown; messageIds?: unknown }
        if (typeof payload.accountId !== 'string' || typeof payload.unread !== 'boolean') return writeJson(response, 400, { error: 'accountId_and_unread_required' })
        const result = await gmail.setConversationUnread(payload.accountId, decodeURIComponent(readStateMatch[1]), payload.unread, Array.isArray(payload.messageIds) ? payload.messageIds.filter((id): id is string => typeof id === 'string') : undefined)
        return writeJson(response, 200, { accepted: true, result })
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_read_state_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    const actionMatch = /^\/v1\/conversations\/([^/]+)\/actions$/.exec(url.pathname)
    if (request.method === 'POST' && actionMatch?.[1]) {
      if (!gmail.mutateConversation) return writeJson(response, 501, { error: 'gmail_actions_not_configured' })
      try {
        const payload = await readJson(request) as { accountId?: unknown; messageIds?: unknown; action?: unknown }
        const action = payload.action as GmailConversationAction
        if (typeof payload.accountId !== 'string' || !Array.isArray(payload.messageIds) || !payload.messageIds.every((id) => typeof id === 'string') || !['archive', 'spam', 'trash', 'inbox'].includes(action)) return writeJson(response, 400, { error: 'invalid_gmail_action' })
        await gmail.mutateConversation(payload.accountId, decodeURIComponent(actionMatch[1]), payload.messageIds as string[], action)
        return writeJson(response, 202, { accepted: true, action })
      } catch (error) { return writeJson(response, 502, { error: 'gmail_action_failed', detail: error instanceof Error ? error.message : String(error) }) }
    }
    if (request.method === 'GET' && url.pathname === '/v1/messages') {
      const accountId = url.searchParams.get('account')
      try {
        const accounts = await gmail.accounts()
        if (accounts.length > 0) {
          const messages = accountId ? await gmail.listMessages(accountId) : await gmail.listUnifiedMessages()
          return writeJson(response, 200, { source: 'gmail', scope: accountId ? 'account' : 'unified', messages })
        }
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_list_failed', detail: error instanceof Error ? error.message : String(error) })
      }
      return demoEnabled
        ? writeJson(response, 200, { source: 'demo', messages: provider.listMessages() })
        : writeJson(response, 503, { error: 'gmail_not_connected', detail: 'No Gmail connector accounts are available.' })
    }
    if (request.method === 'GET' && url.pathname === '/v1/accounts') {
      try {
        return writeJson(response, 200, { accounts: await gmail.accounts() })
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_accounts_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/recipients') {
      const query = url.searchParams.get('q') ?? ''
      const accountId = url.searchParams.get('account')
      try {
        const accounts = await gmail.accounts()
        if (accounts.length > 0) {
          const recipients = gmail.listRecipients ? await gmail.listRecipients(query, accountId ?? undefined) : []
          return writeJson(response, 200, { recipients })
        }
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_recipients_failed', detail: error instanceof Error ? error.message : String(error) })
      }
      return demoEnabled
        ? writeJson(response, 200, { recipients: provider.listRecipients(query) })
        : writeJson(response, 503, { error: 'gmail_not_connected', detail: 'No Gmail connector accounts are available.' })
    }
    if (request.method === 'GET' && url.pathname === '/v1/sync/status') {
      const status = gmail.syncStatus?.()
      return status
        ? writeJson(response, 200, { sync: status })
        : writeJson(response, 501, { error: 'gmail_sync_not_configured' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/sync') {
      if (!gmail.refreshNow && !gmail.syncNow) return writeJson(response, 501, { error: 'gmail_sync_not_configured' })
      try {
        if (gmail.refreshNow) await within(gmail.refreshNow(), 45_000, 'Gmail refresh')
        else await within(gmail.syncNow!(), 45_000, 'Gmail refresh')
        return writeJson(response, 200, { sync: gmail.syncStatus?.() })
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_refresh_failed', detail: error instanceof Error ? error.message : String(error), sync: gmail.syncStatus?.() })
      }
    }
    const messageMatch = /^\/v1\/messages\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && messageMatch?.[1]) {
      const accountId = url.searchParams.get('account')
      if (accountId) {
        try {
          return writeJson(response, 200, { message: await gmail.readMessage(accountId, decodeURIComponent(messageMatch[1])) })
        } catch (error) {
          return writeJson(response, 502, { error: 'gmail_read_failed', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      const message = provider.readMessage(decodeURIComponent(messageMatch[1]))
      return message ? writeJson(response, 200, { message }) : writeJson(response, 404, { error: 'message_not_found' })
    }
    const attachmentOpenMatch = /^\/v1\/messages\/([^/]+)\/attachments\/([^/]+)\/open$/.exec(url.pathname)
    if (request.method === 'POST' && attachmentOpenMatch?.[1] && attachmentOpenMatch[2]) {
      const accountId = url.searchParams.get('account') ?? ''
      const filename = url.searchParams.get('filename') ?? ''
      const messageId = decodeURIComponent(attachmentOpenMatch[1])
      const attachmentId = decodeURIComponent(attachmentOpenMatch[2])
      try {
        const payload = await attachmentPayload(accountId, messageId, attachmentId, filename)
        const opened = await openAttachmentFile({
          messageId,
          attachmentId,
          filename,
          payload,
          cacheDir: attachmentCacheDir,
          openPath,
        })
        return writeJson(response, 200, { opened: true, filename: opened.filename, path: opened.path })
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (code === 'attachment_not_found') return writeJson(response, 404, { error: 'attachment_not_found', detail: error instanceof Error ? error.message : String(error) })
        if (code === 'gmail_attachment_unavailable') return writeJson(response, 503, { error: 'gmail_attachment_unavailable', detail: error instanceof Error ? error.message : String(error) })
        return writeJson(response, 502, { error: 'gmail_attachment_open_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    const attachmentMatch = /^\/v1\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && attachmentMatch?.[1] && attachmentMatch[2]) {
      try {
        const accountId = url.searchParams.get('account') ?? ''
        const filename = url.searchParams.get('filename') ?? ''
        return writeJson(response, 200, { attachment: await attachmentPayload(accountId, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2]), filename) })
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (code === 'attachment_not_found') return writeJson(response, 404, { error: 'attachment_not_found', detail: error instanceof Error ? error.message : String(error) })
        if (code === 'gmail_attachment_unavailable') return writeJson(response, 503, { error: 'gmail_attachment_unavailable', detail: error instanceof Error ? error.message : String(error) })
        return writeJson(response, 502, { error: 'gmail_attachment_read_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/drafts/preview') {
      try {
        const body = draftObject(await readJson(request))
        if (!body) return writeJson(response, 400, { error: 'invalid_json' })
        return writeJson(response, 200, { bodyHtml: renderDraftMarkdown(String(body.bodyMarkdown ?? '')) })
      } catch {
        return writeJson(response, 400, { error: 'invalid_json' })
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/drafts/open') {
      let body: Record<string, unknown> | undefined
      try {
        body = draftObject(await readJson(request))
      } catch {
        return writeJson(response, 400, { error: 'invalid_json' })
      }
      if (!body) return writeJson(response, 400, { error: 'invalid_json' })
      if (typeof body.accountId !== 'string' || typeof body.messageId !== 'string') {
        return writeJson(response, 400, { error: 'accountId_and_messageId_required' })
      }
      if (!gmail.openGmailDraft) return writeJson(response, 501, { error: 'gmail_draft_open_not_configured' })
      try {
        return writeJson(response, 201, { draft: await gmail.openGmailDraft(body.accountId, body.messageId) })
      } catch (error) {
        return writeJson(response, draftStatus(error), draftError(error, 'gmail_draft_update_failed'))
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/drafts') {
      let body: Record<string, unknown> | undefined
      try {
        body = draftObject(await readJson(request))
      } catch {
        return writeJson(response, 400, { error: 'invalid_json' })
      }
      if (!body) return writeJson(response, 400, { error: 'invalid_json' })
      const messageId = 'messageId' in body ? String(body.messageId) : ''
      if (typeof body.accountId === 'string' && gmail.createGmailDraft) {
        try {
          const draft = await gmail.createGmailDraft(body.accountId, messageId, String(body.to ?? ''), String(body.cc ?? ''), String(body.bcc ?? ''), String(body.subject ?? ''), String(body.bodyMarkdown ?? body.bodyText ?? ''), draftAttachments(body.attachments))
          return writeJson(response, 201, { draft })
        } catch (error) {
          return writeJson(response, 502, draftError(error, 'gmail_draft_update_failed'))
        }
      }
      if (!demoEnabled) return writeJson(response, 400, { error: 'gmail_draft_fields_required' })
      const draft = 'bodyMarkdown' in body || 'bodyText' in body
        ? provider.createDraft(messageId, { bodyMarkdown: String(body.bodyMarkdown ?? body.bodyText ?? '') })
        : provider.createDraft(messageId)
      return draft ? writeJson(response, 201, { draft }) : writeJson(response, 404, { error: 'message_not_found' })
    }
    const draftMatch = /^\/v1\/drafts\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && draftMatch?.[1]) {
      const draftId = decodeURIComponent(draftMatch[1])
      const accountId = url.searchParams.get('account')
      if (!accountId) {
        const draft = provider.readDraft(draftId)
        return draft ? writeJson(response, 200, { draft }) : writeJson(response, 404, { error: 'draft_not_found' })
      }
      if (!gmail.readGmailDraft) return writeJson(response, 501, { error: 'gmail_draft_read_not_configured' })
      try {
        return writeJson(response, 200, { draft: await gmail.readGmailDraft(accountId, draftId) })
      } catch (error) {
        return writeJson(response, draftStatus(error), draftError(error, 'gmail_draft_refresh_failed'))
      }
    }
    if (request.method === 'PUT' && draftMatch?.[1] && gmail.updateGmailDraft) {
      try {
        const body = draftObject(await readJson(request))
        if (!body) return writeJson(response, 400, { error: 'invalid_json' })
        const draft = await gmail.updateGmailDraft(projectDraft({ id: decodeURIComponent(draftMatch[1]), inReplyToMessageId: String(body.messageId ?? ''), to: [{ name: String(body.to ?? ''), address: String(body.to ?? ''), initials: '@' }], cc: String(body.cc ?? ''), bcc: String(body.bcc ?? ''), subject: String(body.subject ?? ''), bodyMarkdown: String(body.bodyMarkdown ?? body.bodyText ?? ''), attachments: draftAttachments(body.attachments), accountId: String(body.accountId ?? '') }))
        return writeJson(response, 200, { draft })
      } catch (error) { return writeJson(response, 502, draftError(error, 'gmail_draft_update_failed')) }
    }
    if (request.method === 'POST' && draftMatch?.[1] && url.searchParams.get('action') === 'discard') {
      const draftId = decodeURIComponent(draftMatch[1])
      const accountId = url.searchParams.get('account')
      if (accountId) {
        if (!gmail.discardGmailDraft) return writeJson(response, 501, { error: 'gmail_draft_discard_not_configured' })
        try {
          await gmail.discardGmailDraft(accountId, draftId)
          return writeJson(response, 200, { discarded: true })
        } catch (error) {
          return writeJson(response, 502, draftError(error, 'gmail_draft_update_failed'))
        }
      }
      if (!demoEnabled) return writeJson(response, 400, { error: 'gmail_account_required' })
      return provider.discardDraft(draftId)
        ? writeJson(response, 200, { discarded: true })
        : writeJson(response, 404, { error: 'draft_not_found' })
    }
    if (request.method === 'POST' && draftMatch?.[1] && url.searchParams.get('action') === 'send' && gmail.sendGmailDraft) {
      try { return writeJson(response, 200, { delivery: await gmail.sendGmailDraft(String(url.searchParams.get('account') ?? ''), decodeURIComponent(draftMatch[1])) }) }
      catch (error) { return writeJson(response, 502, { error: 'gmail_draft_send_failed', detail: error instanceof Error ? error.message : String(error) }) }
    }
    return writeJson(response, 404, { error: 'not_found' })
  })
  gmail.startBackgroundSync?.()
  server.on('close', () => gmail.stopBackgroundSync?.())
  return server
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  const port = Number(process.env.DISPATCH_MAIL_PORT ?? 8411)
  createMailServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`dispatch-mail ready on http://127.0.0.1:${port}\n`)
  })
}
