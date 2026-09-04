import { groupConversations, projectConversation } from './conversation.js'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { GmailIndex, type GmailSyncStatus, type IndexedGmailMessage } from './gmail-index.js'
import type { AttachmentProjection, ConversationProjection, ConversationSummary, DraftProjection, MailAddress, MailStateFilter, MessageProjection, MessageSummary } from './model.js'

export interface GmailAccountProjection {
  readonly id: string
  readonly connectorId: string
  readonly name: string
  readonly email: string
}

type UnknownRecord = Record<string, unknown>

interface GmailSyncProgress {
  accountCount: number
  accountsCompleted: number
  pagesFetched: number
  fetchedMessages: number
  currentAccount: string | null
}

function defaultIndexPath(): string {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Dispatch', 'gmail-index.sqlite')
    : resolve(process.cwd(), '.dispatch-data', 'gmail-index.sqlite')
}

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
      id: text(partBody?.attachment_id) || text(part.part_id) || filename,
      name: filename,
      mediaType: text(part.mime_type) || 'application/octet-stream',
      sizeLabel: size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1000))} KB`,
    }]
  })
}

function received(value: string): { iso: string; label: string; fullLabel: string } {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Gmail message has an invalid or missing received timestamp')
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
  if (!Array.isArray(message.label_ids)) throw new Error('Gmail message is missing label_ids')
  if (!messageHeaders.get('from')) throw new Error('Gmail message is missing its From header')
  const receivedAt = received(text(message.internal_date) || messageHeaders.get('date') || '')
  const projection: MessageProjection = {
    id: text(message.id),
    threadId: text(message.thread_id),
    sender: sender(messageHeaders.get('from')!),
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
  if (!Array.isArray(email.labels)) throw new Error('Gmail search result is missing labels')
  if (!text(email.from_)) throw new Error('Gmail search result is missing from_')
  const receivedAt = received(text(email.email_ts))
  const id = text(email.id)
  const threadId = text(email.thread_id)
  if (!id || !threadId) throw new Error('Gmail search result is missing stable message identity')
  return {
    id,
    threadId,
    sender: sender(text(email.from_)),
    subject: text(email.subject) || '(No subject)',
    receivedAt: receivedAt.iso,
    receivedLabel: receivedAt.label,
    receivedFullLabel: receivedAt.fullLabel,
    preview: text(email.snippet),
    unread: array(email.labels).includes('UNREAD'),
    hasAttachment: email.has_attachment === true,
    accountId: account.id,
    accountLabel: account.email || account.name,
  }
}

export class GmailConnectorProvider {
  readonly #agentBase: string
  readonly #index: GmailIndex | undefined
  readonly #syncIntervalMs: number
  #syncPromise: Promise<void> | undefined
  #syncTimer: ReturnType<typeof setInterval> | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #stopped = false
  #syncProgress: GmailSyncProgress = { accountCount: 0, accountsCompleted: 0, pagesFetched: 0, fetchedMessages: 0, currentAccount: null }

  constructor(
    agentBase = process.env.DISPATCH_AGENT_URL ?? 'http://127.0.0.1:8412',
    options: { indexPath?: string | false; syncIntervalMs?: number } = {},
  ) {
    this.#agentBase = agentBase
    const indexPath = options.indexPath === false
      ? undefined
      : options.indexPath ?? process.env.DISPATCH_MAIL_DB ?? defaultIndexPath()
    this.#index = indexPath ? new GmailIndex(indexPath) : undefined
    this.#syncIntervalMs = options.syncIntervalMs ?? 300_000
  }

  startBackgroundSync(): void {
    if (!this.#index || this.#syncTimer) return
    this.#stopped = false
    if (this.#index.count() > 0) this.#scheduleSync()
    this.#syncTimer = setInterval(() => { this.#scheduleSync() }, this.#syncIntervalMs)
    this.#syncTimer.unref()
  }

  stopBackgroundSync(): void {
    this.#stopped = true
    if (this.#syncTimer) clearInterval(this.#syncTimer)
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#syncTimer = undefined
    this.#retryTimer = undefined
    this.#index?.close()
  }

  syncStatus(): (GmailSyncStatus & Partial<GmailSyncProgress>) | undefined {
    const status = this.#index?.status()
    return status ? { ...status, ...this.#syncProgress } : undefined
  }

  async syncNow(): Promise<void> {
    return this.#synchronize(100, true)
  }

  async accounts(): Promise<readonly GmailAccountProjection[]> {
    try {
      const response = await fetch(`${this.#agentBase}/v1/connectors/gmail`, { signal: AbortSignal.timeout(30_000) })
      const value = await response.json() as unknown
      if (!response.ok) throw new Error(`Gmail inventory failed (${response.status})`)
      const inventory = record(value)
      return array(inventory?.accounts).map((account) => {
        const item = record(account)
        const id = text(item?.linkId)
        if (!id) throw new Error('Gmail inventory contains an account without linkId')
        return { id, connectorId: text(item?.connectorId), name: text(item?.name) || 'Gmail', email: text(item?.email) }
      })
    } catch (error) {
      const indexed = this.#index?.accounts() ?? []
      if (indexed.length === 0) throw error
      this.#index?.failSync(`Gmail account refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      return indexed
    }
  }

  async listMessages(accountId: string, maxResults = 10): Promise<readonly MessageSummary[]> {
    if (this.#index) {
      await this.#ensureIndex()
      return this.#index.messages(accountId).filter((message) => message.inInbox || message.unread)
    }
    const account = await this.#account(accountId)
    return this.#listAccountMessages(account, maxResults, 'all')
  }

  async listUnifiedMessages(maxResultsPerAccount = 10): Promise<readonly MessageSummary[]> {
    if (this.#index) {
      await this.#ensureIndex()
      return this.#index.messages().filter((message) => message.inInbox || message.unread)
    }
    const accounts = await this.accounts()
    const lists = await Promise.all(accounts.map((account) => this.#listAccountMessages(account, maxResultsPerAccount, 'all')))
    return lists
      .flat()
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
  }

  async listConversations(accountId: string, state: MailStateFilter, maxResults = 20): Promise<readonly ConversationSummary[]> {
    if (this.#index) {
      await this.#ensureIndex()
      return this.#index.conversations(state, accountId)
    }
    const account = await this.#account(accountId)
    return groupConversations(await this.#listAccountMessages(account, maxResults, state), state)
  }

  async listUnifiedConversations(state: MailStateFilter, maxResultsPerAccount = 20): Promise<readonly ConversationSummary[]> {
    if (this.#index) {
      await this.#ensureIndex()
      return this.#index.conversations(state)
    }
    const accounts = await this.accounts()
    const lists = await Promise.all(accounts.map((account) => this.#listAccountMessages(account, maxResultsPerAccount, state)))
    return groupConversations(lists.flat(), state)
  }

  async searchConversations(query: string, state: MailStateFilter, accountId?: string): Promise<readonly ConversationSummary[]> {
    if (!this.#index) throw new Error('Durable Gmail index is required for search')
    await this.#ensureIndex()
    return this.#index.searchConversations(query, state, accountId)
  }

  async #listAccountMessages(account: GmailAccountProjection, maxResults: number, state: MailStateFilter): Promise<readonly MessageSummary[]> {
    if (state === 'all') {
      const [inbox, unread] = await Promise.all([
        this.#searchAccountMessages(account, maxResults, '-in:spam -in:trash', ['INBOX']),
        this.#searchAccountMessages(account, maxResults, '-in:spam -in:trash', ['UNREAD']),
      ])
      return [...new Map([...inbox, ...unread].map((message) => [message.id, message])).values()]
    }
    return this.#searchAccountMessages(
      account,
      maxResults,
      state === 'read' ? '-in:spam -in:trash is:read' : '-in:spam -in:trash',
      state === 'read' ? ['INBOX'] : ['UNREAD'],
    )
  }

  async #searchAccountMessages(account: GmailAccountProjection, maxResults: number, query: string, labelIds: readonly string[]): Promise<readonly MessageSummary[]> {
    return (await this.#searchPage(account, maxResults, query, labelIds, '')).messages
  }

  async #searchPage(
    account: GmailAccountProjection,
    maxResults: number,
    query: string,
    labelIds: readonly string[],
    nextPageToken: string,
  ): Promise<{ messages: readonly IndexedGmailMessage[]; nextPageToken: string }> {
    const search = await this.#post('/v1/connectors/gmail/search-messages', {
      linkId: account.id, query, labelIds, maxResults, nextPageToken,
    })
    const content = structured(search)
    return {
      messages: array(content.emails).map((email) => {
        const value = record(email)
        const labels = array(value?.labels)
        return { ...projectGmailSearchEmail(email, account), inInbox: labels.includes('INBOX') }
      }),
      nextPageToken: text(content.next_page_token),
    }
  }

  async #ensureIndex(): Promise<void> {
    if (!this.#index) return
    const status = this.#index.status()
    if (this.#index.count() === 0) {
      await this.#synchronize(1, false)
      this.#scheduleSync()
      return
    }
    if (status.state === 'failed' || status.state === 'partial') this.#scheduleSync()
  }

  #scheduleSync(delayMs = 0): void {
    if (!this.#index || this.#retryTimer || this.#stopped) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      void this.syncNow().catch(() => this.#scheduleSync(5_000))
    }, delayMs)
    this.#retryTimer.unref()
  }

  async #synchronize(maxPagesPerStream: number, requireComplete: boolean): Promise<void> {
    if (!this.#index) return
    if (this.#syncPromise) return this.#syncPromise
    this.#syncPromise = (async () => {
      const startedAt = new Date().toISOString()
      const runId = `${startedAt}:${randomUUID()}`
      this.#index!.beginSync(startedAt)
      try {
        const accounts = await this.accounts()
        if (accounts.length === 0) throw new Error('Cannot synchronize Gmail: no connector accounts are available')
        this.#index!.replaceAccounts(accounts, startedAt)
        this.#syncProgress = { accountCount: accounts.length, accountsCompleted: 0, pagesFetched: 0, fetchedMessages: 0, currentAccount: null }
        const completion: boolean[] = []
        for (const account of accounts) {
          this.#syncProgress.currentAccount = account.name
          const messages = new Map<string, IndexedGmailMessage>()
          let complete = true
          for (const labelIds of [['INBOX'], ['UNREAD']] as const) {
            let token = ''
            for (let pageNumber = 0; pageNumber < maxPagesPerStream; pageNumber += 1) {
              const page = await this.#searchPage(account, 50, '-in:spam -in:trash', labelIds, token)
              this.#syncProgress.pagesFetched += 1
              this.#syncProgress.fetchedMessages += page.messages.length
              for (const message of page.messages) {
                const existing = messages.get(message.id)
                messages.set(message.id, existing
                  ? { ...message, unread: existing.unread || message.unread, inInbox: existing.inInbox || message.inInbox }
                  : message)
              }
              if (!page.nextPageToken) {
                token = ''
                break
              }
              if (page.nextPageToken === token) throw new Error(`Gmail pagination repeated a page token for account ${account.name}`)
              token = page.nextPageToken
            }
            if (token) {
              complete = false
              if (requireComplete) throw new Error(`Gmail pagination exceeded ${maxPagesPerStream} pages for account ${account.name}`)
            }
          }
          this.#index!.replaceAccount(account.id, [...messages.values()], runId, complete)
          completion.push(complete)
          this.#syncProgress.accountsCompleted += 1
        }
        this.#syncProgress.currentAccount = null
        this.#index!.pruneAccounts(accounts.map((account) => account.id))
        this.#index!.completeSync(new Date().toISOString(), completion.every(Boolean))
      } catch (error) {
        this.#index!.failSync(error instanceof Error ? error.message : String(error))
        throw error
      }
    })().finally(() => { this.#syncPromise = undefined })
    return this.#syncPromise
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

  async setConversationUnread(accountId: string, threadId: string, unread: boolean): Promise<{ messageIds: readonly string[]; unread: boolean }> {
    if (!this.#index) throw new Error('Durable Gmail index is required for read-state mutations')
    const messageIds = this.#index.threadMessageIds(accountId, threadId)
    if (messageIds.length === 0) throw new Error('Conversation is not present in the Gmail index')
    await this.#post('/v1/connectors/gmail/modify', {
      linkId: accountId, messageIds,
      addLabels: unread ? ['UNREAD'] : [], removeLabels: unread ? [] : ['UNREAD'],
    })
    this.#index.setUnread(accountId, messageIds, unread)
    this.#scheduleSync(1_000)
    return { messageIds, unread }
  }

  async createGmailDraft(accountId: string, messageId: string, to: string, subject: string, bodyText: string): Promise<DraftProjection> {
    const value = structured(await this.#post('/v1/connectors/gmail/drafts/create', { linkId: accountId, replyMessageId: messageId, to, subject, bodyText }))
    const id = text(value.draft_id) || text(value.id)
    if (!id) throw new Error('Gmail did not return a draft ID')
    return { id, inReplyToMessageId: messageId, to: [sender(to)], subject, bodyText, state: 'draft', accountId }
  }

  async updateGmailDraft(draft: DraftProjection): Promise<DraftProjection> {
    if (!draft.accountId) throw new Error('Gmail draft is missing account identity')
    await this.#post('/v1/connectors/gmail/drafts/update', { linkId: draft.accountId, draftId: draft.id, to: draft.to.map((item) => item.address).join(', '), subject: draft.subject, bodyText: draft.bodyText })
    return draft
  }

  async sendGmailDraft(accountId: string, draftId: string): Promise<unknown> {
    return this.#post('/v1/connectors/gmail/drafts/send', { linkId: accountId, draftId })
  }
  async readAttachment(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<unknown> {
    return this.#post('/v1/connectors/gmail/attachment', { linkId: accountId, messageId, attachmentId, filename })
  }

  async #account(accountId: string): Promise<GmailAccountProjection> {
    const account = (await this.accounts()).find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('Unknown Gmail account')
    return account
  }

  async #post(path: string, bodyValue: UnknownRecord): Promise<unknown> {
    const response = await fetch(`${this.#agentBase}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyValue), signal: AbortSignal.timeout(30_000),
    })
    const value = await response.json() as unknown
    if (!response.ok) throw new Error(`Gmail connector request failed (${response.status}): ${JSON.stringify(value)}`)
    return value
  }
}
