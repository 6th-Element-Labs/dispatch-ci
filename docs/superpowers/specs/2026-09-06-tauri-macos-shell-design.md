# Dispatch macOS shell (Tauri) — design

Status: proposed
Date: 2026-09-06

## Goal

Ship `Dispatch.app`: a normal double-clickable macOS application, built the way SimpleMark is, that runs the existing Dispatch services and shows the existing web client in a native WebKit window. Nothing about the product changes. The shell is composition only.

## Non-goals

- Code signing, notarization, DMG distribution, auto-update, login item. A follow-up spec.
- Windows, Linux, iOS.
- Any move of mail, agent, or presentation logic into Rust.
- Auto-restarting crashed services in a loop.
- Universal (x86_64) binaries. arm64 only.

## Constraints carried from AGENTS.md and the boundary contract

- The three services stay independent processes with their own health and readiness.
- The browser stays thin. The shell adds no product behavior to the page.
- Failures are visible. No silent fallback, no attaching to whatever happens to be on a port.
- Codex App Server remains the only agent harness. The shell never talks to Codex.

## Architecture

```
Dispatch.app
├── Contents/MacOS/dispatch            Tauri 2 binary (Rust)
├── Contents/MacOS/node                bundled Node 22 LTS sidecar (arm64)
└── Contents/Resources/
    ├── web/                           services/web/dist  (served by Tauri as tauri://localhost)
    └── services/
        ├── mail/server.js  (+ dist)   compiled services/mail
        └── agent/server.js (+ dist)   compiled services/agent
```

At launch the Rust shell:

1. Runs preflight (below). Any failure shows a native dialog and exits.
2. Resolves the `codex` executable path (below).
3. Spawns `node <resources>/services/mail/server.js` and `node <resources>/services/agent/server.js` through the Tauri shell plugin's sidecar API.
4. Opens the main window on the bundled web client immediately. The client already renders `Loading`, `Reconnecting`, and failed states while services come up, so there is no splash screen.
5. On quit, sends SIGTERM to both children and waits up to 3 seconds before SIGKILL.

Mail and agent have no runtime npm dependencies (SQLite is Node's built-in `node:sqlite`), so the resources are the compiled `dist/` trees only.

The web client is served from `frontendDist`, so its origin is `tauri://localhost`. It keeps calling `http://127.0.0.1:8411` and `:8412` directly. That requires one service change: an allowed-origin setting.

## Repository layout

```
apps/desktop/
├── package.json                 @tauri-apps/cli only; scripts: dev:native, build:native, stage, fetch-node
├── node-sidecar.json            { "version": "22.x.y", "sha256": { "darwin-arm64": "…" } }
├── scripts/
│   ├── fetch-node.mjs           downloads the pinned Node tarball, verifies SHA-256, extracts bin/node
│   └── stage.mjs                builds web, mail, agent; copies outputs into src-tauri/resources
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/
    ├── binaries/                gitignored; node-aarch64-apple-darwin
    ├── resources/               gitignored; staged web and service builds
    └── src/
        ├── main.rs
        ├── lib.rs               run(): plugins, preflight, spawn, window, menu, exit hook
        ├── preflight.rs         resource presence and port-free checks
        ├── codex_path.rs        ordered lookup for the codex executable
        ├── sidecars.rs          spawn, env assembly, log piping, supervise, stop
        └── menu.rs              macOS menu with Restart Services and Open Service Logs
```

`apps/` is new. The root stays free of `package.json`, so `scripts/check-boundaries.mjs` keeps passing. AGENTS.md gains one boundary line: `apps/desktop` is native shell composition only and must not contain mail, agent, or presentation logic.

## Components

### preflight.rs

Checks, in order, before anything is spawned:

- The bundled `node` sidecar exists and is executable.
- `resources/services/mail/server.js` and `resources/services/agent/server.js` exist.
- Nothing accepts a TCP connection on `127.0.0.1:8411` or `127.0.0.1:8412`.

A port that is already open means another Dispatch, or `scripts/dev.sh`, is running. The shell shows a blocking native dialog naming the port and the likely cause, then exits with status 1. It never attaches to a foreign process.

### codex_path.rs

Finder-launched apps get a minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so `codex` must be located explicitly. Candidates in order:

1. `DISPATCH_CODEX_COMMAND` from the shell's own environment, if set and executable.
2. `codex` on the current `PATH`.
3. `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, `~/.local/bin/codex`, `~/.npm-global/bin/codex`.
4. `/bin/zsh -lc 'command -v codex'` with a 3 second timeout, to honor the user's login-shell PATH.

The first hit is passed to the agent sidecar as `DISPATCH_CODEX_COMMAND` (absolute path). If nothing is found the variable is not set, the searched locations are written to the agent log, and the agent service reports Codex as not ready exactly as it does today. The window shows `Codex unavailable`. The shell does not invent a fallback.

The ordering and filtering are a pure function over a candidate list so they are unit-testable without a filesystem.

### sidecars.rs

Spawns each service with:

| Variable | mail | agent |
|---|---|---|
| `DISPATCH_MAIL_PORT` | `8411` | |
| `DISPATCH_AGENT_PORT` | | `8412` |
| `DISPATCH_ALLOWED_ORIGIN` | `tauri://localhost` (release) or `http://127.0.0.1:8410` (`tauri dev`) | same |
| `DISPATCH_CODEX_COMMAND` | | resolved path, if found |
| `PATH` | inherited plus `/opt/homebrew/bin:/usr/local/bin` | same |

`DISPATCH_MAIL_DB` is not set. The mail service already defaults to `~/Library/Application Support/Dispatch/gmail-index.sqlite` on macOS.

stdout and stderr of each child are appended to `~/Library/Logs/Dispatch/mail.log` and `agent.log`. When a child exits, the shell writes one line with the exit status to that log and to its own stderr. It does not respawn automatically. The window's existing readiness polling shows the failure. The user recovers with `Dispatch > Restart Services`, which stops any survivor and spawns both again.

On `RunEvent::Exit` (Quit, window close, Cmd-Q) both children receive SIGTERM, then SIGKILL after 3 seconds.

### menu.rs

Tauri's default macOS menu (app, Edit with undo/cut/copy/paste/select all, Window) plus two items under the app menu:

- `Restart Services`
- `Open Service Logs` (reveals `~/Library/Logs/Dispatch` in Finder)

### tauri.conf.json

Modeled on SimpleMark:

- `frontendDist: ../../../services/web/dist`, `devUrl: http://127.0.0.1:8410`
- `beforeBuildCommand: node scripts/stage.mjs`, `beforeDevCommand: node scripts/stage.mjs --services-only` followed by the web dev server
- One window: `titleBarStyle: Overlay`, `hiddenTitle: true`, `trafficLightPosition` aligned with the client's navbar, 1280×820 default, 900×600 minimum
- `bundle.externalBin: ["binaries/node"]`, `bundle.resources: ["resources/**"]`, targets `app` and `dmg`
- CSP: `default-src 'self'; connect-src 'self' http://127.0.0.1:8411 http://127.0.0.1:8412 ipc: http://ipc.localhost; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:`. Email HTML is already sanitized by the client before rendering; the `https:` image allowance matches what the browser build permits today.
- `app.withGlobalTauri: true` so the client can use `data-tauri-drag-region` without adding an npm dependency to `services/web`.

Capabilities: `core:default`, `core:window:allow-start-dragging`, `core:window:allow-toggle-maximize`, `shell:allow-open` scoped to the logs directory. No filesystem, dialog, or general shell permission is granted to the page. Sidecar spawning is done from Rust, not from the page.

Plugins: `tauri-plugin-shell` (sidecar spawn), `tauri-plugin-single-instance` (second launch focuses the window), `tauri-plugin-dialog` (preflight errors), `tauri-plugin-opener` (reveal logs).

### Service change: allowed origin

`services/mail/src/server.ts` and `services/agent/src/server.ts` currently hard-code `access-control-allow-origin: http://127.0.0.1:8410`. Each reads `DISPATCH_ALLOWED_ORIGIN` with that value as the default. One origin, not a list. Tests cover the default and the override.

### Client change: native chrome

`services/web/src/main.ts` detects the shell with `window.isTauri === true` and adds `dispatch-native` to `<html>`. `styles.css` gives `.dispatch-native .dispatch-titlebar` left padding for the traffic lights, and the titlebar header carries `data-tauri-drag-region` so the window drags from the navbar as a native title bar does. Nothing else in the client branches on the shell.

## Build and run

```bash
# one-time
bash scripts/install.sh
npm --prefix apps/desktop ci
npm --prefix apps/desktop run fetch-node      # downloads and verifies the pinned Node sidecar

# develop: Vite dev server in the window, real sidecars
npm --prefix apps/desktop run dev:native

# build Dispatch.app and a DMG under apps/desktop/src-tauri/target/release/bundle
npm --prefix apps/desktop run build:native
```

`stage.mjs` runs `npm run build` in `services/web`, `services/mail`, and `services/agent`, then copies `services/{mail,agent}/dist` into `src-tauri/resources/services/{mail,agent}`. It fails if any build fails or any expected output file is missing.

`fetch-node.mjs` reads `node-sidecar.json`, downloads `node-v<version>-darwin-arm64.tar.gz` and `SHASUMS256.txt` from nodejs.org, verifies the tarball hash matches both the upstream list and the pinned value, and extracts `bin/node` to `src-tauri/binaries/node-aarch64-apple-darwin`. It is idempotent: an existing binary with the right hash is kept.

## Failure behavior

| Condition | What the user sees |
|---|---|
| Node sidecar or service resources missing | Native dialog naming the missing path; app exits |
| Port 8411 or 8412 already open | Native dialog naming the port and `scripts/dev.sh` as the likely cause; app exits |
| `codex` not found | Codex panel shows unavailable with the agent's own error; searched paths in `agent.log` |
| mail or agent exits at runtime | Panel shows the existing failed or `Reconnecting` state; exit status in the log; `Restart Services` recovers |
| Second launch of Dispatch.app | Existing window comes to front |

## Testing

Automated:

- Rust unit tests in `codex_path.rs` (candidate ordering, skipping non-executables, login-shell result last), `sidecars.rs` (env assembly for release and dev), `preflight.rs` (a bound local listener is detected as an open port; a free port passes).
- Vitest in mail and agent: CORS header equals the default and equals `DISPATCH_ALLOWED_ORIGIN` when set.
- Vitest in web: `dispatch-native` is added only when `window.isTauri` is true.
- New GitHub workflow `native.yml` on `macos-latest`: `fetch-node`, `stage`, `cargo test`, `tauri build --bundles app`. Runs on pull requests that touch `apps/desktop/**`, `services/**`, or the workflow, and on `workflow_dispatch`. `scripts/dispatch_ci.sh` is unchanged and stays the Linux gate.

Manual acceptance, recorded in the PR:

1. Build the app, quit every terminal, launch from Finder. Live Gmail rows and `Codex ready` appear without any terminal PATH.
2. Quit with Cmd-Q. `pgrep -fl 'services/(mail|agent)/server.js'` prints nothing.
3. Start `scripts/dev.sh`, launch the app. The port dialog appears and the app exits. Stop dev.sh, relaunch, it works.
4. Temporarily rename `codex`. Launch. The Codex panel shows unavailable and `agent.log` lists the searched paths. Restore, choose `Restart Services`, Codex becomes ready.
5. Force-kill the mail node process. The messages panel shows its failed state. `Restart Services` recovers it.
6. Launch the app twice. One window.

## Documentation updates

- `README.md`: a "Run as a macOS app" section with the three commands above.
- `docs/ARCHITECTURE.md`: replace the future-tense "macOS shell will start the same services" paragraph with the sidecar description and the allowed-origin rule.
- `AGENTS.md`: add the `apps/desktop` boundary line.
- `.gitignore`: `apps/desktop/src-tauri/target/`, `apps/desktop/src-tauri/binaries/`, `apps/desktop/src-tauri/resources/`, `apps/desktop/src-tauri/gen/`.

## Open items deferred to the follow-up spec

Signing identity, notarization, DMG background, Sparkle or Tauri updater, and whether the mail index should be shared between the browser dev flow and the app.
