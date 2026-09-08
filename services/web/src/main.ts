import { installWebLinks } from './web-links.js'
import { DraftRecovery, type RecoveryDraft } from './draft-recovery.js'
import { receiptView } from './receipt-view.js'
import { resultExcerpt, highlightPassage } from './search-highlights.js'
import { renderThreadAttachments } from './thread-attachments'
import '@tabler/core/dist/css/tabler.min.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles.css'
import './apple-ui.css'
import { api } from './api.js'
import { renderChatMarkdown } from './chat-renderer.js'
import { renderEmailContent, emailPlainText } from './email-renderer.js'
import { commitRecipientToken, parseRecipientList, serializeRecipientList } from './recipient-field.js'
import type { SendReceipt, OfflineStatus, SearchResults, SearchResult, AppSummary, ConversationProjection, DispatchModel, DispatchModelCatalog, ConversationSummary, DraftProjection, GmailAccount, GmailConversationAction, GmailMailbox, MailAddress, MailStateFilter, MessageProjection } from './contracts.js'
import { createContextMenuPopup } from './context-menu-popup.js'
import { createMarkReadDwell } from './mark-read-dwell.js'
import { gmailAppId, isNativeShell } from './model.js'
import { codexMailEffect, visibleUserPrompt, type CodexMailEffect } from './codex-mail-effect.js'
import { arrivedUnreadIds, liveListBaseline, playNewMailTone, type LiveListBaseline } from './new-mail-tone.js'
import { threadContextMenuItems } from './thread-context-menu.js'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('Dispatch app root is missing')
const app: HTMLDivElement = appElement
if (isNativeShell(window as { isTauri?: unknown })) document.documentElement.classList.add('dispatch-native')
const popupContextMenu = createContextMenuPopup(window as Window & { isTauri?: unknown; __TAURI__?: { core?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } } })

app.innerHTML = `
  <div class="page dispatch-window">
    <header class="dispatch-toolbar" data-tauri-drag-region>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-messages" data-toolbar-messages data-tauri-drag-region>
        <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-mailboxes-toggle aria-label="Show mailboxes" aria-expanded="false" title="Show mailboxes"><i class="ti ti-layout-sidebar" aria-hidden="true"></i></button><button class="btn btn-sm btn-ghost-secondary dispatch-sidebar-options" data-sidebar-options aria-label="Folder rail style" aria-haspopup="menu" aria-expanded="false"><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
        <button class="btn btn-icon btn-ghost-primary btn-sm" type="button" data-compose aria-label="Compose" title="Compose"><i class="ti ti-pencil" aria-hidden="true"></i></button>
        <div class="dispatch-folder">
          <button class="btn btn-ghost-secondary btn-sm dispatch-folder-button" type="button" data-folder-toggle aria-haspopup="menu" aria-expanded="false"><h1 class="dispatch-folder-title" data-mailbox-title>Inbox</h1><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
          <div class="dropdown-menu dispatch-folder-menu" data-folder-menu role="menu" hidden>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="inbox"><i class="ti ti-inbox dropdown-item-icon" aria-hidden="true"></i>Inbox</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="sent"><i class="ti ti-send dropdown-item-icon" aria-hidden="true"></i>Sent</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="drafts"><i class="ti ti-file-pencil dropdown-item-icon" aria-hidden="true"></i>Drafts</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="archive"><i class="ti ti-archive dropdown-item-icon" aria-hidden="true"></i>Archive</button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" type="button" role="menuitem" data-collapse-messages aria-label="Collapse thread list">Hide message list <span class="ms-auto">⌃&#96;</span></button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="spam"><i class="ti ti-alert-octagon dropdown-item-icon" aria-hidden="true"></i>Spam</button>
            <button class="dropdown-item" type="button" role="menuitem" data-mailbox="trash"><i class="ti ti-trash dropdown-item-icon" aria-hidden="true"></i>Trash</button>
          </div>
        </div>
        <select class="form-select form-select-sm dispatch-scope" data-account aria-label="Gmail account"><option value="">All inboxes</option></select>
        <span class="dispatch-toolbar-spacer" data-tauri-drag-region></span>
      </div>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-reader" data-tauri-drag-region>

        <span class="dispatch-toolbar-spacer" data-tauri-drag-region></span>
        <label class="input-icon dispatch-search"><span class="input-icon-addon"><i class="ti ti-search" aria-hidden="true"></i></span><input class="form-control form-control-sm" data-search placeholder="Search" aria-label="Search mail" title="Type to filter; press Enter to search with Codex"><kbd class="dispatch-search-kbd" aria-hidden="true">⌘K</kbd></label><button class="btn btn-sm btn-icon btn-ghost-primary" type="button" data-ai-search aria-label="Search with Codex" title="Search with Codex (Enter)"><i class="ti ti-sparkles" aria-hidden="true"></i></button>
      </div>
      <div class="dispatch-toolbar-cluster dispatch-toolbar-agent" data-toolbar-agent data-tauri-drag-region>
        <span class="dispatch-toolbar-spacer" data-tauri-drag-region></span>
        <div class="btn-group dispatch-panel-controls" role="group" aria-label="Visible panels">
          <button class="btn btn-sm btn-icon active" type="button" data-panel="messages" aria-pressed="true" aria-label="Messages" title="Messages (Control + &#96;)"><i class="ti ti-layout-sidebar" aria-hidden="true"></i></button>
          <button class="btn btn-sm btn-icon active" type="button" data-panel="reader" aria-pressed="true" aria-label="Email" title="Email"><i class="ti ti-mail" aria-hidden="true"></i></button>
          <button class="btn btn-sm btn-icon active" type="button" data-panel="agent" aria-pressed="true" aria-label="Codex" title="Codex"><i class="ti ti-sparkles" aria-hidden="true"></i></button>
        </div>
      </div>
    </header>
    <div class="dispatch-workspace">
      <nav class="dispatch-rail nav nav-pills flex-column" aria-label="Mail folders" hidden><button type="button" class="nav-link active" data-mailbox="inbox"><i class="ti ti-inbox" aria-hidden="true"></i><span>Inbox</span></button><button type="button" class="nav-link" data-mailbox="sent"><i class="ti ti-send" aria-hidden="true"></i><span>Sent</span></button><button type="button" class="nav-link" data-mailbox="drafts"><i class="ti ti-file-pencil" aria-hidden="true"></i><span>Drafts</span></button><button type="button" class="nav-link" data-mailbox="archive"><i class="ti ti-archive" aria-hidden="true"></i><span>Archive</span></button><span class="dispatch-rail-spacer"></span><button type="button" class="nav-link" data-mailbox="spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i><span>Spam</span></button><button type="button" class="nav-link" data-mailbox="trash"><i class="ti ti-trash" aria-hidden="true"></i><span>Trash</span></button></nav>
      <aside class="card rounded-0 border-0 dispatch-messages" aria-label="Messages">
        <nav class="dispatch-mail-tabs" aria-label="Message state"><button class="dispatch-mail-tab active" type="button" data-mail-state="all" aria-pressed="true">All</button><button class="dispatch-mail-tab" type="button" data-mail-state="unread" aria-pressed="false">Unread</button><button class="dispatch-mail-tab" type="button" data-mail-state="read" aria-pressed="false">Read</button><button class="btn btn-sm btn-icon ms-auto" data-density aria-label="Use comfortable message list" aria-pressed="true" title="Message density"><i class="ti ti-list-details" aria-hidden="true"></i></button></nav>
        <div class="dispatch-recovery-banner" hidden><span data-recovery-count>Unsaved drafts on this Mac</span><button type="button" class="nav-link" data-recovery-open hidden><i class="ti ti-history" aria-hidden="true"></i><span>Recovery</span></button></div>
        <div class="dispatch-search-status" data-search-status hidden><span data-search-summary role="status"></span><button class="btn btn-sm btn-ghost-secondary" type="button" data-clear-search aria-label="Return to mailbox">Clear</button></div>
        <div class="list-group list-group-flush dispatch-message-list" data-message-list></div>
        <div class="alert alert-danger m-3 dispatch-pane-error" role="alert" data-mail-error hidden></div>
        <footer class="dispatch-mail-activity"><div class="dispatch-activity-status">        <span class="dispatch-sync" data-sync-state="idle"><span class="dispatch-sync-dot" aria-hidden="true"></span><span class="text-secondary" data-mail-source>Loading</span></span>
        <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-refresh aria-label="Refresh" title="Refresh Gmail"><i class="ti ti-refresh" aria-hidden="true"></i></button></div><button class="btn btn-sm" data-activity-toggle aria-expanded="false" aria-controls="dispatch-activity"><i class="ti ti-activity" aria-hidden="true"></i><span>Mail activity</span></button><div class="dispatch-activity-popover" id="dispatch-activity" hidden><strong>Mail activity</strong><div class="dispatch-activity-options"><button type="button" class="nav-link" data-receipts-open><i class="ti ti-receipt" aria-hidden="true"></i><span>Receipts</span></button><button type="button" class="nav-link" data-offline-open><i class="ti ti-cloud-down" aria-hidden="true"></i><span>Offline</span></button></div><p class="small text-secondary mb-0">Send history and downloaded mail</p></div></footer>
      </aside>
      <div class="dispatch-divider" data-divider="messages" role="separator" tabindex="0" aria-label="Resize messages panel" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="640"><i class="ti ti-grip-vertical" aria-hidden="true"></i></div>
      <main class="card rounded-0 border-0 dispatch-reader" aria-label="Selected email">
        <div class="empty dispatch-reader-empty" data-reader-empty><div class="empty-icon"><i class="ti ti-mail-opened"></i></div><p class="empty-title">Select a message</p></div>
        <div data-reader hidden>
          <header class="dispatch-reader-header">
            <h2 class="dispatch-reader-subject" data-subject></h2>
            <div class="dispatch-reader-toolbar">
              <button class="btn btn-icon btn-ghost-secondary btn-sm dispatch-mobile-back" type="button" data-mobile-back aria-label="Back to Inbox"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
              <button class="btn btn-outline-secondary btn-sm" type="button" data-reply><i class="ti ti-arrow-back-up me-1" aria-hidden="true"></i>Reply</button>
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
            <div class="dispatch-thread-meta" data-thread-meta><span data-message-count></span><span class="dispatch-meta-sep">·</span><span data-thread-mailbox></span><span class="dispatch-meta-sep" data-account-sep hidden>·</span><span class="dispatch-account-dot" data-account-dot hidden aria-hidden="true"></span><span data-address hidden></span><button type="button" class="btn btn-sm btn-ghost-primary dispatch-thread-files-toggle" data-thread-files-toggle aria-expanded="false" aria-controls="dispatch-thread-files" hidden></button></div>
            <div class="dispatch-copy-status" data-copy-status hidden role="status"></div>
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
            <p class="text-secondary small" data-recovery-status role="status"></p>
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
        <div class="dispatch-agent-stream" data-agent-stream><p class="dispatch-agent-intro">Use the installed Codex harness with your selected email in view.</p></div>
        <footer class="card-footer">
          <p class="dispatch-agent-state-text" data-agent-state-text role="status" hidden></p><div class="dispatch-suggestions"><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Catch me up on this email.">Catch me up</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Draft a reply to this email.">Draft a reply</button><button class="btn btn-sm btn-ghost-secondary" type="button" data-suggestion="Find related messages in Gmail.">Find related</button></div>
          <div class="card card-sm dispatch-prompt"><div class="card-body p-2"><textarea class="form-control border-0 shadow-none" data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea><div class="progress progress-sm mt-2" data-agent-activity aria-label="Codex is working" hidden><div class="progress-bar progress-bar-indeterminate bg-blue"></div></div><div class="d-flex align-items-center justify-content-between mt-2"><span class="dispatch-prompt-status"><span class="dispatch-status-dot" data-connector data-ready="false" title="Checking connectors" aria-label="Checking connectors"></span><span class="dispatch-status-dot" data-agent-status data-status="Connecting" title="Connecting" aria-label="Connecting" aria-live="polite"></span><span class="dispatch-model"><button class="badge bg-blue-lt text-blue border-0 dispatch-model-button" type="button" data-model-toggle aria-haspopup="menu" aria-expanded="false" title="Choose the Codex model and reasoning effort"><span data-model-label>GPT-5.6 Sol · Medium</span><i class="ti ti-chevron-down" aria-hidden="true"></i></button><div class="dropdown-menu dispatch-model-menu" data-model-menu role="menu" hidden><div class="dropdown-header" data-model-summary>Loading models</div><div data-model-list></div><div class="dropdown-divider"></div><div class="dropdown-header">Reasoning effort</div><div class="dispatch-model-efforts" role="group" aria-label="Reasoning effort" data-model-efforts></div></div></span></span><span><button class="btn btn-icon btn-sm btn-outline-danger" type="button" data-stop aria-label="Stop" hidden><i class="ti ti-player-stop-filled" aria-hidden="true"></i></button><button class="btn btn-icon btn-sm btn-primary" type="button" data-send aria-label="Send"><i class="ti ti-arrow-up" aria-hidden="true"></i></button></span></div></div></div>
        </footer>
      </aside>
    </div>
  </div>`

app.insertAdjacentHTML('beforeend', `
  <div class="dispatch-sidebar-menu dropdown-menu" role="menu" aria-label="Folder rail style" data-sidebar-menu hidden><button class="dropdown-item" role="menuitemradio" aria-checked="true" data-sidebar-style="compact">Compact</button><button class="dropdown-item" role="menuitemradio" aria-checked="false" data-sidebar-style="expanded">Expanded</button></div>
  <dialog class="dispatch-utility-dialog" data-recovery-dialog aria-label="Local draft recovery"><div class="d-flex justify-content-between"><h2>Local draft recovery</h2><button class="btn btn-sm" data-dialog-close>Close</button></div><p>These local copies are not saved to Gmail. Review a copy before saving it.</p><div data-recovery-list></div></dialog>
  <dialog class="dispatch-utility-dialog" data-receipts-dialog aria-label="Send receipts"><div class="d-flex justify-content-between"><h2>Send receipts</h2><button class="btn btn-sm" data-dialog-close>Close</button></div><div data-receipts-list></div></dialog>
  <dialog class="dispatch-utility-dialog" data-offline-dialog aria-label="Downloaded mail"><div class="d-flex justify-content-between"><h2>Downloaded mail</h2><button class="btn btn-sm" data-dialog-close>Close</button></div><p>Opened conversations are saved automatically. Download mailbox saves indexed conversations’ full message bodies. Attachments are separate and work offline when already downloaded.</p><label class="form-check"><input class="form-check-input" type="checkbox" data-offline-mode><span class="form-check-label">Use downloaded mail</span></label><p data-offline-status role="status"></p><button class="btn btn-primary btn-sm" data-download-mailbox>Download mailbox</button><button class="btn btn-sm" data-cancel-download hidden>Cancel download</button></dialog>
`)

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
  copyStatus: app.querySelector<HTMLElement>('[data-copy-status]')!,
  recoveryStatus: app.querySelector<HTMLElement>('[data-recovery-status]')!,
  readerMore: app.querySelector<HTMLButtonElement>('[data-reader-more]')!,
  readerMenu: app.querySelector<HTMLElement>('[data-reader-menu]')!,
  body: app.querySelector<HTMLElement>('[data-body]')!,
  threadFilesToggle: app.querySelector<HTMLButtonElement>('[data-thread-files-toggle]')!,
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
  agentStatus: app.querySelector<HTMLElement>('[data-agent-status]')!,
  agentActivity: app.querySelector<HTMLElement>('[data-agent-activity]')!,
  connector: app.querySelector<HTMLElement>('[data-connector]')!,
  stream: app.querySelector<HTMLElement>('[data-agent-stream]')!,
  prompt: app.querySelector<HTMLTextAreaElement>('[data-prompt]')!,
  searchStatus: app.querySelector<HTMLElement>('[data-search-status]')!,
  searchSummary: app.querySelector<HTMLElement>('[data-search-summary]')!,
  search: app.querySelector<HTMLInputElement>('[data-search]')!,
  toolbarMessages: app.querySelector<HTMLElement>('[data-toolbar-messages]')!,
  toolbarAgent: app.querySelector<HTMLElement>('[data-toolbar-agent]')!,
  folderToggle: app.querySelector<HTMLButtonElement>('[data-folder-toggle]')!,
  folderMenu: app.querySelector<HTMLElement>('[data-folder-menu]')!,
  modelToggle: app.querySelector<HTMLButtonElement>('[data-model-toggle]')!,
  modelLabel: app.querySelector<HTMLElement>('[data-model-label]')!,
  modelMenu: app.querySelector<HTMLElement>('[data-model-menu]')!,
  modelSummary: app.querySelector<HTMLElement>('[data-model-summary]')!,
  modelList: app.querySelector<HTMLElement>('[data-model-list]')!,
  modelEfforts: app.querySelector<HTMLElement>('[data-model-efforts]')!,
  sync: app.querySelector<HTMLElement>('.dispatch-sync')!,
  stop: app.querySelector<HTMLButtonElement>('[data-stop]')!,
  readState: app.querySelector<HTMLButtonElement>('[data-read-state]')!,
  archive: app.querySelector<HTMLButtonElement>('[data-archive]')!,
  spam: app.querySelector<HTMLButtonElement>('[data-spam]')!,
  trash: app.querySelector<HTMLButtonElement>('[data-trash]')!,
  moveInbox: app.querySelector<HTMLButtonElement>('[data-move-inbox]')!,
}

installWebLinks(app, window as { isTauri?: unknown }, error => {
  elements.mailError.hidden = false
  elements.mailError.textContent = `Could not open link: ${error instanceof Error ? error.message : String(error)}`
})

function setAgentStatus(status: string, label = status): void {
  elements.agentStatus.dataset.status = status
  elements.agentStatus.title = label
  elements.agentStatus.setAttribute('aria-label', label)
  const stateText = app.querySelector<HTMLElement>('[data-agent-state-text]')!
  stateText.dataset.state = status
  stateText.hidden = status === 'Connected'
  stateText.textContent = label
  renderServiceStatus()
}

function setConnectorStatus(label: string, ready: boolean): void {
  elements.connector.dataset.ready = ready ? 'true' : 'false'
  elements.connector.title = label
  elements.connector.setAttribute('aria-label', label)
}

function renderServiceStatus(): void {
  const status = elements.agentStatus.dataset.status ?? ''
  elements.agentActivity.hidden = status !== 'Working'
  const source = elements.mailSource.textContent?.trim() ?? ''
  elements.sync.dataset.syncState = /FAILED|Unavailable/.test(source) ? 'failed' : /^(Syncing|Refreshing)/.test(source) ? 'syncing' : /^(STALE|Partial)/.test(source) ? 'stale' : 'ready'
}

new MutationObserver(renderServiceStatus).observe(elements.mailSource, { childList: true, subtree: true })
new MutationObserver(renderServiceStatus).observe(elements.agentStatus, { attributes: true, attributeFilter: ['data-status'] })
renderServiceStatus()
let activeDraft: DraftProjection | undefined
let draftPreviewTimer: number | undefined
let draftAutosaveTimer: number | undefined
let recipientSuggestTimer: number | undefined
let draftPreviewSequence = 0
let draftEditSession = 0
let draftDirty = false
let draftEditRevision = 0
function markDraftDirty(): void { draftDirty = true; draftEditRevision += 1; checkpointDraft() }
// Keep Gmail draft writes in order so a slow save cannot overwrite a newer save.
let draftSaveFlight: Promise<DraftProjection | undefined> | undefined
// Keep Gmail send confirmation single-flight.
let draftSendFlight: Promise<void> | undefined
let sendConfirmationRevision: number | undefined
let draftDiscarding = false
const recovery = new DraftRecovery()
let recoveryKey: string | undefined
let offlineMode = localStorage.getItem('dispatch.offline-mode') === 'true' || navigator.onLine === false
let receipts: SendReceipt[] = []
let offlineStatus: OfflineStatus | undefined

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
const markReadDwell = createMarkReadDwell()
let conversationLoadSequence = 0
const conversationCache = new Map<string, Promise<ConversationProjection>>()
const BINDING_CACHE = 'dispatch.codex.bindings.v1'
type CodexPaneKey = { kind: 'unbound' } | { kind: 'conversation'; accountId: string; gmailThreadId: string }
const acceptedReadState = new Map<string, boolean>()
let threadId: string | undefined = localStorage.getItem('dispatch.codex.threadId') || undefined

function bindingCacheKey(key: CodexPaneKey): string {
  return key.kind === 'unbound' ? 'unbound' : `conversation:${key.accountId}:${key.gmailThreadId}`
}

function readBindingCache(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(BINDING_CACHE) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeBindingCache(key: CodexPaneKey, id: string): void {
  const cache = readBindingCache()
  cache[bindingCacheKey(key)] = id
  localStorage.setItem(BINDING_CACHE, JSON.stringify(cache))
  localStorage.setItem('dispatch.codex.threadId', id)
}

function conversationBindingKey(conversation: { accountId?: string; threadId: string; source?: string }): { kind: 'conversation'; accountId: string; gmailThreadId: string } {
  const accountId = conversation.accountId || (conversation.source === 'demo' ? 'demo' : '')
  if (!accountId || !conversation.threadId) throw new Error('This conversation has no Gmail account or thread id for Codex.')
  return { kind: 'conversation', accountId, gmailThreadId: conversation.threadId }
}
let apps: AppSummary[] = []
let modelCatalog: DispatchModelCatalog | undefined
let modelCatalogError: string | undefined
let selectedModelId = localStorage.getItem('dispatch.codex.model') || ''
let selectedEffort = localStorage.getItem('dispatch.codex.effort') || ''
const userChoseModel = () => Boolean(localStorage.getItem('dispatch.codex.model'))
const userChoseEffort = () => Boolean(localStorage.getItem('dispatch.codex.effort'))
let activeAgentMessage: HTMLElement | undefined
let activeAgentText = ''
let agentEvents: EventSource | undefined
let paneSequence = 0
let reconnectTimer: number | undefined
let agentConnecting = false
let syncStatusTimer: number | undefined
let observedSyncCompletedAt: string | null | undefined
/** Ids from the last confirmed live inbox load, keyed by account and state filter so a scope change never chimes. */
let liveInboxBaseline: { scope: string; baseline: LiveListBaseline } | undefined
let toneContext: AudioContext | undefined
let syncErrorVisible = false
let mailReconnectTimer: number | undefined
/** How long after page load an unreachable mail service still counts as "starting" rather than failed. */
const MAIL_STARTUP_GRACE_MS = 20_000
const MAIL_STARTUP_RETRY_MS = 500
const mailStartupGraceUntil = performance.now() + MAIL_STARTUP_GRACE_MS
let searchQuery = ''
let acceptChatSearchResults = true
let searchView: (SearchResults & { phase: 'pending' | 'ready' | 'failed'; error?: string }) | undefined
let searchTimer: number | undefined
let activeTurnId: string | undefined
let codexContextReady = false
let selectedAttachmentContext: { accountId?: string; threadId: string; messageId: string; attachmentId: string; filename: string } | undefined
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
type SidebarStyle = 'compact' | 'expanded'
const savedSidebar = localStorage.getItem('dispatch.ui.sidebar')
let mailboxesVisible = savedSidebar !== 'hidden'
let sidebarStyle: SidebarStyle = (savedSidebar === 'expanded' || (savedSidebar === 'hidden' && localStorage.getItem('dispatch.ui.sidebar.last-visible') === 'expanded')) ? 'expanded' : 'compact'
let compactMessages = localStorage.getItem('dispatch.ui.density') !== 'comfortable'
document.documentElement.classList.toggle('dispatch-compact', compactMessages)

function usesMobilePanels(): boolean {
  return window.matchMedia('(max-width: 820px)').matches
}

function renderPanels(): void {
  const showMailboxes = mailboxesVisible && !usesMobilePanels()
  const displayedSidebarStyle = window.innerWidth < 1000 ? 'compact' : sidebarStyle
  app.querySelector<HTMLElement>('.dispatch-rail')!.hidden = !showMailboxes
  app.querySelector<HTMLElement>('.dispatch-rail')!.dataset.style = displayedSidebarStyle
  app.querySelectorAll('[data-sidebar-style]').forEach(button => button.setAttribute('aria-checked', String((button as HTMLElement).dataset.sidebarStyle === sidebarStyle)))
  const mailboxToggle = app.querySelector<HTMLButtonElement>('[data-mailboxes-toggle]')!
  mailboxToggle.setAttribute('aria-expanded', String(showMailboxes))
  mailboxToggle.setAttribute('aria-label', showMailboxes ? 'Hide mailboxes' : 'Show mailboxes')
  mailboxToggle.title = showMailboxes ? 'Hide mailboxes' : 'Show mailboxes'
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
  const railWidth = mailboxesVisible ? (displayedSidebarStyle === 'compact' ? 64 : 140) : 0
  const minimumReaderWidth = Math.max(220, Math.min(window.innerWidth <= 1100 ? 320 : 360, elements.workspace.clientWidth - railWidth - 518))
  if (panels.messages && panels.reader && panels.agent) {
    const sideWidth = Math.max(500, elements.workspace.clientWidth - railWidth - 18 - minimumReaderWidth)
    if (messagesWidth + agentWidth > sideWidth) {
      const scale = sideWidth / (messagesWidth + agentWidth)
      messagesWidth = Math.max(220, Math.round(messagesWidth * scale))
      agentWidth = Math.max(280, sideWidth - messagesWidth)
      if (messagesWidth + agentWidth > sideWidth) messagesWidth = Math.max(220, sideWidth - agentWidth)
    }
  }
  const columns: string[] = railWidth ? [`${railWidth}px`] : []
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

/** Dragging a divider this far past its panel's minimum width closes the panel instead of pinning it. */
const CLOSE_DRAG_SLACK = 60

function resizePanel(name: 'messagesWidth' | 'agentWidth', event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = panels[name]
  const direction = name === 'messagesWidth' ? 1 : -1
  const divider = event.currentTarget as HTMLElement
  divider.setPointerCapture?.(event.pointerId)
  document.body.classList.add('dispatch-resizing')
  const limit = name === 'messagesWidth' ? [220, 640] : [280, 900]
  const move = (next: PointerEvent) => {
    const requested = startWidth + ((next.clientX - startX) * direction)
    if (requested < limit[0]! - CLOSE_DRAG_SLACK) {
      panels[name] = limit[0]!
      panels[name === 'messagesWidth' ? 'messages' : 'agent'] = false
      renderPanels()
      stop()
      return
    }
    panels[name] = Math.max(limit[0]!, Math.min(limit[1]!, requested))
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

const threadAttachmentCounts = new Map<string, number>()
const expandedAttachmentThreads = new Set<string>()

function attachmentIndicator(count?: number): HTMLElement {
  const indicator = document.createElement('span')
  indicator.className = 'dispatch-attachment-indicator text-primary'
  indicator.setAttribute('aria-label', count === undefined ? 'Has attachments' : `${count} attachments`)
  indicator.innerHTML = '<i class="ti ti-paperclip" aria-hidden="true"></i>'
  if (count !== undefined) indicator.append(document.createTextNode(String(count)))
  return indicator
}

function renderList(emptyMessage = defaultEmptyListMessage()): void {
  elements.list.innerHTML = ''
  const listed = searchView ? searchView.results.map(result => result.conversation) : conversations
  renderSearchStatus()
  if (searchView) emptyMessage = searchView.phase === 'pending' ? 'Searching with Codex…' : searchView.phase === 'failed' ? searchView.error || 'Search failed.' : 'No matching conversations.'
  if (listed.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty text-secondary p-4 dispatch-message-list-empty'
    empty.textContent = emptyMessage
    elements.list.append(empty)
    return
  }
  for (const conversation of listed) {
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
    if (offlineMode && conversation.downloaded === false) { const unavailable = document.createElement('i'); unavailable.className = 'ti ti-cloud-off text-secondary'; unavailable.setAttribute('aria-label', 'Not downloaded'); top.append(unavailable) }
    const attachmentCount = threadAttachmentCounts.get(`${mailbox}:${conversation.id}`)
    if (attachmentCount ? attachmentCount > 0 : conversation.hasAttachment && attachmentCount !== 0) {
      top.append(attachmentIndicator(attachmentCount))
      button.setAttribute('aria-label', `${button.getAttribute('aria-label')}, has attachments`)
    }
    const subject = document.createElement('b')
    subject.textContent = conversation.subject
    subject.title = conversation.subject
    const preview = document.createElement('small')
    const match = searchView?.results.find(result => result.conversation.id === conversation.id)
    button.classList.toggle('dispatch-search-match', Boolean(match))
    if (match?.hits[0]) preview.append(resultExcerpt(match.hits[0]))
    else preview.textContent = conversation.preview
    preview.title = conversation.preview
    const account = document.createElement('span')
    account.className = 'dispatch-message-account'
    account.textContent = conversation.accountLabel ?? ''
    account.title = conversation.accountLabel ?? ''
    content.append(top, subject, preview)
    if (match?.hits[0]) {
      const reason = document.createElement('span')
      reason.className = 'dispatch-search-reason'
      reason.textContent = match.hits[0].reason
      content.append(reason)
    }
    if (conversation.accountLabel && accounts.length > 1) content.append(account)
    button.append(avatar, content)
    button.addEventListener('click', () => { void selectConversation(conversation.id, { revealOnMobile: true, startReadDwell: true }) })
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      void openThreadContextMenu(event, conversation.id)
    })
    elements.list.append(button)
  }
  if (!searchView && nextConversationCursor) {
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'btn btn-outline-secondary m-3 dispatch-load-more'
    more.textContent = loadingMoreConversations ? 'Loading more…' : `Load more · ${Math.max(0, conversationTotal - listed.length)} remaining`
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
    const result = await api.listConversations(mailState, selectedAccountId, nextConversationCursor, searchQuery, mailbox, offlineMode)
    conversations = applyAcceptedReadState([...new Map([...conversations, ...result.conversations].map((conversation) => [conversation.id, conversation])).values()])
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
  elements.threadMailbox.textContent = searchView ? 'Search result' : mailboxLabels[mailbox]
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
  article.dataset.messageId = message.id
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
  if (message.attachments.length) header.append(attachmentIndicator(message.attachments.length))
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
  if (message.accountId && message.labels?.includes('SENT')) {
    const receiptDisclosure = document.createElement('details')
    receiptDisclosure.className = 'dispatch-message-receipt'
    const summary = document.createElement('summary'); summary.textContent = 'Sent details'
    const content = document.createElement('div')
    receiptDisclosure.append(summary, content)
    let loaded = false
    receiptDisclosure.addEventListener('toggle', () => {
      if (!receiptDisclosure.open || loaded) return
      loaded = true; content.textContent = 'Loading sent details…'
      const show = (receipt: SendReceipt) => content.replaceChildren(receiptView(receipt, () => {
        void api.verifyReceipt(receipt.id).then(show).catch(error => { content.textContent = String(error); loaded = false })
      }))
      const known = receipts.find(item => item.accountId === message.accountId && item.messageId === message.id)
      if (known) show(known)
      else if (offlineMode) { content.textContent = 'No saved receipt for this message. Go online to verify it.'; loaded = false }
      else void api.recordSend(message.accountId!, message.id).then(receipt => api.verifyReceipt(receipt.id)).then(show).catch(error => { content.textContent = String(error); loaded = false })
    })
    article.append(receiptDisclosure)
  }
  const content = renderEmailContent(message.body.kind, message.body.content, offlineMode || selected?.availability?.mode === 'downloaded')
  content.classList.add('dispatch-thread-content')
  article.append(content)
  if (message.attachments.length > 0) {
    const attachmentList = document.createElement('div')
    attachmentList.className = 'dispatch-thread-attachments'
    const previews = document.createElement('div')
    previews.className = 'dispatch-attachment-previews'
    for (const attachment of message.attachments) {
      if (attachment.contentId && message.body.kind === 'sanitized-html' && message.body.content.includes(encodeURIComponent(attachment.id))) continue
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
      const fileUrl = api.attachmentFileUrl(message.id, attachment.id, message.accountId, attachment.name, offlineMode || selected?.availability?.mode === 'downloaded')
      if (attachment.mediaType.startsWith('image/')) {
        const figure = document.createElement('figure')
        figure.className = 'dispatch-attachment-preview'
        const image = document.createElement('img')
        image.src = fileUrl
        image.alt = attachment.name
        image.loading = 'lazy'
        image.addEventListener('click', () => { void openAttachment(message, attachment.id, attachment.name) })
        figure.append(image)
        previews.append(figure)
      } else if (attachment.mediaType === 'application/pdf') {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'btn btn-sm btn-ghost-secondary dispatch-attachment-preview-toggle'
        toggle.textContent = 'Preview'
        toggle.setAttribute('aria-expanded', 'false')
        toggle.setAttribute('aria-label', `Preview ${attachment.name}`)
        let frame: HTMLIFrameElement | undefined
        toggle.addEventListener('click', () => {
          if (frame) {
            frame.remove()
            frame = undefined
            toggle.textContent = 'Preview'
            toggle.setAttribute('aria-expanded', 'false')
            return
          }
          frame = document.createElement('iframe')
          frame.className = 'dispatch-attachment-frame'
          frame.src = fileUrl
          frame.title = attachment.name
          previews.append(frame)
          toggle.textContent = 'Hide preview'
          toggle.setAttribute('aria-expanded', 'true')
        })
        attachmentList.append(toggle)
      }
    }
    article.append(attachmentList)
    if (previews.childElementCount > 0 || attachmentList.querySelector('.dispatch-attachment-preview-toggle')) article.append(previews)
  }
  return article
}

/**
 * Warms the mail cache for every attachment in the thread, newest message
 * first, so opening or previewing one later is instant. Stops as soon as the
 * selection moves on; failures are left for the explicit open to report.
 */
async function warmAttachments(conversation: ConversationProjection, sequence: number): Promise<void> {
  const ordered = [...conversation.messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  for (const message of ordered) {
    for (const attachment of message.attachments) {
      if (sequence !== selectionSequence) return
      try {
        await api.cacheAttachment(message.id, attachment.id, message.accountId, attachment.name)
      } catch {
        // The explicit open reports connector failures; warming stays silent.
      }
    }
  }
}

async function openAttachment(message: MessageProjection, attachmentId: string, filename: string): Promise<void> {
  selectedAttachmentContext = { accountId: message.accountId, threadId: message.threadId, messageId: message.id, attachmentId, filename }
  try {
    await api.openAttachment(message.id, attachmentId, message.accountId, filename, offlineMode || selected?.availability?.mode === 'downloaded')
    addAgentMessage('tool', `Opened ${filename}`)
  } catch (error) { addAgentMessage('error', error instanceof Error ? error.message : String(error)) }
}

async function selectConversation(id: string, options: { revealOnMobile?: boolean; startReadDwell?: boolean } = {}): Promise<void> {
  markReadDwell.cancel()
  const matchResult = searchView?.results.find(result => result.conversation.id === id)
  const summary = matchResult?.conversation ?? conversations.find((conversation) => conversation.id === id)
  if (!summary) return
  const sequence = ++selectionSequence
  selectedAttachmentContext = undefined
  codexContextReady = false
  try {
    await flushDraftAutosave()
  } catch (error) {
    if (sequence !== selectionSequence) return
    // A draft that will not save must not pin the whole inbox: say so where it
    // is visible, keep Gmail's last saved copy, and move on.
    const subject = activeDraft?.subject || '(no subject)'
    elements.mailError.hidden = false
    elements.mailError.textContent = `Draft "${subject}" was not saved: ${error instanceof Error ? error.message : String(error)}. Gmail keeps the last saved version.`
    draftDirty = false
  }
  if (sequence !== selectionSequence) return
  if (options.revealOnMobile && usesMobilePanels()) {
    mobilePanel = 'reader'
    mobileReturnPanel = 'reader'
    renderPanels()
  }
  selectedConversationId = id
  selected = undefined
  activeDraft = undefined
  recoveryKey = undefined
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
  elements.copyStatus.hidden = true
  elements.subject.textContent = summary.subject
  renderThreadMeta(summary)
  const loading = document.createElement('div')
  loading.className = 'empty text-secondary dispatch-reader-loading'
  loading.textContent = 'Loading conversation…'
  elements.body.replaceChildren(loading)
  elements.attachments.replaceChildren()
  elements.threadFilesToggle.hidden = true
  if (!offlineMode && options.startReadDwell && summary.unread && summary.accountId) {
    const conversationId = summary.id
    markReadDwell.schedule(conversationId, () => { void completeReadDwell(conversationId) })
  }

  if (!offlineMode && !searchView && mailbox === 'drafts' && summary.accountId) {
    try {
      const draft = await api.openDraftFromMessage(summary.accountId, summary.latestMessageId, summary.threadId)
      if (sequence !== selectionSequence || selectedConversationId !== id) return
      showDraft(draft, false)
      try {
        const key = conversationBindingKey({ accountId: summary.accountId, threadId: summary.threadId })
        await bindAndShowCodex(key, { sequence, clearOnFailure: true })
      } catch (error) {
        if (sequence !== selectionSequence) return
        elements.stream.replaceChildren()
        addAgentMessage('error', error instanceof Error ? error.message : String(error))
      }
    } catch (error) {
      if (sequence !== selectionSequence) return
      const detail = error instanceof Error ? error.message : String(error)
      const gone = detail.includes('gmail_draft_not_found')
      loading.className = 'alert alert-danger m-4 dispatch-reader-load-error'
      loading.textContent = gone ? 'This draft no longer exists in Gmail. It was sent or deleted.' : detail
      if (gone) void loadConversations(true)
    }
    return
  }

  const key = `${offlineMode ? 'offline:' : ''}${mailbox}:${summary.accountId ?? selectedAccountId ?? ''}:${summary.threadId}`
  let request = conversationCache.get(key)
  if (!request) {
    request = api.readConversation(summary.threadId, summary.accountId ?? selectedAccountId, offlineMode, mailbox)
    conversationCache.set(key, request)
    request.catch(() => conversationCache.delete(key))
  }

  try {
    const conversation = await request
    if (sequence !== selectionSequence || selectedConversationId !== id) return
    selected = conversation
    elements.copyStatus.hidden = !conversation.availability
    elements.copyStatus.textContent = conversation.availability ? `${conversation.availability.mode === 'downloaded' ? 'Downloaded copy' : 'Available offline'} · ${new Date(conversation.availability.cachedAt).toLocaleString()}${conversation.availability.reason ? ` · ${conversation.availability.reason}` : ''}` : ''
    if (conversation.availability?.mode === 'downloaded') markReadDwell.cancel()
    elements.readState.hidden = !conversation.accountId
    const acceptedUnread = selectedConversationId ? acceptedReadState.get(selectedConversationId) : undefined
    if (acceptedUnread !== undefined) selected = { ...selected, unread: acceptedUnread }
    elements.readState.textContent = selected.unread ? 'Mark read' : 'Mark unread'
    elements.subject.textContent = conversation.subject
    renderThreadMeta({ ...conversation, messageCount: conversation.messages.length })
const newestFirst = [...conversation.messages].sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    elements.body.replaceChildren(...newestFirst.map((message, index) => renderThreadMessage(message, index === 0 || Boolean(matchResult?.hits.some(hit => hit.messageId === message.id)))))
    const attachmentCount = newestFirst.reduce((count, message) => count + message.attachments.length, 0)
    threadAttachmentCounts.set(`${mailbox}:${id}`, attachmentCount)
    renderList()
    if (attachmentCount > 0) {
      const files = renderThreadAttachments(newestFirst, (message, attachmentId, name) => {
        void openAttachment(message, attachmentId, name)
      }, (message) => {
        const article = [...elements.body.querySelectorAll<HTMLElement>('[data-message-id]')].find((item) => item.dataset.messageId === message.id)
        if (!article) return
        const expanded = renderThreadMessage(message, true)
        article.replaceWith(expanded)
        expanded.tabIndex = -1
        expanded.focus({ preventScroll: true })
        expanded.scrollIntoView({ block: 'nearest' })
      })
      const toggle = elements.threadFilesToggle
      const renderDisclosure = () => {
        const expanded = expandedAttachmentThreads.has(id)
        files.hidden = !expanded
        toggle.setAttribute('aria-expanded', String(expanded))
        toggle.innerHTML = `<i class="ti ti-paperclip" aria-hidden="true"></i>${attachmentCount} ${attachmentCount === 1 ? 'attachment' : 'attachments'}<i class="ti ti-chevron-${expanded ? 'up' : 'down'}" aria-hidden="true"></i>`
      }
      toggle.onclick = () => {
        if (expandedAttachmentThreads.has(id)) expandedAttachmentThreads.delete(id)
        else expandedAttachmentThreads.add(id)
        renderDisclosure()
      }
      toggle.hidden = false
      elements.body.prepend(files)
      renderDisclosure()
    }
    if (matchResult) {
      for (const hit of matchResult.hits) {
        const message = [...elements.body.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === hit.messageId)
        const content = message?.querySelector<HTMLElement>('.dispatch-thread-content')
        if (content && !highlightPassage(content, hit.quote)) {
          const evidence = document.createElement('div')
          evidence.className = 'dispatch-search-evidence'
          evidence.append(resultExcerpt(hit)); content.before(evidence)
        }
      }
      const first = matchResult.hits[0]
      if (first) {
        const message = [...elements.body.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === first.messageId)
        ;(message?.querySelector('mark') ?? message)?.scrollIntoView({ block: 'center' })
      }
    }
    if (!offlineMode && conversation.availability?.mode !== 'downloaded') void warmAttachments(conversation, sequence)
    prefetchConversations(id)
    try {
      const key = conversationBindingKey({ accountId: conversation.accountId, threadId: conversation.threadId, source: conversation.source })
      await bindAndShowCodex(key, { sequence, clearOnFailure: true })
    } catch (error) {
      if (sequence !== selectionSequence) return
      elements.stream.replaceChildren()
      addAgentMessage('error', error instanceof Error ? error.message : String(error))
    }
  } catch (error) {
    if (sequence !== selectionSequence) return
    loading.className = 'alert alert-danger m-4 dispatch-reader-load-error'
    loading.textContent = error instanceof Error ? error.message : String(error)
if (!offlineMode && !String(error).includes('not_downloaded')) window.setTimeout(() => {
      if (selectedConversationId === id) void selectConversation(id)
    }, 1_500)
  }
}

async function completeReadDwell(conversationId: string): Promise<void> {
  if (selectedConversationId !== conversationId) return
  const summary = conversations.find((conversation) => conversation.id === conversationId)
  if (!summary?.accountId || !summary.unread) return
  const messageIds = selectedConversationId === conversationId && selected ? selected.messages.map((message) => message.id) : []
  try {
    await api.setConversationUnread(summary.threadId, summary.accountId, false, messageIds)
    if (selectedConversationId !== conversationId) return
    applyLocalReadState(conversationId, false)
  } catch (error) {
    if (selectedConversationId !== conversationId) return
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  }
}

function applyLocalReadState(conversationId: string, unread: boolean): void {
  acceptedReadState.set(conversationId, unread)
  dropConversationCache(conversationId)
  if (selectedConversationId === conversationId && selected) selected = { ...selected, unread }
  conversations = conversations
    .map((conversation) => conversation.id === conversationId ? { ...conversation, unread } : conversation)
    .filter((conversation) => mailState !== 'unread' || conversation.unread)
  if (selectedConversationId === conversationId) elements.readState.textContent = unread ? 'Mark read' : 'Mark unread'
  renderList()
}

function dropConversationCache(conversationId: string): void {
  const threadId = (selectedConversationId === conversationId ? selected?.threadId : undefined)
    ?? conversations.find((conversation) => conversation.id === conversationId)?.threadId
  if (!threadId) return
  for (const key of conversationCache.keys()) {
    if (key.endsWith(`:${threadId}`)) conversationCache.delete(key)
  }
}

function applyAcceptedReadState(items: readonly ConversationSummary[]): ConversationSummary[] {
  return items
    .map((conversation) => {
      const unread = acceptedReadState.get(conversation.id)
      return unread === undefined ? conversation : { ...conversation, unread }
    })
    .filter((conversation) => mailState !== 'unread' || conversation.unread)
}

function syncSelectedReadState(): void {
  if (!selected || !selectedConversationId) return
  const unread = acceptedReadState.get(selectedConversationId)
    ?? conversations.find((conversation) => conversation.id === selectedConversationId)?.unread
  if (unread === undefined || selected.unread === unread) return
  selected = { ...selected, unread }
  elements.readState.textContent = unread ? 'Mark read' : 'Mark unread'
}

async function applyReadState(nextUnread: boolean): Promise<void> {
  if (!selected?.accountId) return
  const conversationId = selected.id
  elements.readState.disabled = true
  elements.readState.textContent = nextUnread ? 'Marking unread…' : 'Marking read…'
  try {
    await api.setConversationUnread(selected.threadId, selected.accountId, nextUnread, selected.messages.map((message) => message.id))
    if (selectedConversationId !== conversationId) return
    applyLocalReadState(conversationId, nextUnread)
  } catch (error) {
    elements.readState.textContent = selected.unread ? 'Mark read' : 'Mark unread'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    elements.readState.disabled = false
  }
}

async function toggleReadState(): Promise<void> {
  if (!selected) return
  await applyReadState(!selected.unread)
}

function askCodex(): void {
  if (usesMobilePanels()) { mobilePanel = 'agent'; mobileReturnPanel = 'agent'; renderPanels() }
  elements.prompt.focus()
}

async function openThreadContextMenu(event: MouseEvent, conversationId: string): Promise<void> {
  const load = selectConversation(conversationId, { revealOnMobile: true })
  const summary = conversations.find((conversation) => conversation.id === conversationId)
  if (!summary) return
  const unread = acceptedReadState.get(conversationId) ?? summary.unread
  const items = threadContextMenuItems({ mailbox, unread, hasAccountId: Boolean(summary.accountId) })
  try {
    const chosen = await popupContextMenu(items, { clientX: event.clientX, clientY: event.clientY })
    if (!chosen) return
    await load
    await runThreadContextCommand(chosen)
  } catch (error) {
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function runThreadContextCommand(id: string): Promise<void> {
  switch (id) {
    case 'reply':
      await openDraft(false).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error)))
      return
    case 'replyAll':
      await openDraft(true).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error)))
      return
    case 'forward':
      await openForward().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error)))
      return
    case 'markRead':
      await applyReadState(false)
      return
    case 'markUnread':
      await applyReadState(true)
      return
    case 'archive':
      await mutateSelected('archive')
      return
    case 'inbox':
      await mutateSelected('inbox')
      return
    case 'spam':
      await mutateSelected('spam')
      return
    case 'trash':
      await mutateSelected('trash')
      return
    case 'ask':
      askCodex()
      return
    default:
      throw new Error(`Dispatch received an unknown menu command: ${id}`)
  }
}

function prefetchConversations(exceptId: string): void {
  for (const summary of (searchView?.results.map(result => result.conversation) ?? conversations).filter((item) => item.id !== exceptId).slice(0, 3)) {
    const key = `${offlineMode ? 'offline:' : ''}${mailbox}:${summary.accountId ?? selectedAccountId ?? ''}:${summary.threadId}`
    if (!conversationCache.has(key)) {
      const request = api.readConversation(summary.threadId, summary.accountId ?? selectedAccountId, offlineMode, mailbox)
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
      markDraftDirty()
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
        markDraftDirty()
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
      markDraftDirty()
      if (activeDraft.id) void saveDraft(false).catch(draftError)
    })
    row.append(name, remove)
    return row
  }))
  elements.draftAttachments.hidden = items.length === 0
}

function checkpointDraft(): void {
  if (!activeDraft) return
  try {
    recoveryKey ??= crypto.randomUUID()
    const accountId = activeDraft.id ? activeDraft.accountId : elements.draftAccount.value || activeDraft.accountId
    recovery.save({ key: recoveryKey, updatedAt: new Date().toISOString(), revision: draftEditRevision,
      accountId, accountLabel: accounts.find(account => account.id === accountId)?.email, gmailDraftId: activeDraft.id,
      inReplyToMessageId: activeDraft.inReplyToMessageId, to: recipientValue(elements.draftTo), cc: recipientValue(elements.draftCc), bcc: recipientValue(elements.draftBcc), subject: elements.draftSubject.value, bodyMarkdown: elements.draftBody.value,
    }, activeDraft.attachments)
    elements.recoveryStatus.textContent = recovery.list().find(item => item.key === recoveryKey)?.attachments.some(file => file.contentPending) ? 'Text saved locally; attachment recovery is saving…' : 'Local recovery copy saved'
    renderRecoveryList()
    const draftId = activeDraft.id
    void recovery.cacheFiles(activeDraft.attachments).then(() => {
      if (activeDraft?.id === draftId && draftDirty && recoveryKey) {
        const pending = recovery.list().find(item => item.key === recoveryKey)?.attachments.some(file => file.contentPending)
        if (pending) checkpointDraft()
      }
    }).catch(draftError)
  } catch (error) { draftError(new Error(`Local recovery could not be saved: ${String(error)}. Keep this draft open.`)) }
}
function clearRecovery(key = recoveryKey): void {
  if (!key) return
  try { recovery.remove(key) } catch (error) { draftError(new Error(`Gmail action completed, but the local recovery copy could not be cleared: ${String(error)}`)); return }
  if (key === recoveryKey) recoveryKey = undefined
  renderRecoveryList()
}
function renderRecoveryList(): void {
  const button = app.querySelector<HTMLButtonElement>('[data-recovery-open]')!
  const list = app.querySelector<HTMLElement>('[data-recovery-list]')!
  try {
    const records = recovery.list()
    button.hidden = records.length === 0
    app.querySelector<HTMLElement>('.dispatch-recovery-banner')!.hidden = records.length === 0
    app.querySelector<HTMLElement>('[data-recovery-count]')!.textContent = `${records.length} recovered ${records.length === 1 ? 'draft' : 'drafts'}`
    button.setAttribute('aria-label', `Local draft recovery (${records.length})`)
    list.replaceChildren(...records.map(record => {
      const row = document.createElement('section'); row.className = 'dispatch-recovery-row'
      const title = document.createElement('strong'); title.textContent = record.subject || '(No subject)'
      const detail = document.createElement('p'); detail.textContent = `${record.to || '(No recipient)'} · ${record.accountLabel || 'Saved account'} · ${new Date(record.updatedAt).toLocaleString()}`
      const restore = document.createElement('button'); restore.className = 'btn btn-sm'; restore.textContent = 'Restore local draft'
      restore.addEventListener('click', () => { void restoreLocalDraft(record.key).catch(draftError) })
      row.append(title, detail, restore); return row
    }))
  } catch (error) { button.hidden = false; app.querySelector<HTMLElement>('.dispatch-recovery-banner')!.hidden = false; button.setAttribute('aria-label', 'Local recovery needs attention'); list.textContent = String(error) }
}
async function restoreLocalDraft(key: string): Promise<void> {
  if (activeDraft && draftDirty) checkpointDraft()
  const sequence = ++selectionSequence
  const restored = await recovery.restore(key)
  if (sequence !== selectionSequence) return
  const record = restored.record
  selected = undefined; selectedConversationId = undefined; selectedAttachmentContext = undefined
  codexContextReady = false
  elements.subject.textContent = record.subject || 'Recovered local draft'
  elements.messageCount.textContent = 'Local draft'
  elements.copyStatus.hidden = true
  elements.address.hidden = true
  showDraft({ id: record.gmailDraftId, accountId: record.accountId, inReplyToMessageId: record.inReplyToMessageId,
    to: parseRecipientList(record.to).map(address => ({ name: address, address, initials: '@' })), cc: record.cc, bcc: record.bcc, subject: record.subject, bodyMarkdown: record.bodyMarkdown, bodyText: record.bodyMarkdown, bodyHtml: '', attachments: restored.attachments, state: 'draft' }, !record.gmailDraftId)
  recoveryKey = key; draftDirty = true; draftEditRevision += 1
  elements.recoveryStatus.textContent = 'Recovered local copy — review before saving to Gmail'
  if (restored.missing.length) draftError(new Error(`Reattach these files before saving: ${restored.missing.join(', ')}`))
  ;(app.querySelector('[data-recovery-dialog]') as HTMLDialogElement).close()
  refreshPreview()
  if (!offlineMode) void bindAndShowCodex({ kind: 'unbound' }, { sequence })
}
function freezeDraft(disabled: boolean): void {
  elements.draft.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button').forEach(control => { control.disabled = disabled })
  if (!disabled) elements.draftAccount.disabled = Boolean(activeDraft?.id)
}

function draftError(error: unknown): void {
  elements.draftError.hidden = false
  elements.draftError.textContent = error instanceof Error ? error.message : String(error)
}

function replyQuoteMarkdown(message: MessageProjection): string {
  const content = emailPlainText(message.body.kind, message.body.content)
  return `\n\n> ${content.split(/\r?\n/).join('\n> ')}`
}

function showDraft(draft: DraftProjection, accountMutable: boolean): void {
  if (!draft.id || activeDraft?.id !== draft.id || activeDraft?.accountId !== draft.accountId) recoveryKey = undefined
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
  if (!selected) { elements.threadFilesToggle.hidden = true; elements.copyStatus.hidden = true }
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
  if (draft.accountId && !accounts.some(account => account.id === draft.accountId)) {
    const option = document.createElement('option'); option.value = draft.accountId; option.textContent = 'Recovered account (offline)'; option.selected = true; elements.draftAccount.append(option)
  }
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
  elements.recoveryStatus.textContent = ''
  freezeDraft(Boolean(draftSendFlight))
  void recovery.cacheFiles(draft.attachments).then(() => { if (activeDraft?.id === draft.id && draftDirty) checkpointDraft() }).catch(draftError)
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
  recoveryKey = undefined
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
    if (draftDirty && activeDraft?.id && !offlineMode && !draftSendFlight) void saveDraft(false).catch(draftError)
  }, 1_500)
}

async function flushDraftAutosave(): Promise<void> {
  if (offlineMode) { if (draftDirty) checkpointDraft(); return }
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
  const subject = /^re:/i.test(selected.subject) ? selected.subject : `Re: ${selected.subject}`
  const fields = { to, cc, bcc: '', subject, bodyMarkdown, bodyText: bodyMarkdown }
  if (offlineMode || (selected.source === 'gmail' && accountId)) {
    if (draftSaveFlight && activeDraft?.inReplyToMessageId === latest.id && activeDraft.accountId === accountId) { elements.draftBody.focus(); return }
    showDraft({ id: '', accountId, inReplyToMessageId: latest.id, to: parseRecipientList(to).map(address => ({ name: address, address, initials: '@' })), cc, bcc: '', subject, bodyMarkdown, bodyText: bodyMarkdown, bodyHtml: '', attachments: [], state: 'draft' }, true)
    markDraftDirty(); refreshPreview(); elements.draftBody.focus()
    if (!offlineMode) void saveDraft(false).catch(draftError)
    return
  }
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
  const content = emailPlainText(latest.body.kind, latest.body.content)
  const bodyMarkdown = `\n\n---------- Forwarded message ----------\nFrom: ${latest.sender.name} <${latest.sender.address}>\nDate: ${latest.receivedFullLabel}\nSubject: ${latest.subject}\n\n${content}`
  if (offlineMode) {
    showDraft({ id: '', accountId: selected.accountId, inReplyToMessageId: '', to: [], cc: '', bcc: '', subject, bodyMarkdown, bodyText: bodyMarkdown, bodyHtml: '', attachments: latest.attachments.map(file => ({ ...file, sourceMessageId: latest.id })), state: 'draft' }, true)
    markDraftDirty(); refreshPreview(); return
  }
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
  markReadDwell.cancel()
  const sequence = ++selectionSequence
  selectedAttachmentContext = undefined
  codexContextReady = false
  selected = undefined
  selectedConversationId = undefined
  void bindAndShowCodex({ kind: 'unbound' }, { sequence, clearOnFailure: true })
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
  if (offlineMode) { checkpointDraft(); throw new Error('This draft is saved locally. Go online to save it to Gmail.') }
  if (draftDiscarding) return
  const session = draftEditSession
  while (draftSaveFlight) await draftSaveFlight
  if (draftDiscarding || !activeDraft || session !== draftEditSession) return
  const draft = activeDraft
  const savingRecoveryKey = recoveryKey
  const savingRevision = draftEditRevision
  const accountId = draft.id ? draft.accountId : elements.draftAccount.value
  if (!accountId) throw new Error('Choose a Gmail account for this draft.')
  const bodyMarkdown = elements.draftBody.value
  const fields = { accountId, messageId: draft.inReplyToMessageId, to: recipientValue(elements.draftTo), cc: recipientValue(elements.draftCc), bcc: recipientValue(elements.draftBcc), subject: elements.draftSubject.value, bodyMarkdown, bodyText: bodyMarkdown, attachments: draft.attachments }
  elements.draftAccount.disabled = true
  elements.recoveryStatus.textContent = 'Saving to Gmail · local recovery copy kept'
  let savedSuccessfully = false
  const operation = (async () => {
    const savedDraft = draft.id
      ? await api.updateDraft(draft.id, fields)
      : await api.createDraft('', fields)
    savedSuccessfully = true
    if (savingRecoveryKey && savedDraft.id) {
      try { recovery.bindGmailIdentity(savingRecoveryKey, accountId, savedDraft.id) }
      catch (error) { draftError(new Error(`Gmail saved the draft, but local recovery could not record its identity: ${String(error)}`)) }
    }
    if (session !== draftEditSession || !activeDraft || activeDraft.id !== draft.id || draftDiscarding) return savedDraft
    activeDraft = draftEditRevision === savingRevision ? savedDraft : { ...savedDraft, attachments: activeDraft.attachments }
    elements.draftAccount.disabled = true
    elements.draftPreview.innerHTML = savedDraft.bodyHtml
    elements.draftError.hidden = true
    elements.draftError.textContent = ''
    if (draftEditRevision === savingRevision && recipientValue(elements.draftTo) === fields.to
      && recipientValue(elements.draftCc) === fields.cc
      && recipientValue(elements.draftBcc) === fields.bcc
      && elements.draftSubject.value === fields.subject
      && elements.draftBody.value === bodyMarkdown) {
      draftDirty = false
      clearRecovery(savingRecoveryKey)
      elements.recoveryStatus.textContent = 'Saved to Gmail'
    } else { checkpointDraft() }
    if (notify) addAgentMessage('tool', 'Gmail draft saved.')
    return savedDraft
  })()
  draftSaveFlight = operation
  try {
    await operation
  } finally {
    if (draftSaveFlight === operation) draftSaveFlight = undefined
    if (session === draftEditSession && activeDraft) {
      elements.draftAccount.disabled = Boolean(activeDraft.id)
      if (!savedSuccessfully) elements.recoveryStatus.textContent = 'Gmail save not confirmed · local recovery copy kept'
      if (savedSuccessfully && draftDirty && activeDraft.id && !draftSendFlight) autosaveDraft()
    }
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
    `Call Gmail update_draft on that draft ID using the installed tool schema and a multipart/alternative payload for plain text and HTML. Preserve existing attachments. This is a revision request, not permission to send.`,
    `Current draft:\n\n${elements.draftBody.value}`,
  ].join(' ')
  elements.prompt.focus()
  await sendPrompt()
}

function sendDraft(): void {
  if (offlineMode) { checkpointDraft(); draftError(new Error('Go online to send. Your local draft is kept.')); return }
  if (!activeDraft || draftSendFlight) return
  if (![elements.draftTo, elements.draftCc, elements.draftBcc].some(field => recipientValue(field).trim())) { draftError(new Error('Add a recipient before sending.')); return }
  sendConfirmationRevision = draftEditRevision
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
  const session = draftEditSession
  const revision = draftEditRevision
  const sendingRecoveryKey = recoveryKey
  const originalId = activeDraft.id
  const originalAccount = activeDraft.id ? activeDraft.accountId : elements.draftAccount.value
  if (sendConfirmationRevision !== revision || ![elements.draftTo, elements.draftCc, elements.draftBcc].some(field => recipientValue(field).trim())) {
    elements.sendConfirm.hidden = true
    throw new Error('The draft changed. Review its recipients before sending again.')
  }
  const operation = (async () => {
    if (draftSaveFlight) await draftSaveFlight
    if (session !== draftEditSession || revision !== draftEditRevision) throw new Error('The draft changed before sending. Review it again.')
    // An unchanged Gmail draft already has its exact recipients, MIME body, and files.
    // Do not rewrite it from the editor's projection as a side effect of Send.
    if (!activeDraft?.id || draftDirty) await saveDraft()
    if (session !== draftEditSession || revision !== draftEditRevision
      || (originalId && activeDraft?.id !== originalId) || activeDraft?.accountId !== originalAccount) {
      throw new Error('The draft changed before sending. Review it again.')
    }
    const draft = activeDraft
    if (!draft?.id || !draft.accountId) throw new Error('Save the Gmail draft before sending it.')
    const receipt = await api.sendDraft(draft.id, draft.accountId)
    if (!receipt) throw new Error('The send response had no receipt. Check Send receipts or Sent before retrying.')
    showReceipt(receipt)
    if (receipt.status !== 'accepted' && receipt.status !== 'verified') throw new Error(receipt.error || 'The send outcome is not confirmed. Check the receipt before retrying.')
    clearRecovery(sendingRecoveryKey)
    addAgentMessage('agent', 'Gmail accepted the send. Its receipt is available in Receipts.')
    if (session === draftEditSession && activeDraft?.id === draft.id && activeDraft.accountId === draft.accountId) hideDraftEditor()
    void loadConversations()
  })()
  draftSendFlight = operation
  elements.sendConfirmGo.disabled = true
  elements.sendDraft.disabled = true
  elements.discardDraft.disabled = true
  freezeDraft(true)
  try {
    await operation
  } catch (error) {
    try { const known = (await api.receipts()).find(receipt => receipt.accountId === originalAccount && receipt.draftId === (originalId || activeDraft?.id)); if (known) showReceipt(known) } catch {}
    throw error
  } finally {
    freezeDraft(false)
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
    clearRecovery()
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
  const attachmentSession = draftEditSession
  const files = [...(elements.draftFiles.files ?? [])]
  if (files.length === 0) return
  try {
    const attachments = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      contentBase64: await fileContentBase64(file),
    })))
    await recovery.cacheFiles(attachments)
    if (!activeDraft || attachmentSession !== draftEditSession) return
    activeDraft = { ...activeDraft, attachments: [...activeDraft.attachments, ...attachments] }
    renderDraftAttachments()
    markDraftDirty()
    if (!offlineMode) await saveDraft()
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
    bubble.className = 'card dispatch-chat-bubble'
    const body = document.createElement('div')
    body.className = 'card-body p-3'
    const content = document.createElement('div')
    content.className = 'dispatch-chat-plain'
    content.textContent = text
    const time = document.createElement('time')
    time.className = 'd-block text-secondary small mt-2'
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
      setAgentStatus('Working')
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
      setAgentStatus('Working')
      card.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach((control) => { control.disabled = true })
      const state = card.querySelector<HTMLElement>('[data-request-state]')
      if (state) state.textContent = 'Submitted'
    }).catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error)))
  })
  card.querySelector('[data-request-actions]')?.append(submit)
}

/** A connector permission prompt carries an empty schema: one click, no JSON. */
function isPermissionElicitation(params: Record<string, unknown> | undefined): boolean {
  const schema = params?.requestedSchema as { properties?: Record<string, unknown> } | undefined
  const properties = schema?.properties
  return !properties || Object.keys(properties).length === 0
}

function renderElicitationRequest(card: HTMLElement, params?: Record<string, unknown>): void {
  if (isPermissionElicitation(params)) {
    addRequestButton(card, 'Allow', { action: 'accept', content: {} }, true)
    addRequestButton(card, 'Decline', { action: 'decline', content: null })
    return
  }
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
        setAgentStatus('Working')
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
    const permission = isPermissionElicitation(params)
    title.textContent = permission ? 'Allow this connector action?' : 'Connector needs information'
    description.textContent = requestText(params, permission ? 'Codex wants to run a connector tool.' : 'Provide the requested information to continue.')
    renderElicitationRequest(card, params)
  } else {
    title.textContent = 'Codex needs attention'
    description.textContent = `Unsupported request: ${message.method}`
    addRequestButton(card, 'Cancel request', { decision: 'cancel' })
  }
  setAgentStatus('Needs attention')
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
    setAgentStatus('Reconnecting', 'Restarting Codex App Server')
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
  if (message.method === 'account/rateLimits/updated') {
    void refreshModelCatalog()
    return
  }
  if (message.method === 'turn/started') {
    const turn = params?.turn as Record<string, unknown> | undefined
    activeTurnId = typeof turn?.id === 'string' ? turn.id : undefined
    elements.stop.hidden = !activeTurnId
    setAgentStatus('Working')
  }
  if (message.method === 'turn/completed') {
    const turn = params?.turn as Record<string, unknown> | undefined
    const status = String(turn?.status ?? 'completed')
    if (searchView?.phase === 'pending') {
      searchView = { ...searchView, phase: 'failed', error: status === 'interrupted' ? 'Search stopped.' : 'Codex did not publish verified results. Refine the request or try again.' }
      renderList()
    }
    // Codex may have created or updated a draft; the Drafts folder is served live, so show it now.
    if (mailbox === 'drafts') void loadConversations(true)
    if (status === 'failed') {
      const error = turn?.error as Record<string, unknown> | undefined
      setAgentStatus('Failed')
      addAgentMessage('error', String(error?.message ?? 'The Codex turn failed.'))
      if (error?.codexErrorInfo === 'usageLimitExceeded') void refreshModelCatalog()
    } else {
      setAgentStatus(status === 'interrupted' ? 'Interrupted' : 'Connected')
    }
    activeAgentMessage = undefined
    activeAgentText = ''
    activeTurnId = undefined
    elements.stop.hidden = true
    const draftToRefresh = activeDraft
    if (draftToRefresh?.id && draftToRefresh.accountId && codexDraftFlights === 0) {
      void refreshCodexDraft(draftToRefresh.id, draftToRefresh.accountId, false)
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
  // Tool-call starts (item/started for mcpToolCall) and plan updates are
  // intentionally not echoed into the chat: the Working status and activity
  // bar already show progress, and the rows only added noise.
  if (message.method === 'item/completed') {
    const item = params?.item as Record<string, unknown> | undefined
    if (item?.type === 'agentMessage') {
      activeAgentMessage = undefined
      activeAgentText = ''
    }
    const effect = codexMailEffect(item)
    if (effect) void applyCodexMailEffect(effect)
  }
  if (message.method === 'error') {
    const error = params?.error as Record<string, unknown> | undefined
    setAgentStatus('Failed')
    addAgentMessage('error', String(error?.message ?? params?.message ?? 'Codex reported an error.'))
  }
}

let codexDraftFlights = 0
let codexDraftRequest = 0

/** A remote result may update only the editor revision that requested it. */
async function refreshCodexDraft(draftId: string, accountId: string, createdByCodex: boolean): Promise<void> {
  if (!codexContextReady) return
  const snapshot = { selection: selectionSequence, pane: paneSequence, session: draftEditSession, revision: draftEditRevision,
    dirty: draftDirty, saving: Boolean(draftSaveFlight), draftId: activeDraft?.id, accountId: activeDraft?.accountId }
  const request = ++codexDraftRequest
  codexDraftFlights += 1
  try {
    const draft = await api.getDraft(draftId, accountId)
    if (request !== codexDraftRequest || snapshot.selection !== selectionSequence || snapshot.pane !== paneSequence) return
    if (draft.id !== draftId || draft.accountId !== accountId) throw new Error('Gmail returned a different draft or account; the editor was not changed.')
    const unchanged = snapshot.session === draftEditSession && snapshot.revision === draftEditRevision
      && snapshot.draftId === activeDraft?.id && snapshot.accountId === activeDraft?.accountId
      && !snapshot.dirty && !snapshot.saving && !draftDirty && !draftSaveFlight
    if (unchanged) showDraft(draft, false)
    else if (createdByCodex) addAgentMessage('tool', 'Gmail saved the draft. Your current edits were kept; open Drafts to review the saved version.')
    if (createdByCodex && mailbox === 'drafts') void loadConversations(true)
  } catch (error) {
    if (snapshot.selection === selectionSequence && snapshot.pane === paneSequence) addAgentMessage('error', error instanceof Error ? error.message : String(error))
  } finally { codexDraftFlights -= 1 }
}

async function applyCodexMailEffect(effect: CodexMailEffect): Promise<void> {
  if (!codexContextReady) return
  if (effect.kind === 'search') {
    if (!effect.search.requestId && !acceptChatSearchResults) return
    if (effect.search.requestId && effect.search.requestId !== searchView?.requestId) return
    if (searchView?.phase === 'pending' && effect.search.requestId !== searchView.requestId) return
    if (searchView?.requestId && selectedAccountId && effect.search.results.some(result => result.conversation.accountId !== selectedAccountId)) {
      searchView = { ...searchView, phase: 'failed', error: 'The results do not match the selected account. Please retry.' }; renderList(); return
    }
    conversationLoadSequence += 1
    const query = effect.search.requestId && effect.search.requestId === searchView?.requestId ? searchView.query : effect.search.query
    searchView = { ...effect.search, query, phase: 'ready' }
    searchQuery = query
    elements.search.value = searchQuery
    renderList()
    return
  }
  if (effect.kind === 'draft') {
    await refreshCodexDraft(effect.draftId, effect.accountId, true)
    return
  }
  try {
    const receipt = await api.recordSend(effect.accountId, effect.messageId, effect.draftId)
    showReceipt(receipt)
  } catch (error) { addAgentMessage('tool', `Gmail accepted message ${effect.messageId}; receipt details could not be loaded: ${String(error)}`) }
  if (effect.draftId && activeDraft?.id === effect.draftId && activeDraft.accountId === effect.accountId && !draftDirty && !draftSaveFlight) { clearRecovery(); hideDraftEditor() }
  if (!offlineMode) void loadConversations(true)
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

async function showCodexThread(nextThreadId: string, created: boolean, replaced: boolean, detail?: string): Promise<void> {
  if (nextThreadId === threadId && agentEvents && agentEvents.readyState !== EventSource.CLOSED) return
  const sequence = ++paneSequence
  threadId = nextThreadId
  agentEvents?.close()
  elements.stream.replaceChildren()
  activeAgentMessage = undefined
  activeAgentText = ''
  activeTurnId = undefined
  elements.stop.hidden = true
  if (replaced) console.info(detail ? `Codex thread replaced · ${detail}` : 'Codex thread replaced')
  if (!created) {
    try {
      const history = await api.readThread(nextThreadId) as { thread?: { turns?: Array<{ items?: Array<Record<string, unknown>> }> } }
      if (sequence !== paneSequence) return
      const restored = history.thread?.turns?.flatMap((turn) => turn.items ?? []) ?? []
      for (const item of restored) {
        const text = agentHistoryText(item)
        if (text && item.type === 'userMessage') addAgentMessage('user', visibleUserPrompt(text))
        if (text && item.type === 'agentMessage') addAgentMessage('agent', text)
      }
    } catch (error) {
      if (sequence !== paneSequence) return
      addAgentMessage('error', `Could not restore Codex history: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (sequence !== paneSequence) return
  agentEvents = api.events(nextThreadId)
  agentEvents.onopen = () => { setAgentStatus('Connected') }
  agentEvents.onmessage = (event) => {
    if (sequence === paneSequence && nextThreadId === threadId) handleAgentEvent(JSON.parse(event.data) as AgentEvent)
  }
  agentEvents.onerror = () => {
    agentEvents?.close()
    setAgentStatus('Reconnecting')
    scheduleAgentReconnect()
  }
}

async function bindAndShowCodex(key: CodexPaneKey, options: { adoptThreadId?: string; sequence?: number; clearOnFailure?: boolean } = {}): Promise<boolean> {
  try {
    if (!await api.agentReady()) { scheduleAgentReconnect(); return false }
    const binding = await api.bindThread(key, options.adoptThreadId)
    if (options.sequence !== undefined && options.sequence !== selectionSequence) return false
    writeBindingCache(key, binding.threadId)
    await showCodexThread(binding.threadId, binding.created, binding.replaced, binding.detail)
    const context = selected ?? (mailbox === 'drafts' ? conversations.find((item) => item.id === selectedConversationId) : undefined)
    const currentKey = context ? conversationBindingKey(context) : !selectedConversationId ? { kind: 'unbound' } : undefined
    if (currentKey && JSON.stringify(key) === JSON.stringify(currentKey) && (options.sequence === undefined || options.sequence === selectionSequence)) codexContextReady = true
    return true
  } catch (error) {
    if (options.sequence !== undefined && options.sequence !== selectionSequence) return false
    const message = error instanceof Error ? error.message : String(error)
    setAgentStatus('Reconnecting')
    if (options.clearOnFailure) elements.stream.replaceChildren()
    addAgentMessage('error', message)
    scheduleAgentReconnect()
    return false
  }
}

async function connectAgent(): Promise<void> {
  if (agentConnecting) return
  agentConnecting = true
  if (!await api.agentReady()) {
    setAgentStatus('Reconnecting', 'Waiting for Codex App Server')
    void refreshModelCatalog()
    agentConnecting = false
    scheduleAgentReconnect()
    return
  }
  try {
    apps = await api.listApps()
    const gmail = gmailAppId(apps)
    setConnectorStatus(gmail ? 'Gmail available' : 'No Gmail connector', Boolean(gmail))
    const unbound = { kind: 'unbound' as const }
    if (!await bindAndShowCodex(unbound, { adoptThreadId: localStorage.getItem('dispatch.codex.threadId') || undefined })) {
      throw new Error(elements.stream.lastElementChild?.textContent || 'Could not bind the unbound Codex thread.')
    }
    if (selected) {
      const key = conversationBindingKey({ accountId: selected.accountId, threadId: selected.threadId, source: selected.source })
      await bindAndShowCodex(key)
    }
    void refreshModelCatalog()
  } catch (error) {
    setAgentStatus('Reconnecting', error instanceof Error ? error.message : String(error))
    scheduleAgentReconnect()
  } finally {
    agentConnecting = false
  }
}

async function sendPrompt(): Promise<void> {
  const text = elements.prompt.value.trim()
  if (!text || !threadId) return
  if (!codexContextReady) { addAgentMessage('error', 'Codex is still connecting to the selected conversation. Please try again.'); return }
  acceptChatSearchResults = true
  addAgentMessage('user', text)
  setAgentStatus('Working')
  elements.prompt.value = ''
  try {
    if (activeTurnId) {
      await api.steerTurn(threadId, activeTurnId, text)
      return
    }
    await api.startTurn(threadId, {
      text,
      ...userChoseModel() ? { model: selectedModelId } : {},
      ...userChoseEffort() ? { effort: selectedEffort } : {},
      appId: gmailAppId(apps),
      mailContext: selected || activeDraft ? {
        searchMatch: selected && searchView ? { query: searchView.query, hits: searchView.results.find(result => result.conversation.id === selectedConversationId)?.hits } : undefined,
        draft: activeDraft ? { id: activeDraft.id, accountId: activeDraft.accountId, to: recipientValue(elements.draftTo), cc: recipientValue(elements.draftCc), bcc: recipientValue(elements.draftBcc), subject: elements.draftSubject.value, hasUnsavedChanges: draftDirty } : undefined,
        accountId: selected?.accountId,
        messageId: selected?.latestMessageId,
        threadId: selected?.threadId,
        subject: selected?.subject,
        sender: selected?.sender.address,
        attachment: selectedAttachmentContext?.accountId === selected?.accountId
          && selectedAttachmentContext?.threadId === selected?.threadId
          && selected?.messages.some((message) => message.id === selectedAttachmentContext?.messageId
            && message.attachments.some((file) => file.id === selectedAttachmentContext?.attachmentId))
          ? selectedAttachmentContext : undefined,
      } : undefined,
    })
  } catch (error) {
    addAgentMessage('error', error instanceof Error ? error.message : String(error))
  }
}

function renderSearchStatus(): void {
  elements.searchStatus.hidden = !searchView
  elements.searchSummary.textContent = !searchView ? '' : searchView.phase === 'pending' ? 'Searching with Codex…' : searchView.phase === 'failed' ? 'Search needs attention' : `${searchView.results.length} matching ${searchView.results.length === 1 ? 'thread' : 'threads'} · Codex search`
}

function clearSearchView(): void {
  acceptChatSearchResults = false
  if (!searchView) return
  searchView = undefined
  conversationLoadSequence += 1
  searchQuery = ''
  elements.search.value = ''
  renderSearchStatus()
}

async function searchWithCodex(): Promise<void> {
  const query = elements.search.value.trim()
  if (!query) return
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  try {
    // Navigation must not drop a draft that has not reached Gmail yet.
    if (activeDraft && !activeDraft.id && draftDirty) await saveDraft(false)
    else await flushDraftAutosave()
    if (draftDirty || draftSaveFlight) throw new Error('Your draft still has unsaved changes. Save it before searching.')
  } catch (error) { elements.mailError.hidden = false; elements.mailError.textContent = String(error); return }
  const requestId = crypto.randomUUID()
  conversationLoadSequence += 1
  const sequence = ++selectionSequence
  markReadDwell.cancel()
  acceptChatSearchResults = false
  searchView = { query, requestId, results: [], phase: 'pending' }
  searchQuery = query
  selected = undefined; selectedConversationId = undefined; selectedAttachmentContext = undefined
  activeDraft = undefined; draftEditSession += 1; codexContextReady = false
  elements.reader.hidden = true; elements.readerEmpty.hidden = false
  elements.readerEmpty.textContent = 'Search results will appear in the message list.'
  elements.mailError.hidden = true
  panels.messages = true; panels.agent = true
  if (usesMobilePanels()) mobilePanel = 'messages'
  renderPanels(); renderList()
  const account = selectedAccountId ? accounts.find(item => item.id === selectedAccountId) : undefined
  try {
    if (!await bindAndShowCodex({ kind: 'unbound' }, { sequence, clearOnFailure: true }) || !threadId) throw new Error('Codex is not connected. Try the search again when it is ready.')
    if (sequence !== selectionSequence || searchView?.requestId !== requestId) return
    addAgentMessage('user', query)
    const prompt = `${query}\n\nSelected Gmail search context: ` + [
      `Search email for this request: ${JSON.stringify(query)}.`,
      `Search scope: ${account ? `only account ${account.id} (${account.email})` : 'all connected Gmail accounts'}. Search across mail folders, not only the current Inbox list.`,
      `Current local time: ${new Date().toString()}.`,
      'Use Gmail tools to search and read candidates. For unanswered questions, inspect the conversation replies; unread does not mean unanswered. Do not infer customer identity when the evidence is unclear.',
      `Publish your findings with dispatch_mail.show_search_results using requestId ${requestId} and the original query. Supply the exact account ID, message ID, a verbatim body quote, and a short relevance reason for each match. Return an empty matches list if no sources match.`,
    ].join(' ')
    setAgentStatus('Working')
    if (activeTurnId) await api.steerTurn(threadId, activeTurnId, prompt)
    else await api.startTurn(threadId, { text: prompt, ...userChoseModel() ? { model: selectedModelId } : {}, ...userChoseEffort() ? { effort: selectedEffort } : {}, appId: gmailAppId(apps) })
  } catch (error) {
    if (searchView?.requestId !== requestId) return
    searchView = { ...searchView, phase: 'failed', error: error instanceof Error ? error.message : String(error) }
    renderList()
  }
}

async function loadConversations(preserveSelection = false): Promise<void> {
  if (searchView) { renderList(); return }
  const loadSequence = ++conversationLoadSequence
  const cacheKey = `${offlineMode ? 'offline:' : ''}dispatch.conversations.v1:${selectedAccountId ?? 'all'}:${mailbox}:${mailState}:${searchQuery}`
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
    markReadDwell.cancel()
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
    const result = await api.listConversations(mailState, selectedAccountId, undefined, searchQuery, mailbox, offlineMode)
    if (loadSequence !== conversationLoadSequence) return
    conversations = applyAcceptedReadState(result.conversations)
    syncSelectedReadState()
    noteArrivals()
    if (mailReconnectTimer !== undefined) window.clearTimeout(mailReconnectTimer)
    mailReconnectTimer = undefined
    nextConversationCursor = result.nextCursor ?? null
    conversationTotal = result.total ?? conversations.length
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), conversations, nextCursor: nextConversationCursor, total: conversationTotal }))
    const refreshedLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
    elements.mailSource.textContent = result.source === 'demo'
      ? 'Demo mail'
      : result.coverage === 'downloaded' ? 'Downloaded mail · cached mailbox index'
      : result.coverage === 'recent'
        ? `Recent ${mailboxLabels[mailbox]} · ${refreshedLabel}`
        : `${!selectedAccountId && accounts.length > 1 ? 'Unified Gmail' : 'Gmail connected'} · ${refreshedLabel}`
    renderList()
    if (conversations[0]) {
      const selectedStillListed = Boolean(selectedConversationId && conversations.some((conversation) => conversation.id === selectedConversationId))
      if (!preserveSelection && !selectedStillListed) await selectConversation(conversations[0].id)
    } else if (!preserveSelection) {
      selected = undefined
      selectedConversationId = undefined
      elements.reader.hidden = true
      elements.readerEmpty.hidden = false
      elements.readerEmpty.textContent = defaultEmptyListMessage()
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

/** Compares a confirmed live inbox list against the previous one for the same scope and chimes only for newly arrived unread mail, never for older threads that an archive or delete scrolled onto the page. */
function noteArrivals(): void {
  if (mailbox !== 'inbox' || searchQuery || mailState === 'read') {
    liveInboxBaseline = undefined
    return
  }
  const scope = `${selectedAccountId ?? 'all'}:${mailState}`
  const previous = liveInboxBaseline?.scope === scope ? liveInboxBaseline.baseline : undefined
  const arrived = arrivedUnreadIds(previous, conversations)
  liveInboxBaseline = { scope, baseline: liveListBaseline(conversations) }
  if (arrived.length > 0) void chimeNewMail()
}

function unlockTone(): void {
  toneContext ??= new AudioContext()
  if (toneContext.state === 'suspended') void toneContext.resume()
}

async function chimeNewMail(): Promise<void> {
  try {
    toneContext ??= new AudioContext()
    const played = await playNewMailTone(toneContext)
    if (!played) console.warn('New mail arrived but the audio context is suspended until the first click or keypress.')
  } catch (error) {
    console.warn('New mail tone failed', error)
  }
}

function syncTime(value: string | null): string {
  if (!value) return 'never'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

async function refreshSyncStatus(): Promise<void> {
  if (offlineMode) { elements.mailSource.textContent = 'Downloaded mail'; return }
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

function scheduleMailReconnect(delayMs = 1_500): void {
  if (mailReconnectTimer !== undefined) return
  mailReconnectTimer = window.setTimeout(() => {
    mailReconnectTimer = undefined
    void connectMail()
  }, delayMs)
}

async function connectMail(): Promise<void> {
  try {
    accounts = await api.listAccounts(offlineMode)
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
    if (isServiceUnreachable(error) && performance.now() < mailStartupGraceUntil) {
      // The native shell starts the mail sidecar alongside the window, so the
      // first requests can race its listener. That is startup, not a failure.
      elements.mailSource.textContent = 'Starting mail service…'
      scheduleMailReconnect(MAIL_STARTUP_RETRY_MS)
      return
    }
    elements.mailSource.textContent = 'Unavailable'
    elements.mailError.hidden = false
    elements.mailError.textContent = error instanceof Error ? error.message : String(error)
    scheduleMailReconnect()
  }
}

function isServiceUnreachable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Service request failed at ')
}

function renderReceipts(): void {
  const root = app.querySelector<HTMLElement>('[data-receipts-list]')!
  if (!receipts.length) { root.textContent = 'No send receipts yet.'; return }
  root.replaceChildren(...receipts.map(receipt => receiptView(receipt, () => {
    void api.verifyReceipt(receipt.id).then(showReceipt).catch(error => { root.textContent = String(error) })
  })))
}
function showReceipt(receipt: SendReceipt): void {
  receipts = [receipt, ...receipts.filter(item => item.id !== receipt.id)]
  renderReceipts()
  const dialog = app.querySelector<HTMLDialogElement>('[data-receipts-dialog]')!
  if (!dialog.open) dialog.show()
}
function renderOfflineStatus(): void {
  const checkbox = app.querySelector<HTMLInputElement>('[data-offline-mode]')!
  checkbox.checked = offlineMode
  const summary = app.querySelector<HTMLElement>('[data-offline-status]')!
  const job = offlineStatus?.download
  summary.textContent = offlineStatus ? `${offlineStatus.conversations} conversations downloaded · ${(offlineStatus.bytes / 1_000_000).toFixed(1)} MB${job ? `
${job.mailbox}: ${job.state} · ${job.completed}/${job.total}${job.errors.length ? `
${job.errors.length} failed: ${job.errors.slice(0, 3).join('; ')}` : ''}` : ''}` : 'Loading downloaded-mail status…'
  const download = app.querySelector<HTMLButtonElement>('[data-download-mailbox]')!
  download.textContent = `Download ${mailboxLabels[mailbox]}`
  download.disabled = job?.state === 'running' || offlineMode
  app.querySelector<HTMLElement>('[data-cancel-download]')!.hidden = job?.state !== 'running'
  app.querySelector('[data-offline-open]')?.classList.toggle('active', offlineMode)
}
async function refreshUtilities(): Promise<void> {
  const [receiptResult, offlineResult] = await Promise.allSettled([api.receipts(), api.offlineStatus()])
  if (receiptResult.status === 'fulfilled') {
    if (JSON.stringify(receipts) !== JSON.stringify(receiptResult.value)) { receipts = receiptResult.value; renderReceipts() }
  } else if (app.querySelector<HTMLDialogElement>('[data-receipts-dialog]')!.open) app.querySelector<HTMLElement>('[data-receipts-list]')!.textContent = `Receipts unavailable: ${String(receiptResult.reason)}`
  if (offlineResult.status === 'fulfilled') { offlineStatus = offlineResult.value; renderOfflineStatus() }
  else if (app.querySelector<HTMLDialogElement>('[data-offline-dialog]')!.open) app.querySelector<HTMLElement>('[data-offline-status]')!.textContent = `Downloaded-mail status unavailable: ${String(offlineResult.reason)}`
}
function setDownloadedMode(value: boolean): void {
  if (draftDirty) checkpointDraft()
  offlineMode = value; localStorage.setItem('dispatch.offline-mode', String(value))
  clearSearchView(); conversationCache.clear(); renderOfflineStatus()
  void connectMail()
}
function persistSidebar(): void {
  localStorage.setItem('dispatch.ui.sidebar', mailboxesVisible ? sidebarStyle : 'hidden')
  localStorage.setItem('dispatch.ui.sidebar.last-visible', sidebarStyle)
}
function setSidebarMenu(open: boolean): void {
  const menu = app.querySelector<HTMLElement>('[data-sidebar-menu]')!
  const button = app.querySelector<HTMLButtonElement>('[data-sidebar-options]')!
  menu.hidden = !open; menu.classList.toggle('show', open); button.setAttribute('aria-expanded', String(open))
  if (open) {
    const rect = button.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 188))}px`
    menu.style.top = `${rect.bottom + 4}px`
    menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }
}
app.querySelector('[data-sidebar-options]')?.addEventListener('click', event => { event.stopPropagation(); setSidebarMenu(app.querySelector<HTMLElement>('[data-sidebar-menu]')!.hidden) })
app.querySelectorAll<HTMLButtonElement>('[data-sidebar-style]').forEach(button => button.addEventListener('click', () => {
  sidebarStyle = button.dataset.sidebarStyle as SidebarStyle; mailboxesVisible = true; persistSidebar(); renderPanels(); setSidebarMenu(false)
  app.querySelector<HTMLButtonElement>('[data-sidebar-options]')!.focus()
}))
app.querySelector('[data-sidebar-menu]')?.addEventListener('keydown', event => {
  const key = (event as KeyboardEvent).key
  if (!['ArrowDown','ArrowUp','Home','End'].includes(key)) return
  event.preventDefault()
  const buttons = [...app.querySelectorAll<HTMLButtonElement>('[data-sidebar-style]')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[key === 'Home' ? 0 : key === 'End' ? buttons.length - 1 : (current + (key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
})
app.querySelector('[data-mailboxes-toggle]')?.addEventListener('click', () => {
  if (usesMobilePanels()) { setFolderMenu(elements.folderMenu.hidden); return }
  mailboxesVisible = !mailboxesVisible; persistSidebar(); renderPanels()
})
function renderDensity(): void {
  document.documentElement.classList.toggle('dispatch-compact', compactMessages)
  const button = app.querySelector<HTMLButtonElement>('[data-density]')!
  button.setAttribute('aria-pressed', String(compactMessages))
  button.setAttribute('aria-label', compactMessages ? 'Use comfortable message list' : 'Use compact message list')
}
app.querySelector('[data-density]')?.addEventListener('click', () => { compactMessages = !compactMessages; localStorage.setItem('dispatch.ui.density', compactMessages ? 'compact' : 'comfortable'); renderDensity() })
renderDensity()
function closeActivity(): void { app.querySelector<HTMLElement>('#dispatch-activity')!.hidden = true; app.querySelector('[data-activity-toggle]')!.setAttribute('aria-expanded', 'false') }
app.querySelector('[data-activity-toggle]')?.addEventListener('click', () => {
  const panel = app.querySelector<HTMLElement>('#dispatch-activity')!; panel.hidden = !panel.hidden
  app.querySelector('[data-activity-toggle]')!.setAttribute('aria-expanded', String(!panel.hidden))
})
for (const selector of ['[data-receipts-open]', '[data-offline-open]']) app.querySelector(selector)?.addEventListener('click', closeActivity)
document.addEventListener('click', event => { if (!(event.target as Element).closest('.dispatch-mail-activity')) closeActivity() })
for (const name of ['receipts', 'offline', 'recovery']) {
  const dialog = app.querySelector<HTMLDialogElement>(`[data-${name}-dialog]`)!
  dialog.addEventListener('close', () => app.querySelector<HTMLButtonElement>(name === 'recovery' ? '[data-recovery-open]' : '[data-activity-toggle]')?.focus())
}
app.querySelectorAll<HTMLButtonElement>('[data-dialog-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog')!.close()))
app.querySelector('[data-recovery-open]')?.addEventListener('click', () => { renderRecoveryList(); app.querySelector<HTMLDialogElement>('[data-recovery-dialog]')!.showModal() })
app.querySelector('[data-receipts-open]')?.addEventListener('click', () => { renderReceipts(); app.querySelector<HTMLDialogElement>('[data-receipts-dialog]')!.show(); void refreshUtilities() })
app.querySelector('[data-offline-open]')?.addEventListener('click', () => { renderOfflineStatus(); app.querySelector<HTMLDialogElement>('[data-offline-dialog]')!.show(); void refreshUtilities() })
app.querySelector<HTMLInputElement>('[data-offline-mode]')?.addEventListener('change', event => setDownloadedMode((event.target as HTMLInputElement).checked))
app.querySelector('[data-download-mailbox]')?.addEventListener('click', () => { void api.downloadMailbox(mailbox, selectedAccountId).then(refreshUtilities).catch(error => { app.querySelector<HTMLElement>('[data-offline-status]')!.textContent = String(error) }) })
app.querySelector('[data-cancel-download]')?.addEventListener('click', () => { void api.cancelDownload().then(refreshUtilities).catch(error => { app.querySelector<HTMLElement>('[data-offline-status]')!.textContent = String(error) }) })
window.addEventListener('offline', () => setDownloadedMode(true))
renderRecoveryList()
void refreshUtilities()
window.setInterval(() => { void refreshUtilities() }, 5000)

async function start(): Promise<void> {
  await Promise.all([connectMail(), connectAgent()])
}

window.addEventListener('pointerdown', unlockTone, { once: true })
window.addEventListener('keydown', unlockTone, { once: true })
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
  clearSearchView()
  selectedAccountId = elements.account.value || undefined
  void loadConversations()
})
app.querySelectorAll<HTMLButtonElement>('[data-mailbox]').forEach((button) => button.addEventListener('click', () => {
  clearSearchView()
  mailbox = button.dataset.mailbox as GmailMailbox
  renderMailbox()
  void loadConversations()
}))
elements.search.addEventListener('input', () => {
  searchQuery = elements.search.value.trim()
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  if (searchView && !searchQuery) clearSearchView()
  if (searchView || activeDraft) return
  searchTimer = window.setTimeout(() => { void loadConversations() }, 250)
})
elements.search.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void searchWithCodex() } })
app.querySelector('[data-ai-search]')?.addEventListener('click', () => { void searchWithCodex() })
app.querySelector('[data-clear-search]')?.addEventListener('click', () => { clearSearchView(); void loadConversations() })
app.querySelectorAll<HTMLButtonElement>('[data-mail-state]').forEach((button) => button.addEventListener('click', () => {
  clearSearchView()
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
app.querySelector('[data-ask]')?.addEventListener('click', askCodex)
app.querySelector('[data-save-draft]')?.addEventListener('click', () => { void saveDraft().catch((error) => addAgentMessage('error', error instanceof Error ? error.message : String(error))) })
app.querySelector('[data-send-draft]')?.addEventListener('click', sendDraft)
app.querySelector('[data-send-cancel]')?.addEventListener('click', () => { elements.sendConfirm.hidden = true })
app.querySelector('[data-send-confirm-go]')?.addEventListener('click', () => { void confirmSendDraft().catch(draftError) })
app.querySelector('[data-discard-draft]')?.addEventListener('click', () => { void discardDraft().catch(draftError) })
app.querySelector('[data-attach-draft]')?.addEventListener('click', () => { elements.draftFiles.click() })
elements.draftFiles.addEventListener('change', () => { void attachDraftFiles() })
elements.draftBody.addEventListener('input', () => {
  elements.sendConfirm.hidden = true
  markDraftDirty()
  refreshPreview()
  autosaveDraft()
})
for (const field of [elements.draftTo, elements.draftCc, elements.draftBcc]) {
  field.addEventListener('input', () => {
    elements.sendConfirm.hidden = true
    markDraftDirty()
    onRecipientInput(field)
    if (activeDraft?.id) autosaveDraft()
  })
  field.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === 'Tab') && field.value.trim()) {
      if (event.key === 'Enter') event.preventDefault()
      acceptRecipientInput(field)
      markDraftDirty()
      if (activeDraft?.id) autosaveDraft()
    }
    if (event.key === 'Backspace' && !field.value) {
      const chips = recipientChipAddresses(field)
      if (chips.length === 0) return
      renderRecipientChips(field, chips.slice(0, -1))
      markDraftDirty()
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
  markDraftDirty()
  if (activeDraft?.id) autosaveDraft()
})
elements.draftAccount.addEventListener('input', () => { markDraftDirty(); elements.sendConfirm.hidden = true })
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
const EFFORT_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }
function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}
function placeholderModel(): DispatchModel {
  return {
    id: selectedModelId,
    label: selectedModelId || (modelCatalogError ? 'Model' : 'Loading models'),
    efforts: selectedEffort ? [selectedEffort] : [],
    exhausted: null,
    resetsAt: null,
  }
}
function currentModel(): DispatchModel {
  if (!modelCatalog) return placeholderModel()
  return modelCatalog.models.find((model) => model.id === selectedModelId)
    ?? (selectedModelId
      ? { id: selectedModelId, label: selectedModelId, efforts: selectedEffort ? [selectedEffort] : [], exhausted: null, resetsAt: null }
      : placeholderModel())
}
function modelToggleText(model: DispatchModel): string {
  if (!model.id) return model.label
  const effort = selectedEffort || modelCatalog?.defaults.effort || ''
  return effort ? `${model.label} · ${effortLabel(effort)}` : model.label
}
function resetLabel(resetsAt: number | null): string {
  if (!resetsAt) return ''
  return ` · resets ${new Date(resetsAt * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}
function renderModelPicker(): void {
  const model = currentModel()
  elements.modelLabel.textContent = modelToggleText(model)
  elements.modelToggle.classList.toggle('bg-blue-lt', model.exhausted !== true)
  elements.modelToggle.classList.toggle('text-blue', model.exhausted !== true)
  elements.modelToggle.classList.toggle('bg-yellow-lt', model.exhausted === true)
  elements.modelToggle.classList.toggle('text-yellow', model.exhausted === true)
  if (modelCatalogError) elements.modelSummary.textContent = modelCatalogError
  else if (!modelCatalog) elements.modelSummary.textContent = 'Loading models'
  else if (model.exhausted === true) elements.modelSummary.textContent = `${model.label} has reached its usage limit. Pick another model.`
  else if (modelCatalog.rateLimitsError) elements.modelSummary.textContent = `Usage limits unavailable: ${modelCatalog.rateLimitsError}`
  else elements.modelSummary.textContent = 'Model'
  elements.modelList.replaceChildren()
  for (const candidate of modelCatalog?.models ?? (model.id ? [model] : [])) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'dropdown-item dispatch-model-option'
    row.setAttribute('role', 'menuitemradio')
    row.setAttribute('aria-checked', String(candidate.id === selectedModelId))
    row.dataset.modelId = candidate.id
    row.disabled = candidate.exhausted === true
    const name = document.createElement('span')
    name.className = 'dispatch-model-name'
    name.textContent = candidate.label
    row.append(name)
    if (candidate.id === selectedModelId && candidate.exhausted !== true) {
      const check = document.createElement('i')
      check.className = 'ti ti-check ms-auto'
      check.setAttribute('aria-hidden', 'true')
      row.append(check)
    }
    if (candidate.exhausted === true) {
      const note = document.createElement('span')
      note.className = 'text-secondary small dispatch-model-note'
      note.textContent = `Limit reached${resetLabel(candidate.resetsAt)}`
      row.append(note)
    }
    row.addEventListener('click', (event) => {
      event.stopPropagation()
      selectModel(candidate.id)
    })
    elements.modelList.append(row)
  }
  elements.modelEfforts.replaceChildren()
  for (const effort of model.efforts) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `btn btn-sm ${effort === selectedEffort ? 'btn-primary' : 'btn-outline-secondary'}`
    button.setAttribute('aria-pressed', String(effort === selectedEffort))
    button.dataset.effort = effort
    button.textContent = effortLabel(effort)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      selectedEffort = effort
      localStorage.setItem('dispatch.codex.effort', effort)
      renderModelPicker()
    })
    elements.modelEfforts.append(button)
  }
}
function selectModel(id: string): void {
  selectedModelId = id
  localStorage.setItem('dispatch.codex.model', id)
  const efforts = currentModel().efforts
  if (efforts.length > 0 && !efforts.includes(selectedEffort)) {
    selectedEffort = efforts.includes('medium') ? 'medium' : efforts[efforts.length - 1]!
    localStorage.setItem('dispatch.codex.effort', selectedEffort)
  }
  renderModelPicker()
}
let modelCatalogRequest: Promise<void> | undefined
async function refreshModelCatalog(): Promise<void> {
  if (modelCatalogRequest) return modelCatalogRequest
  modelCatalogRequest = (async () => {
    try {
      if (!await api.agentReady()) {
        modelCatalogError = 'Codex not connected'
        return
      }
      modelCatalog = await api.listModels()
      modelCatalogError = undefined
      if (!userChoseModel()) selectedModelId = modelCatalog.defaults.model
      if (!userChoseEffort()) selectedEffort = modelCatalog.defaults.effort
    } catch (error) {
      modelCatalogError = error instanceof Error ? error.message : String(error)
    } finally {
      modelCatalogRequest = undefined
      renderModelPicker()
    }
  })()
  return modelCatalogRequest
}
function setModelMenu(open: boolean): void {
  elements.modelMenu.hidden = !open
  elements.modelMenu.classList.toggle('show', open)
  elements.modelToggle.setAttribute('aria-expanded', String(open))
  if (open) void refreshModelCatalog()
}
elements.modelToggle.addEventListener('click', (event) => {
  event.stopPropagation()
  setModelMenu(elements.modelMenu.hidden)
})
renderModelPicker()
void refreshModelCatalog()
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
  if (!(event.target as Element).closest('[data-sidebar-menu], [data-sidebar-options]')) setSidebarMenu(false)
  if (!elements.folderMenu.hidden && !elements.folderMenu.contains(event.target as Node)) setFolderMenu(false)
  if (!elements.readerMenu.hidden && !elements.readerMenu.contains(event.target as Node)) setReaderMenu(false)
  if (!elements.modelMenu.hidden && !elements.modelMenu.contains(event.target as Node)) setModelMenu(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (!app.querySelector<HTMLElement>('[data-sidebar-menu]')!.hidden) { setSidebarMenu(false); app.querySelector<HTMLButtonElement>('[data-sidebar-options]')!.focus() }
  closeActivity()
  app.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close())
  setFolderMenu(false)
  setReaderMenu(false)
  setModelMenu(false)
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
