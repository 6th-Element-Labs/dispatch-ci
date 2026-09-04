import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { DemoMailProvider } from './demo-provider.js'
import { GmailConnectorProvider } from './gmail-provider.js'
import type { MailStateFilter } from './model.js'

const provider = new DemoMailProvider()

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://127.0.0.1:8410',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

type GmailProvider = Pick<GmailConnectorProvider, 'accounts' | 'listMessages' | 'listUnifiedMessages' | 'readMessage' | 'listConversations' | 'listUnifiedConversations' | 'readConversation'> & Partial<Pick<GmailConnectorProvider, 'startBackgroundSync' | 'stopBackgroundSync' | 'syncStatus' | 'syncNow' | 'setConversationUnread' | 'searchConversations' | 'createGmailDraft' | 'updateGmailDraft' | 'sendGmailDraft' | 'readAttachment'>>

function stateFilter(value: string | null): MailStateFilter | undefined {
  if (value === null || value === 'all') return 'all'
  if (value === 'read' || value === 'unread') return value
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
  options: { demoEnabled?: boolean; readinessTimeoutMs?: number } = { demoEnabled: process.env.DISPATCH_DEMO_MAIL === '1' },
) {
  const demoEnabled = options.demoEnabled === true
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 3_000
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
          const conversations = query && gmail.searchConversations
            ? await gmail.searchConversations(query, state, accountId ?? undefined)
            : accountId ? await gmail.listConversations(accountId, state) : await gmail.listUnifiedConversations(state)
          const page = conversations.slice(cursorValue, cursorValue + limitValue)
          const nextCursor = cursorValue + page.length < conversations.length ? String(cursorValue + page.length) : null
          return writeJson(response, 200, { source: 'gmail', scope: accountId ? 'account' : 'unified', state, conversations: page, nextCursor, total: conversations.length, sync: gmail.syncStatus?.() })
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
        const payload = await readJson(request) as { accountId?: unknown; unread?: unknown }
        if (typeof payload.accountId !== 'string' || typeof payload.unread !== 'boolean') return writeJson(response, 400, { error: 'accountId_and_unread_required' })
        const result = await gmail.setConversationUnread(payload.accountId, decodeURIComponent(readStateMatch[1]), payload.unread)
        return writeJson(response, 200, { accepted: true, result })
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_read_state_failed', detail: error instanceof Error ? error.message : String(error) })
      }
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
    if (request.method === 'GET' && url.pathname === '/v1/sync/status') {
      const status = gmail.syncStatus?.()
      return status
        ? writeJson(response, 200, { sync: status })
        : writeJson(response, 501, { error: 'gmail_sync_not_configured' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/sync') {
      if (!gmail.syncNow) return writeJson(response, 501, { error: 'gmail_sync_not_configured' })
      void gmail.syncNow().catch(() => undefined)
      return writeJson(response, 202, { sync: gmail.syncStatus?.() })
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
    const attachmentMatch = /^\/v1\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && attachmentMatch?.[1] && attachmentMatch[2] && gmail.readAttachment) {
      try {
        const accountId = url.searchParams.get('account') ?? ''
        const filename = url.searchParams.get('filename') ?? ''
        return writeJson(response, 200, { attachment: await gmail.readAttachment(accountId, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2]), filename) })
      } catch (error) { return writeJson(response, 502, { error: 'gmail_attachment_read_failed', detail: error instanceof Error ? error.message : String(error) }) }
    }
    if (request.method === 'POST' && url.pathname === '/v1/drafts') {
      try {
        const body = await readJson(request) as Record<string, unknown>
        const messageId = typeof body === 'object' && body !== null && 'messageId' in body ? String(body.messageId) : ''
        if (typeof body.accountId === 'string' && gmail.createGmailDraft) {
          const draft = await gmail.createGmailDraft(body.accountId, messageId, String(body.to ?? ''), String(body.subject ?? ''), String(body.bodyText ?? ''))
          return writeJson(response, 201, { draft })
        }
        if (!demoEnabled) return writeJson(response, 400, { error: 'gmail_draft_fields_required' })
        const draft = provider.createDraft(messageId)
        return draft ? writeJson(response, 201, { draft }) : writeJson(response, 404, { error: 'message_not_found' })
      } catch {
        return writeJson(response, 400, { error: 'invalid_json' })
      }
    }
    const draftMatch = /^\/v1\/drafts\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'PUT' && draftMatch?.[1] && gmail.updateGmailDraft) {
      try {
        const body = await readJson(request) as Record<string, unknown>
        const draft = await gmail.updateGmailDraft({ id: decodeURIComponent(draftMatch[1]), inReplyToMessageId: String(body.messageId ?? ''), to: [{ name: String(body.to ?? ''), address: String(body.to ?? ''), initials: '@' }], subject: String(body.subject ?? ''), bodyText: String(body.bodyText ?? ''), state: 'draft', accountId: String(body.accountId ?? '') })
        return writeJson(response, 200, { draft })
      } catch (error) { return writeJson(response, 502, { error: 'gmail_draft_update_failed', detail: error instanceof Error ? error.message : String(error) }) }
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
