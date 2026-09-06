# Dispatch service architecture

Status: accepted foundation direction

## Decision

Dispatch uses small, independently runnable services. The repository is a delivery container, not a runtime monolith.

```text
Browser or Tauri WebKit
        |
        +---- dispatch-mail :8411
        |         owns message and draft projections
        |
        +---- dispatch-agent :8412
                  owns codex app-server lifecycle
                            |
                            +---- codex app-server over JSONL stdio
                                      |
                                      +---- installed apps/connectors
```

## Boundaries

### Web

`dispatch-web` owns presentation state only. It does not infer mail priority, synthesize agent results, hold credentials, spawn processes, or read provider storage.

### Mail

`dispatch-mail` owns browser-facing conversation, message, and draft view models plus the durable Gmail SQLite index. It calls the agent service's typed Gmail adapter, paginates the Inbox, Unread, Sent, Drafts, Spam, Trash, and archive-query streams for every connector account, atomically replaces each completed account snapshot, removes disconnected accounts, groups messages by account plus Gmail thread ID, and converts Gmail headers and MIME parts into safe view models. It owns All, Unread, and Read filter semantics. Demo mail is available only through the explicit development setting. Gmail writes remain guarded by Codex approvals. The six folder lists are indexed. Mail does not serve Sent, Drafts, Archive, Spam, or Trash from a one-page live fetch.

The index bootstraps one page per Gmail stream so the first usable result is bounded. A full paginated synchronization then runs in the background and every five minutes. The API exposes sync state, timestamps, indexed-message count, and exact failures. A repeated page token or pagination beyond the safety limit fails the sync instead of truncating it silently.

On macOS, the Gmail index is stored under `Library/Application Support/Dispatch`, outside the source repository and its Dropbox synchronization. `DISPATCH_MAIL_DB` can set an explicit deployment path. Opened attachments are written under `Library/Caches/Dispatch/attachments`. Mail then calls the OS default app for that file (`open` on macOS). Browser responses are paginated so the client does not render the full indexed mailbox at once.

### Agent

`dispatch-agent` is the only service that starts and communicates with Codex App Server. It exposes a small HTTP and server-sent-event adapter for account state, installed apps, threads, turns, and streamed items. It does not implement a model loop.

The agent adapter also exposes the installed Gmail draft, label, and attachment tools. `dispatch-mail` owns their application commands and projections; the browser remains presentation-only. Codex thread history, steering, and interruption map directly to App Server `thread/read`, `turn/steer`, and `turn/interrupt`.

`dispatch-agent` owns a durable map from an unbound key or `accountId` plus Gmail `threadId` to a Codex App Server thread id. The map is stored under `Library/Application Support/Dispatch/codex-bindings.json`. `DISPATCH_CODEX_BINDINGS` can set an explicit path. The browser caches that map and persists the current pane thread id. After an agent-service restart, the browser asks agent for the current key, then resumes that App Server thread before reopening the event stream. If App Server is temporarily unavailable, the browser shows `Reconnecting` and retries. It does not report a disconnected stream as connected.

## SimpleMark reuse

The foundation reuses SimpleMark's established choices rather than its product domain:

- Vite and strict TypeScript.
- WebKit-compatible HTML and CSS.
- restrained native-window visual language;
- rendered-document typography;
- explicit light and dark themes;
- sanitization before rendering provider HTML;
- thin platform composition;
- browser acceptance tests;
- private canonical repository plus public verification sandbox.

The source reference inspected for this bootstrap was SimpleMark `8a38e012089dd5b81a71a176056134d0a6d68dda`.

## Local transport

Browser development uses localhost HTTP and SSE. The macOS shell in `apps/desktop` is a Tauri 2 application that serves the built web client as `tauri://localhost` and starts `dispatch-mail` and `dispatch-agent` as sidecars with a bundled Node 22 runtime, pinned by version and SHA-256 in `apps/desktop/node-sidecar.json`. Staging copies each service's compiled output and installs its production npm dependencies from the lockfile beside it, so a service dependency added in `services/` ships in the bundle without shell changes. The shell owns no product behavior. It checks that the sidecar and compiled services exist and that ports 8411 and 8412 are free, locates the installed `codex` executable for the agent, appends each service's output to `~/Library/Logs/Dispatch`, and stops both services on quit. A service that exits is not respawned silently; the client shows the failed state and the user can choose Restart Services.

Mail and agent read `DISPATCH_ALLOWED_ORIGIN` for their CORS origin. The default is the browser dev origin `http://127.0.0.1:8410`; the shell passes `tauri://localhost`. Codex App Server remains on its supported local `stdio` transport.

## Failure behavior

- Mail failure leaves the mail panel in a visible failed state.
- Cached mail is labeled with its age while a refresh is active. A failed refresh keeps the provider error visible and never presents stale data as current.
- Missing or invalid provider fields fail normalization instead of silently becoming read, empty, or current values.
- Agent failure leaves email readable and shows Codex as unavailable.
- App Server restart does not fabricate successful turns.
- Demo mail is visibly labeled and never presented as Gmail evidence.
