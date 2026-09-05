# UI polish pass — same Tabler, ten percent sleeker

Date: 2026-09-06
Status: approved by Steve on 2026-09-06 (wireframes at https://claude.ai/code/artifact/adfcf8d0-78e6-49bc-b009-739daf876264)
Slice: presentation only, `services/web`

## Problem

The workbench reads as a web dashboard, not a Mac app. The title bar prints the product name and an "All Gmail inboxes" badge, centres a search box across three columns, and sits above a message pane that stacks three control rows before the first message. Message rows spend ~115px each on two-line subjects, two-line previews, and the full account address. The reader repeats the sender in its header and in the first thread card, labels the subject "Selected thread", and parks five text buttons at the bottom. The Codex pane competes with itself: a model badge, a status badge, and an info alert in the header, saturated user bubbles, and one red card per repeated error.

## Goal

Keep Tabler 1.4 tokens (blue `#066fd1`, 6px radii, Inter, `#e5e7eb` borders) and the three-panel model from `docs/PRODUCT.md`, and make the chrome behave like a native macOS app.

## Decisions

### Top of the window: direction C, unified toolbar

- Remove the global title bar. Nothing in the window prints "Dispatch".
- One 44px toolbar row spans the window and is visually split by the column dividers, like Finder and Mail on macOS 11+.
  - Over the rail: the traffic lights (native shell) or nothing (browser).
  - Over the messages column: a folder popover button (`Inbox ▾`), a muted "All inboxes" scope caption that opens the account picker, a filter icon, and a compose icon button.
  - Over the reader: a sync dot with "Synced N min ago" on the left and a 300px search field with a `⌘K` hint on the right.
  - Over the Codex column: the three panel-visibility toggles as icon buttons.
- The status bar goes away. Sync detail moves to the toolbar dot and its tooltip. Codex status stays in the Codex header.
- The labelled "Gmail account" select and the standalone Refresh button in the messages pane are removed. Account scope lives in the toolbar caption. Refresh stays available from the sync dot's menu.
- The messages column keeps its All / Unread / Read filters as underline tabs on the pane's top divider, with an unread count on the right.

### Message rows: keep the current layout

Rows keep today's anatomy (avatar, sender, time, two-line subject, two-line preview, account address). The only row change in this pass is behavioural: rows reflow when the divider narrows the pane instead of overflowing under it. That fix shipped separately; see "Already done".

### Reader: accepted

- Drop the "Selected thread" subheader and the duplicated sender row. The subject is the only heading, at 18px/600.
- A meta line under the subject carries message count, folder, and the account as a colour dot plus address.
- Actions move into the subject row: `Reply` as the one primary button, then an icon group for reply-all and forward, a divider, then archive, spam, trash, and a `⋯` menu. Mark read/unread and "Ask Codex" live under `⋯`; the Codex pane's suggestion chips cover the ask.
- The bottom action bar is removed.
- Older thread messages collapse to one line (avatar, sender, snippet, date). The newest expands. Body text indents under the avatar column.

### Codex pane: accepted

- Header: a 28px ink mark, "Codex" at 14px/600 with the model as an 11px caption beneath, and one status signal on the right as a dot plus word (Connected, Working, Needs attention, Failed).
- The context alert becomes a removable pill chip in the same style as recipient chips.
- User turns render in `bg-primary-lt` bubbles with a small timestamp beneath. Assistant turns are flat text. Tool activity is a one-line receipt with a check icon.
- Repeated errors dedupe into one amber card with a `Retry` action. Raw URLs go behind the card, not in it.
- Suggestions render as pill chips. The composer gets a bordered card, a connector dot with "Gmail connected", and a 30px primary send button.

### Type and surfaces

- Panes use 13px body, 12px meta, 11px captions. The scattered `.7rem` to `.78rem` overrides in `styles.css` are replaced by those three sizes.
- Panels are flat with 1px dividers. Cards are reserved for thread messages and the composer.

## Non-goals

- Changing the mail or agent services, contracts, or any command surface.
- The dense no-avatar row variant on the wireframe canvas.
- Dark mode.
- Mobile layout changes beyond keeping the existing single-pane behaviour working.

## Already done

- Panel reflow: `.dispatch-messages`, `.dispatch-reader > [data-reader]`, and `.dispatch-agent` declare `grid-template-columns: minmax(0, 1fr)` and give their children `min-width: 0`, so pane content shrinks with the divider instead of sliding under it. Covered by the Playwright test "reflows pane content instead of overflowing when a divider narrows it".

## Order of work

1. Toolbar and status bar (direction C), including moving the panel toggles and account scope.
2. Reader header and thread collapsing.
3. Codex header, context chip, bubbles, error dedupe, composer.
4. Type scale and surface flattening.

Each step is its own PR with Playwright coverage for the moved controls and the mobile pane behaviour.
