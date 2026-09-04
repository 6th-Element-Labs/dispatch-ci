import '@tabler/core/dist/css/tabler.min.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles.css'
import { api } from './api.js'
import { renderChatMarkdown } from './chat-renderer.js'
import { renderEmailContent } from './email-renderer.js'
import type { AppSummary, ConversationProjection, ConversationSummary, DraftProjection, GmailAccount, GmailConversationAction, GmailMailbox, MailAddress, MailStateFilter, MessageProjection } from './contracts.js'
import { contextLabel, gmailAppId } from './model.js'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('Dispatch app root is missing')
const app: HTMLDivElement = appElement

app.innerHTML = `
  <div class="page dispatch-window">
    <header class="navbar navbar-expand-md d-print-none dispatch-titlebar">
      <div class="container-fluid">
        <div class="navbar-brand navbar-brand-autodark m-0"><span class="avatar avatar-sm bg-blue text-white">D</span><strong>Dispatch</strong><span class="badge bg-blue-lt text-blue">All Gmail inboxes</span></div>
        <label class="input-icon dispatch-search"><span class="input-icon-addon"><i class="ti ti-search" aria-hidden="true"></i></span><input class="form-control" placeholder="Search Gmail" aria-label="Search mail"></label>
        <div class="navbar-nav flex-row align-items-center gap-2 ms-auto"><button class="btn btn-icon btn-outline-secondary" type="button" data-refresh aria-label="Refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button><button class="btn btn-primary" type="button" data-compose><i class="ti ti-square-rounded-plus me-1" aria-hidden="true"></i>Compose</button></div>
      </div>
    </header>
    <div class="dispatch-workspace">
      <nav class="dispatch-rail nav nav-pills flex-column bg-white" aria-label="Mail folders"><button type="button" class="nav-link active" data-mailbox="inbox"><i class="ti ti-inbox" aria-hidden="true"></i><span>Inbox</span></button><button type="button" class="nav-link" data-mailbox="sent"><i class="ti ti-send" aria-hidden="true"></i><span>Sent</span></button><button type="button" class="nav-link" data-mailbox="drafts"><i class="ti ti-file-pencil" aria-hidden="true"></i><span>Drafts</span></button><button type="button" class="nav-link" data-mailbox="archive"><i class="ti ti-archive" aria-hidden="true"></i><span>Archive</span></button><span class="dispatch-rail-spacer"></span><button type="button" class="nav-link" data-mailbox="spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i><span>Spam</span></button><button type="button" class="nav-link" data-mailbox="trash"><i class="ti ti-trash" aria-hidden="true"></i><span>Trash</span></button></nav>
      <aside class="card rounded-0 border-0 dispatch-messages" aria-label="Messages">
        <div class="card-header dispatch-pane-heading"><div><h1 class="card-title mb-1" data-mailbox-title>Inbox</h1><span class="text-secondary" data-mail-source>Loading</span></div><button class="btn btn-icon btn-ghost-secondary" type="button" aria-label="Message filters"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i></button></div>
        <label class="dispatch-folder-select px-3 pt-3"><span class="form-label mb-1">Folder</span><select class="form-select form-select-sm" data-mailbox-select aria-label="Gmail folder"><option value="inbox">Inbox</option><option value="sent">Sent</option><option value="drafts">Drafts</option><option value="archive">Archive</option><option value="spam">Spam</option><option value="trash">Trash</option></select></label>
        <label class="dispatch-account px-3 pt-3" hidden><span class="form-label mb-1">Gmail account</span><select class="form-select form-select-sm" data-account aria-label="Gmail account"></select></label>
        <div class="btn-group mx-3 my-3 dispatch-mail-filters" role="group" aria-label="Message state"><button class="btn btn-sm active" type="button" data-mail-state="all" aria-pressed="true">All</button><button class="btn btn-sm" type="button" data-mail-state="unread" aria-pressed="false">Unread</button><button class="btn btn-sm" type="button" data-mail-state="read" aria-pressed="false">Read</button></div>
        <div class="list-group list-group-flush dispatch-message-list" data-message-list></div>
        <div class="alert alert-danger m-3 dispatch-pane-error" role="alert" data-mail-error hidden></div>
      </aside>
      <div class="dispatch-divider" data-divider="messages" role="separator" aria-label="Resize messages panel" aria-orientation="vertical"></div>
      <main class="card rounded-0 border-0 dispatch-reader" aria-label="Selected email">
        <div class="empty dispatch-reader-empty" data-reader-empty><div class="empty-icon"><i class="ti ti-mail-opened"></i></div><p class="empty-title">Select a message</p></div>
        <div data-reader hidden>
          <header class="card-header dispatch-reader-header">
            <div class="w-100"><div class="d-flex align-items-start gap-2"><div class="flex-grow-1"><span class="subheader">Selected thread</span><h2 class="card-title mt-1 mb-3" data-subject></h2></div><div class="btn-list flex-nowrap dispatch-message-actions"><button class="btn btn-icon btn-ghost-secondary" type="button" data-move-inbox aria-label="Move to Inbox" hidden><i class="ti ti-inbox" aria-hidden="true"></i></button><button class="btn btn-icon btn-ghost-secondary" type="button" data-archive aria-label="Archive"><i class="ti ti-archive" aria-hidden="true"></i></button><button class="btn btn-icon btn-ghost-secondary" type="button" data-spam aria-label="Mark as spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i></button><button class="btn btn-icon btn-ghost-danger" type="button" data-trash aria-label="Move to Trash"><i class="ti ti-trash" aria-hidden="true"></i></button></div></div>
            <div class="dispatch-sender"><span class="avatar avatar-sm bg-blue-lt text-blue" data-avatar></span><span><strong data-sender></strong><small class="text-secondary" data-address></small></span><time class="text-secondary ms-auto" data-time></time></div></div>
          </header>
          <article class="dispatch-email-body" data-body></article>
          <section class="dispatch-attachments" data-attachments></section>
          <section class="card-body dispatch-draft" data-draft hidden>
            <div class="card"><div class="card-header"><div><span class="badge bg-blue-lt text-blue me-2">Draft</span><strong>Reply preview</strong></div><span class="text-secondary small">Nothing sends without approval</span></div><div class="card-body">
            <label class="form-label">From<select class="form-select mt-1" data-draft-account aria-label="Draft account"></select></label>
            <label class="form-label">To<input class="form-control mt-1" data-draft-to aria-label="Draft recipient"></label>
            <div class="row g-3 mt-0"><label class="col form-label">Cc<input class="form-control mt-1" data-draft-cc aria-label="Draft Cc"></label><label class="col form-label">Bcc<input class="form-control mt-1" data-draft-bcc aria-label="Draft Bcc"></label></div>
            <label class="form-label">Subject<input class="form-control mt-1" data-draft-subject aria-label="Draft subject"></label>
            <label class="form-label">Message<textarea class="form-control mt-1" data-draft-body aria-label="Draft body"></textarea></label>
            </div><footer class="card-footer d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary" type="button" data-save-draft>Save draft</button><button class="btn btn-outline-secondary" type="button" data-revise-draft><i class="ti ti-sparkles me-1" aria-hidden="true"></i>Ask Codex to revise</button><button class="btn btn-primary ms-auto" type="button" data-send-draft><i class="ti ti-send me-1" aria-hidden="true"></i>Send draft</button></footer></div>
          </section>
          <footer class="card-footer dispatch-reader-actions"><button class="btn btn-primary" type="button" data-reply><i class="ti ti-reply me-1" aria-hidden="true"></i>Reply</button><button class="btn btn-outline-secondary" type="button" data-reply-all><i class="ti ti-arrow-back-up-double me-1" aria-hidden="true"></i>Reply all</button><button class="btn btn-outline-secondary" type="button" data-forward><i class="ti ti-arrow-forward-up me-1" aria-hidden="true"></i>Forward</button><button class="btn btn-outline-secondary" type="button" data-read-state>Mark unread</button><button class="btn btn-outline-secondary" type="button" data-ask><i class="ti ti-sparkles me-1" aria-hidden="true"></i>Ask Codex</button></footer>
        </div>
      </main>
      <div class="dispatch-divider" data-divider="agent" role="separator" aria-label="Resize Codex panel" aria-orientation="vertical"></div>
      <aside class="card rounded-0 border-0 dispatch-agent" aria-label="Codex">
        <header class="card-header"><div class="d-flex align-items-center w-100"><span class="avatar avatar-sm bg-dark text-white me-2">✦</span><strong>Codex</strong><span class="badge bg-secondary-lt ms-auto" data-agent-status>Connecting</span></div><div class="alert alert-info mt-3 mb-0 py-2 px-3 dispatch-context" data-context>No email selected</div></header>
        <div class="dispatch-agent-stream" data-agent-stream><p class="dispatch-agent-intro">Use the installed Codex harness with your selected email in view.</p></div>
        <footer class="card-footer">
          <div class="dispatch-suggestions"><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Catch me up on this email.">Catch me up</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Draft a reply to this email.">Draft a reply</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Find related messages in Gmail.">Find related</button></div>
          <div class="card card-sm dispatch-prompt"><div class="card-body p-2"><textarea class="form-control border-0 shadow-none" data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea><div class="d-flex align-items-center justify-content-between mt-2"><span class="text-secondary small" data-connector>Checking connectors</span><span><button class="btn btn-icon btn-sm btn-outline-danger" type="button" data-stop aria-label="Stop" hidden><i class="ti ti-player-stop-filled" aria-hidden="true"></i></button><button class="btn btn-icon btn-sm btn-primary" type="button" data-send aria-label="Send"><i class="ti ti-arrow-up" aria-hidden="true"></i></button></span></div></div></div>
        </footer>
      </aside>
    </div>
    <footer class="dispatch-statusbar border-top bg-white"><span class="text-secondary"><i class="ti ti-circle-check text-green me-1" aria-hidden="true"></i><span data-status-summary>Gmail and Codex status shown in each pane</span></span><div class="btn-group dispatch-panel-controls" role="group" aria-label="Visible panels"><button class="btn btn-sm active" type="button" data-panel="messages" aria-pressed="true">Messages</button><button class="btn btn-sm active" type="button" data-panel="reader" aria-pressed="true">Email</button><button class="btn btn-sm active" type="button" data-panel="agent" aria-pressed="true">Codex</button></div></footer>
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
  mailboxTitle: app.querySelector<HTMLElement>('[data-mailbox-title]')!,
  mailboxSelect: app.querySelector<HTMLSelectElement>('[data-mailbox-select]')!,
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
  draftCc: app.querySelector<HTMLInputElement>('[data-draft-cc]')!,
  draftBcc: app.querySelector<HTMLInputElement>('[data-draft-bcc]')!,
  draftAccount: app.querySelector<HTMLSelectElement>('[data-draft-account]')!,
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
  archive: app.querySelector<HTMLButtonElement>('[data-archive]')!,
  spam: app.querySelector<HTMLButtonElement>('[data-spam]')!,
  trash: app.querySelector<HTMLButtonElement>('[data-trash]')!,
  moveInbox: app.querySelector<HTMLButtonElement>('[data-move-inbox]')!,
  statusSummary: app.querySelector<HTMLElement>('[data-status-summary]')!,
}

function renderServiceStatus(): void {
  elements.agentStatus.classList.remove('bg-secondary-lt', 'bg-green-lt', 'text-green', 'bg-blue-lt', 'text-blue', 'bg-yellow-lt', 'text-yellow', 'bg-red-lt', 'text-red')
  const status = elements.agentStatus.textContent?.trim() ?? ''
  if (status === 'Connected') elements.agentStatus.classList.add('bg-green-lt', 'text-green')
  else if (status === 'Working') elements.agentStatus.classList.add('bg-blue-lt', 'text-blue')
  else if (status === 'Needs attention') elements.agentStatus.classList.add('bg-yellow-lt', 'text-yellow')
  else if (status === 'Failed') elements.agentStatus.classList.add('bg-red-lt', 'text-red')
  else elements.agentStatus.classList.add('bg-secondary-lt')
  elements.statusSummary.textContent = `${elements.mailSource.textContent?.trim() || 'Gmail loading'} · Codex ${status || 'connecting'}`
}

new MutationObserver(renderServiceStatus).observe(elements.mailSource, { childList: true, subtree: true })
new MutationObserver(renderServiceStatus).observe(elements.agentStatus, { childList: true, subtree: true })
renderServiceStatus()
let activeDraft: DraftProjection | undefined

let conversations: ConversationSummary[] = []
let conversationTotal = 0
let nextConversationCursor: string | null = null
let loadingMoreConversations = false
let accounts: GmailAccount[] = []
let selectedAccountId: string | undefined
let mailState: MailStateFilter = 'all'
let mailbox: GmailMailbox = 'inbox'
let selected: ConversationProjection | undefined
let selectedConversationId: string | undefined
let selectionSequence = 0
let conversationLoadSequence = 0
const conversationCache = new Map<string, Promise<ConversationProjection>>()
let threadId: string | undefined = localStorage.getItem('dispatch.codex.threadId') || undefined
let apps: AppSummary[] = []
let activeAgentMessage: HTMLElement | undefined
let activeAgentText = ''
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
  const defaults: PanelState = { messages: true, reader: true, agent: true, messagesWidth: 290, agentWidth: 340 }
  try {
    const saved = JSON.parse(localStorage.getItem('dispatch.panels.v1') ?? '{}') as Partial<PanelState>
    return {
      messages: saved.messages ?? defaults.messages,
      reader: saved.reader ?? defaults.reader,
      agent: saved.agent ?? defaults.agent,
      messagesWidth: Math.max(220, Math.min(440, saved.messagesWidth ?? defaults.messagesWidth)),
      agentWidth: Math.max(280, Math.min(480, saved.agentWidth ?? defaults.agentWidth)),
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

  let messagesWidth = panels.messagesWidth
  let agentWidth = panels.agentWidth
  if (panels.messages && panels.reader && panels.agent) {
    const sideWidth = Math.max(500, window.innerWidth - 72 - 10 - 360)
    if (messagesWidth + agentWidth > sideWidth) {
      messagesWidth = Math.max(220, Math.round(sideWidth * .44))
      agentWidth = Math.max(280, sideWidth - messagesWidth)
    }
  }
  const columns: string[] = ['72px']
  if (panels.messages) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${messagesWidth}px`)
  if (!elements.messagesDivider.hidden) columns.push('5px')
  if (panels.reader) columns.push('minmax(280px, 1fr)')
  if (!elements.agentDivider.hidden) columns.push('5px')
  if (panels.agent) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${agentWidth}px`)
  elements.workspace.style.gridTemplateColumns = columns.join(' ')
  app.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => {
    const name = button.dataset.panel as PanelName
    button.setAttribute('aria-pressed', String(panels[name]))
    button.classList.toggle('active', panels[name])
  })
  localStorage.setItem('dispatch.panels.v1', JSON.stringify(panels))
}

function resizePanel(name: 'messagesWidth' | 'agentWidth', event: PointerEvent): void {
  const startX = event.clientX
  const startWidth = panels[name]
  const direction = name === 'messagesWidth' ? 1 : -1
  const move = (next: PointerEvent) => {
    const limit = name === 'messagesWidth' ? [220, 440] : [280, 480]
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
  const label = mailbox === 'drafts' ? 'drafts' : mailbox
  if (mailState === 'unread') return `No unread messages in ${label}.`
  if (mailState === 'read') return `No read messages in ${label}.`
  return `No messages in ${label}.`
}

const mailboxLabels: Record<GmailMailbox, string> = { inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', archive: 'Archive', spam: 'Spam', trash: 'Trash' }

function renderMailbox(): void {
  elements.mailboxTitle.textContent = mailboxLabels[mailbox]
  elements.mailboxSelect.value = mailbox
  app.querySelectorAll<HTMLButtonElement>('[data-mailbox]').forEach((button) => {
    const active = button.dataset.mailbox === mailbox
    button.classList.toggle('active', active)
    button.setAttribute('aria-current', active ? 'page' : 'false')
  })
  elements.archive.hidden = mailbox !== 'inbox'
  elements.spam.hidden = mailbox === 'spam' || mailbox === 'trash'
  elements.trash.hidden = mailbox === 'trash'
  elements.moveInbox.hidden = mailbox !== 'archive' && mailbox !== 'spam' && mailbox !== 'trash'
}

function renderList(emptyMessage = defaultEmptyListMessage()): void {
  elements.list.innerHTML = ''
  if (conversations.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty text-secondary p-4 dispatch-message-list-empty'
    empty.textContent = emptyMessage
    elements.list.append(empty)
    return
  }
  for (const conversation of conversations) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'list-group-item list-group-item-action dispatch-message'
    button.dataset.conversationId = conversation.id
    button.setAttribute('aria-selected', String(selectedConversationId === conversation.id))
    button.setAttribute('aria-label', `${conversation.sender.name}, ${conversation.subject}${conversation.unread ? ', unread' : ''}`)
    button.classList.toggle('dispatch-message-unread', conversation.unread)
    button.classList.toggle('active', selectedConversationId === conversation.id)
    const avatar = document.createElement('span')
    avatar.className = 'avatar avatar-sm bg-blue-lt text-blue dispatch-avatar'
    avatar.textContent = conversation.sender.initials
    if (conversation.unread) {
      const unread = document.createElement('span')
      unread.className = 'avatar-status bg-blue'
      avatar.append(unread)
    }
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
    more.className = 'btn btn-outline-secondary m-3 dispatch-load-more'
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
    const result = await api.listConversations(mailState, selectedAccountId, nextConversationCursor, searchQuery, mailbox)
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
  article.className = 'card dispatch-thread-message'
  const header = document.createElement('header')
  header.className = 'card-header'
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
  content.classList.add('card-body')
  const attachmentList = document.createElement('div')
  attachmentList.className = 'card-footer d-grid gap-2 dispatch-thread-attachments'
  for (const attachment of message.attachments) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'btn btn-outline-secondary text-start'
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
  elements.reader.classList.remove('dispatch-drafting')
  elements.reader.classList.remove('dispatch-composing')
  renderMailbox()
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
  loading.className = 'empty text-secondary dispatch-reader-loading'
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
    loading.className = 'alert alert-danger m-4 dispatch-reader-load-error'
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
    await api.setConversationUnread(selected.threadId, selected.accountId, nextUnread, selected.messages.map((message) => message.id))
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

function draftAddressList(addresses: readonly MailAddress[] | undefined): string {
  return (addresses ?? []).map((address) => address.address).filter(Boolean).join(', ')
}

function showDraft(draft: DraftProjection, accountMutable: boolean): void {
  activeDraft = draft
  elements.reader.hidden = false
  elements.readerEmpty.hidden = true
  elements.reader.classList.add('dispatch-drafting')
  elements.reader.classList.toggle('dispatch-composing', !selected)
  if (!selected) [elements.archive, elements.spam, elements.trash, elements.moveInbox].forEach((control) => { control.hidden = true })
  elements.body.hidden = !selected
  elements.attachments.hidden = true
  elements.draft.hidden = false
  elements.draftAccount.replaceChildren(...accounts.map((account) => {
    const option = document.createElement('option')
    option.value = account.id
    option.textContent = account.email || account.name
    option.selected = account.id === draft.accountId
    return option
  }))
  elements.draftAccount.disabled = !accountMutable
  elements.draftTo.value = draft.to.map((address) => address.address).join(', ')
  elements.draftCc.value = draft.cc ?? ''
  elements.draftBcc.value = draft.bcc ?? ''
  elements.draftSubject.value = draft.subject
  elements.draftBody.value = draft.bodyText
}

async function openDraft(replyAll = false): Promise<void> {
  if (!selected) return
  const accountId = selected.accountId
  const latest = selected.messages.at(-1)
  const own = accounts.find((account) => account.id === accountId)?.email.toLowerCase()
  const participants = [selected.sender, ...(latest?.to ?? [])].filter((address, index, values) => address.address.toLowerCase() !== own && values.findIndex((item) => item.address.toLowerCase() === address.address.toLowerCase()) === index)
  const primary = participants[0] ?? selected.sender
  const to = replyAll ? draftAddressList(participants) : primary.address
  const cc = replyAll ? draftAddressList((latest?.cc ?? []).filter((address) => address.address.toLowerCase() !== own && !participants.some((item) => item.address.toLowerCase() === address.address.toLowerCase()))) : ''
  const draft: DraftProjection = selected.source === 'gmail' && accountId
    ? await api.createDraft(selected.latestMessageId, { accountId, to, cc, bcc: '', subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`, bodyText: '' })
    : await api.createDraft(selected.latestMessageId)
  showDraft(draft, false)
}

async function openForward(): Promise<void> {
  if (!selected?.accountId) return
  const latest = selected.messages.at(-1)
  if (!latest) return
  const subject = selected.subject.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject}`
  const content = renderEmailContent(latest.body.kind, latest.body.content).textContent?.trim() ?? ''
  const bodyText = `\n\n---------- Forwarded message ----------\nFrom: ${latest.sender.name} <${latest.sender.address}>\nDate: ${latest.receivedFullLabel}\nSubject: ${latest.subject}\n\n${content}`
  const draft = await api.createDraft('', { accountId: selected.accountId, to: '', cc: '', bcc: '', subject, bodyText })
  showDraft(draft, false)
}

function openCompose(): void {
  const accountId = selectedAccountId ?? selected?.accountId ?? accounts[0]?.id
  if (!accountId) {
    addAgentMessage('error', 'Connect a Gmail account before composing mail.')
    return
  }
  selected = undefined
  selectedConversationId = undefined
  elements.subject.textContent = 'New message'
  elements.sender.textContent = 'Compose'
  elements.address.textContent = 'Draft preview'
  elements.time.textContent = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const draft: DraftProjection = { id: '', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: '', bodyText: '', state: 'draft', accountId }
  showDraft(draft, true)
}

async function saveDraft(): Promise<void> {
  if (!activeDraft) return
  const accountId = activeDraft.id ? activeDraft.accountId : elements.draftAccount.value
  if (!accountId) throw new Error('Choose a Gmail account for this draft.')
  activeDraft = activeDraft.id
    ? await api.updateDraft(activeDraft.id, { accountId, messageId: activeDraft.inReplyToMessageId, to: elements.draftTo.value, cc: elements.draftCc.value, bcc: elements.draftBcc.value, subject: elements.draftSubject.value, bodyText: elements.draftBody.value })
    : await api.createDraft('', { accountId, to: elements.draftTo.value, cc: elements.draftCc.value, bcc: elements.draftBcc.value, subject: elements.draftSubject.value, bodyText: elements.draftBody.value })
  elements.draftAccount.disabled = true
  addAgentMessage('tool', 'Gmail draft saved.')
}

async function sendDraft(): Promise<void> {
  if (!activeDraft?.accountId) return
  await saveDraft()
  await api.sendDraft(activeDraft.id, activeDraft.accountId)
  addAgentMessage('agent', 'Gmail confirmed that the draft was sent.')
}

async function mutateSelected(action: GmailConversationAction): Promise<void> {
  if (!selected?.accountId) return
  const controls = [elements.archive, elements.spam, elements.trash, elements.moveInbox]
  controls.forEach((control) => { control.disabled = true })
  try {
    await api.mutateConversation(selected.threadId, selected.accountId, selected.messages.map((message) => message.id), action)
    addAgentMessage('tool', `Gmail accepted: ${action}.`)
    await loadConversations()
  } catch (error) {
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    controls.forEach((control) => { control.disabled = false })
  }
}

function addAgentMessage(kind: 'user' | 'agent' | 'tool' | 'error', text: string): HTMLElement {
  const item = document.createElement('div')
  item.className = `dispatch-agent-message dispatch-agent-${kind}`
  item.dataset.rawMessage = text
  const timestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  if (kind === 'user') {
    item.classList.add('d-flex', 'justify-content-end')
    const bubble = document.createElement('div')
    bubble.className = 'card bg-primary text-white dispatch-chat-bubble'
    const body = document.createElement('div')
    body.className = 'card-body p-3'
    const content = document.createElement('div')
    content.className = 'text-white dispatch-chat-plain'
    content.textContent = text
    const time = document.createElement('time')
    time.className = 'd-block text-white opacity-75 small mt-2'
    time.textContent = timestamp
    body.append(content, time)
    bubble.append(body)
    item.append(bubble)
  } else if (kind === 'agent') {
    item.classList.add('d-flex', 'align-items-start')
    const avatar = document.createElement('span')
    avatar.className = 'avatar avatar-sm bg-blue-lt text-blue me-3 flex-shrink-0'
    avatar.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i>'
    const response = document.createElement('div')
    response.className = 'flex-grow-1 dispatch-chat-response'
    const content = document.createElement('div')
    content.dataset.agentContent = ''
    content.append(renderChatMarkdown(text))
    const footer = document.createElement('div')
    footer.className = 'border-top d-flex align-items-center justify-content-between mt-2 pt-2'
    const time = document.createElement('time')
    time.className = 'text-secondary small'
    time.textContent = timestamp
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'btn btn-icon btn-sm btn-ghost-secondary'
    copy.setAttribute('aria-label', 'Copy Codex response')
    copy.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i>'
    copy.addEventListener('click', () => { void navigator.clipboard.writeText(item.dataset.rawMessage ?? '') })
    footer.append(time, copy)
    response.append(content, footer)
    item.append(avatar, response)
  } else {
    item.classList.add('alert', kind === 'error' ? 'alert-danger' : 'alert-secondary', 'py-2', 'px-3')
    const icon = document.createElement('i')
    icon.className = `ti ${kind === 'error' ? 'ti-alert-circle' : 'ti-point-filled'} me-2`
    icon.setAttribute('aria-hidden', 'true')
    item.append(icon, document.createTextNode(text))
  }
  elements.stream.append(item)
  elements.stream.scrollTop = elements.stream.scrollHeight
  return item
}

function updateAgentMessage(item: HTMLElement, text: string): void {
  item.dataset.rawMessage = text
  const content = item.querySelector<HTMLElement>('[data-agent-content]')
  if (content) content.replaceChildren(renderChatMarkdown(text))
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
  button.className = primary ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-secondary'
  button.textContent = label
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
  fields.className = 'd-grid gap-2 my-3 dispatch-request-fields'
  for (const question of questions) {
    const label = document.createElement('label')
    label.className = 'form-label'
    label.textContent = String(question.question ?? question.header ?? 'Response')
    const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : []
    if (options.length > 0) {
      const select = document.createElement('select')
      select.className = 'form-select form-select-sm mt-1'
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
      input.className = 'form-control form-control-sm mt-1'
      input.dataset.questionId = String(question.id ?? '')
      input.placeholder = 'Type your response'
      label.append(input)
    }
    fields.append(label)
  }
  card.querySelector('[data-request-actions]')?.before(fields)
  const submit = document.createElement('button')
  submit.type = 'button'
  submit.className = 'btn btn-sm btn-primary'
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
  input.className = 'form-control my-3 dispatch-request-json'
  input.value = '{}'
  input.setAttribute('aria-label', 'Requested information')
  card.querySelector('[data-request-actions]')?.before(input)
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'btn btn-sm btn-primary'
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
  card.className = 'card card-body border-primary dispatch-agent-request'
  card.dataset.requestId = String(message.id)
  requestIds.set(card.dataset.requestId, message.id)
  card.dataset.timestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const title = document.createElement('strong')
  title.className = 'card-title'
  const description = document.createElement('p')
  description.className = 'text-secondary mb-2'
  const state = document.createElement('small')
  state.className = 'badge bg-blue-lt text-blue align-self-start'
  state.dataset.requestState = ''
  state.textContent = 'Waiting for you'
  const actions = document.createElement('div')
  actions.className = 'd-flex flex-wrap gap-2 mt-3'
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
    activeAgentText = ''
    activeTurnId = undefined
    elements.stop.hidden = true
  }
  if (message.method === 'item/agentMessage/delta') {
    if (!activeAgentMessage) {
      activeAgentText = ''
      activeAgentMessage = addAgentMessage('agent', '')
    }
    activeAgentText += String(params?.delta ?? '')
    updateAgentMessage(activeAgentMessage, activeAgentText)
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
    if (item?.type === 'agentMessage') {
      activeAgentMessage = undefined
      activeAgentText = ''
    }
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
  const cacheKey = `dispatch.conversations.v1:${selectedAccountId ?? 'all'}:${mailbox}:${mailState}:${searchQuery}`
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
  if (!usedCache && mailbox === 'inbox' && mailState !== 'all' && !searchQuery) {
    try {
      const allKey = `dispatch.conversations.v1:${selectedAccountId ?? 'all'}:inbox:all:`
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
  elements.readerEmpty.textContent = usedCache && conversations.length > 0 ? 'Select a message' : `Loading ${mailState === 'all' ? '' : `${mailState} `}${mailboxLabels[mailbox].toLowerCase()}…`
  app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => {
    const active = button.dataset.mailState === mailState
    button.setAttribute('aria-pressed', String(active))
    button.classList.toggle('active', active)
  })
  renderList(usedCache ? defaultEmptyListMessage() : 'Loading messages…')
  if (usedCache && conversations[0]) void selectConversation(conversations[0].id)
  try {
    const result = await api.listConversations(mailState, selectedAccountId, undefined, searchQuery, mailbox)
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
      : result.coverage === 'recent'
        ? `Recent ${mailboxLabels[mailbox]} · ${refreshedLabel}`
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
    if (mailbox !== 'inbox' && sync.state !== 'failed') return
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
app.querySelectorAll<HTMLButtonElement>('[data-mailbox]').forEach((button) => button.addEventListener('click', () => {
  mailbox = button.dataset.mailbox as GmailMailbox
  renderMailbox()
  void loadConversations()
}))
elements.mailboxSelect.addEventListener('change', () => {
  mailbox = elements.mailboxSelect.value as GmailMailbox
  renderMailbox()
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
app.querySelector('[data-compose]')?.addEventListener('click', openCompose)
app.querySelector('[data-reply]')?.addEventListener('click', () => { void openDraft(false).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-reply-all]')?.addEventListener('click', () => { void openDraft(true).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-forward]')?.addEventListener('click', () => { void openForward().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
elements.archive.addEventListener('click', () => { void mutateSelected('archive') })
elements.spam.addEventListener('click', () => { void mutateSelected('spam') })
elements.trash.addEventListener('click', () => { void mutateSelected('trash') })
elements.moveInbox.addEventListener('click', () => { void mutateSelected('inbox') })
app.querySelector('[data-ask]')?.addEventListener('click', () => elements.prompt.focus())
app.querySelector('[data-save-draft]')?.addEventListener('click', () => { void saveDraft().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-send-draft]')?.addEventListener('click', () => { void sendDraft().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
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
window.addEventListener('resize', renderPanels)

renderMailbox()
renderPanels()
void start()
