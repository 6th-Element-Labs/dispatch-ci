# Tauri macOS Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `Dispatch.app`, a double-clickable Tauri 2 macOS app that runs the mail and agent services as bundled-Node sidecars and shows the built web client.

**Architecture:** A new `apps/desktop` Tauri project serves `services/web/dist` as `tauri://localhost`, spawns `node services/mail/server.js` and `node services/agent/server.js` from its resources with a bundled Node 22 sidecar, and pipes their output to `~/Library/Logs/Dispatch`. Mail and agent gain a `DISPATCH_ALLOWED_ORIGIN` setting; the web client adds native chrome when `window.isTauri` is true. Spec: `docs/superpowers/specs/2026-09-06-tauri-macos-shell-design.md`.

**Tech Stack:** Tauri 2 (Rust 1.97), tauri-plugin-shell, tauri-plugin-single-instance, tauri-plugin-dialog, tauri-plugin-opener, libc; Node 22.23.2 darwin-arm64 sidecar; Vitest; cargo test.

## Global Constraints

- Root of the repo must not gain `package.json`, `app.ts`, or `server.ts` (`scripts/check-boundaries.mjs`).
- Services stay independent processes; the shell adds no product logic.
- No silent fallback: port conflicts and missing resources exit with a native dialog; missing `codex` surfaces through the agent's own readiness error.
- Node sidecar pinned: version `22.23.2`, sha256 `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6` for `darwin-arm64`.
- Ports fixed: mail `8411`, agent `8412`. Default CORS origin stays `http://127.0.0.1:8410`. Release shell origin `tauri://localhost`.
- Commit after each task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Allowed-origin setting in mail and agent

**Files:**
- Modify: `services/mail/src/server.ts:9-17`
- Modify: `services/agent/src/server.ts:17-24`
- Test: `services/mail/tests/server.test.ts`, `services/agent/tests/server.test.ts`

**Interfaces:**
- Produces: env var `DISPATCH_ALLOWED_ORIGIN` read once at module load in both services; default `http://127.0.0.1:8410`.

- [ ] **Step 1: Write failing tests**

Mail, append inside `describe('dispatch-mail')`:
```ts
  it('allows the browser origin by default and honors DISPATCH_ALLOWED_ORIGIN', async () => {
    const base = await start()
    const defaultOrigin = (await fetch(`${base}/health`)).headers.get('access-control-allow-origin')
    expect(defaultOrigin).toBe('http://127.0.0.1:8410')
    vi.stubEnv('DISPATCH_ALLOWED_ORIGIN', 'tauri://localhost')
    vi.resetModules()
    const { createMailServer: fresh } = await import('../src/server.js')
    const server = fresh({ accounts: async () => [], listMessages: async () => [], listUnifiedMessages: async () => [], readMessage: async () => { throw new Error('x') }, listConversations: async () => [], listUnifiedConversations: async () => [], readConversation: async () => { throw new Error('x') } }, { demoEnabled: true })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    expect((await fetch(`http://127.0.0.1:${port}/health`)).headers.get('access-control-allow-origin')).toBe('tauri://localhost')
    vi.unstubAllEnvs()
  })
```
Add `vi` to the vitest import. Agent: same shape using `createAgentServer(runtime())`.

- [ ] **Step 2: Run, expect FAIL** — `npm --prefix services/mail test`, `npm --prefix services/agent test`.

- [ ] **Step 3: Implement**

Both files: `const allowedOrigin = process.env.DISPATCH_ALLOWED_ORIGIN ?? 'http://127.0.0.1:8410'` at module top; use `allowedOrigin` in the header object.

- [ ] **Step 4: Run tests + typecheck, expect PASS.**
- [ ] **Step 5: Commit** `feat(services): configurable allowed origin for the native shell`

---

### Task 2: Web client native chrome

**Files:**
- Modify: `services/web/src/model.ts` (add `isNativeShell`), `services/web/src/main.ts:1-16`, `services/web/src/styles.css:9`
- Test: `services/web/src/model.test.ts`

**Interfaces:**
- Produces: `export function isNativeShell(win: { isTauri?: unknown }): boolean`.

- [ ] **Step 1: Failing test**
```ts
  it('detects the Tauri shell only from the isTauri flag', () => {
    expect(isNativeShell({ isTauri: true })).toBe(true)
    expect(isNativeShell({})).toBe(false)
    expect(isNativeShell({ isTauri: 'yes' })).toBe(false)
  })
```
- [ ] **Step 2: Run** `npm --prefix services/web test` — FAIL.
- [ ] **Step 3: Implement**

model.ts: `export function isNativeShell(win: { isTauri?: unknown }): boolean { return win.isTauri === true }`

main.ts after `const app`: `if (isNativeShell(window as { isTauri?: unknown })) document.documentElement.classList.add('dispatch-native')`; add `data-tauri-drag-region` to the `<header class="navbar ... dispatch-titlebar">` element.

styles.css: `.dispatch-native .dispatch-titlebar .container-fluid { padding-left: 84px; }` and `.dispatch-native .dispatch-titlebar { -webkit-user-select: none; }`.

- [ ] **Step 4: Test + typecheck + `npm --prefix services/web run build`.**
- [ ] **Step 5: Commit** `feat(web): native shell chrome`

---

### Task 3: apps/desktop scaffold, Node fetch, and staging

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/node-sidecar.json`, `apps/desktop/scripts/fetch-node.mjs`, `apps/desktop/scripts/stage.mjs`, `apps/desktop/scripts/make-icon.mjs`, `apps/desktop/.gitignore`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `src-tauri/binaries/node-aarch64-apple-darwin`, `src-tauri/resources/services/{mail,agent}/**` (Tauri maps `resources/services/` → `services/`).

- [ ] **Step 1:** package.json
```json
{
  "name": "dispatch-desktop", "private": true, "type": "module",
  "engines": {"node": ">=22"},
  "scripts": {
    "fetch-node": "node scripts/fetch-node.mjs",
    "stage": "node scripts/stage.mjs",
    "icon": "node scripts/make-icon.mjs && tauri icon icon-source.png",
    "dev:native": "tauri dev",
    "build:native": "tauri build",
    "test:native": "cargo test --manifest-path src-tauri/Cargo.toml"
  },
  "devDependencies": {"@tauri-apps/cli": "^2.11.4"}
}
```
node-sidecar.json: `{ "version": "22.23.2", "sha256": { "darwin-arm64": "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6" } }`.

- [ ] **Step 2:** fetch-node.mjs: read pin; target `src-tauri/binaries/node-aarch64-apple-darwin`; if it exists and `sha256(file)` equals a cached `.sha256` sidecar file matching the tarball pin, exit 0; else download tarball + `SHASUMS256.txt` from `https://nodejs.org/dist/v<ver>/`, verify the tarball hash equals both the pin and the upstream list line, `tar -xzf` into a temp dir, copy `bin/node`, chmod 755, write `.sha256`. Any mismatch: print and exit 1.
- [ ] **Step 3:** stage.mjs: run `npm --prefix ../../services/<s> run build` for web, mail, agent (skip web with `--services-only`), `rm -rf` then copy `services/mail/dist` → `src-tauri/resources/services/mail`, same for agent; assert `server.js` exists in both; exit 1 otherwise.
- [ ] **Step 4:** make-icon.mjs writes a 1024×1024 solid `#206bc4` PNG (zlib + crc32 by hand) to `icon-source.png`; `.gitignore` in apps/desktop: `node_modules/`, `icon-source.png`, `src-tauri/target/`, `src-tauri/binaries/`, `src-tauri/resources/`, `src-tauri/gen/`.
- [ ] **Step 5:** `npm --prefix apps/desktop install`, `npm --prefix apps/desktop run fetch-node`, `npm --prefix apps/desktop run stage`; verify files exist; `node scripts/check-boundaries.mjs` still passes.
- [ ] **Step 6: Commit** `build(desktop): Tauri project scaffold with Node sidecar staging`

---

### Task 4: Rust crate with unit-tested modules

**Files:**
- Create: `apps/desktop/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`, `src/preflight.rs`, `src/codex_path.rs`, `src/sidecars.rs`, `src/menu.rs`, `icons/*` (from `npm run icon`)

**Interfaces (Produces):**
- `preflight::open_ports(ports: &[u16]) -> Vec<u16>`; `preflight::missing_files(paths: &[PathBuf]) -> Vec<PathBuf>`
- `codex_path::resolve(overridden: Option<&str>, path_var: Option<&str>, home: &Path, is_executable: &dyn Fn(&Path) -> bool, login_shell: &dyn Fn() -> Option<PathBuf>) -> Resolution { pub path: Option<PathBuf>, pub searched: Vec<PathBuf> }`
- `sidecars::Service { Mail, Agent }` with `port()`, `script()` (`services/mail/server.js`), `log_name()`; `sidecars::service_env(service, codex: Option<&Path>, dev: bool, inherited_path: &str) -> Vec<(String, String)>`; `sidecars::Supervisor` managed state with `start(&AppHandle)`, `stop()`, `restart(&AppHandle)`.
- `menu::build(app) -> tauri::Result<Menu<R>>` with ids `restart-services`, `open-logs`.

- [ ] **Step 1:** Cargo.toml deps: `tauri = "2"`, `tauri-build = "2"` (build), `tauri-plugin-shell = "2"`, `tauri-plugin-single-instance = "2"`, `tauri-plugin-dialog = "2"`, `tauri-plugin-opener = "2"`, `libc = "0.2"`, `serde`, `serde_json`. build.rs: `fn main() { tauri_build::build() }`.
- [ ] **Step 2:** Write tests first in each module:
  - preflight: bind `TcpListener` on `127.0.0.1:0`, assert `open_ports(&[port])` returns it; drop, assert empty. `missing_files` on a temp path returns it.
  - codex_path: override wins when executable; PATH entries searched in order; Homebrew before `/usr/local`; login shell consulted last and only when others fail; `searched` lists every candidate tried.
  - sidecars: `service_env(Mail, None, false, "/usr/bin")` contains `DISPATCH_MAIL_PORT=8411`, `DISPATCH_ALLOWED_ORIGIN=tauri://localhost`, `PATH` starting with `/usr/bin:/opt/homebrew/bin:/usr/local/bin`, and no `DISPATCH_CODEX_COMMAND`; `service_env(Agent, Some("/x/codex"), true, ...)` has `DISPATCH_AGENT_PORT=8412`, origin `http://127.0.0.1:8410`, codex path.
- [ ] **Step 3:** `cargo test` fails to compile; implement modules; `cargo test` passes.
- [ ] **Step 4:** lib.rs `run()`: builder with single-instance (focus `main`), shell, dialog, opener; `.setup`: preflight (dialog + `std::process::exit(1)` on failure), resolve codex, `Supervisor::start`, set menu, `on_menu_event`; `.build(...).run(|app, event| if let RunEvent::ExitRequested{..} | RunEvent::Exit = event { supervisor.stop() })`.
- [ ] **Step 5:** tauri.conf.json per spec (`frontendDist: ../../../services/web/dist`, `devUrl: http://127.0.0.1:8410`, `beforeDevCommand: node scripts/stage.mjs --services-only && npm --prefix ../../services/web run dev`, `beforeBuildCommand: node scripts/stage.mjs`, window Overlay/hiddenTitle/trafficLightPosition `{x:18,y:20}`, `externalBin: ["binaries/node"]`, `resources: {"resources/services/": "services/"}`, CSP from spec, `withGlobalTauri: true`); capabilities: `core:default`, `core:window:allow-start-dragging`, `core:window:allow-toggle-maximize`.
- [ ] **Step 6:** `npm --prefix apps/desktop run icon`; `cargo test`; `npx tauri build --bundles app`; launch the `.app`; confirm live Gmail rows and Codex ready; Cmd-Q; `pgrep -fl 'services/(mail|agent)/server.js'` empty.
- [ ] **Step 7: Commit** `feat(desktop): Tauri macOS shell with supervised Node sidecars`

---

### Task 5: CI, docs, and boundary line

**Files:**
- Create: `.github/workflows/native.yml`
- Modify: `README.md`, `docs/ARCHITECTURE.md` (Local transport paragraph), `AGENTS.md` (Current boundaries)

- [ ] **Step 1:** native.yml: `on: pull_request: paths: [apps/desktop/**, services/**, .github/workflows/native.yml]`, `workflow_dispatch`; `macos-latest`; setup-node 22; `dtolnay/rust-toolchain@stable`; cache `~/.cargo` + `apps/desktop/src-tauri/target`; `npm --prefix apps/desktop ci`; for web, mail, agent `npm ci`; `npm --prefix apps/desktop run fetch-node`; `npm --prefix apps/desktop run test:native`; `npm --prefix apps/desktop run build:native -- --bundles app`.
- [ ] **Step 2:** README "Run as a macOS app" section; ARCHITECTURE sidecar paragraph + allowed-origin rule; AGENTS.md `- apps/desktop: native shell composition only; no mail, agent, or presentation logic.`
- [ ] **Step 3:** `bash scripts/dispatch_ci.sh` passes locally.
- [ ] **Step 4: Commit** `docs(desktop): document the macOS shell and add the native CI gate`; push branch; open PR.
