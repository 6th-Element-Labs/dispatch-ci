import './styles.css'
import { api } from './api.js'
import { renderEmailContent } from './email-renderer.js'
import type { AppSummary, ConversationProjection, ConversationSummary, DraftProjection, GmailAccount, MailStateFilter, MessageProjection } from './contracts.js'
import { contextLabel, gmailAppId } from './model.js'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('Dispatch app root is missing')
const app: HTMLDivElement = appElement

app.innerHTML = `
  <div class="dispatch-window">
    <header class="dispatch-titlebar">
      <div class="dispatch-traffic"><span></span><span></span><span></span></div>
      <div class="dispatch-title-center"><strong>Dispatch</strong><div class="dispatch-panel-controls" aria-label="Visible panels"><button type="button" data-panel="messages" aria-pressed="true">Messages</button><button type="button" data-panel="reader" aria-pressed="true">Email</button><button type="button" data-panel="agent" aria-pressed="true">Codex</button></div></div>
      <div class="dispatch-title-actions"><button type="button" data-refresh aria-label="Refresh">↻</button><button type="button" data-compose>Compose</button></div>
    </header>
    <div class="dispatch-workspace">
      <aside class="dispatch-messages" aria-label="Messages">
        <div class="dispatch-pane-heading"><h1>Messages</h1><span data-mail-source>Loading</span></div>
        <label class="dispatch-account" hidden><span>Account</span><select data-account aria-label="Gmail account"></select></label>
        <div class="dispatch-mail-filters" aria-label="Message state"><button type="button" data-mail-state="all" aria-pressed="true">All</button><button type="button" data-mail-state="unread" aria-pressed="false">Unread</button><button type="button" data-mail-state="read" aria-pressed="false">Read</button></div>
        <label class="dispatch-search"><span>⌕</span><input placeholder="Search mail" aria-label="Search mail"></label>
        <div class="dispatch-message-list" data-message-list></div>
        <div class="dispatch-pane-error" data-mail-error hidden></div>
      </aside>
      <div class="dispatch-divider" data-divider="messages" role="separator" aria-label="Resize messages panel" aria-orientation="vertical"></div>
      <main class="dispatch-reader" aria-label="Selected email">
        <div class="dispatch-reader-empty" data-reader-empty>Select a message</div>
        <div data-reader hidden>
          <header class="dispatch-reader-header">
            <h2 data-subject></h2>
            <div class="dispatch-sender"><span class="dispatch-avatar" data-avatar></span><span><strong data-sender></strong><small data-address></small></span><time data-time></time></div>
          </header>
          <article class="dispatch-email-body" data-body></article>
          <section class="dispatch-attachments" data-attachments></section>
          <section class="dispatch-draft" data-draft hidden>
            <div><span>To</span><input data-draft-to aria-label="Draft recipient"></div>
            <div><span>Subject</span><input data-draft-subject aria-label="Draft subject"></div>
            <textarea data-draft-body aria-label="Draft body"></textarea>
            <footer><button type="button" data-save-draft>Save draft</button><button type="button" data-revise-draft>Ask Codex to revise</button><button type="button" data-send-draft>Send draft</button></footer>
          </section>
          <footer class="dispatch-reader-actions"><button type="button" data-reply>Reply</button><button type="button" data-read-state>Mark unread</button><button type="button" data-ask>Ask Codex</button></footer>
        </div>
      </main>
      <div class="dispatch-divider" data-divider="agent" role="separator" aria-label="Resize Codex panel" aria-orientation="vertical"></div>
      <aside class="dispatch-agent" aria-label="Codex">
        <header><div><span class="dispatch-codex-mark">✦</span><strong>Codex</strong><span class="dispatch-status" data-agent-status>Connecting</span></div><div class="dispatch-context" data-context>No email selected</div></header>
        <div class="dispatch-agent-stream" data-agent-stream><p class="dispatch-agent-intro">Use the installed Codex harness with your selected email in view.</p></div>
        <footer>
          <div class="dispatch-suggestions"><button type="button" data-suggestion="Catch me up on this email.">Catch me up</button><button type="button" data-suggestion="Draft a reply to this email.">Draft a reply</button><button type="button" data-suggestion="Find related messages in Gmail.">Find related</button></div>
          <div class="dispatch-prompt"><textarea data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea><div><span data-connector>Checking connectors</span><span><button type="button" data-stop aria-label="Stop" hidden>■</button><button type="button" data-send aria-label="Send">↑</button></span></div></div>
        </footer>
      </aside>
    </div>
  </div>`

const elements = {
  workspace: app.querySelector<HTMLElement>('.dispatch-workspace')!,
  messagesPanel: app.querySelector<HTMLElement>('.dispatch-messages')!,
  readerPanel: app.querySelector<HTMLElement>('.dispatch-reader')!,
  agentPanel: app.querySelector<HTMLElement>('.dispatch-agent')!,
  messagesDivider: app.querySelector<HTMLElement>('[data-divider="messages"]')!,
  agentDivider: app.querySelector<HTMLElement>('[data-divider="agent"]')!,
  list: app.querySelector<HTMLElement>('[data-message-list]')!,
  mailSource: app.querySelector<HTMLElement>('[data-mail-source]')!,
  accountWrap: app.querySelector<HTMLElement>('.dispatch-account')!,
  account: app.querySelector<HTMLSelectElement>('[data-account]')!,
  mailError: app.querySelector<HTMLElement>('[data-mail-error]')!,
  reader: app.querySelector<HTMLElement>('[data-reader]')!,
  readerEmpty: app.querySelector<HTMLElement>('[data-reader-empty]')!,
  subject: app.querySelector<HTMLElement>('[data-subject]')!,
  avatar: app.querySelector<HTMLElement>('[data-avatar]')!,
  sender: app.querySelector<HTMLElement>('[data-sender]')!,
  address: app.querySelector<HTMLElement>('[data-address]')!,
  time: app.querySelector<HTMLTimeElement>('[data-time]')!,
  body: app.querySelector<HTMLElement>('[data-body]')!,
  attachments: app.querySelector<HTMLElement>('[data-attachments]')!,
  draft: app.querySelector<HTMLElement>('[data-draft]')!,
  draftTo: app.querySelector<HTMLInputElement>('[data-draft-to]')!,
  draftSubject: app.querySelector<HTMLInputElement>('[data-draft-subject]')!,
  draftBody: app.querySelector<HTMLTextAreaElement>('[data-draft-body]')!,
  context: app.querySelector<HTMLElement>('[data-context]')!,
  agentStatus: app.querySelector<HTMLElement>('[data-agent-status]')!,
  connector: app.querySelector<HTMLElement>('[data-connector]')!,
  stream: app.querySelector<HTMLElement>('[data-agent-stream]')!,
  prompt: app.querySelector<HTMLTextAreaElement>('[data-prompt]')!,
  search: app.querySelector<HTMLInputElement>('[aria-label="Search mail"]')!,
  stop: app.querySelector<HTMLButtonElement>('[data-stop]')!,
  readState: app.querySelector<HTMLButtonElement>('[data-read-state]')!,
}
let activeDraft: DraftProjection | undefined

let conversations: ConversationSummary[] = []
let conversationTotal = 0
let nextConversationCursor: string | null = null
let loadingMoreConversations = false
let accounts: GmailAccount[] = []
let selectedAccountId: string | undefined
let mailState: MailStateFilter = 'all'
let selected: ConversationProjection | undefined
let selectedConversationId: string | undefined
let selectionSequence = 0
let conversationLoadSequence = 0
const conversationCache = new Map<string, Promise<ConversationProjection>>()
let threadId: string | undefined = localStorage.getItem('dispatch.codex.threadId') || undefined
let apps: AppSummary[] = []
let activeAgentMessage: HTMLElement | undefined
let agentEvents: EventSource | undefined
let reconnectTimer: number | undefined
let agentConnecting = false
let syncStatusTimer: number | undefined
let syncErrorVisible = false
let mailReconnectTimer: number | undefined
let searchQuery = ''
let searchTimer: number | undefined
let activeTurnId: string | undefined
let selectedAttachmentContext: { messageId: string; attachmentId: string; filename: string } | undefined

type PanelName = 'messages' | 'reader' | 'agent'
interface PanelState {
  messages: boolean
  reader: boolean
  agent: boolean
  messagesWidth: number
  agentWidth: number
}

function loadPanelState(): PanelState {
  const defaults: PanelState = { messages: true, reader: true, agent: true, messagesWidth: 290, agentWidth: 370 }
  try {
    const saved = JSON.parse(localStorage.getItem('dispatch.panels.v1') ?? '{}') as Partial<PanelState>
    return {
      messages: saved.messages ?? defaults.messages,
      reader: saved.reader ?? defaults.reader,
      agent: saved.agent ?? defaults.agent,
      messagesWidth: Math.max(220, Math.min(440, saved.messagesWidth ?? defaults.messagesWidth)),
      agentWidth: Math.max(280, Math.min(560, saved.agentWidth ?? defaults.agentWidth)),
    }
  } catch {
    return defaults
  }
}

const panels = loadPanelState()

function renderPanels(): void {
  const visible = (['messages', 'reader', 'agent'] as const).filter((name) => panels[name])
  if (visible.length === 0) panels.reader = true
  elements.messagesPanel.hidden = !panels.messages
  elements.readerPanel.hidden = !panels.reader
  elements.agentPanel.hidden = !panels.agent
  elements.messagesDivider.hidden = !(panels.messages && panels.reader)
  elements.agentDivider.hidden = !(panels.agent && (panels.reader || panels.messages))

  const columns: string[] = []
  if (panels.messages) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${panels.messagesWidth}px`)
  if (!elements.messagesDivider.hidden) columns.push('5px')
  if (panels.reader) columns.push('minmax(360px, 1fr)')
  if (!elements.agentDivider.hidden) columns.push('5px')
  if (panels.agent) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${panels.agentWidth}px`)
  elements.workspace.style.gridTemplateColumns = columns.join(' ')
  app.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => {
    const name = button.dataset.panel as PanelName
    button.setAttribute('aria-pressed', String(panels[name]))
  })
  localStorage.setItem('dispatch.panels.v1', JSON.stringify(panels))
}

function resizePanel(name: 'messagesWidth' | 'agentWidth', event: PointerEvent): void {
  const startX = event.clientX
  const startWidth = panels[name]
  const direction = name === 'messagesWidth' ? 1 : -1
  const move = (next: PointerEvent) => {
    const limit = name === 'messagesWidth' ? [220, 440] : [280, 560]
    panels[name] = Math.max(limit[0]!, Math.min(limit[1]!, startWidth + ((next.clientX - startX) * direction)))
    renderPanels()
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

function defaultEmptyListMessage(): string {
  if (mailState === 'unread') return 'No unread messages in the connected inboxes.'
  if (mailState === 'read') return 'No read messages in the connected inboxes.'
  return 'No messages in the connected inboxes.'
}

function renderList(emptyMessage = defaultEmptyListMessage()): void {
  elements.list.innerHTML = ''
  if (conversations.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'dispatch-message-list-empty'
    empty.textContent = emptyMessage
    elements.list.append(empty)
    return
  }
  for (const conversation of conversations) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dispatch-message'
    button.dataset.conversationId = conversation.id
    button.setAttribute('aria-selected', String(selectedConversationId === conversation.id))
    button.setAttribute('aria-label', `${conversation.sender.name}, ${conversation.subject}${conversation.unread ? ', unread' : ''}`)
    button.classList.toggle('dispatch-message-unread', conversation.unread)
    const avatar = document.createElement('span')
    avatar.className = 'dispatch-avatar'
    avatar.textContent = conversation.sender.initials
    const content = document.createElement('span')
    const top = document.createElement('span')
    top.className = 'dispatch-message-top'
    const sender = document.createElement('strong')
    sender.textContent = conversation.sender.name
    const time = document.createElement('time')
    time.textContent = conversation.receivedLabel
    top.append(sender, time)
    const subject = document.createElement('b')
    subject.textContent = conversation.subject
    const preview = document.createElement('small')
    preview.textContent = conversation.preview
    const account = document.createElement('span')
    account.className = 'dispatch-message-account'
    account.textContent = conversation.accountLabel ?? ''
    content.append(top, subject, preview)
    if (conversation.accountLabel && accounts.length > 1) content.append(account)
    button.append(avatar, content)
    button.addEventListener('click', () => { void selectConversation(conversation.id) })
    elements.list.append(button)
  }
  if (nextConversationCursor) {
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'dispatch-load-more'
    more.textContent = loadingMoreConversations ? 'Loading more…' : `Load more · ${Math.max(0, conversationTotal - conversations.length)} remaining`
    more.disabled = loadingMoreConversations
    more.addEventListener('click', () => { void loadMoreConversations() })
    elements.list.append(more)
  }
}

async function loadMoreConversations(): Promise<void> {
  if (!nextConversationCursor || loadingMoreConversations) return
  loadingMoreConversations = true
  renderList()
  try {
    const result = await api.listConversations(mailState, selectedAccountId, nextConversationCursor, searchQuery)
    conversations = [...new Map([...conversations, ...result.conversations].map((conversation) => [conversation.id, conversation])).values()]
    nextConversationCursor = result.nextCursor ?? null
    conversationTotal = result.total ?? conversations.length
  } catch (error) {
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    loadingMoreConversations = false
    renderList()
  }
}

function renderThreadMessage(message: MessageProjection): HTMLElement {
  const article = document.createElement('article')
  article.className = 'dispatch-thread-message'
  const header = document.createElement('header')
  const identity = document.createElement('div')
  const name = document.createElement('strong')
  name.textContent = message.sender.name
  const address = document.createElement('small')
  address.textContent = message.sender.address
  identity.append(name, address)
  const time = document.createElement('time')
  time.dateTime = message.receivedAt
  time.textContent = message.receivedFullLabel
  header.append(identity, time)
  const content = renderEmailContent(message.body.kind, message.body.content)
  const attachmentList = document.createElement('div')
  attachmentList.className = 'dispatch-thread-attachments'
  for (const attachment of message.attachments) {
    const item = document.createElement('button')
    item.type = 'button'
    const attachmentName = document.createElement('strong')
    attachmentName.textContent = attachment.name
    const size = document.createElement('small')
    size.textContent = attachment.sizeLabel
    item.append(attachmentName, size)
    item.addEventListener('click', () => { void openAttachment(message, attachment.id, attachment.name, attachment.mediaType) })
    attachmentList.append(item)
  }
  article.append(header, content)
  if (message.attachments.length > 0) article.append(attachmentList)
  return article
}

async function openAttachment(message: MessageProjection, attachmentId: string, filename: string, mediaType: string): Promise<void> {
  if (!message.accountId) return
  selectedAttachmentContext = { messageId: message.id, attachmentId, filename }
  try {
    const value = await api.readAttachment(message.id, attachmentId, message.accountId, filename) as Record<string, unknown>
    const content = (value.structuredContent ?? value) as Record<string, unknown>
    const encoded = String(content.base64_url_content ?? content.data ?? '')
    if (!encoded) throw new Error('Gmail attachment response did not contain downloadable bytes')
    const anchor = document.createElement('a')
    anchor.href = `data:${String(content.mime_type ?? mediaType)};base64,${encoded.replace(/-/g, '+').replace(/_/g, '/')}`
    anchor.download = filename
    anchor.click()
    addAgentMessage('tool', `Opened attachment citation · ${filename}`)
  } catch (error) { addAgentMessage('error', error instanceof Error ? error.message : String(error)) }
}

async function selectConversation(id: string): Promise<void> {
  const summary = conversations.find((conversation) => conversation.id === id)
  if (!summary) return
  const sequence = ++selectionSequence
  selectedConversationId = id
  selected = undefined
  renderList()
  elements.readerEmpty.hidden = true
  elements.reader.hidden = false
  elements.draft.hidden = true
  elements.body.hidden = false
  elements.attachments.hidden = false
  elements.subject.textContent = summary.subject
  elements.avatar.textContent = summary.sender.initials
  elements.sender.textContent = summary.sender.name
  elements.address.textContent = summary.sender.address
  elements.time.textContent = summary.receivedLabel
  elements.time.dateTime = summary.receivedAt
  elements.context.textContent = `Loading · ${summary.subject} · ${summary.sender.name}`
  const loading = document.createElement('div')
  loading.className = 'dispatch-reader-loading'
  loading.textContent = 'Loading conversation…'
  elements.body.replaceChildren(loading)
  elements.attachments.replaceChildren()

  const key = `${summary.accountId ?? selectedAccountId ?? ''}:${summary.threadId}`
  let request = conversationCache.get(key)
  if (!request) {
    request = api.readConversation(summary.threadId, summary.accountId ?? selectedAccountId)
    conversationCache.set(key, request)
    request.catch(() => conversationCache.delete(key))
  }

  try {
    const conversation = await request
    if (sequence !== selectionSequence || selectedConversationId !== id) return
    selected = conversation
    elements.readState.hidden = !conversation.accountId
    elements.readState.textContent = conversation.unread ? 'Mark read' : 'Mark unread'
    elements.subject.textContent = conversation.subject
    elements.avatar.textContent = conversation.sender.initials
    elements.sender.textContent = conversation.sender.name
    elements.address.textContent = conversation.sender.address
    elements.time.textContent = conversation.receivedFullLabel
    elements.time.dateTime = conversation.receivedAt
    elements.context.textContent = `Working with · ${contextLabel(conversation)}`
    elements.body.replaceChildren(...conversation.messages.map(renderThreadMessage))
    prefetchConversations(id)
  } catch (error) {
    if (sequence !== selectionSequence) return
    loading.className = 'dispatch-reader-load-error'
    loading.textContent = error instanceof Error ? error.message : String(error)
    elements.context.textContent = `Unavailable · ${summary.subject}`
    window.setTimeout(() => {
      if (selectedConversationId === id) void selectConversation(id)
    }, 1_500)
  }
}

async function toggleReadState(): Promise<void> {
  if (!selected?.accountId) return
  const nextUnread = !selected.unread
  elements.readState.disabled = true
  elements.readState.textContent = nextUnread ? 'Marking unread…' : 'Marking read…'
  try {
    await api.setConversationUnread(selected.threadId, selected.accountId, nextUnread)
    selected = { ...selected, unread: nextUnread }
    conversations = conversations.map((conversation) => conversation.id === selected?.id ? { ...conversation, unread: nextUnread } : conversation)
    elements.readState.textContent = nextUnread ? 'Mark read' : 'Mark unread'
    renderList()
    void loadConversations()
  } catch (error) {
    elements.readState.textContent = selected.unread ? 'Mark read' : 'Mark unread'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    elements.readState.disabled = false
  }
}

function prefetchConversations(exceptId: string): void {
  for (const summary of conversations.filter((item) => item.id !== exceptId).slice(0, 3)) {
    const key = `${summary.accountId ?? selectedAccountId ?? ''}:${summary.threadId}`
    if (!conversationCache.has(key)) {
      const request = api.readConversation(summary.threadId, summary.accountId ?? selectedAccountId)
      conversationCache.set(key, request)
      request.catch(() => conversationCache.delete(key))
    }
  }
}

async function openDraft(): Promise<void> {
  if (!selected) return
  const draft: DraftProjection = selected.source === 'gmail' && selected.accountId
    ? await api.createDraft(selected.latestMessageId, { accountId: selected.accountId, to: selected.sender.address, subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`, bodyText: '' })
    : await api.createDraft(selected.latestMessageId)
  activeDraft = draft
  elements.body.hidden = true
  elements.attachments.hidden = true
  elements.draft.hidden = false
  elements.draftTo.value = draft.to.map((address) => address.address).join(', ')
  elements.draftSubject.value = draft.subject
  elements.draftBody.value = draft.bodyText
}

async function saveDraft(): Promise<void> {
  if (!activeDraft?.accountId) return
  activeDraft = await api.updateDraft(activeDraft.id, { accountId: activeDraft.accountId, messageId: activeDraft.inReplyToMessageId, to: elements.draftTo.value, subject: elements.draftSubject.value, bodyText: elements.draftBody.value })
  addAgentMessage('tool', 'Gmail draft saved.')
}

async function sendDraft(): Promise<void> {
  if (!activeDraft?.accountId) return
  await saveDraft()
  await api.sendDraft(activeDraft.id, activeDraft.accountId)
  addAgentMessage('agent', 'Gmail confirmed that the draft was sent.')
}

function addAgentMessage(kind: 'user' | 'agent' | 'tool' | 'error', text: string): HTMLElement {
  const item = document.createElement('div')
  item.className = `dispatch-agent-message dispatch-agent-${kind}`
  item.dataset.timestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  item.textContent = text
  elements.stream.append(item)
  elements.stream.scrollTop = elements.stream.scrollHeight
  return item
}

type AgentEvent = { id?: number | string; method?: string; params?: unknown }
const requestIds = new Map<string, number | string>()

function originalRequestId(card: HTMLElement): number | string | undefined {
  const key = card.dataset.requestId
  return key === undefined ? undefined : requestIds.get(key)
}

function requestText(params: Record<string, unknown> | undefined, fallback: string): string {
  return String(params?.reason ?? params?.message ?? fallback)
}

function addRequestButton(card: HTMLElement, label: string, result: unknown, primary = false): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  if (primary) button.className = 'dispatch-request-primary'
  button.addEventListener('click', () => {
    const id = originalRequestId(card)
    if (id === undefined) return
    card.querySelectorAll('button, input, select, textarea').forEach((control) => {
      ;(control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled = true
    })
    void api.respondToServerRequest(id, result).then(() => {
      card.classList.add('dispatch-request-resolved')
      elements.agentStatus.textContent = 'Working'
      const state = card.querySelector<HTMLElement>('[data-request-state]')
      if (state) state.textContent = label
    }).catch((error) => {
      card.querySelectorAll('button, input, select, textarea').forEach((control) => {
        ;(control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled = false
      })
      addAgentMessage('error', error instanceof Error ? error.message : String(error))
    })
  })
  card.querySelector('[data-request-actions]')?.append(button)
}

function renderUserInputRequest(card: HTMLElement, params: Record<string, unknown>): void {
  const questions = Array.isArray(params.questions) ? params.questions as Array<Record<string, unknown>> : []
  const fields = document.createElement('div')
  fields.className = 'dispatch-request-fields'
  for (const question of questions) {
    const label = document.createElement('label')
    label.textContent = String(question.question ?? question.header ?? 'Response')
    const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : []
    if (options.length > 0) {
      const select = document.createElement('select')
      select.dataset.questionId = String(question.id ?? '')
      for (const option of options) {
        const item = document.createElement('option')
        item.value = String(option.label ?? '')
        item.textContent = String(option.label ?? '')
        select.append(item)
      }
      label.append(select)
    } else {
      const input = document.createElement('input')
      input.dataset.questionId = String(question.id ?? '')
      input.placeholder = 'Type your response'
      label.append(input)
    }
    fields.append(label)
  }
  card.querySelector('[data-request-actions]')?.before(fields)
  const submit = document.createElement('button')
  submit.type = 'button'
  submit.className = 'dispatch-request-primary'
  submit.textContent = 'Submit'
  submit.addEventListener('click', () => {
    const answers: Record<string, { answers: string[] }> = {}
    fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-question-id]').forEach((field) => {
      answers[field.dataset.questionId ?? ''] = { answers: [field.value] }
    })
    const id = originalRequestId(card)
    if (id === undefined) return
    void api.respondToServerRequest(id, { answers }).then(() => {
      card.classList.add('dispatch-request-resolved')
      elements.agentStatus.textContent = 'Working'
      card.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach((control) => { control.disabled = true })
      const state = card.querySelector<HTMLElement>('[data-request-state]')
      if (state) state.textContent = 'Submitted'
    }).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error)))
  })
  card.querySelector('[data-request-actions]')?.append(submit)
}

function renderElicitationRequest(card: HTMLElement): void {
  const input = document.createElement('textarea')
  input.className = 'dispatch-request-json'
  input.value = '{}'
  input.setAttribute('aria-label', 'Requested information')
  card.querySelector('[data-request-actions]')?.before(input)
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'dispatch-request-primary'
  accept.textContent = 'Submit'
  accept.addEventListener('click', () => {
    try {
      const content = JSON.parse(input.value) as unknown
      const id = originalRequestId(card)
      if (id === undefined) return
      void api.respondToServerRequest(id, { action: 'accept', content }).then(() => {
        card.classList.add('dispatch-request-resolved')
        elements.agentStatus.textContent = 'Working'
        card.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea').forEach((control) => { control.disabled = true })
        const state = card.querySelector<HTMLElement>('[data-request-state]')
        if (state) state.textContent = 'Submitted'
      })
    } catch {
      addAgentMessage('error', 'The requested information must be valid JSON.')
    }
  })
  card.querySelector('[data-request-actions]')?.append(accept)
  addRequestButton(card, 'Decline', { action: 'decline', content: null })
}

function renderServerRequest(message: AgentEvent): void {
  if (message.id === undefined || !message.method) return
  const params = message.params as Record<string, unknown> | undefined
  const card = document.createElement('section')
  card.className = 'dispatch-agent-request'
  card.dataset.requestId = String(message.id)
  requestIds.set(card.dataset.requestId, message.id)
  card.dataset.timestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const title = document.createElement('strong')
  const description = document.createElement('p')
  const state = document.createElement('small')
  state.dataset.requestState = ''
  state.textContent = 'Waiting for you'
  const actions = document.createElement('div')
  actions.dataset.requestActions = ''
  card.append(title, description, state, actions)
  elements.stream.append(card)

  if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
    title.textContent = message.method.includes('fileChange') ? 'Approve file changes?' : 'Approve command?'
    description.textContent = requestText(params, 'Codex needs approval to continue this task.')
    addRequestButton(card, 'Allow once', { decision: 'accept' }, true)
    addRequestButton(card, 'Decline', { decision: 'decline' })
  } else if (message.method === 'item/permissions/requestApproval') {
    title.textContent = 'Approve permissions?'
    description.textContent = requestText(params, 'Codex needs additional permissions to continue this task.')
    addRequestButton(card, 'Allow for this turn', { permissions: params?.permissions ?? {}, scope: 'turn' }, true)
    addRequestButton(card, 'Decline', { permissions: {}, scope: 'turn' })
  } else if (message.method === 'tool/requestUserInput' || message.method === 'item/tool/requestUserInput') {
    title.textContent = 'Codex needs your input'
    description.textContent = 'Answer this question to continue the task.'
    renderUserInputRequest(card, params ?? {})
  } else if (message.method === 'mcpServer/elicitation/request') {
    title.textContent = 'Connector needs information'
    description.textContent = requestText(params, 'Provide the requested information to continue.')
    renderElicitationRequest(card)
  } else {
    title.textContent = 'Codex needs attention'
    description.textContent = `Unsupported request: ${message.method}`
    addRequestButton(card, 'Cancel request', { decision: 'cancel' })
  }
  elements.agentStatus.textContent = 'Needs attention'
  elements.stream.scrollTop = elements.stream.scrollHeight
}

function handleAgentEvent(message: AgentEvent): void {
  if (message.id !== undefined && message.method) {
    renderServerRequest(message)
    return
  }
  const params = message.params as Record<string, unknown> | undefined
  if (message.method === 'dispatch/appServerDisconnected') {
    agentEvents?.close()
    elements.agentStatus.textContent = 'Reconnecting'
    elements.connector.textContent = 'Restarting Codex App Server'
    scheduleAgentReconnect()
    return
  }
  if (message.method === 'serverRequest/resolved') {
    const requestId = String(params?.requestId ?? '')
    const card = elements.stream.querySelector<HTMLElement>(`[data-request-id="${CSS.escape(requestId)}"]`)
    if (card) {
      card.classList.add('dispatch-request-resolved')
      card.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea').forEach((control) => { control.disabled = true })
      const state = card.querySelector<HTMLElement>('[data-request-state]')
      if (state && state.textContent === 'Waiting for you') state.textContent = 'Resolved'
    }
    requestIds.delete(requestId)
  }
  if (message.method === 'turn/started') {
    const turn = params?.turn as Record<string, unknown> | undefined
    activeTurnId = typeof turn?.id === 'string' ? turn.id : undefined
    elements.stop.hidden = !activeTurnId
    elements.agentStatus.textContent = 'Working'
  }
  if (message.method === 'turn/completed') {
    const turn = params?.turn as Record<string, unknown> | undefined
    const status = String(turn?.status ?? 'completed')
    if (status === 'failed') {
      const error = turn?.error as Record<string, unknown> | undefined
      elements.agentStatus.textContent = 'Failed'
      addAgentMessage('error', String(error?.message ?? 'The Codex turn failed.'))
    } else {
      elements.agentStatus.textContent = status === 'interrupted' ? 'Interrupted' : 'Connected'
    }
    activeAgentMessage = undefined
    activeTurnId = undefined
    elements.stop.hidden = true
  }
  if (message.method === 'item/agentMessage/delta') {
    if (!activeAgentMessage) activeAgentMessage = addAgentMessage('agent', '')
    activeAgentMessage.textContent += String(params?.delta ?? '')
  }
  if (message.method === 'item/started') {
    const item = params?.item as Record<string, unknown> | undefined
    if (item?.type === 'mcpToolCall') addAgentMessage('tool', `Using ${String(item.server ?? 'connector')} · ${String(item.tool ?? 'tool')}`)
  }
  if (message.method === 'turn/plan/updated') {
    const plan = Array.isArray(params?.plan) ? params.plan as Array<Record<string, unknown>> : []
    addAgentMessage('tool', plan.map((item) => `${String(item.status ?? '')}: ${String(item.step ?? '')}`).join('\n'))
  }
  if (message.method === 'item/completed') {
    const item = params?.item as Record<string, unknown> | undefined
    if (item?.type === 'agentMessage') activeAgentMessage = undefined
  }
  if (message.method === 'error') {
    const error = params?.error as Record<string, unknown> | undefined
    elements.agentStatus.textContent = 'Failed'
    addAgentMessage('error', String(error?.message ?? params?.message ?? 'Codex reported an error.'))
  }
}

function scheduleAgentReconnect(): void {
  if (reconnectTimer !== undefined) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    void connectAgent()
  }, 1500)
}

function agentHistoryText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(agentHistoryText).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  for (const field of ['text', 'content', 'value']) {
    const extracted = agentHistoryText(item[field])
    if (extracted) return extracted
  }
  return ''
}

async function connectAgent(): Promise<void> {
  if (agentConnecting) return
  agentConnecting = true
  if (!await api.agentReady()) {
    elements.agentStatus.textContent = 'Reconnecting'
    elements.connector.textContent = 'Waiting for Codex App Server'
    agentConnecting = false
    scheduleAgentReconnect()
    return
  }
  try {
    apps = accounts
      .filter((account) => account.connectorId)
      .map((account) => ({ id: account.connectorId, name: 'Gmail', isAccessible: true, isEnabled: true }))
    if (apps.length === 0) apps = await api.listApps()
    const gmail = gmailAppId(apps)
    elements.connector.textContent = gmail ? 'Gmail available' : 'No Gmail connector'
    if (threadId) {
      try { threadId = await api.resumeThread(threadId) } catch { threadId = await api.startThread() }
    } else {
      threadId = await api.startThread()
    }
    localStorage.setItem('dispatch.codex.threadId', threadId)
    try {
      const history = await api.readThread(threadId) as { thread?: { turns?: Array<{ items?: Array<Record<string, unknown>> }> } }
      const restored = history.thread?.turns?.flatMap((turn) => turn.items ?? []) ?? []
      if (restored.length > 0 && elements.stream.querySelectorAll('.dispatch-agent-message').length === 0) {
        for (const item of restored) {
          const text = agentHistoryText(item)
          if (text && item.type === 'userMessage') addAgentMessage('user', text)
          if (text && item.type === 'agentMessage') addAgentMessage('agent', text)
        }
      }
    } catch (error) {
      addAgentMessage('error', `Could not restore Codex history: ${error instanceof Error ? error.message : String(error)}`)
    }
    agentEvents?.close()
    agentEvents = api.events(threadId)
    agentEvents.onopen = () => { elements.agentStatus.textContent = 'Connected' }
    agentEvents.onmessage = (event) => handleAgentEvent(JSON.parse(event.data) as AgentEvent)
    agentEvents.onerror = () => {
      agentEvents?.close()
      elements.agentStatus.textContent = 'Reconnecting'
      scheduleAgentReconnect()
    }
  } catch (error) {
    elements.agentStatus.textContent = 'Reconnecting'
    elements.connector.textContent = error instanceof Error ? error.message : String(error)
    scheduleAgentReconnect()
  } finally {
    agentConnecting = false
  }
}

async function sendPrompt(): Promise<void> {
  const text = elements.prompt.value.trim()
  if (!text || !threadId) return
  addAgentMessage('user', text)
  elements.agentStatus.textContent = 'Working'
  elements.prompt.value = ''
  try {
    if (activeTurnId) {
      await api.steerTurn(threadId, activeTurnId, text)
      return
    }
    await api.startTurn(threadId, {
      text,
      appId: gmailAppId(apps),
      mailContext: selected ? { messageId: selected.latestMessageId, threadId: selected.threadId, subject: selected.subject, sender: selected.sender.address, attachment: selectedAttachmentContext } : undefined,
    })
  } catch (error) {
    addAgentMessage('error', error instanceof Error ? error.message : String(error))
  }
}

async function loadConversations(): Promise<void> {
  const loadSequence = ++conversationLoadSequence
  const cacheKey = `dispatch.conversations.v1:${selectedAccountId ?? 'all'}:${mailState}:${searchQuery}`
  let usedCache = false
  let cacheConfirmedAt: number | undefined
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { savedAt?: number; conversations?: ConversationSummary[]; nextCursor?: string | null; total?: number } | null
    if (cached?.savedAt && Date.now() - cached.savedAt < 86_400_000 && Array.isArray(cached.conversations)) {
      conversations = cached.conversations
      usedCache = true
      cacheConfirmedAt = cached.savedAt
      nextConversationCursor = cached.nextCursor ?? null
      conversationTotal = cached.total ?? cached.conversations.length
    } else {
      conversations = []
      nextConversationCursor = null
      conversationTotal = 0
    }
  } catch {
    conversations = []
  }
  if (!usedCache && mailState !== 'all' && !searchQuery) {
    try {
      const allKey = `dispatch.conversations.v1:${selectedAccountId ?? 'all'}:all:`
      const cachedAll = JSON.parse(localStorage.getItem(allKey) ?? 'null') as { savedAt?: number; conversations?: ConversationSummary[]; total?: number } | null
      if (cachedAll?.savedAt && Date.now() - cachedAll.savedAt < 86_400_000 && Array.isArray(cachedAll.conversations)) {
        conversations = cachedAll.conversations.filter((conversation) => mailState === 'unread' ? conversation.unread : !conversation.unread)
        usedCache = true
        cacheConfirmedAt = cachedAll.savedAt
        nextConversationCursor = null
        conversationTotal = conversations.length
      }
    } catch {
      // A malformed optional cache must not block a live Gmail refresh.
    }
  }
  const cacheLabel = cacheConfirmedAt
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(cacheConfirmedAt))
    : ''
  elements.mailSource.textContent = usedCache ? `Refreshing · cached ${cacheLabel}` : 'Loading'
  elements.mailError.hidden = true
  selected = undefined
  selectedConversationId = undefined
  selectionSequence += 1
  elements.reader.hidden = true
  elements.readerEmpty.hidden = false
  elements.readerEmpty.textContent = usedCache && conversations.length > 0 ? 'Select a message' : `Loading ${mailState === 'all' ? '' : `${mailState} `}messages…`
  app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mailState === mailState))
  })
  renderList(usedCache ? defaultEmptyListMessage() : 'Loading messages…')
  if (usedCache && conversations[0]) void selectConversation(conversations[0].id)
  try {
    const result = await api.listConversations(mailState, selectedAccountId, undefined, searchQuery)
    if (loadSequence !== conversationLoadSequence) return
    conversations = result.conversations
    if (mailReconnectTimer !== undefined) window.clearTimeout(mailReconnectTimer)
    mailReconnectTimer = undefined
    nextConversationCursor = result.nextCursor ?? null
    conversationTotal = result.total ?? conversations.length
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), conversations, nextCursor: nextConversationCursor, total: conversationTotal }))
    const refreshedLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
    elements.mailSource.textContent = result.source === 'demo'
      ? 'Demo mail'
      : `${!selectedAccountId && accounts.length > 1 ? 'Unified Gmail' : 'Gmail connected'} · ${refreshedLabel}`
    renderList()
    if (conversations[0]) {
      if (!selectedConversationId || !conversations.some((conversation) => conversation.id === selectedConversationId)) await selectConversation(conversations[0].id)
    } else {
      selected = undefined
      selectedConversationId = undefined
      elements.reader.hidden = true
      elements.readerEmpty.hidden = false
      elements.readerEmpty.textContent = defaultEmptyListMessage()
      elements.context.textContent = 'No email selected'
    }
  } catch (error) {
    if (loadSequence !== conversationLoadSequence) return
    if (usedCache) {
      elements.mailSource.textContent = `STALE · ${cacheLabel}`
      elements.mailError.hidden = false
      const detail = error instanceof Error ? error.message : String(error)
      elements.mailError.textContent = `Gmail refresh failed: ${detail}. Showing data last confirmed ${cacheLabel}.`
      scheduleMailReconnect()
      return
    }
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
    scheduleMailReconnect()
  }
}

function syncTime(value: string | null): string {
  if (!value) return 'never'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

async function refreshSyncStatus(): Promise<void> {
  try {
    const sync = await api.syncStatus()
    if (sync.state === 'failed') {
      elements.mailSource.textContent = `SYNC FAILED · ${syncTime(sync.startedAt)}`
      elements.mailError.hidden = false
      elements.mailError.textContent = sync.error ?? 'Gmail synchronization failed without an error detail.'
      syncErrorVisible = true
    } else if (sync.state === 'syncing') {
      const accountProgress = sync.accountCount
        ? ` · account ${Math.min((sync.accountsCompleted ?? 0) + 1, sync.accountCount)}/${sync.accountCount}`
        : ''
      elements.mailSource.textContent = `Syncing Gmail${accountProgress} · ${sync.fetchedMessages ?? sync.messageCount} fetched`
    } else if (sync.state === 'partial') {
      elements.mailSource.textContent = `Partial Gmail index · ${sync.messageCount} messages`
    } else if (sync.state === 'ready') {
      elements.mailSource.textContent = `Gmail synced · ${syncTime(sync.completedAt)}`
      if (syncErrorVisible) elements.mailError.hidden = true
      syncErrorVisible = false
      if (mailState === 'all' && conversations.length === 0) void loadConversations()
    }
  } catch (error) {
    elements.mailSource.textContent = 'SYNC STATUS FAILED'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
    syncErrorVisible = true
  }
}

function startSyncStatusWatch(): void {
  if (syncStatusTimer !== undefined) return
  void refreshSyncStatus()
  syncStatusTimer = window.setInterval(() => { void refreshSyncStatus() }, 5_000)
}

function scheduleMailReconnect(): void {
  if (mailReconnectTimer !== undefined) return
  mailReconnectTimer = window.setTimeout(() => {
    mailReconnectTimer = undefined
    void connectMail()
  }, 1_500)
}

async function connectMail(): Promise<void> {
  try {
    accounts = await api.listAccounts()
    if (accounts.length > 0) {
      const all = document.createElement('option')
      all.value = ''
      all.textContent = `All Gmail inboxes (${accounts.length})`
      all.selected = !selectedAccountId
      elements.account.replaceChildren(all, ...accounts.map((account) => {
        const option = document.createElement('option')
        option.value = account.id
        option.textContent = account.email || account.name
        option.selected = account.id === selectedAccountId
        return option
      }))
      elements.accountWrap.hidden = false
    }
    await loadConversations()
    if (accounts.length > 0) startSyncStatusWatch()
  } catch (error) {
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
    scheduleMailReconnect()
  }
}

async function start(): Promise<void> {
  await Promise.all([connectMail(), connectAgent()])
}

app.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload())
elements.account.addEventListener('change', () => {
  selectedAccountId = elements.account.value || undefined
  void loadConversations()
})
elements.search.addEventListener('input', () => {
  searchQuery = elements.search.value.trim()
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void loadConversations() }, 250)
})
app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => button.addEventListener('click', () => {
  mailState = button.dataset.mailState as MailStateFilter
  void loadConversations()
}))
app.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => button.addEventListener('click', () => {
  const name = button.dataset.panel as PanelName
  const visibleCount = Number(panels.messages) + Number(panels.reader) + Number(panels.agent)
  if (panels[name] && visibleCount === 1) return
  panels[name] = !panels[name]
  renderPanels()
}))
elements.messagesDivider.addEventListener('pointerdown', (event) => resizePanel('messagesWidth', event))
elements.agentDivider.addEventListener('pointerdown', (event) => resizePanel('agentWidth', event))
app.querySelectorAll('[data-compose], [data-reply]').forEach((button) => button.addEventListener('click', () => { void openDraft() }))
app.querySelector('[data-ask]')?.addEventListener('click', () => elements.prompt.focus())
app.querySelector('[data-save-draft]')?.addEventListener('click', () => { void saveDraft() })
app.querySelector('[data-send-draft]')?.addEventListener('click', () => { void sendDraft() })
app.querySelector('[data-revise-draft]')?.addEventListener('click', () => { elements.prompt.value = `Revise this draft:\n\n${elements.draftBody.value}`; elements.prompt.focus() })
elements.readState.addEventListener('click', () => { void toggleReadState() })
app.querySelector('[data-send]')?.addEventListener('click', () => { void sendPrompt() })
elements.stop.addEventListener('click', () => {
  if (threadId && activeTurnId) void api.interruptTurn(threadId, activeTurnId)
})
app.querySelectorAll<HTMLElement>('[data-suggestion]').forEach((button) => button.addEventListener('click', () => {
  elements.prompt.value = button.dataset.suggestion ?? ''
  elements.prompt.focus()
}))
elements.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
})

renderPanels()
void start()
