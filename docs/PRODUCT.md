# Dispatch product contract

Status: foundation implementation

## Job

Keep the email visible while the user works with it through the Codex experience they already know.

## Primary surface

Dispatch has three persistent panels:

1. Messages.
2. Selected email or draft.
3. Codex chat.

The middle reading surface is visually primary. Selection changes the explicit Codex context but does not silently replace the active Codex conversation.

## Version-one acceptance

The first useful version lets a user:

1. See real Gmail messages.
2. Select and safely render one conversation.
3. Ask the installed Codex harness about it.
4. See Gmail connector activity.
5. Open a cited Gmail resource.
6. Create a draft through Codex.
7. Review and edit the draft in the middle panel.
8. Reach an explicit approval before sending.

## Current foundation

The current slice proves the service boundaries, real Codex App Server handshake, and browser experience. The mail service deliberately returns demo projections until the existing Gmail connector's list, read, MIME, attachment, and resource contracts are verified.

## Non-goals for the foundation

- Full Gmail synchronization.
- IMAP or Outlook.
- Autonomous triage or sending.
- A second agent runtime.
- A second Gmail MCP server.
- A pure SwiftUI rewrite.

