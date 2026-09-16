# Reader toolbar, multi-select, drag to folder, Delete key

Date: 2026-09-17
Status: approved by Steve on 2026-09-17 (option D toolbar with the Codex sparkle; multi-select, drag, and Delete as specified here)

## Problem

The reader toolbar mixes four button treatments in one row: an outlined "Reply" text pill, a bordered Reply-all/Forward group, borderless ghost icons for folder actions, and a red Trash. Heights differ and the row ends mid-header. The list has no multi-select, rows cannot be dragged to a folder, and the Delete key does nothing.

## Goal

- One consistent reader toolbar: icon over an 11px label for every action, same size, same ghost treatment.
- Shift-click and Cmd-click select several conversations; the toolbar acts on the whole selection.
- Rows drag onto folder targets (rail, folder dropdown) and drop runs the existing folder command.
- Delete and Backspace move the selection to Trash. In Trash they explain that the Gmail connector cannot delete permanently.

## Non-goals

- Redesigning message rows or the top window toolbar.
- Flag, Mute, Move to arbitrary label.
- Native drag images or a native drop into Finder.
- Undo.

## Constraints

- `services/web` owns presentation. `services/mail` remains the only Gmail writer. `apps/desktop` learns nothing new.
- Keep Tabler 1.4 tokens and the 36px minimum hit target. Labels never wrap; the toolbar scrolls horizontally rather than overflowing the pane.
- Keys are ignored while focus is in a text field, textarea, or contenteditable.
- Failures stay visible per conversation. No whole-list rollback.

## PR 1: Toolbar D

Markup: every reader action becomes `.btn.btn-ghost-secondary.dispatch-reader-action` with an `<i class="ti">` above a `<span>` label. Order, left to right:

| Command | Icon | Label | Shown |
|---|---|---|---|
| reply | ti-arrow-back-up | Reply | always |
| replyAll | ti-arrow-back-up-double | Reply all | always |
| forward | ti-arrow-forward-up | Forward | always |
| divider | | | |
| inbox | ti-inbox | Inbox | archive, spam, trash |
| archive | ti-archive | Archive | inbox |
| spam | ti-alert-octagon | Spam | not spam, not trash |
| trash | ti-trash | Trash | not trash |
| readState | ti-mail-opened / ti-mail | Unread / Read | when the thread has an account |
| spacer | | | |
| ask | ti-sparkles | Codex | always |
| more | ti-dots | More | always |

The More menu keeps "Hide email panel" only. Mark read/unread and Ask Codex move into the toolbar. Trash loses the red. Size: 44px tall, min 52px wide, icon 1.25rem, label .6875rem, gap 2px. The existing `data-*` hooks stay so handlers and tests keep working. Playwright: toolbar buttons all visible ones have the same height, label text is present, no button narrower than 44px.

## PR 2: Multi-select and drag

State: `selectedIds: Set<string>` and `selectionAnchor?: string` beside the existing `selectedConversationId`. Plain click sets the anchor and a single selection and opens the reader as today. Shift-click selects the range from the anchor to the row in the listed order. Cmd-click toggles one row; the anchor stays. Arrow keys with focus in the list move the anchor; Shift-arrow extends. Escape collapses to the anchor.

Rendering: rows carry `aria-selected` and `.active` for every id in the set. With two or more selected the reader shows the empty state "N conversations selected" and the toolbar stays visible with reply, replyAll, forward, and ask hidden.

Actions: `mutateSelected(action)` becomes `mutateConversations(ids, action)`. It removes all rows optimistically, calls the mail API once per thread in parallel, and re-inserts only the rows whose call failed, with the mail error naming the count. The context menu acts on the whole selection when the right-clicked row is part of it.

Drag: rows are `draggable`. `dragstart` sets `text/x-dispatch-conversations` to the selected ids (or the dragged row if it is not selected) and a custom drag image showing the count. Drop targets are `[data-mailbox]` in the rail and the folder dropdown items, plus the folder title button, which opens the dropdown on `dragenter`. Targets whose mailbox equals the current one, or `sent`/`drafts`, refuse the drop. A drop maps mailbox to action: inbox→inbox, archive→archive, spam→spam, trash→trash, and runs `mutateConversations`. `.dispatch-drop-target` highlights the hovered target.

## PR 3: Delete key

Keys: with focus outside a text field, textarea, select, contenteditable, or open dialog, Delete or Backspace runs `trash` on the selection in any mailbox except trash. Cmd-Backspace does the same. Shift, Ctrl, and Alt combinations are left alone. Composing a new message with nothing selected ignores the keys.

In trash the keys show a mail error, "Gmail does not allow Dispatch to delete permanently. Empty the trash in Gmail." The Codex Gmail connector's only delete tool, `gmail.delete_emails`, is documented as "Move one or more existing Gmail messages to Trash … does not permanently delete the messages" (checked live on 2026-09-17), so no `delete` action is added to the mail service and the Trash button stays hidden in Trash.

## Follow-ups approved 2026-09-17 (wireframes: https://claude.ai/artifact/UpLVHvedpyTxvXMJ4E41DL)

### Undo toast (PR 4)
After any move that removes rows from the current list, a dark toast at the bottom centre says "Moved N conversations to Trash" (or "Archived N", "Marked N as spam", "Moved N to Inbox") with an Undo button, a ⌘Z hint, a dismiss control, and a 6 s countdown bar that pauses on hover. Undo re-inserts the rows at their old positions when the list is still the same mailbox, then applies the inverse actions per thread in order: from Inbox → `inbox`; from Archive → `inbox`, `archive`; from Spam → `inbox`, `spam`; from Trash → `inbox`, `trash`; a move to Inbox → the source folder's action. ⌘Z triggers Undo only while the toast is visible and focus is outside a text field. Only the latest move is undoable.

### Rail counts (PR 5)
Inbox shows its unread count in blue; Drafts and Spam show totals in grey; Sent, Archive, Trash show nothing. Badges hide at zero and cap at 99+. Counts come from a new mail route `GET /v1/mailboxes/counts?account=` served from the index and polled with sync status.

### Keyboard shortcuts (PR 6)
Single letters with focus in the list or reader: R reply, A reply all, F forward, E archive, ! spam, # trash, U toggle read, J/K next/previous, C compose, G then I/S/D/A/T go to a folder, ? cheat sheet. Hovering a toolbar action shows a tip with its key. The cheat sheet is a dialog closed by Escape.

### Reader meta line (PR 7)
One row: account dot and address (when more than one account), folder, message count only when above one, an "Offline" chip whose tooltip holds the cached time (amber "Downloaded copy" when serving the local download), attachments toggle at the right. The separate "Available offline" line goes away.

## Testing

Vitest for pure selection logic (`selection.ts`: range, toggle, anchor, collapse) and for drag payload encoding. Playwright for the toolbar shape, Shift and Cmd selection, drag-and-drop onto the rail, the Delete key, and the message shown in Trash. Native UAT from a worktree build for the drag image and the key routing inside Tauri.
