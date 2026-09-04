# Dispatch product contract

Status: working read-only foundation

## Job

Keep the email visible while the user works with it through the Codex experience they already know.

## Primary surface

Dispatch has three persistent panels:

1. Messages.
2. Selected email or draft.
3. Codex chat.

The middle reading surface is visually primary. Selection changes the explicit Codex context but does not silently replace the active Codex conversation.

All connected Gmail accounts enter one date-ordered queue by default. The user can filter that queue to one account. Message rows show a compact date and time. The rendered message header shows the full date and time.

The queue contains conversations, not duplicate individual messages. A conversation is scoped by Gmail account and Gmail thread ID. All, Unread, and Read filters operate on conversation state. A conversation is unread when any retrieved member message carries Gmail's `UNREAD` label. All contains Inbox conversations plus unread conversations outside Inbox, excluding spam and trash. Unread contains every unread conversation outside spam and trash. Read remains scoped to read Inbox conversations.

Selecting a conversation loads the complete Gmail thread in chronological order. Each message shows sender, address, full date, and time. Repeated quoted history is collapsed by default but remains available through a disclosure.

The user can keep one, two, or three panels open. Each panel has an explicit visibility control. At least one panel remains visible. The messages and Codex panel widths are adjustable and persist locally.

## Version-one acceptance

The first useful version lets a user:

1. See real Gmail messages.
   Messages from all connected accounts share one queue.
   The queue groups messages into Gmail conversations and supports All, Unread, and Read filters.
2. Select and safely render one conversation.
3. Ask the installed Codex harness about it.
4. See Gmail connector activity.
5. Open a cited Gmail resource.
6. Create a draft through Codex.
7. Review and edit the draft in the middle panel.
8. Reach an explicit approval before sending.

## Current foundation

The current slice proves the service boundaries, real Codex App Server handshake, installed Gmail connector discovery, read-only inbox search, full MIME retrieval, safe browser rendering, and the browser experience. Demo projections require the explicit `DISPATCH_DEMO_MAIL=1` development setting. A missing Gmail connection is a visible readiness failure and never silently substitutes demo mail. Gmail writes run through Codex and its explicit approval flow; reply and respond requests show a complete preview before any send call.

## Non-goals for the foundation

- Full Gmail synchronization.
- IMAP or Outlook.
- Autonomous triage or sending.
- A second agent runtime.
- A second Gmail MCP server.
- A pure SwiftUI rewrite.
