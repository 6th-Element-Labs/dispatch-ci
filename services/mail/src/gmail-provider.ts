import { groupConversations, projectConversation } from './conversation.js'
import type { AttachmentProjection, ConversationProjection, ConversationSummary, MailAddress, MailStateFilter, MessageProjection, MessageSummary } from './model.js'

export interface GmailAccountProjection {
  readonly id: string
  readonly connectorId: string
  readonly name: string
  readonly email: string
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function structured(value: unknown): UnknownRecord {
  const root = record(value)
  return record(root?.structuredContent) ?? {}
}

function headers(payload: UnknownRecord): Map<string, string> {
  const result = new Map<string, string>()
  for (const item of array(payload.headers)) {
    const header = record(item)
    const name = text(header?.name).toLowerCase()
    if (name) result.set(name, text(header?.value))
  }
  return result
}

function sender(value: string): MailAddress {
  const match = /^\s*([^<]*)<([^>]+)>\s*$/.exec(value)
  const name = (match?.[1]?.trim() || match?.[2] || value).trim()
  const address = (match?.[2] || value).trim()
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '@'
  return { name, address, initials }
}

function parts(payload: UnknownRecord): readonly UnknownRecord[] {
  const children = array(payload.parts).flatMap((part) => {
    const value = record(part)
    return value ? [value, ...parts(value)] : []
  })
  return children
}

function body(payload: UnknownRecord): MessageProjection['body'] {
  const all = [payload, ...parts(payload)]
  const html = all.find((part) => text(part.mime_type).toLowerCase() === 'text/html')
  const plain = all.find((part) => text(part.mime_type).toLowerCase() === 'text/plain')
  const htmlContent = text(record(html?.body)?.content)
  if (htmlContent) return { kind: 'sanitized-html', content: htmlContent }
  const plainContent = text(record(plain?.body)?.content) || text(record(payload.body)?.content)
  return { kind: 'plain-text', content: plainContent || 'This message has no readable text body.' }
}

function attachments(payload: UnknownRecord): readonly AttachmentProjection[] {
  return parts(payload).flatMap((part) => {
    const filename = text(part.filename)
    if (!filename) return []
    const partBody = record(part.body)
    const size = typeof partBody?.size === 'number' ? partBody.size : 0
    return [{
      id: text(part.part_id) || filename,
      name: filename,
      mediaType: text(part.mime_type) || 'application/octet-stream',
      sizeLabel: size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1000))} KB`,
    }]
  })
}

function received(value: string): { iso: string; label: string; fullLabel: string } {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value)
  if (Number.isNaN(date.getTime())) return { iso: value, label: '', fullLabel: '' }
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date),
    fullLabel: new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(date),
  }
}

export function projectGmailMessage(value: unknown, includeBody: boolean, account?: GmailAccountProjection): MessageProjection {
  const message = structured(value)
  const payload = record(message.payload) ?? {}
  const messageHeaders = headers(payload)
  const receivedAt = received(text(message.internal_date) || messageHeaders.get('date') || '')
  const projection: MessageProjection = {
    id: text(message.id),
    threadId: text(message.thread_id),
    sender: sender(messageHeaders.get('from') || 'Unknown sender'),
    subject: messageHeaders.get('subject') || '(No subject)',
    receivedAt: receivedAt.iso,
    receivedLabel: receivedAt.label,
    receivedFullLabel: receivedAt.fullLabel,
    preview: text(message.snippet),
    unread: array(message.label_ids).includes('UNREAD'),
    body: includeBody ? body(payload) : { kind: 'plain-text', content: '' },
    attachments: includeBody ? attachments(payload) : [],
    source: 'gmail',
    accountId: account?.id,
    accountLabel: account?.email || account?.name,
  }
  if (!projection.id || !projection.threadId) throw new Error('Gmail response is missing stable message identity')
  return projection
}

export function projectGmailSearchEmail(value: unknown, account: GmailAccountProjection): MessageSummary {
  const email = record(value) ?? {}
  const receivedAt = received(text(email.email_ts))
  const id = text(email.id)
  const threadId = text(email.thread_id)
  if (!id || !threadId) throw new Error('Gmail search result is missing stable message identity')
  return {
    id,
    threadId,
    sender: sender(text(email.from_) || 'Unknown sender'),
    subject: text(email.subject) || '(No subject)',
    receivedAt: receivedAt.iso,
    receivedLabel: receivedAt.label,
    receivedFullLabel: receivedAt.fullLabel,
    preview: text(email.snippet),
    unread: array(email.labels).includes('UNREAD'),
    accountId: account.id,
    accountLabel: account.email || account.name,
  }
}

export class GmailConnectorProvider {
  readonly #agentBase: string

  constructor(agentBase = process.env.DISPATCH_AGENT_URL ?? 'http://127.0.0.1:8412') {
    this.#agentBase = agentBase
  }

  async accounts(): Promise<readonly GmailAccountProjection[]> {
    const response = await fetch(`${this.#agentBase}/v1/connectors/gmail`)
    const value = await response.json() as unknown
    if (!response.ok) throw new Error(`Gmail inventory failed (${response.status})`)
    const inventory = record(value)
    return array(inventory?.accounts).flatMap((account) => {
      const item = record(account)
      const id = text(item?.linkId)
      if (!id) return []
      return [{ id, connectorId: text(item?.connectorId), name: text(item?.name) || 'Gmail', email: text(item?.email) }]
    })
  }

  async listMessages(accountId: string, maxResults = 10): Promise<readonly MessageSummary[]> {
    const account = await this.#account(accountId)
    return this.#listAccountMessages(account, maxResults, 'all')
  }

  async listUnifiedMessages(maxResultsPerAccount = 10): Promise<readonly MessageSummary[]> {
    const accounts = await this.accounts()
    const lists = await Promise.all(accounts.map((account) => this.#listAccountMessages(account, maxResultsPerAccount, 'all')))
    return lists
      .flat()
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
  }

  async listConversations(accountId: string, state: MailStateFilter, maxResults = 20): Promise<readonly ConversationSummary[]> {
    const account = await this.#account(accountId)
    return groupConversations(await this.#listAccountMessages(account, maxResults, state), state)
  }

  async listUnifiedConversations(state: MailStateFilter, maxResultsPerAccount = 20): Promise<readonly ConversationSummary[]> {
    const accounts = await this.accounts()
    const lists = await Promise.all(accounts.map((account) => this.#listAccountMessages(account, maxResultsPerAccount, state)))
    return groupConversations(lists.flat(), state)
  }

  async #listAccountMessages(account: GmailAccountProjection, maxResults: number, state: MailStateFilter): Promise<readonly MessageSummary[]> {
    const stateQuery = state === 'unread' ? ' is:unread' : state === 'read' ? ' is:read' : ''
    const search = await this.#post('/v1/connectors/gmail/search-messages', {
      linkId: account.id, query: `in:inbox -in:spam -in:trash${stateQuery}`, maxResults,
    })
    return array(structured(search).emails).map((email) => projectGmailSearchEmail(email, account))
  }

  async readMessage(accountId: string, messageId: string): Promise<MessageProjection> {
    const account = await this.#account(accountId)
    const value = await this.#post('/v1/connectors/gmail/read', { linkId: accountId, messageId, format: 'full' })
    return projectGmailMessage(value, true, account)
  }

  async readConversation(accountId: string, threadId: string): Promise<ConversationProjection> {
    const account = await this.#account(accountId)
    const value = await this.#post('/v1/connectors/gmail/read-thread', { linkId: accountId, threadId, maxMessages: 100 })
    const thread = structured(value)
    const messages = array(thread.messages).map((message) => projectGmailMessage({ structuredContent: message }, true, account))
    if (messages.length === 0) throw new Error('Gmail thread contains no readable messages')
    return projectConversation(messages, 'gmail')
  }

  async #account(accountId: string): Promise<GmailAccountProjection> {
    const account = (await this.accounts()).find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('Unknown Gmail account')
    return account
  }

  async #post(path: string, bodyValue: UnknownRecord): Promise<unknown> {
    const response = await fetch(`${this.#agentBase}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyValue),
    })
    const value = await response.json() as unknown
    if (!response.ok) throw new Error(`Gmail connector request failed (${response.status}): ${JSON.stringify(value)}`)
    return value
  }
}
