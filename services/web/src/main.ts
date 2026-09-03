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
            <div><span>To</span><strong data-draft-to></strong></div>
            <div><span>Subject</span><strong data-draft-subject></strong></div>
            <textarea data-draft-body aria-label="Draft body"></textarea>
          </section>
          <footer class="dispatch-reader-actions"><button type="button" data-reply>Reply</button><button type="button" data-ask>Ask Codex</button></footer>
        </div>
      </main>
      <div class="dispatch-divider" data-divider="agent" role="separator" aria-label="Resize Codex panel" aria-orientation="vertical"></div>
      <aside class="dispatch-agent" aria-label="Codex">
        <header><div><span class="dispatch-codex-mark">✦</span><strong>Codex</strong><span class="dispatch-status" data-agent-status>Connecting</span></div><div class="dispatch-context" data-context>No email selected</div></header>
        <div class="dispatch-agent-stream" data-agent-stream><p class="dispatch-agent-intro">Use the installed Codex harness with your selected email in view.</p></div>
        <footer>
          <div class="dispatch-suggestions"><button type="button" data-suggestion="Catch me up on this email.">Catch me up</button><button type="button" data-suggestion="Draft a reply to this email.">Draft a reply</button><button type="button" data-suggestion="Find related messages in Gmail.">Find related</button></div>
          <div class="dispatch-prompt"><textarea data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea><div><span data-connector>Checking connectors</span><button type="button" data-send aria-label="Send">↑</button></div></div>
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
  draftTo: app.querySelector<HTMLElement>('[data-draft-to]')!,
  draftSubject: app.querySelector<HTMLElement>('[data-draft-subject]')!,
  draftBody: app.querySelector<HTMLTextAreaElement>('[data-draft-body]')!,
  context: app.querySelector<HTMLElement>('[data-context]')!,
  agentStatus: app.querySelector<HTMLElement>('[data-agent-status]')!,
  connector: app.querySelector<HTMLElement>('[data-connector]')!,
  stream: app.querySelector<HTMLElement>('[data-agent-stream]')!,
  prompt: app.querySelector<HTMLTextAreaElement>('[data-prompt]')!,
}

let conversations: ConversationSummary[] = []
let accounts: GmailAccount[] = []
let selectedAccountId: string | undefined
let mailState: MailStateFilter = 'all'
let selected: ConversationProjection | undefined
let threadId: string | undefined = localStorage.getItem('dispatch.codex.threadId') || undefined
let apps: AppSummary[] = []
let activeAgentMessage: HTMLElement | undefined
let agentEvents: EventSource | undefined
let reconnectTimer: number | undefined
let agentConnecting = false

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

function renderList(): void {
  elements.list.innerHTML = ''
  for (const conversation of conversations) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dispatch-message'
    button.dataset.conversationId = conversation.id
    button.setAttribute('aria-selected', String(selected?.id === conversation.id))
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
    attachmentList.append(item)
  }
  article.append(header, content)
  if (message.attachments.length > 0) article.append(attachmentList)
  return article
}

async function selectConversation(id: string): Promise<void> {
  const summary = conversations.find((conversation) => conversation.id === id)
  if (!summary) return
  selected = await api.readConversation(summary.threadId, summary.accountId ?? selectedAccountId)
  renderList()
  elements.readerEmpty.hidden = true
  elements.reader.hidden = false
  elements.draft.hidden = true
  elements.body.hidden = false
  elements.attachments.hidden = false
  elements.subject.textContent = selected.subject
  elements.avatar.textContent = selected.sender.initials
  elements.sender.textContent = selected.sender.name
  elements.address.textContent = selected.sender.address
  elements.time.textContent = selected.receivedFullLabel
  elements.time.dateTime = selected.receivedAt
  elements.context.textContent = `Working with · ${contextLabel(selected)}`
  elements.body.replaceChildren(...selected.messages.map(renderThreadMessage))
  elements.attachments.replaceChildren()
}

async function openDraft(): Promise<void> {
  if (!selected) return
  if (selected.source === 'gmail') {
    addAgentMessage('error', 'Gmail draft creation is not enabled until connector approvals are wired.')
    return
  }
  const draft: DraftProjection = await api.createDraft(selected.latestMessageId)
  elements.body.hidden = true
  elements.attachments.hidden = true
  elements.draft.hidden = false
  elements.draftTo.textContent = draft.to.map((address) => `${address.name} <${address.address}>`).join(', ')
  elements.draftSubject.textContent = draft.subject
  elements.draftBody.value = draft.bodyText
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

function handleAgentEvent(message: { method?: string; params?: unknown }): void {
  const params = message.params as Record<string, unknown> | undefined
  if (message.method === 'item/agentMessage/delta') {
    if (!activeAgentMessage) activeAgentMessage = addAgentMessage('agent', '')
    activeAgentMessage.textContent += String(params?.delta ?? '')
  }
  if (message.method === 'item/started') {
    const item = params?.item as Record<string, unknown> | undefined
    if (item?.type === 'mcpToolCall') addAgentMessage('tool', `Using ${String(item.server ?? 'connector')} · ${String(item.tool ?? 'tool')}`)
  }
  if (message.method === 'item/completed') {
    const item = params?.item as Record<string, unknown> | undefined
    if (item?.type === 'agentMessage') activeAgentMessage = undefined
  }
  if (message.method === 'error') addAgentMessage('error', 'Codex reported an error. Review the agent service logs.')
}

function scheduleAgentReconnect(): void {
  if (reconnectTimer !== undefined) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    void connectAgent()
  }, 1500)
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
    agentEvents?.close()
    agentEvents = api.events(threadId)
    agentEvents.onopen = () => { elements.agentStatus.textContent = 'Connected' }
    agentEvents.onmessage = (event) => handleAgentEvent(JSON.parse(event.data) as { method?: string; params?: unknown })
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
  elements.prompt.value = ''
  try {
    await api.startTurn(threadId, {
      text,
      appId: gmailAppId(apps),
      mailContext: selected ? { messageId: selected.latestMessageId, threadId: selected.threadId, subject: selected.subject, sender: selected.sender.address } : undefined,
    })
  } catch (error) {
    addAgentMessage('error', error instanceof Error ? error.message : String(error))
  }
}

async function loadConversations(): Promise<void> {
  elements.mailSource.textContent = 'Loading'
  elements.mailError.hidden = true
  selected = undefined
  elements.reader.hidden = true
  elements.readerEmpty.hidden = false
  app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mailState === mailState))
  })
  try {
    const result = await api.listConversations(mailState, selectedAccountId)
    conversations = result.conversations
    elements.mailSource.textContent = result.source === 'demo'
      ? 'Demo mail'
      : (!selectedAccountId && accounts.length > 1 ? 'Unified Gmail' : 'Gmail connected')
    renderList()
    if (conversations[0]) await selectConversation(conversations[0].id)
  } catch (error) {
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function start(): Promise<void> {
  try {
    accounts = await api.listAccounts()
    if (accounts.length > 0) {
      const all = document.createElement('option')
      all.value = ''
      all.textContent = accounts.length > 1 ? `All accounts (${accounts.length})` : 'All mail'
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
  } catch (error) {
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
    return
  }
  await Promise.all([loadConversations(), connectAgent()])
}

app.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload())
elements.account.addEventListener('change', () => {
  selectedAccountId = elements.account.value || undefined
  void loadConversations()
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
app.querySelector('[data-send]')?.addEventListener('click', () => { void sendPrompt() })
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
