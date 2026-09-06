import '@tabler/core/dist/css/tabler.min.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles.css'
import { api } from './api.js'
import { renderChatMarkdown } from './chat-renderer.js'
import { renderEmailContent } from './email-renderer.js'
import { commitRecipientToken, parseRecipientList, serializeRecipientList } from './recipient-field.js'
import type { AppSummary, ConversationProjection, ConversationSummary, DraftProjection, GmailAccount, GmailConversationAction, GmailMailbox, MailAddress, MailStateFilter, MessageProjection } from './contracts.js'
import { contextLabel, gmailAppId, isNativeShell } from './model.js'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('Dispatch app root is missing')
const app: HTMLDivElement = appElement
if (isNativeShell(window as { isTauri?: unknown })) document.documentElement.classList.add('dispatch-native')

app.innerHTML = `
  <div class="page dispatch-window">
    <header class="dispatch-toolbar" data-tauri-drag-region>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-messages" data-toolbar-messages>
        <div class="dispatch-folder">
          <button class="btn btn-ghost-secondary btn-sm dispatch-folder-button" type="button" data-folder-toggle aria-haspopup="menu" aria-expanded="false"><h1 class="dispatch-folder-title" data-mailbox-title>Inbox</h1><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
          <div class="dropdown-menu dispatch-folder-menu" data-folder-menu role="menu" hidden>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="inbox"><i class="ti ti-inbox dropdown-item-icon" aria-hidden="true"></i>Inbox</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="sent"><i class="ti ti-send dropdown-item-icon" aria-hidden="true"></i>Sent</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="drafts"><i class="ti ti-file-pencil dropdown-item-icon" aria-hidden="true"></i>Drafts</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="archive"><i class="ti ti-archive dropdown-item-icon" aria-hidden="true"></i>Archive</button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="spam"><i class="ti ti-alert-octagon dropdown-item-icon" aria-hidden="true"></i>Spam</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="trash"><i class="ti ti-trash dropdown-item-icon" aria-hidden="true"></i>Trash</button>
          </div>
        </div>
        <select class="form-select form-select-sm dispatch-scope" data-account aria-label="Gmail account"><option value="">All inboxes</option></select>
        <span class="dispatch-toolbar-spacer"></span>
        <button class="btn btn-icon btn-ghost-secondary btn-sm dispatch-pane-collapse" type="button" data-collapse-messages aria-label="Collapse thread list" aria-keyshortcuts="Control+Backquote" title="Toggle thread list (Control + &#96;)"><i class="ti ti-layout-sidebar-left-collapse" aria-hidden="true"></i></button>
        <button class="btn btn-icon btn-ghost-primary btn-sm" type="button" data-compose aria-label="Compose" title="Compose"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-reader">
        <span class="dispatch-sync" data-sync-state="idle"><span class="dispatch-sync-dot" aria-hidden="true"></span><span class="text-secondary" data-mail-source>Loading</span></span>
        <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-refresh aria-label="Refresh" title="Refresh Gmail"><i class="ti ti-refresh" aria-hidden="true"></i></button>
        <span class="dispatch-toolbar-spacer"></span>
        <label class="input-icon dispatch-search"><span class="input-icon-addon"><i class="ti ti-search" aria-hidden="true"></i></span><input class="form-control form-control-sm" data-search placeholder="Search" aria-label="Search mail"><kbd class="dispatch-search-kbd" aria-hidden="true">⌘K</kbd></label>
      </div>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-agent" data-toolbar-agent>
        <span class="dispatch-toolbar-spacer"></span>
        <div class="btn-group dispatch-panel-controls" role="group" aria-label="Visible panels">
          <button class="btn btn-sm btn-icon active" type="button" data-panel="messages" aria-pressed="true" aria-label="Messages" title="Messages (Control + &#96;)"><i class="ti ti-layout-sidebar" aria-hidden="true"></i></button>
          <button class="btn btn-sm btn-icon active" type="button" data-panel="reader" aria-pressed="true" aria-label="Email" title="Email"><i class="ti ti-mail" aria-hidden="true"></i></button>
          <button class="btn btn-sm btn-icon active" type="button" data-panel="agent" aria-pressed="true" aria-label="Codex" title="Codex"><i class="ti ti-sparkles" aria-hidden="true"></i></button>
        </div>
      </div>
    </header>
    <div class="dispatch-workspace">
      <nav class="dispatch-rail nav nav-pills flex-column bg-white" aria-label="Mail folders"><button type="button" class="nav-link active" data-mailbox="inbox"><i class="ti ti-inbox" aria-hidden="true"></i><span>Inbox</span></button><button type="button" class="nav-link" data-mailbox="sent"><i class="ti ti-send" aria-hidden="true"></i><span>Sent</span></button><button type="button" class="nav-link" data-mailbox="drafts"><i class="ti ti-file-pencil" aria-hidden="true"></i><span>Drafts</span></button><button type="button" class="nav-link" data-mailbox="archive"><i class="ti ti-archive" aria-hidden="true"></i><span>Archive</span></button><span class="dispatch-rail-spacer"></span><button type="button" class="nav-link" data-mailbox="spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i><span>Spam</span></button><button type="button" class="nav-link" data-mailbox="trash"><i class="ti ti-trash" aria-hidden="true"></i><span>Trash</span></button></nav>
      <aside class="card rounded-0 border-0 dispatch-messages" aria-label="Messages">
        <nav class="dispatch-mail-tabs" aria-label="Message state"><button class="dispatch-mail-tab active" type="button" data-mail-state="all" aria-pressed="true">All</button><button class="dispatch-mail-tab" type="button" data-mail-state="unread" aria-pressed="false">Unread</button><button class="dispatch-mail-tab" type="button" data-mail-state="read" aria-pressed="false">Read</button></nav>
        <div class="list-group list-group-flush dispatch-message-list" data-message-list></div>
        <div class="alert alert-danger m-3 dispatch-pane-error" role="alert" data-mail-error hidden></div>
      </aside>
      <div class="dispatch-divider" data-divider="messages" role="separator" tabindex="0" aria-label="Resize messages panel" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="640"><i class="ti ti-grip-vertical" aria-hidden="true"></i></div>
      <main class="card rounded-0 border-0 dispatch-reader" aria-label="Selected email">
        <div class="empty dispatch-reader-empty" data-reader-empty><div class="empty-icon"><i class="ti ti-mail-opened"></i></div><p class="empty-title">Select a message</p></div>
        <div data-reader hidden>
          <header class="dispatch-reader-header">
            <div class="dispatch-reader-toolbar">
              <button class="btn btn-icon btn-ghost-secondary btn-sm dispatch-mobile-back" type="button" data-mobile-back aria-label="Back to Inbox"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
              <h2 class="dispatch-reader-subject" data-subject></h2>
              <button class="btn btn-primary btn-sm" type="button" data-reply><i class="ti ti-arrow-back-up me-1" aria-hidden="true"></i>Reply</button>
              <div class="btn-group" role="group" aria-label="Reply options">
                <button class="btn btn-icon btn-sm" type="button" data-reply-all aria-label="Reply all" title="Reply all"><i class="ti ti-arrow-back-up-double" aria-hidden="true"></i></button>
                <button class="btn btn-icon btn-sm" type="button" data-forward aria-label="Forward" title="Forward"><i class="ti ti-arrow-forward-up" aria-hidden="true"></i></button>
              </div>
              <span class="dispatch-reader-divider" aria-hidden="true"></span>
              <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-move-inbox aria-label="Move to Inbox" title="Move to Inbox" hidden><i class="ti ti-inbox" aria-hidden="true"></i></button>
              <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-archive aria-label="Archive" title="Archive"><i class="ti ti-archive" aria-hidden="true"></i></button>
              <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-spam aria-label="Mark as spam" title="Mark as spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i></button>
              <button class="btn btn-icon btn-ghost-danger btn-sm" type="button" data-trash aria-label="Move to Trash" title="Move to Trash"><i class="ti ti-trash" aria-hidden="true"></i></button>
              <div class="dispatch-reader-more">
                <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-reader-more aria-label="More actions" aria-haspopup="menu" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>
                <div class="dropdown-menu dropdown-menu-end dispatch-reader-menu" data-reader-menu role="menu" hidden>
                  <button class="dropdown-item" type="button" role="menuitem" data-read-state>Mark unread</button>
                  <button class="dropdown-item" type="button" role="menuitem" data-ask><i class="ti ti-sparkles dropdown-item-icon" aria-hidden="true"></i>Ask Codex</button>
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item dispatch-pane-collapse" type="button" role="menuitem" data-collapse-reader>Hide email panel</button>
                </div>
              </div>
            </div>
            <div class="dispatch-thread-meta" data-thread-meta><span data-message-count></span><span class="dispatch-meta-sep">·</span><span data-thread-mailbox></span><span class="dispatch-meta-sep" data-account-sep hidden>·</span><span class="dispatch-account-dot" data-account-dot hidden aria-hidden="true"></span><span data-address hidden></span></div>
          </header>
          <article class="dispatch-email-body" data-body></article>
          <section class="dispatch-attachments" data-attachments></section>
          <section class="card-body dispatch-draft" data-draft hidden>
            <div class="card"><div class="card-header"><div><span class="badge bg-blue-lt text-blue me-2">Draft</span><strong>Reply preview</strong></div><span class="text-secondary small">Send asks for confirm</span></div><div class="card-body">
            <label class="form-label">From<select class="form-select mt-1" data-draft-account aria-label="Draft account"></select></label>
            <label class="form-label">To<div class="dispatch-recipient-field mt-1" data-recipient-field><div class="dispatch-recipient-chips"></div><input class="form-control" data-draft-to aria-label="Draft recipient" autocomplete="off"><ul class="dispatch-recipient-suggestions" hidden role="listbox" aria-label="Recipient suggestions"></ul></div></label>
            <div class="row g-3 mt-0"><label class="col form-label">Cc<div class="dispatch-recipient-field mt-1" data-recipient-field><div class="dispatch-recipient-chips"></div><input class="form-control" data-draft-cc aria-label="Draft Cc" autocomplete="off"><ul class="dispatch-recipient-suggestions" hidden role="listbox" aria-label="Cc suggestions"></ul></div></label><label class="col form-label">Bcc<div class="dispatch-recipient-field mt-1" data-recipient-field><div class="dispatch-recipient-chips"></div><input class="form-control" data-draft-bcc aria-label="Draft Bcc" autocomplete="off"><ul class="dispatch-recipient-suggestions" hidden role="listbox" aria-label="Bcc suggestions"></ul></div></label></div>
            <label class="form-label">Subject<input class="form-control mt-1" data-draft-subject aria-label="Draft subject"></label>
            <label class="form-label">Message<textarea class="form-control mt-1" data-draft-body aria-label="Draft body"></textarea></label>
            <ul class="dispatch-draft-attachments" data-draft-attachments aria-label="Draft attachments" hidden></ul>
            <div class="dispatch-draft-preview markdown" data-draft-preview aria-label="Draft preview"></div>
            <p class="text-secondary small" data-draft-error hidden></p>
            <div class="alert alert-warning" data-send-confirm hidden>
              <p data-send-confirm-text></p>
              <button class="btn btn-outline-secondary" type="button" data-send-cancel>Cancel</button>
              <button class="btn btn-primary" type="button" data-send-confirm-go>Send now</button>
            </div>
            </div><footer class="card-footer d-flex flex-wrap gap-2"><button class="btn btn-outline-danger" type="button" data-discard-draft>Discard</button><button class="btn btn-outline-secondary" type="button" data-attach-draft>Attach</button><input type="file" data-draft-files multiple hidden><button class="btn btn-outline-secondary" type="button" data-save-draft>Save draft</button><button class="btn btn-outline-secondary" type="button" data-revise-draft><i class="ti ti-sparkles me-1" aria-hidden="true"></i>Ask Codex to revise</button><button class="btn btn-primary ms-auto" type="button" data-send-draft><i class="ti ti-send me-1" aria-hidden="true"></i>Send draft</button></footer></div>
          </section>
        </div>
      </main>
      <div class="dispatch-divider" data-divider="agent" role="separator" tabindex="0" aria-label="Resize Codex panel" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="900"><i class="ti ti-grip-vertical" aria-hidden="true"></i></div>
      <aside class="card rounded-0 border-0 dispatch-agent" aria-label="Codex">
        <header class="card-header"><div class="d-flex align-items-center w-100"><span class="avatar avatar-sm bg-dark text-white me-2">✦</span><strong>Codex</strong><span class="badge bg-blue-lt text-blue ms-2" title="Pinned Dispatch model">GPT-5.6 Sol · Medium</span><span class="badge bg-secondary-lt ms-auto" aria-live="polite" data-agent-status>Connecting</span></div><div class="alert alert-info mt-3 mb-0 py-2 px-3 dispatch-context" data-context>No email selected</div><div class="progress progress-sm mt-2" data-agent-activity aria-label="Codex is working" hidden><div class="progress-bar progress-bar-indeterminate bg-blue"></div></div></header>
        <div class="dispatch-agent-stream" data-agent-stream><p class="dispatch-agent-intro">Use the installed Codex harness with your selected email in view.</p></div>
        <footer class="card-footer">
          <div class="dispatch-suggestions"><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Catch me up on this email.">Catch me up</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Draft a reply to this email.">Draft a reply</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Find related messages in Gmail.">Find related</button></div>
          <div class="card card-sm dispatch-prompt"><div class="card-body p-2"><textarea class="form-control border-0 shadow-none" data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea><div class="d-flex align-items-center justify-content-between mt-2"><span class="text-secondary small" data-connector>Checking connectors</span><span><button class="btn btn-icon btn-sm btn-outline-danger" type="button" data-stop aria-label="Stop" hidden><i class="ti ti-player-stop-filled" aria-hidden="true"></i></button><button class="btn btn-icon btn-sm btn-primary" type="button" data-send aria-label="Send"><i class="ti ti-arrow-up" aria-hidden="true"></i></button></span></div></div></div>
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
  mailboxTitle: app.querySelector<HTMLElement>('[data-mailbox-title]')!,
  account: app.querySelector<HTMLSelectElement>('[data-account]')!,
  mailError: app.querySelector<HTMLElement>('[data-mail-error]')!,
  reader: app.querySelector<HTMLElement>('[data-reader]')!,
  readerEmpty: app.querySelector<HTMLElement>('[data-reader-empty]')!,
  subject: app.querySelector<HTMLElement>('[data-subject]')!,
  address: app.querySelector<HTMLElement>('[data-address]')!,
  messageCount: app.querySelector<HTMLElement>('[data-message-count]')!,
  threadMailbox: app.querySelector<HTMLElement>('[data-thread-mailbox]')!,
  accountDot: app.querySelector<HTMLElement>('[data-account-dot]')!,
  accountSep: app.querySelector<HTMLElement>('[data-account-sep]')!,
  readerMore: app.querySelector<HTMLButtonElement>('[data-reader-more]')!,
  readerMenu: app.querySelector<HTMLElement>('[data-reader-menu]')!,
  body: app.querySelector<HTMLElement>('[data-body]')!,
  attachments: app.querySelector<HTMLElement>('[data-attachments]')!,
  draft: app.querySelector<HTMLElement>('[data-draft]')!,
  draftTo: app.querySelector<HTMLInputElement>('[data-draft-to]')!,
  draftCc: app.querySelector<HTMLInputElement>('[data-draft-cc]')!,
  draftBcc: app.querySelector<HTMLInputElement>('[data-draft-bcc]')!,
  draftAccount: app.querySelector<HTMLSelectElement>('[data-draft-account]')!,
  draftSubject: app.querySelector<HTMLInputElement>('[data-draft-subject]')!,
  draftBody: app.querySelector<HTMLTextAreaElement>('[data-draft-body]')!,
  draftPreview: app.querySelector<HTMLElement>('[data-draft-preview]')!,
  draftError: app.querySelector<HTMLElement>('[data-draft-error]')!,
  draftAttachments: app.querySelector<HTMLElement>('[data-draft-attachments]')!,
  draftFiles: app.querySelector<HTMLInputElement>('[data-draft-files]')!,
  discardDraft: app.querySelector<HTMLButtonElement>('[data-discard-draft]')!,
  sendDraft: app.querySelector<HTMLButtonElement>('[data-send-draft]')!,
  sendConfirm: app.querySelector<HTMLElement>('[data-send-confirm]')!,
  sendConfirmText: app.querySelector<HTMLElement>('[data-send-confirm-text]')!,
  sendConfirmGo: app.querySelector<HTMLButtonElement>('[data-send-confirm-go]')!,
  context: app.querySelector<HTMLElement>('[data-context]')!,
  agentStatus: app.querySelector<HTMLElement>('[data-agent-status]')!,
  agentActivity: app.querySelector<HTMLElement>('[data-agent-activity]')!,
  connector: app.querySelector<HTMLElement>('[data-connector]')!,
  stream: app.querySelector<HTMLElement>('[data-agent-stream]')!,
  prompt: app.querySelector<HTMLTextAreaElement>('[data-prompt]')!,
  search: app.querySelector<HTMLInputElement>('[data-search]')!,
  toolbarMessages: app.querySelector<HTMLElement>('[data-toolbar-messages]')!,
  toolbarAgent: app.querySelector<HTMLElement>('[data-toolbar-agent]')!,
  folderToggle: app.querySelector<HTMLButtonElement>('[data-folder-toggle]')!,
  folderMenu: app.querySelector<HTMLElement>('[data-folder-menu]')!,
  sync: app.querySelector<HTMLElement>('.dispatch-sync')!,
  stop: app.querySelector<HTMLButtonElement>('[data-stop]')!,
  readState: app.querySelector<HTMLButtonElement>('[data-read-state]')!,
  archive: app.querySelector<HTMLButtonElement>('[data-archive]')!,
  spam: app.querySelector<HTMLButtonElement>('[data-spam]')!,
  trash: app.querySelector<HTMLButtonElement>('[data-trash]')!,
  moveInbox: app.querySelector<HTMLButtonElement>('[data-move-inbox]')!,
}

function renderServiceStatus(): void {
  elements.agentStatus.classList.remove('bg-secondary-lt', 'bg-green-lt', 'text-green', 'bg-blue-lt', 'text-blue', 'bg-yellow-lt', 'text-yellow', 'bg-red-lt', 'text-red')
  const status = elements.agentStatus.textContent?.trim() ?? ''
  if (status === 'Connected') elements.agentStatus.classList.add('bg-green-lt', 'text-green')
  else if (status === 'Working') elements.agentStatus.classList.add('bg-blue-lt', 'text-blue')
  else if (status === 'Needs attention') elements.agentStatus.classList.add('bg-yellow-lt', 'text-yellow')
  else if (status === 'Failed') elements.agentStatus.classList.add('bg-red-lt', 'text-red')
  else elements.agentStatus.classList.add('bg-secondary-lt')
  elements.agentActivity.hidden = status !== 'Working'
  const source = elements.mailSource.textContent?.trim() ?? ''
  elements.sync.dataset.syncState = /FAILED|Unavailable/.test(source) ? 'failed' : /^(Syncing|Refreshing)/.test(source) ? 'syncing' : /^(STALE|Partial)/.test(source) ? 'stale' : 'ready'
}

new MutationObserver(renderServiceStatus).observe(elements.mailSource, { childList: true, subtree: true })
new MutationObserver(renderServiceStatus).observe(elements.agentStatus, { childList: true, subtree: true })
renderServiceStatus()
let activeDraft: DraftProjection | undefined
let draftPreviewTimer: number | undefined
let draftAutosaveTimer: number | undefined
let recipientSuggestTimer: number | undefined
let draftPreviewSequence = 0
let draftEditSession = 0
let draftDirty = false
// Keep Gmail draft writes in order so a slow save cannot overwrite a newer save.
let draftSaveFlight: Promise<DraftProjection | undefined> | undefined
// Keep Gmail send confirmation single-flight.
let draftSendFlight: Promise<void> | undefined
let draftDiscarding = false

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
let observedSyncCompletedAt: string | null | undefined
let syncErrorVisible = false
let mailReconnectTimer: number | undefined
let searchQuery = ''
let searchTimer: number | undefined
let activeTurnId: string | undefined
let selectedAttachmentContext: { messageId: string; attachmentId: string; filename: string } | undefined
let mobilePanel: PanelName = 'messages'
let mobileReturnPanel: Exclude<PanelName, 'messages'> = 'reader'

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
      messagesWidth: Math.max(220, Math.min(640, saved.messagesWidth ?? defaults.messagesWidth)),
      agentWidth: Math.max(280, Math.min(900, saved.agentWidth ?? defaults.agentWidth)),
    }
  } catch {
    return defaults
  }
}

const panels = loadPanelState()

function usesMobilePanels(): boolean {
  return window.matchMedia('(max-width: 820px)').matches
}

function renderPanels(): void {
  if (usesMobilePanels()) {
    elements.messagesPanel.hidden = mobilePanel !== 'messages'
    elements.readerPanel.hidden = mobilePanel !== 'reader'
    elements.agentPanel.hidden = mobilePanel !== 'agent'
    elements.messagesDivider.hidden = true
    elements.agentDivider.hidden = true
    elements.workspace.style.gridTemplateColumns = 'minmax(0, 1fr)'
    elements.toolbarMessages.style.width = ''
    elements.toolbarAgent.style.width = ''
    app.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => {
      const active = button.dataset.panel === mobilePanel
      button.setAttribute('aria-pressed', String(active))
      button.classList.toggle('active', active)
    })
    return
  }
  const visible = (['messages', 'reader', 'agent'] as const).filter((name) => panels[name])
  if (visible.length === 0) panels.reader = true
  elements.messagesPanel.hidden = !panels.messages
  elements.readerPanel.hidden = !panels.reader
  elements.agentPanel.hidden = !panels.agent
  elements.messagesDivider.hidden = !(panels.messages && panels.reader)
  elements.agentDivider.hidden = !(panels.agent && (panels.reader || panels.messages))

  let messagesWidth = panels.messagesWidth
  let agentWidth = panels.agentWidth
  const railWidth = window.innerWidth <= 1100 ? 0 : 72
  const minimumReaderWidth = window.innerWidth <= 1100 ? 320 : 360
  if (panels.messages && panels.reader && panels.agent) {
    const sideWidth = Math.max(500, window.innerWidth - railWidth - 18 - minimumReaderWidth)
    if (messagesWidth + agentWidth > sideWidth) {
      const scale = sideWidth / (messagesWidth + agentWidth)
      messagesWidth = Math.max(220, Math.round(messagesWidth * scale))
      agentWidth = Math.max(280, sideWidth - messagesWidth)
      if (messagesWidth + agentWidth > sideWidth) messagesWidth = Math.max(220, sideWidth - agentWidth)
    }
  }
  const columns: string[] = railWidth ? ['72px'] : []
  if (panels.messages) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${messagesWidth}px`)
  if (!elements.messagesDivider.hidden) columns.push('9px')
  if (panels.reader) columns.push(`minmax(${minimumReaderWidth}px, 1fr)`)
  if (!elements.agentDivider.hidden) columns.push('9px')
  if (panels.agent) columns.push(visible.length === 1 ? 'minmax(0, 1fr)' : `${agentWidth}px`)
  elements.workspace.style.gridTemplateColumns = columns.join(' ')
  const messagesCluster = panels.messages && visible.length > 1
  const agentCluster = panels.agent && visible.length > 1
  elements.toolbarMessages.style.width = messagesCluster ? `${railWidth + messagesWidth + 9}px` : ''
  elements.toolbarAgent.style.width = agentCluster ? `${agentWidth + 9}px` : ''
  elements.toolbarMessages.classList.toggle('dispatch-toolbar-cluster-auto', !messagesCluster)
  elements.toolbarAgent.classList.toggle('dispatch-toolbar-cluster-auto', !agentCluster)
  elements.messagesDivider.setAttribute('aria-valuenow', String(Math.round(messagesWidth)))
  elements.agentDivider.setAttribute('aria-valuenow', String(Math.round(agentWidth)))
  app.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => {
    const name = button.dataset.panel as PanelName
    button.setAttribute('aria-pressed', String(panels[name]))
    button.classList.toggle('active', panels[name])
  })
  localStorage.setItem('dispatch.panels.v1', JSON.stringify(panels))
}

function resizePanel(name: 'messagesWidth' | 'agentWidth', event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = panels[name]
  const direction = name === 'messagesWidth' ? 1 : -1
  const divider = event.currentTarget as HTMLElement
  divider.setPointerCapture?.(event.pointerId)
  document.body.classList.add('dispatch-resizing')
  const move = (next: PointerEvent) => {
    const limit = name === 'messagesWidth' ? [220, 640] : [280, 900]
    panels[name] = Math.max(limit[0]!, Math.min(limit[1]!, startWidth + ((next.clientX - startX) * direction)))
    renderPanels()
  }
  const stop = () => {
    document.body.classList.remove('dispatch-resizing')
    if (divider.hasPointerCapture?.(event.pointerId)) divider.releasePointerCapture(event.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function resizePanelWithKeyboard(name: 'messagesWidth' | 'agentWidth', event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const direction = name === 'messagesWidth' ? 1 : -1
  const limit = name === 'messagesWidth' ? [220, 640] : [280, 900]
  const delta = (event.key === 'ArrowRight' ? 20 : -20) * direction
  panels[name] = Math.max(limit[0]!, Math.min(limit[1]!, panels[name] + delta))
  renderPanels()
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
    sender.title = conversation.sender.name
    const time = document.createElement('time')
    time.textContent = conversation.receivedLabel
    top.append(sender, time)
    const subject = document.createElement('b')
    subject.textContent = conversation.subject
    subject.title = conversation.subject
    const preview = document.createElement('small')
    preview.textContent = conversation.preview
    preview.title = conversation.preview
    const account = document.createElement('span')
    account.className = 'dispatch-message-account'
    account.textContent = conversation.accountLabel ?? ''
    account.title = conversation.accountLabel ?? ''
    content.append(top, subject, preview)
    if (conversation.accountLabel && accounts.length > 1) content.append(account)
    button.append(avatar, content)
    button.addEventListener('click', () => { void selectConversation(conversation.id, true) })
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

const accountPalette = ['var(--tblr-blue)', 'var(--tblr-green)', 'var(--tblr-yellow)', 'var(--tblr-purple)', 'var(--tblr-teal)']
function accountColor(accountId: string | undefined): string {
  const index = accounts.findIndex((account) => account.id === accountId)
  return accountPalette[index < 0 ? 0 : index % accountPalette.length]!
}

function renderThreadMeta(summary: Pick<ConversationSummary, 'messageCount' | 'accountId' | 'accountLabel'>): void {
  elements.messageCount.textContent = summary.messageCount === 1 ? '1 message' : `${summary.messageCount} messages`
  elements.threadMailbox.textContent = mailboxLabels[mailbox]
  const showAccount = Boolean(summary.accountLabel) && accounts.length > 1
  elements.address.hidden = !showAccount
  elements.accountDot.hidden = !showAccount
  elements.accountSep.hidden = !showAccount
  elements.address.textContent = summary.accountLabel ?? ''
  elements.accountDot.style.background = accountColor(summary.accountId)
}

function renderThreadMessage(message: MessageProjection, expanded: boolean): HTMLElement {
  const article = document.createElement('article')
  article.className = 'card dispatch-thread-message'
  article.classList.toggle('dispatch-thread-collapsed', !expanded)
  const header = document.createElement('header')
  const avatar = document.createElement('span')
  avatar.className = 'avatar avatar-sm bg-blue-lt text-blue'
  avatar.textContent = message.sender.initials
  const identity = document.createElement('div')
  const name = document.createElement('strong')
  name.textContent = message.sender.name
  identity.append(name)
  if (expanded) {
    const address = document.createElement('small')
    const to = (message.to ?? []).map((item) => item.address).filter(Boolean).join(', ')
    address.textContent = to ? `${message.sender.address} · to ${to}` : message.sender.address
    identity.append(address)
  } else {
    const snippet = document.createElement('small')
    snippet.className = 'dispatch-thread-snippet'
    snippet.textContent = message.preview
    identity.append(snippet)
  }
  const time = document.createElement('time')
  time.dateTime = message.receivedAt
  time.textContent = expanded ? message.receivedFullLabel : message.receivedLabel
  header.append(avatar, identity, time)
  article.append(header)
  if (!expanded) {
    article.tabIndex = 0
    article.setAttribute('role', 'button')
    article.setAttribute('aria-label', `Expand message from ${message.sender.name}`)
    const expand = () => { article.replaceWith(renderThreadMessage(message, true)) }
    article.addEventListener('click', expand)
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        expand()
      }
    })
    return article
  }
  const content = renderEmailContent(message.body.kind, message.body.content)
  content.classList.add('dispatch-thread-content')
  article.append(content)
  if (message.attachments.length > 0) {
    const attachmentList = document.createElement('div')
    attachmentList.className = 'dispatch-thread-attachments'
    for (const attachment of message.attachments) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'btn btn-sm dispatch-thread-attachment'
      const badge = document.createElement('span')
      badge.className = 'badge bg-blue-lt text-blue'
      badge.textContent = attachment.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE'
      const attachmentName = document.createElement('strong')
      attachmentName.textContent = attachment.name
      const size = document.createElement('small')
      size.textContent = attachment.sizeLabel
      item.append(badge, attachmentName, size)
      item.addEventListener('click', () => { void openAttachment(message, attachment.id, attachment.name) })
      attachmentList.append(item)
    }
    article.append(attachmentList)
  }
  return article
}

async function openAttachment(message: MessageProjection, attachmentId: string, filename: string): Promise<void> {
  selectedAttachmentContext = { messageId: message.id, attachmentId, filename }
  try {
    await api.openAttachment(message.id, attachmentId, message.accountId, filename)
    addAgentMessage('tool', `Opened ${filename}`)
  } catch (error) { addAgentMessage('error', error instanceof Error ? error.message : String(error)) }
}

async function selectConversation(id: string, revealOnMobile = false): Promise<void> {
  const summary = conversations.find((conversation) => conversation.id === id)
  if (!summary) return
  const sequence = ++selectionSequence
  try {
    await flushDraftAutosave()
  } catch (error) {
    if (sequence === selectionSequence) draftError(error)
    return
  }
  if (sequence !== selectionSequence) return
  if (revealOnMobile && usesMobilePanels()) {
    mobilePanel = 'reader'
    mobileReturnPanel = 'reader'
    renderPanels()
  }
  selectedConversationId = id
  selected = undefined
  activeDraft = undefined
  draftEditSession += 1
  draftDirty = false
  if (draftPreviewTimer !== undefined) window.clearTimeout(draftPreviewTimer)
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
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
  renderThreadMeta(summary)
  elements.context.textContent = `Loading · ${summary.subject} · ${summary.sender.name}`
  const loading = document.createElement('div')
  loading.className = 'empty text-secondary dispatch-reader-loading'
  loading.textContent = 'Loading conversation…'
  elements.body.replaceChildren(loading)
  elements.attachments.replaceChildren()

  if (mailbox === 'drafts' && summary.accountId) {
    try {
      const draft = await api.openDraftFromMessage(summary.accountId, summary.latestMessageId)
      if (sequence !== selectionSequence || selectedConversationId !== id) return
      elements.context.textContent = `Editing draft · ${draft.subject || '(no subject)'}`
      showDraft(draft, false)
    } catch (error) {
      if (sequence !== selectionSequence) return
      loading.className = 'alert alert-danger m-4 dispatch-reader-load-error'
      loading.textContent = error instanceof Error ? error.message : String(error)
      elements.context.textContent = `Unavailable · ${summary.subject}`
    }
    return
  }

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
    renderThreadMeta({ ...conversation, messageCount: conversation.messages.length })
    elements.context.textContent = `Working with · ${contextLabel(conversation)}`
    const newestFirst = [...conversation.messages].sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    elements.body.replaceChildren(...newestFirst.map((message, index) => renderThreadMessage(message, index === 0)))
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
    void loadConversations(true)
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

function recipientField(input: HTMLInputElement): HTMLElement {
  const field = input.closest<HTMLElement>('[data-recipient-field]')
  if (!field) throw new Error('Draft recipient field is missing')
  return field
}

function recipientChipAddresses(input: HTMLInputElement): string[] {
  return [...recipientField(input).querySelectorAll('[data-recipient-address]')].map((chip) => chip.getAttribute('data-recipient-address') ?? '').filter(Boolean)
}

function recipientValue(input: HTMLInputElement): string {
  return serializeRecipientList(recipientChipAddresses(input), input.value)
}

function hideRecipientSuggestions(input: HTMLInputElement): void {
  const list = recipientField(input).querySelector<HTMLElement>('.dispatch-recipient-suggestions')
  if (!list) return
  list.hidden = true
  list.replaceChildren()
}

function renderRecipientChips(input: HTMLInputElement, addresses: readonly string[]): void {
  const chips = recipientField(input).querySelector('.dispatch-recipient-chips')
  if (!chips) throw new Error('Draft recipient chips are missing')
  chips.replaceChildren(...[...new Set(addresses.filter(Boolean))].map((address) => {
    const chip = document.createElement('span')
    chip.className = 'dispatch-recipient-chip'
    chip.dataset.recipientAddress = address
    const label = document.createElement('span')
    label.textContent = address
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn-close'
    remove.setAttribute('aria-label', `Remove ${address}`)
    remove.addEventListener('click', () => {
      chip.remove()
      hideRecipientSuggestions(input)
      draftDirty = true
      if (activeDraft?.id) autosaveDraft()
    })
    chip.append(label, remove)
    return chip
  }))
}

function setRecipientField(input: HTMLInputElement, value: string): void {
  renderRecipientChips(input, parseRecipientList(value))
  input.value = ''
  hideRecipientSuggestions(input)
}

function addRecipientChip(input: HTMLInputElement, address: string): void {
  const next = address.trim()
  if (!next) return
  renderRecipientChips(input, [...recipientChipAddresses(input), next])
  input.value = ''
  hideRecipientSuggestions(input)
}

async function suggestRecipients(input: HTMLInputElement): Promise<void> {
  const query = input.value.trim()
  const list = recipientField(input).querySelector<HTMLElement>('.dispatch-recipient-suggestions')
  if (!list) return
  if (!query) {
    hideRecipientSuggestions(input)
    return
  }
  const accountId = activeDraft?.accountId || elements.draftAccount.value || selectedAccountId
  try {
    const recipients = await api.listRecipients(query, accountId)
    const exclude = new Set(recipientChipAddresses(input).map((address) => address.toLowerCase()))
    const matches = recipients.filter((recipient) => !exclude.has(recipient.address.toLowerCase()))
    if (matches.length === 0) {
      hideRecipientSuggestions(input)
      return
    }
    list.replaceChildren(...matches.map((recipient) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.className = 'dropdown-item'
      item.textContent = recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address
      item.addEventListener('mousedown', (event) => {
        event.preventDefault()
        addRecipientChip(input, recipient.address)
        draftDirty = true
        if (activeDraft?.id) autosaveDraft()
      })
      return item
    }))
    list.hidden = false
  } catch (error) {
    hideRecipientSuggestions(input)
    draftError(error)
  }
}

function scheduleRecipientSuggestions(input: HTMLInputElement): void {
  if (recipientSuggestTimer !== undefined) window.clearTimeout(recipientSuggestTimer)
  recipientSuggestTimer = window.setTimeout(() => {
    void suggestRecipients(input)
  }, 150)
}

function acceptRecipientInput(input: HTMLInputElement): void {
  const leftover = input.value.trim()
  if (!leftover) return
  addRecipientChip(input, leftover)
}

function onRecipientInput(input: HTMLInputElement): void {
  const parsed = commitRecipientToken(input.value)
  if (parsed.committed.length > 0) {
    renderRecipientChips(input, [...recipientChipAddresses(input), ...parsed.committed])
    input.value = parsed.leftover
  }
  scheduleRecipientSuggestions(input)
}

function renderDraftAttachments(): void {
  const items = activeDraft?.attachments ?? []
  elements.draftAttachments.replaceChildren(...items.map((attachment, index) => {
    const row = document.createElement('li')
    row.className = 'dispatch-draft-attachment'
    const name = document.createElement('strong')
    name.textContent = attachment.name
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-sm btn-ghost-secondary'
    remove.setAttribute('aria-label', `Remove attachment ${attachment.name}`)
    remove.addEventListener('click', () => {
      if (!activeDraft) return
      activeDraft = { ...activeDraft, attachments: activeDraft.attachments.filter((_, itemIndex) => itemIndex !== index) }
      renderDraftAttachments()
      draftDirty = true
      if (activeDraft.id) void saveDraft(false).catch(draftError)
    })
    row.append(name, remove)
    return row
  }))
  elements.draftAttachments.hidden = items.length === 0
}

function draftError(error: unknown): void {
  elements.draftError.hidden = false
  elements.draftError.textContent = error instanceof Error ? error.message : String(error)
}

function replyQuoteMarkdown(message: MessageProjection): string {
  const content = message.body.kind === 'plain-text'
    ? message.body.content.trim()
    : renderEmailContent(message.body.kind, message.body.content).textContent?.trim() ?? ''
  return `\n\n> ${content.split(/\r?\n/).join('\n> ')}`
}

function showDraft(draft: DraftProjection, accountMutable: boolean): void {
  if (draftPreviewTimer !== undefined) window.clearTimeout(draftPreviewTimer)
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
  draftPreviewTimer = undefined
  draftAutosaveTimer = undefined
  draftPreviewSequence += 1
  draftEditSession += 1
  draftDirty = false
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
  setRecipientField(elements.draftTo, draft.to.map((address) => address.address).join(', '))
  setRecipientField(elements.draftCc, draft.cc ?? '')
  setRecipientField(elements.draftBcc, draft.bcc ?? '')
  elements.draftSubject.value = draft.subject
  elements.draftBody.value = draft.bodyMarkdown || draft.bodyText
  elements.draftPreview.innerHTML = draft.bodyHtml
  elements.draftError.hidden = true
  elements.draftError.textContent = ''
  elements.sendConfirm.hidden = true
  renderDraftAttachments()
  draftDiscarding = false
}

function hideDraftEditor(): void {
  if (draftPreviewTimer !== undefined) window.clearTimeout(draftPreviewTimer)
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
  draftPreviewTimer = undefined
  draftAutosaveTimer = undefined
  draftPreviewSequence += 1
  draftEditSession += 1
  draftDirty = false
  draftDiscarding = false
  activeDraft = undefined
  elements.draft.hidden = true
  elements.sendConfirm.hidden = true
  elements.draftError.hidden = true
  elements.reader.classList.remove('dispatch-drafting', 'dispatch-composing')
  if (selected) {
    elements.reader.hidden = false
    elements.readerEmpty.hidden = true
    elements.body.hidden = false
    elements.attachments.hidden = false
  } else {
    elements.reader.hidden = true
    elements.readerEmpty.hidden = false
  }
}

function refreshPreview(): void {
  if (draftPreviewTimer !== undefined) window.clearTimeout(draftPreviewTimer)
  const sequence = ++draftPreviewSequence
  draftPreviewTimer = window.setTimeout(() => {
    draftPreviewTimer = undefined
    void api.previewDraft(elements.draftBody.value).then((bodyHtml) => {
      if (sequence === draftPreviewSequence && activeDraft) elements.draftPreview.innerHTML = bodyHtml
    }).catch(draftError)
  }, 300)
}

function autosaveDraft(): void {
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
  draftAutosaveTimer = window.setTimeout(() => {
    draftAutosaveTimer = undefined
    if (activeDraft?.id) void saveDraft(false).catch(draftError)
  }, 1_500)
}

async function flushDraftAutosave(): Promise<void> {
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
  draftAutosaveTimer = undefined
  const draftId = activeDraft?.id
  const session = draftEditSession
  if (!draftId || !draftDirty) return
  if (draftSaveFlight) await draftSaveFlight
  if (draftEditSession !== session || activeDraft?.id !== draftId || !draftDirty) return
  await saveDraft(false)
}

async function openDraft(replyAll = false): Promise<void> {
  if (!selected) return
  const accountId = selected.accountId
  const latestMessageId = selected.latestMessageId
  const latest = selected.messages.find((message) => message.id === latestMessageId) ?? selected.messages[0]
  if (!latest) return
  const own = accounts.find((account) => account.id === accountId)?.email.toLowerCase()
  const participants = [latest.sender, ...(latest.to ?? [])].filter((address, index, values) => address.address.toLowerCase() !== own && values.findIndex((item) => item.address.toLowerCase() === address.address.toLowerCase()) === index)
  const primary = participants[0] ?? latest.sender
  const to = replyAll ? draftAddressList(participants) : primary.address
  const cc = replyAll ? draftAddressList((latest.cc ?? []).filter((address) => address.address.toLowerCase() !== own && !participants.some((item) => item.address.toLowerCase() === address.address.toLowerCase()))) : ''
  const bodyMarkdown = replyQuoteMarkdown(latest)
  const subject = selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`
  const fields = { to, cc, bcc: '', subject, bodyMarkdown, bodyText: bodyMarkdown }
  const draft: DraftProjection = selected.source === 'gmail' && accountId
    ? await api.createDraft(latest.id, { accountId, ...fields })
    : await api.createDraft(selected.latestMessageId, fields)
  showDraft(draft, false)
}

async function openForward(): Promise<void> {
  if (!selected?.accountId) return
  const latestMessageId = selected.latestMessageId
  const latest = selected.messages.find((message) => message.id === latestMessageId) ?? selected.messages[0]
  if (!latest) return
  const subject = selected.subject.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject}`
  const content = renderEmailContent(latest.body.kind, latest.body.content).textContent?.trim() ?? ''
  const bodyMarkdown = `\n\n---------- Forwarded message ----------\nFrom: ${latest.sender.name} <${latest.sender.address}>\nDate: ${latest.receivedFullLabel}\nSubject: ${latest.subject}\n\n${content}`
  const draft = await api.createDraft('', {
    accountId: selected.accountId,
    to: '',
    cc: '',
    bcc: '',
    subject,
    bodyMarkdown,
    bodyText: bodyMarkdown,
    attachments: latest.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeLabel: attachment.sizeLabel,
      sourceMessageId: latest.id,
    })),
  })
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
  if (usesMobilePanels()) {
    mobilePanel = 'reader'
    mobileReturnPanel = 'reader'
    renderPanels()
  }
  elements.subject.textContent = 'New message'
  elements.messageCount.textContent = 'Draft'
  elements.threadMailbox.textContent = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  elements.address.hidden = true
  elements.accountDot.hidden = true
  elements.accountSep.hidden = true
  const draft: DraftProjection = { id: '', inReplyToMessageId: '', to: [], cc: '', bcc: '', subject: '', bodyMarkdown: '', bodyHtml: '', bodyText: '', attachments: [], state: 'draft', accountId }
  showDraft(draft, true)
}

async function saveDraft(notify = true): Promise<void> {
  if (draftDiscarding) return
  const session = draftEditSession
  while (draftSaveFlight) await draftSaveFlight
  if (draftDiscarding || !activeDraft || session !== draftEditSession) return
  const draft = activeDraft
  const accountId = draft.id ? draft.accountId : elements.draftAccount.value
  if (!accountId) throw new Error('Choose a Gmail account for this draft.')
  const bodyMarkdown = elements.draftBody.value
  const fields = { accountId, messageId: draft.inReplyToMessageId, to: recipientValue(elements.draftTo), cc: recipientValue(elements.draftCc), bcc: recipientValue(elements.draftBcc), subject: elements.draftSubject.value, bodyMarkdown, bodyText: bodyMarkdown, attachments: draft.attachments }
  const operation = (async () => {
    const savedDraft = draft.id
      ? await api.updateDraft(draft.id, fields)
      : await api.createDraft('', fields)
    if (session !== draftEditSession || activeDraft !== draft || draftDiscarding) return savedDraft
    activeDraft = savedDraft
    elements.draftAccount.disabled = true
    elements.draftPreview.innerHTML = savedDraft.bodyHtml
    elements.draftError.hidden = true
    elements.draftError.textContent = ''
    if (recipientValue(elements.draftTo) === fields.to
      && recipientValue(elements.draftCc) === fields.cc
      && recipientValue(elements.draftBcc) === fields.bcc
      && elements.draftSubject.value === fields.subject
      && elements.draftBody.value === bodyMarkdown) {
      draftDirty = false
    }
    if (notify) addAgentMessage('tool', 'Gmail draft saved.')
    return savedDraft
  })()
  draftSaveFlight = operation
  try {
    await operation
  } finally {
    if (draftSaveFlight === operation) draftSaveFlight = undefined
  }
}

async function reviseDraft(): Promise<void> {
  if (!activeDraft) return
  if (activeDraft.id) {
    await flushDraftAutosave()
  } else {
    if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
    draftAutosaveTimer = undefined
    await saveDraft(false)
  }
  const draft = activeDraft
  if (!draft?.id) throw new Error('Gmail did not return a draft ID. Codex did not receive the revision prompt.')
  if (!draft.accountId) throw new Error('The Gmail account is missing from this draft.')
  elements.prompt.value = [
    `Revise Gmail draft ${draft.id} on account ${draft.accountId}.`,
    `Call Gmail update_draft on that draft ID. Put the revised Markdown in text_plain and the revised HTML in payload.`,
    'Never call gmail.send_draft or gmail.send_email. Never send this draft.',
    `Current draft:\n\n${elements.draftBody.value}`,
  ].join(' ')
  elements.prompt.focus()
  await sendPrompt()
}

function sendDraft(): void {
  if (!activeDraft || draftSendFlight) return
  elements.sendConfirmText.textContent = [
    `To: ${recipientValue(elements.draftTo) || '(no recipient)'}`,
    recipientValue(elements.draftCc) ? `Cc: ${recipientValue(elements.draftCc)}` : '',
    recipientValue(elements.draftBcc) ? `Bcc: ${recipientValue(elements.draftBcc)}` : '',
    `Subject: ${elements.draftSubject.value || '(no subject)'}`,
  ].filter(Boolean).join('\n')
  elements.sendConfirm.hidden = false
}

async function confirmSendDraft(): Promise<void> {
  if (!activeDraft || draftSendFlight || draftDiscarding) return
  const operation = (async () => {
    await saveDraft()
    const draft = activeDraft
    if (!draft?.id || !draft.accountId) throw new Error('Save the Gmail draft before sending it.')
    await api.sendDraft(draft.id, draft.accountId)
    addAgentMessage('agent', 'Gmail confirmed that the draft was sent.')
    hideDraftEditor()
    void loadConversations()
  })()
  draftSendFlight = operation
  elements.sendConfirmGo.disabled = true
  elements.sendDraft.disabled = true
  elements.discardDraft.disabled = true
  try {
    await operation
  } finally {
    if (draftSendFlight === operation) draftSendFlight = undefined
    elements.sendConfirmGo.disabled = false
    elements.sendDraft.disabled = false
    elements.discardDraft.disabled = false
  }
}

async function discardDraft(): Promise<void> {
  if (draftSendFlight || draftDiscarding) return
  const draft = activeDraft
  if (!draft) return
  draftDiscarding = true
  if (draftAutosaveTimer !== undefined) window.clearTimeout(draftAutosaveTimer)
  draftAutosaveTimer = undefined
  draftEditSession += 1
  let savedDraft: DraftProjection | undefined = draft
  try {
    if (draftSaveFlight) savedDraft = (await draftSaveFlight) ?? draft
    const discardId = savedDraft.id
    if (discardId) {
      if (!savedDraft.accountId) throw new Error('The Gmail account is missing from this draft.')
      await api.discardDraft(discardId, savedDraft.accountId)
    }
    hideDraftEditor()
    void loadConversations()
  } catch (error) {
    draftDiscarding = false
    throw error
  }
}

async function fileContentBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function attachDraftFiles(): Promise<void> {
  if (!activeDraft) return
  const files = [...(elements.draftFiles.files ?? [])]
  if (files.length === 0) return
  try {
    const attachments = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      contentBase64: await fileContentBase64(file),
    })))
    activeDraft = { ...activeDraft, attachments: [...activeDraft.attachments, ...attachments] }
    renderDraftAttachments()
    await saveDraft()
  } catch (error) {
    draftError(error)
  } finally {
    elements.draftFiles.value = ''
  }
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
    const draftToRefresh = activeDraft
    if (draftToRefresh?.id && draftToRefresh.accountId) {
      void api.getDraft(draftToRefresh.id, draftToRefresh.accountId).then((draft) => {
        if (activeDraft?.id === draftToRefresh.id) showDraft(draft, false)
      }).catch(draftError)
    }
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
    let restoreHistory = false
    if (threadId) {
      try {
        threadId = await api.resumeThread(threadId)
        restoreHistory = true
      } catch {
        threadId = await api.startThread()
      }
    } else {
      threadId = await api.startThread()
    }
    localStorage.setItem('dispatch.codex.threadId', threadId)
    if (restoreHistory) {
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

async function loadConversations(preserveSelection = false): Promise<void> {
  const loadSequence = ++conversationLoadSequence
  const cacheKey = `dispatch.conversations.v1:${selectedAccountId ?? 'all'}:${mailbox}:${mailState}:${searchQuery}`
  let usedCache = false
  let cacheConfirmedAt: number | undefined
  if (!preserveSelection) {
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
  }
  if (!preserveSelection && !usedCache && mailbox === 'inbox' && mailState !== 'all' && !searchQuery) {
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
  if (!preserveSelection) {
    selected = undefined
    selectedConversationId = undefined
    selectionSequence += 1
    elements.reader.hidden = true
    elements.readerEmpty.hidden = false
    elements.readerEmpty.textContent = usedCache && conversations.length > 0 ? 'Select a message' : `Loading ${mailState === 'all' ? '' : `${mailState} `}${mailboxLabels[mailbox].toLowerCase()}…`
  }
  app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => {
    const active = button.dataset.mailState === mailState
    button.setAttribute('aria-pressed', String(active))
    button.classList.toggle('active', active)
  })
  renderList(usedCache ? defaultEmptyListMessage() : 'Loading messages…')
  if (usedCache && conversations[0] && !preserveSelection) void selectConversation(conversations[0].id)
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
      if (syncErrorVisible) elements.mailError.hidden = true
      syncErrorVisible = false
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
      const changed = observedSyncCompletedAt !== undefined && sync.completedAt !== observedSyncCompletedAt
      observedSyncCompletedAt = sync.completedAt
      if (changed && mailbox === 'inbox') void loadConversations(true)
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
      all.textContent = `All inboxes (${accounts.length})`
      all.selected = !selectedAccountId
      elements.account.replaceChildren(all, ...accounts.map((account) => {
        const option = document.createElement('option')
        option.value = account.id
        option.textContent = account.email || account.name
        option.selected = account.id === selectedAccountId
        return option
      }))
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

app.querySelector<HTMLButtonElement>('[data-refresh]')?.addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  elements.mailSource.textContent = 'Refreshing Gmail…'
  void api.refreshMail().then((sync) => {
    observedSyncCompletedAt = sync.completedAt
    return loadConversations(true)
  }).catch((error) => {
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  }).finally(() => { button.disabled = false })
})
elements.account.addEventListener('change', () => {
  selectedAccountId = elements.account.value || undefined
  void loadConversations()
})
app.querySelectorAll<HTMLButtonElement>('[data-mailbox]').forEach((button) => button.addEventListener('click', () => {
  mailbox = button.dataset.mailbox as GmailMailbox
  renderMailbox()
  void loadConversations()
}))
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
  if (usesMobilePanels()) {
    mobilePanel = name
    if (name !== 'messages') mobileReturnPanel = name
    renderPanels()
    return
  }
  const visibleCount = Number(panels.messages) + Number(panels.reader) + Number(panels.agent)
  if (panels[name] && visibleCount === 1) return
  panels[name] = !panels[name]
  renderPanels()
}))
elements.messagesDivider.addEventListener('pointerdown', (event) => resizePanel('messagesWidth', event))
elements.agentDivider.addEventListener('pointerdown', (event) => resizePanel('agentWidth', event))
elements.messagesDivider.addEventListener('keydown', (event) => resizePanelWithKeyboard('messagesWidth', event))
elements.agentDivider.addEventListener('keydown', (event) => resizePanelWithKeyboard('agentWidth', event))
elements.messagesDivider.addEventListener('dblclick', () => { panels.messages = false; renderPanels() })
elements.agentDivider.addEventListener('dblclick', () => { panels.agent = false; renderPanels() })
app.querySelector('[data-collapse-messages]')?.addEventListener('click', () => { panels.messages = false; renderPanels() })
app.querySelector('[data-collapse-reader]')?.addEventListener('click', () => { panels.reader = false; renderPanels() })
app.querySelector('[data-mobile-back]')?.addEventListener('click', () => { mobilePanel = 'messages'; renderPanels() })
app.querySelector('[data-compose]')?.addEventListener('click', openCompose)
app.querySelector('[data-reply]')?.addEventListener('click', () => { void openDraft(false).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-reply-all]')?.addEventListener('click', () => { void openDraft(true).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-forward]')?.addEventListener('click', () => { void openForward().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
elements.archive.addEventListener('click', () => { void mutateSelected('archive') })
elements.spam.addEventListener('click', () => { void mutateSelected('spam') })
elements.trash.addEventListener('click', () => { void mutateSelected('trash') })
elements.moveInbox.addEventListener('click', () => { void mutateSelected('inbox') })
app.querySelector('[data-ask]')?.addEventListener('click', () => {
  if (usesMobilePanels()) { mobilePanel = 'agent'; mobileReturnPanel = 'agent'; renderPanels() }
  elements.prompt.focus()
})
app.querySelector('[data-save-draft]')?.addEventListener('click', () => { void saveDraft().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-send-draft]')?.addEventListener('click', sendDraft)
app.querySelector('[data-send-cancel]')?.addEventListener('click', () => { elements.sendConfirm.hidden = true })
app.querySelector('[data-send-confirm-go]')?.addEventListener('click', () => { void confirmSendDraft().catch(draftError) })
app.querySelector('[data-discard-draft]')?.addEventListener('click', () => { void discardDraft().catch(draftError) })
app.querySelector('[data-attach-draft]')?.addEventListener('click', () => { elements.draftFiles.click() })
elements.draftFiles.addEventListener('change', () => { void attachDraftFiles() })
elements.draftBody.addEventListener('input', () => {
  elements.sendConfirm.hidden = true
  draftDirty = true
  refreshPreview()
  autosaveDraft()
})
for (const field of [elements.draftTo, elements.draftCc, elements.draftBcc]) {
  field.addEventListener('input', () => {
    elements.sendConfirm.hidden = true
    draftDirty = true
    onRecipientInput(field)
    if (activeDraft?.id) autosaveDraft()
  })
  field.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === 'Tab') && field.value.trim()) {
      if (event.key === 'Enter') event.preventDefault()
      acceptRecipientInput(field)
      draftDirty = true
      if (activeDraft?.id) autosaveDraft()
    }
    if (event.key === 'Backspace' && !field.value) {
      const chips = recipientChipAddresses(field)
      if (chips.length === 0) return
      renderRecipientChips(field, chips.slice(0, -1))
      draftDirty = true
      if (activeDraft?.id) autosaveDraft()
    }
    if (event.key === 'Escape') hideRecipientSuggestions(field)
  })
  field.addEventListener('blur', () => {
    window.setTimeout(() => hideRecipientSuggestions(field), 120)
  })
}
elements.draftSubject.addEventListener('input', () => {
  elements.sendConfirm.hidden = true
  draftDirty = true
  if (activeDraft?.id) autosaveDraft()
})
elements.draftAccount.addEventListener('input', () => { elements.sendConfirm.hidden = true })
app.querySelector('[data-revise-draft]')?.addEventListener('click', () => { void reviseDraft().catch(draftError) })
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
function setFolderMenu(open: boolean): void {
  elements.folderMenu.hidden = !open
  elements.folderMenu.classList.toggle('show', open)
  elements.folderToggle.setAttribute('aria-expanded', String(open))
}
elements.folderToggle.addEventListener('click', (event) => {
  event.stopPropagation()
  setFolderMenu(elements.folderMenu.hidden)
})
elements.folderMenu.addEventListener('click', () => setFolderMenu(false))
function setReaderMenu(open: boolean): void {
  elements.readerMenu.hidden = !open
  elements.readerMenu.classList.toggle('show', open)
  elements.readerMore.setAttribute('aria-expanded', String(open))
}
elements.readerMore.addEventListener('click', (event) => {
  event.stopPropagation()
  setReaderMenu(elements.readerMenu.hidden)
})
elements.readerMenu.addEventListener('click', () => setReaderMenu(false))
document.addEventListener('click', (event) => {
  if (!elements.folderMenu.hidden && !elements.folderMenu.contains(event.target as Node)) setFolderMenu(false)
  if (!elements.readerMenu.hidden && !elements.readerMenu.contains(event.target as Node)) setReaderMenu(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  setFolderMenu(false)
  setReaderMenu(false)
})
window.addEventListener('resize', renderPanels)
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    elements.search.focus()
    elements.search.select()
    return
  }
  if (!event.ctrlKey || event.metaKey || event.altKey || event.code !== 'Backquote') return
  event.preventDefault()
  if (usesMobilePanels()) {
    if (mobilePanel === 'messages') mobilePanel = selectedConversationId || activeDraft ? mobileReturnPanel : 'agent'
    else {
      mobileReturnPanel = mobilePanel
      mobilePanel = 'messages'
    }
  } else {
    panels.messages = !panels.messages
  }
  renderPanels()
})

renderMailbox()
renderPanels()
void start()
