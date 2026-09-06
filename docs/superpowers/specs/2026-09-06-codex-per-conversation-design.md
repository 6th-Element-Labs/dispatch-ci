# Codex session per Gmail conversation

Date: 2026-09-06
Status: accepted
Slice: one Codex App Server thread per Gmail conversation, one pane that switches

## Problem

Dispatch keeps one Codex thread for the whole window. The client stores a single id in `dispatch.codex.threadId`. Selecting a conversation does not change that thread. The next prompt only appends `mailContext`. Every conversation shares one chat history.

Codex App Server already supports many threads. Dispatch never maps mail to those threads.

## Goal

Give each Gmail conversation its own Codex session. The window still has one Codex pane. Select a conversation, and that pane shows that conversation’s thread.

A new Compose with no Gmail thread id, and a state with no selection, use one shared unbound Codex thread.

## Non-goals

- Many visible Codex panes or extra Codex windows
- One Codex thread per single message inside a Gmail conversation
- A second model loop or a second agent runtime
- Mail storage of Codex thread ids
- Copying unbound history into a conversation thread after first save
- Changing Gmail sync, drafts, or send rules

## Decisions

| Choice | Value |
|---|---|
| Session key | `accountId` + Gmail `threadId` |
| Pane | One Codex pane that switches on select |
| Map owner | `dispatch-agent` is the only writer. The web client caches. |
| Create | Get or create on first select of that conversation |
| No mail key | One unbound Codex thread |
| Existing `dispatch.codex.threadId` | Becomes the unbound thread |

## Architecture

```text
Select conversation | new Compose | no selection
        |
        v
dispatch-agent  (only writer of the binding map)
        |
        +-- key: accountId + gmailThreadId
        +-- key: unbound
        |
        +-- get or create App Server thread id
        |
        v
one Codex pane: resume or start, switch event stream, restore history
```

Rules:

1. Codex App Server remains the only agent harness. Dispatch does not add a second model loop.
2. `dispatch-agent` owns the binding map. It is the only writer of those records. It persists the map in its own durable store, not in mail’s SQLite and not only in memory. A failed write is a visible error.
3. The web client caches bindings. A stale cache never wins over agent.
4. `dispatch-mail` does not store Codex thread ids and does not create bindings.
5. The window has one Codex pane. Select changes which App Server thread that pane shows.
6. A conversation key is `accountId` plus Gmail `threadId`. Missing either field is a client failure.
7. The unbound key is one sentinel. New Compose without a Gmail thread id, and no selection, use it.
8. First save of a Compose draft does not move unbound history onto the new conversation. The conversation gets its own thread on first select after it has a Gmail thread id.
9. The stored `dispatch.codex.threadId` becomes the unbound thread so current chat is not dropped.

## Data flow

1. **Client start.** The client asks agent for the unbound binding. Agent resumes that thread, or starts it and stores the unbound key. The pane shows that history. The client caches the unbound id.
2. **Select a conversation.** The client sends `accountId` and Gmail `threadId`. Agent returns the binding. If none exists, agent starts an App Server thread and writes the map. The client caches that pair, switches the current thread id, closes the old event stream, opens the new stream, and reads history into the pane.
3. **Send.** The prompt goes to the current thread only. The turn still includes `mailContext` for the selected conversation. Codex tools do not switch bindings.
4. **New Compose with no Gmail thread id.** The client asks for the unbound binding and shows that thread.
5. **Reload.** Agent is the source. The client may use the cache to paint faster, then it confirms with agent. A cache miss or a failed resume is a visible error. The client does not reuse another conversation’s thread.
6. **Agent restart.** The client reconnects, then asks agent again for the binding of the current key. App Server resume stays on the existing resume path.

Agent adds one get-or-create command for a binding key. Resume, read, turn, steer, interrupt, and the event stream stay as they are. No mail route.

## In-flight turns

Switching conversations does not interrupt an active turn on the hidden thread. That thread may keep work. The pane follows the selected conversation. Live tokens from the hidden thread are not shown. When the user returns, the client reads that thread again. An error from the hidden thread is shown only in that conversation’s pane.

## Failure handling

- Missing `accountId` or Gmail `threadId` on a conversation select fails at the client. The pane does not open a random thread.
- Agent get-or-create timeout or error stays visible. The pane shows `Reconnecting` or the exact error. The client does not silently keep the previous conversation’s chat and label it as the new one.
- Resume fail for a stored binding fails in the open. Agent does not point that key at a different conversation’s thread. A later get-or-create for that same key may start a new thread only after the old id is proven dead. That replacement is visible.
- If the client cache and agent disagree, the client takes agent and replaces the cache.
- Mail failure does not create or rewrite Codex bindings.
- An in-flight failure on a hidden thread is not shown as the current pane’s error.

## Tests

- Agent: first select of a conversation starts one thread and stores the binding. Second select of the same key returns the same id and does not call `thread/start` again.
- Agent: two conversations get two ids.
- Agent: unbound key is stable and is not a conversation key.
- Agent: resume fail does not rebind to another conversation’s id.
- Web: select conversation A, then B. The event stream and history belong to B. A prompt goes to B.
- Web: reload uses agent, not a stale cache, when they disagree.
- Web: new Compose with no Gmail thread id uses the unbound thread.
- Do not claim native acceptance from browser tests.

## Out of scope later work

- A control to start a second Codex thread on the same conversation.
- Opening a second Codex window.
- Syncing bindings across machines.
