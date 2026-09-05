# Dispatch

Dispatch puts every connected Gmail account and Codex in one focused workspace:

- messages on the left;
- the selected email or draft in the middle;
- the Codex harness on the right.

The account queue is unified by default. Gmail messages are grouped into conversations with All, Unread, and Read views. The middle panel renders the complete thread and collapses repeated quoted history. Every email location shows both date and time. The messages, email, and Codex panels are independently visible and the outer panels are resizable.

Status: working Gmail-only foundation. The web client and local services run, the installed Codex harness connects, and Gmail messages synchronize through the existing connector into a mail-service-owned SQLite index. Gmail writes remain guarded by the Codex approval flow.

## Services

| Service | Port | Owns |
|---|---:|---|
| `dispatch-web` | 8410 | Static browser client and presentation state |
| `dispatch-mail` | 8411 | Message projections and draft state |
| `dispatch-agent` | 8412 | Codex App Server lifecycle and streamed agent events |

These are independent processes. They communicate through typed HTTP and event contracts. No service reads another service's storage.

## Run

Requires Node 22 or newer and an installed `codex` CLI.

```bash
bash scripts/install.sh
bash scripts/dev.sh
```

Open `http://127.0.0.1:8410`.

The mail surface uses the connector-selected Gmail account when available and labels fixture data as demo mail otherwise. The agent service uses the installed Codex App Server. Sending a chat message can consume Codex usage. Gmail write actions are not enabled yet.

## Run as a macOS app

`apps/desktop` wraps the same services in a Tauri window. The app bundles its own Node runtime and starts `dispatch-mail` and `dispatch-agent` as sidecars; it still needs an installed `codex` CLI.

```bash
npm --prefix apps/desktop ci
npm --prefix apps/desktop run fetch-node
npm --prefix apps/desktop run build:native
```

`build:native` stages the services itself. To run the Rust unit tests alone, run `npm --prefix apps/desktop run stage` first; Tauri's build script requires the staged resources to exist.

The bundle lands under `apps/desktop/src-tauri/target/release/bundle`. Service output goes to `~/Library/Logs/Dispatch`. If port 8411 or 8412 is already in use, for example by `scripts/dev.sh`, the app reports the conflict and exits instead of attaching to it. `npm --prefix apps/desktop run dev:native` runs the window against the Vite dev server with real sidecars.

## Verify

```bash
bash scripts/dispatch_ci.sh
```

The canonical repository is private. `6th-Element-Labs/dispatch-ci` is a public, verification-only CI sandbox. Any branch pushed there becomes public.
