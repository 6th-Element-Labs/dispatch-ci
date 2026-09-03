# Dispatch

Dispatch puts Gmail and Codex in one focused workspace:

- messages on the left;
- the selected email or draft in the middle;
- the Codex harness on the right.

Status: foundation proof. The web client and local services run. Gmail-backed message projection is not connected yet.

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

The mail surface uses explicit demo data. The agent service uses the installed Codex App Server and can report account and connector state. Sending a chat message can consume Codex usage.

## Verify

```bash
bash scripts/dispatch_ci.sh
```

The canonical repository is private. `6th-Element-Labs/dispatch-ci` is a public, verification-only CI sandbox. Any branch pushed there becomes public.

