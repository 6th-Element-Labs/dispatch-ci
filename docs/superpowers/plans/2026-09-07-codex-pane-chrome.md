# Codex Pane Chrome Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Codex pane header, move the model picker into the prompt footer, and show Gmail plus Codex status as two dots on that same row.

**Architecture:** Presentation only in `services/web`. Status words move from visible text to `title` / `aria-label`. CSS paints green or red from `data-ready` and `data-status`. Mail and agent services do not change.

**Tech Stack:** TypeScript, Vite, Tabler 1.4, Playwright (`services/web/tests/ui.spec.ts`)

## Global Constraints

- Slice is `services/web` only. Do not change mail or agent.
- The aside keeps `aria-label="Codex"`. Visible “Codex” text is not required in the pane.
- `data-connector` is the Gmail dot. `data-agent-status` is the Codex dot. Those nodes have no visible words.
- Gmail dot: green when available, red when missing or the Gmail check fails.
- Codex dot: green for Connected, Working, Interrupted. Red for Connecting, Reconnecting, Failed, Needs attention.
- Codex wait text stays on the Codex dot. It must not overwrite the Gmail dot.
- Remove `data-context` and every “Working with …” write.
- Model picker lives in the agent footer. The menu opens upward.
- Thin progress bar sits on the prompt card only while Codex works.
- Do not claim native `Dispatch.app` proof from Playwright.

---

## File map

- Modify: `services/web/tests/ui.spec.ts` — assert titles, footer picker, no header, no context strip
- Modify: `services/web/src/main.ts` — markup, `setAgentStatus` / `setConnectorStatus`, delete context writes
- Modify: `services/web/src/styles.css` — two-row pane grid, dots, upward menu

---

### Task 1: Playwright assertions for the new chrome

**Files:**
- Modify: `services/web/tests/ui.spec.ts`
- Test: `services/web/tests/ui.spec.ts`

**Interfaces:**
- Consumes: current `[data-agent-status]`, `[data-connector]`, `[data-model-toggle]`, `[data-agent-activity]`, `[data-context]`
- Produces: failing tests that require footer dots, no pane header, no context node

- [ ] **Step 1: Write the failing assertions**

In `renders the three-panel mail surface and sanitizes provider HTML`:

```ts
await expect(page.getByRole('complementary', { name: 'Codex' })).toBeVisible()
await expect(page.getByText('GPT-5.6 Sol · Medium')).toBeVisible()
await expect(page.locator('[data-context]')).toHaveCount(0)
await expect(page.locator('.dispatch-agent > header')).toHaveCount(0)
await expect(page.locator('.dispatch-agent > footer [data-model-toggle]')).toBeVisible()
await expect(page.locator('[data-agent-status]')).toHaveAttribute('title', 'Reconnecting')
await expect(page.locator('[data-agent-status]')).toHaveAttribute('aria-label', 'Reconnecting')
```

In `shows a live Tabler activity indicator while Codex is working`:

```ts
await page.evaluate(() => {
  const status = document.querySelector('[data-agent-status]')
  if (!status) return
  status.setAttribute('data-status', 'Working')
  status.setAttribute('title', 'Working')
  status.setAttribute('aria-label', 'Working')
})
await expect(page.locator('[data-agent-activity]')).toBeVisible()
await page.evaluate(() => {
  const status = document.querySelector('[data-agent-status]')
  if (!status) return
  status.setAttribute('data-status', 'Connected')
  status.setAttribute('title', 'Connected')
  status.setAttribute('aria-label', 'Connected')
})
await expect(page.locator('[data-agent-activity]')).toBeHidden()
```

Replace every `toHaveText('Gmail available')` with:

```ts
await expect(page.locator('[data-connector]')).toHaveAttribute('title', 'Gmail available')
await expect(page.locator('[data-connector]')).toHaveAttribute('data-ready', 'true')
```

Replace `toHaveText('No Gmail connector')` with:

```ts
await expect(page.locator('[data-connector]')).toHaveAttribute('title', 'No Gmail connector')
await expect(page.locator('[data-connector]')).toHaveAttribute('data-ready', 'false')
```

Replace remaining `toHaveText('Reconnecting')` on `[data-agent-status]` with `toHaveAttribute('title', 'Reconnecting')`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/web run test:ui -- tests/ui.spec.ts -g "renders the three-panel|live Tabler activity|picks Luna Reserve|tells the user the model list"`

Expected: FAIL because `[data-context]` still exists, header still exists, and dots still show words.

- [ ] **Step 3: Commit the failing tests**

```bash
git add services/web/tests/ui.spec.ts docs/superpowers/plans/2026-09-07-codex-pane-chrome.md
git commit -m "test(web): expect Codex pane dots and footer model picker"
```

---

### Task 2: Markup, status helpers, and styles

**Files:**
- Modify: `services/web/src/main.ts` (template ~113–119, `elements`, `renderServiceStatus`, every `agentStatus` / `connector` / `context` write)
- Modify: `services/web/src/styles.css` (~149–184)

**Interfaces:**
- Consumes: Task 1 assertions
- Produces:

```ts
function setAgentStatus(status: string, label = status): void
function setConnectorStatus(label: string, ready: boolean): void
```

- [ ] **Step 1: Replace the agent pane template**

Remove the `<header class="card-header">…</header>`. Keep `aria-label="Codex"` on the aside. Put dots, model picker, and the progress bar in the prompt footer:

```html
<aside class="card rounded-0 border-0 dispatch-agent" aria-label="Codex">
  <div class="dispatch-agent-stream" data-agent-stream>…</div>
  <footer class="card-footer">
    <div class="dispatch-suggestions">…unchanged…</div>
    <div class="card card-sm dispatch-prompt">
      <div class="card-body p-2">
        <textarea class="form-control border-0 shadow-none" data-prompt aria-label="Ask Codex" placeholder="Ask Codex about this email…"></textarea>
        <div class="progress progress-sm mt-2" data-agent-activity aria-label="Codex is working" hidden>
          <div class="progress-bar progress-bar-indeterminate bg-blue"></div>
        </div>
        <div class="d-flex align-items-center justify-content-between mt-2">
          <span class="dispatch-prompt-status">
            <span class="dispatch-status-dot" data-connector data-ready="false" title="Checking connectors" aria-label="Checking connectors"></span>
            <span class="dispatch-status-dot" data-agent-status data-status="Connecting" title="Connecting" aria-label="Connecting" aria-live="polite"></span>
            <span class="dispatch-model">
              <button class="badge bg-blue-lt text-blue border-0 dispatch-model-button" type="button" data-model-toggle aria-haspopup="menu" aria-expanded="false" title="Choose the Codex model and reasoning effort">
                <span data-model-label>GPT-5.6 Sol · Medium</span>
                <i class="ti ti-chevron-down" aria-hidden="true"></i>
              </button>
              <div class="dropdown-menu dispatch-model-menu" data-model-menu role="menu" hidden>…unchanged…</div>
            </span>
          </span>
          <span>
            <button class="btn btn-icon btn-sm btn-outline-danger" type="button" data-stop aria-label="Stop" hidden>…</button>
            <button class="btn btn-icon btn-sm btn-primary" type="button" data-send aria-label="Send">…</button>
          </span>
        </div>
      </div>
    </div>
  </footer>
</aside>
```

Delete `context` from `elements`. Remove the `contextLabel` import if unused.

- [ ] **Step 2: Add status setters and paint from data attributes**

```ts
function setAgentStatus(status: string, label = status): void {
  elements.agentStatus.dataset.status = status
  elements.agentStatus.title = label
  elements.agentStatus.setAttribute('aria-label', label)
  renderServiceStatus()
}

function setConnectorStatus(label: string, ready: boolean): void {
  elements.connector.dataset.ready = ready ? 'true' : 'false'
  elements.connector.title = label
  elements.connector.setAttribute('aria-label', label)
}

function renderServiceStatus(): void {
  const status = elements.agentStatus.dataset.status ?? ''
  elements.agentActivity.hidden = status !== 'Working'
  const source = elements.mailSource.textContent?.trim() ?? ''
  elements.sync.dataset.syncState = /FAILED|Unavailable/.test(source) ? 'failed' : /^(Syncing|Refreshing)/.test(source) ? 'syncing' : /^(STALE|Partial)/.test(source) ? 'stale' : 'ready'
}
```

Observe `data-status` attribute changes so the activity test still works:

```ts
new MutationObserver(renderServiceStatus).observe(elements.agentStatus, { attributes: true, attributeFilter: ['data-status'] })
```

Replace every `elements.agentStatus.textContent = '…'` with `setAgentStatus('…')`.

Replace Gmail connector writes with `setConnectorStatus('Gmail available', true)` or `setConnectorStatus('No Gmail connector', false)`.

Move Codex wait text onto the Codex dot:

```ts
setAgentStatus('Reconnecting', 'Restarting Codex App Server')
setAgentStatus('Reconnecting', 'Waiting for Codex App Server')
setAgentStatus('Reconnecting', error instanceof Error ? error.message : String(error))
```

Do not write those strings onto `data-connector`.

Delete every `elements.context.textContent = …` line.

- [ ] **Step 3: Update CSS**

```css
.dispatch-agent { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; }
.dispatch-prompt { position: relative; }
.dispatch-prompt-status { display: inline-flex; align-items: center; gap: .45rem; min-width: 0; }
.dispatch-status-dot { width: .5rem; height: .5rem; border-radius: 50%; flex: none; background: var(--tblr-red); }
.dispatch-status-dot[data-ready="true"],
.dispatch-status-dot[data-status="Connected"],
.dispatch-status-dot[data-status="Working"],
.dispatch-status-dot[data-status="Interrupted"] { background: var(--tblr-green); }
.dispatch-model-menu { position: absolute; left: .5rem; right: .5rem; bottom: calc(100% + .25rem); top: auto; z-index: 20; min-width: 0; }
```

Remove `.dispatch-agent > header` rules and `.dispatch-context`.

- [ ] **Step 4: Run the UI tests**

Run: `npm --prefix services/web run test:ui`

Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm --prefix services/web run typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/web/src/main.ts services/web/src/styles.css
git commit -m "fix(web): drop Codex pane header and show status as dots"
```
