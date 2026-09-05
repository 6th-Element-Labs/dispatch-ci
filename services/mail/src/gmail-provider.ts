import { groupConversations, projectConversation } from './conversation.js'
import { plainBodyFromMessage, projectDraft } from './draft.js'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { folderFlagsFromLabels, GmailIndex, type GmailSyncStatus, type IndexedGmailMessage } from './gmail-index.js'
import type { AttachmentProjection, ConversationProjection, ConversationSummary, DraftAttachment, DraftProjection, GmailConversationAction, GmailMailbox, MailAddress, MailStateFilter, MessageProjection, MessageSummary } from './model.js'

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

interface GmailDraftSummary {
  readonly draftId: string
  readonly messageId: string
  readonly threadId: string
  readonly to: string
  readonly cc: string
  readonly bcc: string
  readonly subject: string
  readonly hasAttachment: boolean
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

export const INDEX_STREAMS = [
  { query: '-in:spam -in:trash', labelIds: ['INBOX'] },
  { query: '-in:spam -in:trash', labelIds: ['UNREAD'] },
  { query: '-in:trash', labelIds: ['SENT'] },
  { query: '-in:trash', labelIds: ['DRAFT'] },
  { query: 'in:spam', labelIds: ['SPAM'] },
  { query: 'in:trash', labelIds: ['TRASH'] },
  { query: '-in:inbox -in:sent -in:drafts -in:spam -in:trash', labelIds: [] },
] as const

function queueSearchSpec(state: MailStateFilter): { query: string; labels: readonly string[] } {
  if (state === 'unread') return { query: 'is:unread -in:spam -in:trash', labels: ['UNREAD'] }
  if (state === 'read') return { query: 'in:inbox is:read -in:spam -in:trash', labels: ['INBOX'] }
  return { query: '(in:inbox OR is:unread) -in:spam -in:trash', labels: [] }
}

export function mergeIndexedMessages(messages: readonly IndexedGmailMessage[]): IndexedGmailMessage[] {
  const merged = new Map<string, IndexedGmailMessage>()
  for (const message of messages) {
    const existing = merged.get(message.id)
    const next = existing
      ? {
          ...message,
          unread: existing.unread || message.unread,
          inInbox: existing.inInbox || message.inInbox,
          inSent: existing.inSent || message.inSent,
          inDrafts: existing.inDrafts || message.inDrafts,
          inSpam: existing.inSpam || message.inSpam,
          inTrash: existing.inTrash || message.inTrash,
          inArchive: existing.inArchive || message.inArchive,
          hasAttachment: existing.hasAttachment === true || message.hasAttachment === true,
        }
      : message
    merged.set(message.id, {
      ...next,
      inArchive: next.inArchive && !next.inInbox && !next.inSent && !next.inDrafts && !next.inSpam && !next.inTrash,
    })
  }
  return [...merged.values()]
}

function draftConnectorError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  if (/html|mime_type|text\/html/i.test(detail)) return Object.assign(new Error(detail), { code: 'gmail_html_unsupported' })
  if (/attach/i.test(detail)) return Object.assign(new Error(detail), { code: 'gmail_attachment_unsupported' })
  if (/discard|delete_draft/i.test(detail)) return Object.assign(new Error(detail), { code: 'gmail_draft_discard_unavailable' })
  if (/gmail_draft_list_unavailable/i.test(detail)) return Object.assign(new Error(detail), { code: 'gmail_draft_open_unavailable' })
  return error instanceof Error ? error : new Error(detail)
}

function gmailDraftSummary(value: unknown): GmailDraftSummary {
  const draft = record(value) ?? {}
  const draftId = text(draft.draft_id)
  const messageId = text(draft.message_id)
  if (!draftId || !messageId) throw new Error('Gmail draft list row is missing draft_id or message_id')
  return {
    draftId,
    messageId,
    threadId: text(draft.thread_id),
    to: text(draft.to),
    cc: text(draft.cc),
    bcc: text(draft.bcc),
    subject: text(draft.subject),
    hasAttachment: draft.has_attachment === true,
  }
}

function rejectListedDraftAttachments(summary: GmailDraftSummary): void {
  if (summary.hasAttachment) {
    throw Object.assign(new Error('Gmail draft attachments are unsupported'), { code: 'gmail_attachment_unsupported' })
  }
}

function rejectReadDraftAttachments(message: MessageProjection): void {
  if (message.attachments.length > 0) {
    throw Object.assign(new Error('Gmail draft attachments are unsupported'), { code: 'gmail_attachment_unsupported' })
  }
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
  const bracketed = /^\s*([^<]*)<([^>]+)>\s*$/.exec(value)
  const flattened = bracketed ? undefined : /^\s*(.+?)\s+([^\s<>]+@[^\s<>]+)\s*$/.exec(value)
  const name = (bracketed?.[1]?.trim() || bracketed?.[2] || flattened?.[1] || value).trim().replace(/^"|"$/g, '')
  const address = (bracketed?.[2] || flattened?.[2] || value).trim()
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '@'
  return { name, address, initials }
}

function addressList(value: string): readonly MailAddress[] {
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => item.trim()).filter(Boolean).map(sender)
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
  if (message.label_ids !== null && message.label_ids !== undefined && !Array.isArray(message.label_ids)) throw new Error('Gmail message label_ids must be an array or null')
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
    to: addressList(messageHeaders.get('to') ?? ''),
    cc: addressList(messageHeaders.get('cc') ?? ''),
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
  readonly #refreshIntervalMs: number
  #syncPromise: Promise<void> | undefined
  #syncTimer: ReturnType<typeof setInterval> | undefined
  #refreshTimer: ReturnType<typeof setInterval> | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #stopped = false
  readonly #drafts = new Map<string, DraftProjection>()
  #syncProgress: GmailSyncProgress = { accountCount: 0, accountsCompleted: 0, pagesFetched: 0, fetchedMessages: 0, currentAccount: null }

  constructor(
    agentBase = process.env.DISPATCH_AGENT_URL ?? 'http://127.0.0.1:8412',
    options: { indexPath?: string | false; syncIntervalMs?: number; refreshIntervalMs?: number } = {},
  ) {
    this.#agentBase = agentBase
    const indexPath = options.indexPath === false
      ? undefined
      : options.indexPath ?? process.env.DISPATCH_MAIL_DB ?? defaultIndexPath()
    this.#index = indexPath ? new GmailIndex(indexPath) : undefined
    this.#syncIntervalMs = options.syncIntervalMs ?? 300_000
    this.#refreshIntervalMs = options.refreshIntervalMs ?? 60_000
  }

  startBackgroundSync(): void {
    if (!this.#index || this.#syncTimer) return
    this.#stopped = false
    if (this.#index.count() > 0) void this.refreshNow().catch(() => this.#scheduleSync(5_000))
    else this.#scheduleSync()
    this.#syncTimer = setInterval(() => { this.#scheduleSync() }, this.#syncIntervalMs)
    this.#syncTimer.unref()
    this.#refreshTimer = setInterval(() => { void this.refreshNow().catch(() => undefined) }, this.#refreshIntervalMs)
    this.#refreshTimer.unref()
  }

  stopBackgroundSync(): void {
    this.#stopped = true
    if (this.#syncTimer) clearInterval(this.#syncTimer)
    if (this.#refreshTimer) clearInterval(this.#refreshTimer)
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#syncTimer = undefined
    this.#refreshTimer = undefined
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

  async refreshNow(): Promise<void> {
    if (!this.#index || this.#index.count() === 0) return this.syncNow()
    if (this.#syncPromise) return this.#syncPromise
    this.#syncPromise = (async () => {
      const startedAt = new Date().toISOString()
      const runId = `${startedAt}:${randomUUID()}`
      this.#index!.beginSync(startedAt)
      try {
        const accounts = await this.accounts()
        if (accounts.length === 0) throw new Error('Cannot refresh Gmail: no connector accounts are available')
        this.#index!.replaceAccounts(accounts, startedAt)
        this.#syncProgress = { accountCount: accounts.length, accountsCompleted: 0, pagesFetched: 0, fetchedMessages: 0, currentAccount: null }
        const pages = await Promise.all(accounts.map(async (account) => {
          const streams = await Promise.all(INDEX_STREAMS.map((stream) => this.#searchPage(account, 50, stream.query, stream.labelIds, '')))
          this.#syncProgress.pagesFetched += streams.length
          this.#syncProgress.fetchedMessages += streams.reduce((count, page) => count + page.messages.length, 0)
          return { account, messages: mergeIndexedMessages(streams.flatMap((page) => page.messages)) }
        }))
        for (const page of pages) {
          this.#syncProgress.currentAccount = page.account.name
          this.#index!.replaceAccount(page.account.id, page.messages, runId, false)
          this.#syncProgress.accountsCompleted += 1
        }
        this.#syncProgress.currentAccount = null
        this.#index!.pruneAccounts(accounts.map((account) => account.id))
        this.#index!.completeSync(new Date().toISOString(), true)
      } catch (error) {
        this.#index!.failSync(error instanceof Error ? error.message : String(error))
        throw error
      }
    })().finally(() => { this.#syncPromise = undefined })
    return this.#syncPromise
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
      return this.#index.messages(accountId).filter((message) => message.inInbox)
    }
    const account = await this.#account(accountId)
    return this.#searchAccountMessages(account, maxResults, '-in:spam -in:trash', ['INBOX'])
  }

  async listUnifiedMessages(maxResultsPerAccount = 10): Promise<readonly MessageSummary[]> {
    if (this.#index) {
      await this.#ensureIndex()
      return this.#index.messages().filter((message) => message.inInbox)
    }
    const accounts = await this.accounts()
    const lists = await Promise.all(accounts.map((account) => this.#searchAccountMessages(account, maxResultsPerAccount, '-in:spam -in:trash', ['INBOX'])))
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

  async listMailboxConversations(mailbox: GmailMailbox, state: MailStateFilter, accountId?: string, query = ''): Promise<readonly ConversationSummary[]> {
    if (!this.#index) throw new Error('Durable Gmail index is required for mailbox lists')
    await this.#ensureIndex()
    return query
      ? this.#index.searchMailboxConversations(mailbox, query, state, accountId)
      : this.#index.mailboxConversations(mailbox, state, accountId)
  }

  async #listAccountMessages(account: GmailAccountProjection, maxResults: number, state: MailStateFilter): Promise<readonly MessageSummary[]> {
    const spec = queueSearchSpec(state)
    return this.#searchAccountMessages(account, maxResults, spec.query, spec.labels)
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
        return { ...projectGmailSearchEmail(email, account), ...folderFlagsFromLabels(labels) }
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
          const messages: IndexedGmailMessage[] = []
          let complete = true
          for (const stream of INDEX_STREAMS) {
            let token = ''
            for (let pageNumber = 0; pageNumber < maxPagesPerStream; pageNumber += 1) {
              const page = await this.#searchPage(account, 50, stream.query, stream.labelIds, token)
              this.#syncProgress.pagesFetched += 1
              this.#syncProgress.fetchedMessages += page.messages.length
              messages.push(...page.messages)
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
          this.#index!.replaceAccount(account.id, mergeIndexedMessages(messages), runId, complete)
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

  async setConversationUnread(accountId: string, threadId: string, unread: boolean, suppliedMessageIds?: readonly string[]): Promise<{ messageIds: readonly string[]; unread: boolean }> {
    if (!this.#index) throw new Error('Durable Gmail index is required for read-state mutations')
    const messageIds = suppliedMessageIds?.length ? suppliedMessageIds : this.#index.threadMessageIds(accountId, threadId)
    if (messageIds.length === 0) throw new Error('Conversation is not present in the Gmail index')
    await this.#post('/v1/connectors/gmail/modify', {
      linkId: accountId, messageIds,
      addLabels: unread ? ['UNREAD'] : [], removeLabels: unread ? [] : ['UNREAD'],
    })
    const indexedIds = this.#index.threadMessageIds(accountId, threadId)
    if (indexedIds.length > 0) this.#index.setUnread(accountId, indexedIds, unread)
    this.#scheduleSync(1_000)
    return { messageIds, unread }
  }

  async mutateConversation(accountId: string, threadId: string, messageIds: readonly string[], action: GmailConversationAction): Promise<void> {
    if (!accountId || !threadId || messageIds.length === 0) throw new Error('Gmail conversation action requires account, thread, and message identities')
    if (action === 'archive') await this.#post('/v1/connectors/gmail/archive', { linkId: accountId, threadIds: [threadId] })
    else if (action === 'trash') await this.#post('/v1/connectors/gmail/delete', { linkId: accountId, messageIds })
    else await this.#post('/v1/connectors/gmail/modify', {
      linkId: accountId,
      messageIds,
      addLabels: action === 'spam' ? ['SPAM'] : ['INBOX'],
      removeLabels: action === 'spam' ? ['INBOX'] : ['SPAM', 'TRASH'],
    })
    if (this.#index) this.#index.applyConversationAction(accountId, messageIds, action)
    this.#scheduleSync(1_000)
  }

  async createGmailDraft(accountId: string, messageId: string, to: string, cc: string, bcc: string, subject: string, bodyMarkdown: string, draftAttachments: readonly DraftAttachment[] = []): Promise<DraftProjection> {
    if (draftAttachments.length > 0) {
      throw Object.assign(new Error('Gmail compose attachments are unsupported'), { code: 'gmail_attachment_unsupported' })
    }
    const draft = projectDraft({ id: '', inReplyToMessageId: messageId, to: addressList(to), cc, bcc, subject, bodyMarkdown, attachments: draftAttachments, accountId })
    try {
      const value = structured(await this.#post('/v1/connectors/gmail/drafts/create', {
        linkId: accountId, replyMessageId: messageId || null, to, cc, bcc, subject,
        bodyMarkdown, bodyHtml: draft.bodyHtml, bodyText: bodyMarkdown,
      }))
      const id = text(value.draft_id) || text(value.id)
      if (!id) throw new Error('Gmail did not return a draft ID')
      const saved = { ...draft, id }
      this.#drafts.set(`${accountId}:${id}`, saved)
      await this.#refreshIndexedDrafts()
      return saved
    } catch (error) {
      throw draftConnectorError(error)
    }
  }

  async updateGmailDraft(draft: DraftProjection): Promise<DraftProjection> {
    if (!draft.accountId) throw new Error('Gmail draft is missing account identity')
    if (draft.attachments.length > 0) {
      throw Object.assign(new Error('Gmail compose attachments are unsupported'), { code: 'gmail_attachment_unsupported' })
    }
    try {
      await this.#post('/v1/connectors/gmail/drafts/update', {
        linkId: draft.accountId, draftId: draft.id, to: draft.to.map((item) => item.address).join(', '),
        cc: draft.cc ?? '', bcc: draft.bcc ?? '', subject: draft.subject,
        bodyMarkdown: draft.bodyMarkdown, bodyHtml: draft.bodyHtml, bodyText: draft.bodyText,
      })
      this.#drafts.set(`${draft.accountId}:${draft.id}`, draft)
      await this.#refreshIndexedDrafts()
      return draft
    } catch (error) {
      throw draftConnectorError(error)
    }
  }

  async readGmailDraft(accountId: string, draftId: string): Promise<DraftProjection> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.draftId === draftId)
    if (!summary) {
      throw Object.assign(new Error(`Gmail draft ${draftId} was not found`), { code: 'gmail_draft_not_found' })
    }
    rejectListedDraftAttachments(summary)
    const message = await this.readMessage(accountId, summary.messageId)
    const existing = this.#drafts.get(`${accountId}:${draftId}`)
    const draft = this.#projectGmailDraft(summary, message, existing?.inReplyToMessageId ?? summary.messageId, accountId)
    this.#drafts.set(`${accountId}:${draftId}`, draft)
    return draft
  }

  async openGmailDraft(accountId: string, messageId: string): Promise<DraftProjection> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.messageId === messageId || draft.threadId === messageId)
    if (!summary) {
      throw Object.assign(new Error(`Gmail draft for message ${messageId} was not found`), { code: 'gmail_draft_not_found' })
    }
    rejectListedDraftAttachments(summary)
    const message = await this.readMessage(accountId, summary.messageId)
    const draft = this.#projectGmailDraft(summary, message, messageId, accountId)
    this.#drafts.set(`${accountId}:${summary.draftId}`, draft)
    return draft
  }

  async discardGmailDraft(accountId: string, draftId: string): Promise<void> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.draftId === draftId).catch(() => undefined)
    try {
      await this.#post('/v1/connectors/gmail/drafts/discard', { linkId: accountId, draftId })
      this.#drafts.delete(`${accountId}:${draftId}`)
      if (this.#index && summary) this.#index.discardDraftMessages(accountId, [summary.messageId])
      await this.#refreshIndexedDrafts()
    } catch (error) {
      throw draftConnectorError(error)
    }
  }

  async sendGmailDraft(accountId: string, draftId: string): Promise<unknown> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.draftId === draftId).catch(() => undefined)
    const result = await this.#post('/v1/connectors/gmail/drafts/send', { linkId: accountId, draftId })
    if (this.#index && summary) this.#index.markDraftsSent(accountId, [summary.messageId])
    await this.#refreshIndexedDrafts()
    return result
  }

  async #refreshIndexedDrafts(): Promise<void> {
    try {
      await this.refreshNow()
    } catch {
      this.#scheduleSync(5_000)
    }
  }
  async readAttachment(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<unknown> {
    return this.#post('/v1/connectors/gmail/attachment', { linkId: accountId, messageId, attachmentId, filename })
  }

  async #account(accountId: string): Promise<GmailAccountProjection> {
    const account = (await this.accounts()).find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('Unknown Gmail account')
    return account
  }

  async #findGmailDraft(accountId: string, matches: (draft: GmailDraftSummary) => boolean): Promise<GmailDraftSummary | undefined> {
    let nextPageToken = ''
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      let value: unknown
      try {
        value = await this.#post('/v1/connectors/gmail/drafts/list', {
          linkId: accountId,
          maxResults: 100,
          nextPageToken,
        })
      } catch (error) {
        throw draftConnectorError(error)
      }
      const content = structured(value)
      const match = array(content.drafts).map(gmailDraftSummary).find(matches)
      if (match) return match
      const next = text(content.next_page_token)
      if (!next) return undefined
      if (next === nextPageToken) throw new Error(`Gmail draft pagination repeated page token ${next}`)
      nextPageToken = next
    }
    throw new Error('Gmail draft pagination exceeded 100 pages')
  }

  #projectGmailDraft(summary: GmailDraftSummary, message: MessageProjection, inReplyToMessageId: string, accountId: string): DraftProjection {
    rejectReadDraftAttachments(message)
    return projectDraft({
      id: summary.draftId,
      inReplyToMessageId,
      to: addressList(summary.to),
      cc: summary.cc,
      bcc: summary.bcc,
      subject: summary.subject,
      bodyMarkdown: plainBodyFromMessage(message),
      attachments: [],
      accountId,
    })
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
