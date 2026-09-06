# Native thread context menu

Date: 2026-09-07
Status: approved by Steve on 2026-09-07 (native replacement menu, reader actions, architecture, items, contract, tests)
Slice: one selected conversation; presentation plus shell popup only

## Problem

A right-click on a thread row opens the WebKit page menu (Reload, Back, Inspect). That is a web page, not a mail client. Apple Mail shows a mail menu on that click.

## Goal

In Dispatch.app, a right-click on a thread row shows a native macOS menu. The items are the reader actions that already exist. Choosing an item runs the same web handler as the reader button. Mail still owns every Gmail write. The shell does not learn mail rules.

## Non-goals

- Shift multi-select and mass actions (later spec)
- A new delete meaning (permanent delete, or one message inside a thread) (later spec)
- Drag a row onto a folder (later spec)
- Flag, Move to mailbox, Mute, or other Mail.app items that have no command today
- Importing SimpleMark’s HTML note-row menu as the product look
- Augmenting the WebKit page menu (that keeps Reload and Inspect)
- Building the menu with `@tauri-apps/api/menu` inside the page
- Hard-coding mail labels or Gmail actions in Rust
- A new mail route or a new agent route
- Claiming native acceptance from Playwright

## Constraints

- `apps/desktop` is shell composition only. It may draw a menu from a list and return a command id. It may not call mail, choose labels, or infer unread state.
- `services/web` owns presentation. It builds the item list from the same folder and demo rules as the reader.
- `services/mail` remains the only writer of Gmail labels and the index.
- Sending, forwarding, and recipient changes keep the existing draft confirm. Slice 1 does not add a new delete confirm.
- Failures stay visible. A failed popup or a failed mail call does not open the page menu and does not pretend success.
- Email content is untrusted and never grants authority.

## Decisions

| Choice | Value |
|---|---|
| Look in Dispatch.app | Native macOS menu that replaces the page menu |
| Item owner | Web |
| Popup owner | Shell |
| Browser / Playwright | HTML menu, same command ids; not native acceptance |
| Selection | Right-click selects that conversation |
| Read dwell | Right-click does not start the 5-second dwell |
| Actions | Existing reader handlers, one conversation |
| Command ids | Stable strings so a later multi-select spec can reuse them |
| Popup result | Chosen id, or null if the user dismisses the menu |
| Failed native popup | Visible mail error; no page menu; no HTML fallback inside Dispatch.app |

## Architecture

```text
Right-click on a thread row
        |
        v
web: block the page menu
web: select that conversation (no 5-second read dwell)
web: build items from the same rules as the reader
        |
        +-- Dispatch.app --> shell popup --> chosen id or null --> web command
        |
        +-- browser -------> HTML menu -----> same id or null ----> web command
                                      |
                                      v
                         existing web handlers
                                      |
                                      v
                         dispatch-mail (when the command writes Gmail)
```

Web exposes a popup port. The native adapter calls one Tauri command. The browser adapter shows the HTML menu. Both adapters return the same result type.

## Command ids

These ids are the contract between the item list and the handlers. Slice 1 still runs each handler on the one selected conversation.

| Id | Handler |
|---|---|
| `reply` | `openDraft(false)` |
| `replyAll` | `openDraft(true)` |
| `forward` | `openForward()` |
| `markRead` | `setConversationUnread(..., false)` through the existing read-state path |
| `markUnread` | `setConversationUnread(..., true)` through the existing read-state path |
| `archive` | `mutateSelected('archive')` |
| `inbox` | `mutateSelected('inbox')` |
| `spam` | `mutateSelected('spam')` |
| `trash` | `mutateSelected('trash')` |
| `ask` | Existing Ask Codex control (focus the prompt; on a narrow width open the Codex pane) |

The menu shows `markRead` or `markUnread`, not both. The label is `Mark as Read` or `Mark as Unread`. The choice uses the same unread value as the reader (`acceptedReadState` overlay, then the list row).

## Item list

```text
Reply
Reply All
Forward
————————
Mark as Read   or   Mark as Unread
————————
Archive              (Inbox only)
Move to Inbox        (Archive, Spam, and Trash)
Mark as Spam         (hidden in Spam and Trash)
Move to Trash        (hidden in Trash)
————————
Ask Codex
```

Hidden items follow the reader toolbar, not a second set of rules:

| Item | Visible when |
|---|---|
| Archive | current mailbox is Inbox |
| Move to Inbox | current mailbox is Archive, Spam, or Trash |
| Mark as Spam | current mailbox is not Spam and not Trash |
| Move to Trash | current mailbox is not Trash |

A row with no Gmail `accountId` (demo) keeps Gmail writes disabled: `markRead`, `markUnread`, `archive`, `inbox`, `spam`, `trash`, and `forward`. Reply and Reply All stay available when the reader would create a local draft. Ask Codex stays enabled.

Omit an item that is hidden. Do not show it disabled with a mail reason. Disabled is only for demo / missing `accountId`, matching the reader.

## Click behavior

1. Right-click, Control-click, or a two-finger click on a thread row fires `contextmenu`.
2. Web calls `preventDefault` on that row. The page menu must not appear.
3. Web selects that conversation at once, including a row that is already selected. It does not pass `startReadDwell`.
4. The reader and Codex pane follow the existing select path (load the thread, switch the Codex binding).
5. Web builds the item list from the row, the current mailbox, and the current unread overlay.
6. The popup opens at the pointer. Web does not convert CSS coordinates for the shell.
7. If the user dismisses the menu, the adapter returns null and web does nothing else. The row stays selected.
8. If the user chooses an id, web runs that handler. A command that needs the full thread waits for the in-flight `selectConversation` load, then runs. It does not open a second select.
9. A left-click or a right-click that is not on a thread row does not open this menu. Empty list space keeps the page menu only when the target is not a row.

## Shell contract

Tauri command name: `popup_context_menu`.

Argument:

```ts
{
  items: Array<
    | { kind: 'separator' }
    | { kind: 'command'; id: string; label: string; enabled: boolean }
  >
}
```

Result: the chosen `id` string, or `null` if the user dismisses the menu.

Rules for the shell:

1. Draw the items in order.
2. Use the given label. Do not rename, translate, or add shortcuts.
3. Honor `enabled`.
4. Draw `separator` as a macOS separator.
5. Reject an empty list, a command without an id or label, and a list that is only separators. Return an error string. Do not show a menu.
6. Do not call mail, agent, or the web handlers.
7. Do not add Reload, Inspect, Copy, or other WebKit items.
8. Popup uses the system pointer location.

The page capability gains permission for this command only. The page still has no shell, filesystem, dialog, or opener permission.

Web may use `@tauri-apps/api/core` `invoke` for this command. It must not import `@tauri-apps/api/menu`.

## Failures

| Condition | What the user sees |
|---|---|
| Popup command fails in Dispatch.app | Existing mail error names the failure. No page menu. No HTML menu. |
| Invalid item list | Shell returns an error. Web shows that error. No menu. |
| User dismisses the menu | No error. No command. Row stays selected. |
| Mail write fails after a choice | Existing mail error. Same as the reader button. |
| Full thread load fails before Reply or Forward | Existing select / mail error. The command does not run against another conversation. |
| Browser has no native popup | HTML menu. Same ids. Same handlers. |

Do not hide a failed popup behind a silent no-op. Do not fall back to the page menu.

## Testing

Automated:

- Vitest in web: item lists for Inbox, Archive, Spam, Trash; unread and read; demo (Gmail writes disabled). Right-click select does not start the read dwell.
- Playwright: right-click a row blocks the page menu, selects the row, shows the HTML menu, and runs Reply, Mark unread, and Move to Trash through the same handlers as the reader. Do not call this native acceptance.
- Rust: the popup builder keeps given order, labels, enabled flags, and separators; it rejects an empty list and a separators-only list; it returns the chosen id or null. It does not invent items.

Manual, recorded in the PR:

- In live Dispatch.app, right-click a thread row.
- Confirm a native macOS menu, not an HTML overlay and not the WebKit page menu.
- Confirm Reload and Inspect are absent.
- Confirm Reply, Mark as Read or Unread, and Move to Trash match the reader.
- Confirm a right-click does not mark the row read after five seconds unless the user later left-clicks and dwells.

## Later specs (named, not started)

1. Shift multi-select and mass actions on these command ids. Bulk and delete still need an explicit confirm.
2. Delete meaning: conversation to Trash (today), one message inside a thread, or permanent delete.
3. Drag a conversation onto Inbox, Archive, Spam, or Trash. Mail already has archive, spam, trash, and inbox. It cannot move to Sent or Drafts.
