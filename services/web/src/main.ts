import DOMPurify from 'dompurify'
import './styles.css'
import { api } from './api.js'
import type { AppSummary, DraftProjection, GmailAccount, MessageProjection, MessageSummary } from './contracts.js'
import { contextLabel, gmailAppId } from './model.js'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Dispatch app root is missing')

app.innerHTML = `
  <div class="dispatch-window">
    <header class="dispatch-titlebar">
      <div class="dispatch-traffic"><span></span><span></span><span></span></div>
      <strong>Dispatch</strong>
      <div class="dispatch-title-actions"><button type="button" data-refresh aria-label="Refresh">↻</button><button type="button" data-compose>Compose</button></div>
    </header>
    <div class="dispatch-workspace">
      <aside class="dispatch-messages" aria-label="Messages">
        <div class="dispatch-pane-heading"><h1>Messages</h1><span data-mail-source>Loading</span></div>
        <label class="dispatch-account" hidden><span>Account</span><select data-account aria-label="Gmail account"></select></label>
        <label class="dispatch-search"><span>⌕</span><input placeholder="Search mail" aria-label="Search mail"></label>
        <div class="dispatch-message-list" data-message-list></div>
        <div class="dispatch-pane-error" data-mail-error hidden></div>
      </aside>
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

let messages: MessageSummary[] = []
let accounts: GmailAccount[] = []
let selectedAccountId: string | undefined
let selected: MessageProjection | undefined
let threadId: string | undefined
let apps: AppSummary[] = []
let activeAgentMessage: HTMLElement | undefined

function renderList(): void {
  elements.list.innerHTML = ''
  for (const message of messages) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dispatch-message'
    button.dataset.messageId = message.id
    button.setAttribute('aria-selected', String(selected?.id === message.id))
    const avatar = document.createElement('span')
    avatar.className = 'dispatch-avatar'
    avatar.textContent = message.sender.initials
    const content = document.createElement('span')
    const top = document.createElement('span')
    top.className = 'dispatch-message-top'
    const sender = document.createElement('strong')
    sender.textContent = message.sender.name
    const time = document.createElement('time')
    time.textContent = message.receivedLabel
    top.append(sender, time)
    const subject = document.createElement('b')
    subject.textContent = message.subject
    const preview = document.createElement('small')
    preview.textContent = message.preview
    content.append(top, subject, preview)
    button.append(avatar, content)
    button.addEventListener('click', () => { void selectMessage(message.id) })
    elements.list.append(button)
  }
}

async function selectMessage(id: string): Promise<void> {
  selected = await api.readMessage(id, selectedAccountId)
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
  elements.time.textContent = selected.receivedLabel
  elements.time.dateTime = selected.receivedAt
  elements.context.textContent = `Working with · ${contextLabel(selected)}`
  elements.body.innerHTML = selected.body.kind === 'sanitized-html'
    ? DOMPurify.sanitize(selected.body.content, { USE_PROFILES: { html: true } })
    : `<p>${selected.body.content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p>`
  elements.attachments.replaceChildren(...selected.attachments.map((attachment) => {
    const button = document.createElement('button')
    button.type = 'button'
    const icon = document.createElement('span')
    icon.textContent = 'FILE'
    const name = document.createElement('strong')
    name.textContent = attachment.name
    const size = document.createElement('small')
    size.textContent = attachment.sizeLabel
    button.append(icon, name, size)
    return button
  }))
}

async function openDraft(): Promise<void> {
  if (!selected) return
  if (selected.source === 'gmail') {
    addAgentMessage('error', 'Gmail draft creation is not enabled until connector approvals are wired.')
    return
  }
  const draft: DraftProjection = await api.createDraft(selected.id)
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

async function connectAgent(): Promise<void> {
  if (!await api.agentReady()) {
    elements.agentStatus.textContent = 'Unavailable'
    elements.connector.textContent = 'Codex App Server unavailable'
    return
  }
  elements.agentStatus.textContent = 'Connected'
  try {
    apps = accounts
      .filter((account) => account.connectorId)
      .map((account) => ({ id: account.connectorId, name: 'Gmail', isAccessible: true, isEnabled: true }))
    if (apps.length === 0) apps = await api.listApps()
    const gmail = gmailAppId(apps)
    elements.connector.textContent = gmail ? 'Gmail available' : 'No Gmail connector'
    threadId = await api.startThread()
    const events = api.events(threadId)
    events.onmessage = (event) => handleAgentEvent(JSON.parse(event.data) as { method?: string; params?: unknown })
    events.onerror = () => { elements.agentStatus.textContent = 'Reconnecting' }
  } catch (error) {
    elements.agentStatus.textContent = 'Unavailable'
    elements.connector.textContent = error instanceof Error ? error.message : String(error)
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
      mailContext: selected ? { messageId: selected.id, threadId: selected.threadId, subject: selected.subject, sender: selected.sender.address } : undefined,
    })
  } catch (error) {
    addAgentMessage('error', error instanceof Error ? error.message : String(error))
  }
}

async function start(): Promise<void> {
  try {
    accounts = await api.listAccounts()
    if (accounts.length > 0) {
      selectedAccountId ??= accounts[0]?.id
      elements.account.replaceChildren(...accounts.map((account) => {
        const option = document.createElement('option')
        option.value = account.id
        option.textContent = account.email || account.name
        option.selected = account.id === selectedAccountId
        return option
      }))
      elements.accountWrap.hidden = false
    }
    const result = await api.listMessages(selectedAccountId)
    messages = result.messages
    elements.mailSource.textContent = result.source === 'demo' ? 'Demo mail' : 'Gmail connected'
    renderList()
    if (messages[0]) await selectMessage(messages[0].id)
  } catch (error) {
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  }
  await connectAgent()
}

app.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload())
elements.account.addEventListener('change', () => {
  selectedAccountId = elements.account.value
  selected = undefined
  void start()
})
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

void start()
