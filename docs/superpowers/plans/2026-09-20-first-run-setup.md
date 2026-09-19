# First-run setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional three-step setup overlay that tells a new user to install Codex, sign in to ChatGPT, and connect Gmail, without probing those systems.

**Architecture:** Presentation stays in `services/web`. Storage helpers and pinned URLs live in `setup-guide.ts`. `main.ts` draws an accessible overlay and a footer Setup control. The existing web-link adapter routes the Gmail scheme through the trusted native command. Mail and agent do not change. The desktop command accepts only the pinned Gmail custom URL.

**Tech Stack:** TypeScript, Vite, Tabler 1.4, Vitest (`services/web/src`), Playwright (`services/web/tests`)

## Global Constraints

- Do not change mail or agent. In `apps/desktop`, change only the existing trusted web-link adapter needed for the pinned Gmail URL.
- Do not read `/v1/account`, `/v1/apps`, or Gmail inventory to decide whether to show the overlay.
- Do not start ChatGPT login. Do not call `account/login/start` or `plugin/install`.
- Do not enable demo mail. Setup never sets `DISPATCH_DEMO_MAIL`.
- Overlay key is `dispatch.setup.seen`. Value `'1'` means seen.
- Install URL is `https://developers.openai.com/codex/cli`.
- Gmail URL is `codex://plugins/gmail@openai-curated`.
- Continue always hides the overlay. Setup never reports that Codex or Gmail is connected.
- Do not claim native `Dispatch.app` proof from Playwright.

---

## File map

- Create: `services/web/src/setup-guide.ts` — seen-flag helpers and pinned step copy
- Create: `services/web/src/setup-guide.test.ts` — Vitest for helpers and step URLs
- Create: `services/web/tests/setup-guide.spec.ts` — first-visit Playwright (no seen flag)
- Modify: `services/web/tests/ui.spec.ts` — set the seen flag so existing tests keep the workbench
- Modify: `services/web/src/main.ts` — overlay markup, footer Setup, wire hide/show
- Modify: `services/web/src/styles.css` — full-viewport overlay
- Modify: `README.md` — First run section with the same three steps
- Modify: `services/web/src/web-links.ts` — route `codex:` through the trusted native command
- Modify: `apps/desktop/src-tauri/src/web_links.rs` — allow only the pinned Gmail custom URL

---

### Task 1: Setup guide helpers

**Files:**
- Create: `services/web/src/setup-guide.ts`
- Test: `services/web/src/setup-guide.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export const SETUP_SEEN_KEY = 'dispatch.setup.seen'
export const SETUP_INSTALL_URL = 'https://developers.openai.com/codex/cli'
export const SETUP_GMAIL_URL = 'codex://plugins/gmail@openai-curated'
export const SETUP_STEPS: readonly SetupStep[]
export function setupSeen(storage: Pick<Storage, 'getItem'>): boolean
export function markSetupSeen(storage: Pick<Storage, 'setItem'>): void
```

- [ ] **Step 1: Write the failing unit tests**

Create `services/web/src/setup-guide.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { markSetupSeen, SETUP_GMAIL_URL, SETUP_INSTALL_URL, SETUP_SEEN_KEY, SETUP_STEPS, setupSeen } from './setup-guide.js'

function memoryStorage(start: Record<string, string> = {}): Storage {
  const data = { ...start }
  return {
    get length() { return Object.keys(data).length },
    clear() { for (const key of Object.keys(data)) delete data[key] },
    getItem(key: string) { return Object.hasOwn(data, key) ? data[key]! : null },
    key(index: number) { return Object.keys(data)[index] ?? null },
    removeItem(key: string) { delete data[key] },
    setItem(key: string, value: string) { data[key] = value },
  }
}

describe('setup guide', () => {
  it('treats a missing flag as not seen', () => {
    expect(setupSeen(memoryStorage())).toBe(false)
  })

  it('writes dispatch.setup.seen=1 and then reports seen', () => {
    const storage = memoryStorage()
    markSetupSeen(storage)
    expect(storage.getItem(SETUP_SEEN_KEY)).toBe('1')
    expect(setupSeen(storage)).toBe(true)
  })

  it('treats blocked storage as not seen and does not throw', () => {
    const blocked = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }
    expect(setupSeen(blocked)).toBe(false)
    expect(() => markSetupSeen(blocked)).not.toThrow()
  })

  it('pins the three static steps and official URLs', () => {
    expect(SETUP_STEPS.map((step) => step.title)).toEqual(['Install Codex', 'Sign in to ChatGPT', 'Connect Gmail'])
    expect(SETUP_INSTALL_URL).toBe('https://developers.openai.com/codex/cli')
    expect(SETUP_GMAIL_URL).toBe('codex://plugins/gmail@openai-curated')
    expect(SETUP_STEPS[0]?.href).toBe(SETUP_INSTALL_URL)
    expect(SETUP_STEPS[2]?.href).toBe(SETUP_GMAIL_URL)
    expect(SETUP_STEPS[1]?.detail).toContain('codex login')
    expect(SETUP_STEPS[2]?.fallback).toContain('/plugins')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/web test -- src/setup-guide.test.ts`

Expected: FAIL with `Cannot find module './setup-guide.js'`

- [ ] **Step 3: Write the helpers**

Create `services/web/src/setup-guide.ts`:

```ts
export const SETUP_SEEN_KEY = 'dispatch.setup.seen'
export const SETUP_INSTALL_URL = 'https://developers.openai.com/codex/cli'
export const SETUP_GMAIL_URL = 'codex://plugins/gmail@openai-curated'

export interface SetupStep {
  readonly title: string
  readonly href?: string
  readonly action?: string
  readonly detail?: string
  readonly fallback?: string
}

export const SETUP_STEPS: readonly SetupStep[] = [
  { title: 'Install Codex', href: SETUP_INSTALL_URL, action: 'Open install guide' },
  { title: 'Sign in to ChatGPT', detail: 'Run `codex login`, or sign in in ChatGPT desktop.' },
  {
    title: 'Connect Gmail',
    href: SETUP_GMAIL_URL,
    action: 'Open Codex',
    fallback: 'Open ChatGPT desktop Plugins, or run `codex`, then /plugins, then connect Google.',
  },
]

export function setupSeen(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(SETUP_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markSetupSeen(storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(SETUP_SEEN_KEY, '1')
  } catch {
    return
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --prefix services/web test -- src/setup-guide.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/web/src/setup-guide.ts services/web/src/setup-guide.test.ts docs/superpowers/specs/2026-09-20-first-run-setup-design.md docs/superpowers/plans/2026-09-20-first-run-setup.md
git commit -m "$(cat <<'EOF'
test(web): add first-run setup helpers

Pin the optional setup steps and localStorage flag before wiring the overlay.
EOF
)"
```

---

### Task 2: Playwright first-run coverage

**Files:**
- Modify: `services/web/tests/ui.spec.ts` (the existing `test.beforeEach` at line 39)
- Create: `services/web/tests/setup-guide.spec.ts`

**Interfaces:**
- Consumes: `SETUP_SEEN_KEY`, `SETUP_INSTALL_URL`, `SETUP_GMAIL_URL` from Task 1 (`dispatch.setup.seen`, the two URLs)
- Produces: existing UI tests keep a seen flag; a new spec requires `[data-setup]`, Continue, and footer Setup

- [ ] **Step 1: Keep existing UI tests on the workbench**

In `services/web/tests/ui.spec.ts`, add this as the first line of `test.beforeEach` (before the routes):

```ts
await page.addInitScript(() => { localStorage.setItem('dispatch.setup.seen', '1') })
```

- [ ] **Step 2: Write the failing first-visit spec**

Create `services/web/tests/setup-guide.spec.ts`. Do not set the seen flag:

```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8411/v1/accounts', (route) => route.fulfill({ json: { accounts: [] } }))
  await page.route('http://127.0.0.1:8411/v1/sync/status', (route) => route.fulfill({
    json: { sync: { state: 'ready', startedAt: '2026-09-04T09:00:00+12:00', completedAt: '2026-09-04T09:01:00+12:00', error: null, messageCount: 0 } },
  }))
  await page.route(/http:\/\/127\.0\.0\.1:8411\/v1\/conversations\?state=/, (route) => route.fulfill({ json: { source: 'gmail', conversations: [] } }))
  await page.route('http://127.0.0.1:8412/ready', (route) => route.fulfill({ status: 503, json: { status: 'not_ready' } }))
  await page.route('http://127.0.0.1:8412/v1/apps', (route) => route.fulfill({ json: { data: [] } }))
})

test('shows the first-run setup overlay until Continue', async ({ page }) => {
  await page.goto('/')
  const setup = page.locator('[data-setup]')
  await expect(setup).toBeVisible()
  await expect(setup.getByRole('heading', { name: 'Set up Dispatch' })).toBeVisible()
  await expect(setup.getByRole('link', { name: 'Open install guide' })).toHaveAttribute('href', 'https://developers.openai.com/codex/cli')
  await expect(setup.getByText('codex login')).toBeVisible()
  await expect(setup.getByRole('link', { name: 'Open Codex' })).toHaveAttribute('href', 'codex://plugins/gmail@openai-curated')
  await expect(setup.getByText('/plugins')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await page.locator('[data-setup-continue]').click()
  await expect(setup).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await page.locator('[data-setup-open]').click()
  await expect(setup).toBeVisible()
  await page.locator('[data-setup-continue]').click()
  await page.reload()
  await expect(page.locator('[data-setup]')).toBeHidden()
})
```

- [ ] **Step 3: Run the new spec and confirm it fails**

Run: `npm --prefix services/web run test:ui -- tests/setup-guide.spec.ts`

Expected: FAIL because `[data-setup]` is missing.

- [ ] **Step 4: Commit**

```bash
git add services/web/tests/ui.spec.ts services/web/tests/setup-guide.spec.ts
git commit -m "$(cat <<'EOF'
test(web): expect first-run setup overlay

Cover the optional wizard on a fresh visit and keep existing UI tests on the workbench.
EOF
)"
```

---

### Task 3: Overlay, footer Setup, and README

**Files:**
- Modify: `services/web/src/main.ts` (import, template, `elements`, listeners after `const elements`)
- Modify: `services/web/src/styles.css` (append overlay rules)
- Modify: `README.md` (First run section after the product intro, before `## Services`)

**Interfaces:**
- Consumes: `markSetupSeen`, `setupSeen`, `SETUP_GMAIL_URL`, `SETUP_INSTALL_URL` from `./setup-guide.js`
- Produces: `[data-setup]`, `[data-setup-continue]`, `[data-setup-open]`, `[data-setup-install]`, `[data-setup-gmail]`

- [ ] **Step 1: Import the helpers**

At the top of `services/web/src/main.ts`, add this import next to the other `./` imports:

```ts
import { markSetupSeen, SETUP_GMAIL_URL, SETUP_INSTALL_URL, setupSeen } from './setup-guide.js'
```

- [ ] **Step 2: Add overlay markup and the footer Setup control**

Inside the `app.innerHTML` template, append this overlay as the last child of `.page.dispatch-window` (after the workspace `</div>`, still inside `.page`):

```html
      <div class="dispatch-setup" data-setup hidden>
        <div class="card dispatch-setup-card">
          <div class="card-body">
            <h2 class="card-title">Set up Dispatch</h2>
            <p class="text-secondary">Dispatch uses your installed Codex CLI and the Gmail plugin inside Codex. A user who already has both can continue.</p>
            <ol class="dispatch-setup-steps">
              <li>
                <strong>Install Codex</strong>
                <a class="btn btn-sm btn-outline-primary" data-setup-install href="${SETUP_INSTALL_URL}" target="_blank" rel="noreferrer">Open install guide</a>
              </li>
              <li>
                <strong>Sign in to ChatGPT</strong>
                <p class="mb-0">Run <code>codex login</code>, or sign in in ChatGPT desktop.</p>
              </li>
              <li>
                <strong>Connect Gmail</strong>
                <a class="btn btn-sm btn-outline-primary" data-setup-gmail href="${SETUP_GMAIL_URL}">Open Codex</a>
                <p class="text-secondary small mb-0">If that link does not open, use ChatGPT desktop Plugins, or run <code>codex</code>, then <code>/plugins</code>, then connect Google.</p>
              </li>
            </ol>
            <button class="btn btn-primary" type="button" data-setup-continue>Continue</button>
          </div>
        </div>
      </div>
```

Because `app.innerHTML` is a template literal, write the two `href` values with `${SETUP_INSTALL_URL}` and `${SETUP_GMAIL_URL}` so they stay pinned to the helper module.

In the prompt footer status cluster (the `<span class="dispatch-prompt-status">` that already holds the two dots and the model picker), add this button immediately after the Codex status dot and before `.dispatch-model`:

```html
<button class="btn btn-sm btn-ghost-secondary" type="button" data-setup-open>Setup</button>
```

- [ ] **Step 3: Wire show and hide**

Add these keys to the `elements` object:

```ts
  setup: app.querySelector<HTMLElement>('[data-setup]')!,
  setupContinue: app.querySelector<HTMLButtonElement>('[data-setup-continue]')!,
  setupOpen: app.querySelector<HTMLButtonElement>('[data-setup-open]')!,
```

Add these functions and listeners next to the other `elements.*` listeners (near `renderModelPicker`):

```ts
function hideSetup(): void {
  markSetupSeen(localStorage)
  elements.setup.hidden = true
}

function showSetup(): void {
  elements.setup.hidden = false
}

elements.setup.hidden = setupSeen(localStorage)
elements.setupContinue.addEventListener('click', hideSetup)
elements.setupOpen.addEventListener('click', showSetup)
```

Do not read agent or mail APIs in these functions.

- [ ] **Step 4: Add overlay styles**

Append to `services/web/src/styles.css`:

```css
.dispatch-setup {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--tblr-bg-surface-secondary) 88%, transparent);
}
.dispatch-setup-card { width: min(36rem, 100%); }
.dispatch-setup-steps { display: grid; gap: 1rem; padding-left: 1.2rem; margin: 1rem 0 1.25rem; }
.dispatch-setup-steps li { display: grid; gap: .35rem; }
```

`[hidden] { display: none !important; }` already exists at the top of this file, so a hidden overlay stays gone.

- [ ] **Step 5: Add the README First run section**

In `README.md`, insert this section after the status paragraph and before `## Services`:

```markdown
## First run

Dispatch does not own Gmail or ChatGPT login. On first launch it shows three steps. Continue always works. A user who already has Codex and a linked Gmail plugin can continue immediately.

1. Install the Codex CLI from https://developers.openai.com/codex/cli
2. Sign in to ChatGPT with `codex login`, or in ChatGPT desktop.
3. Connect Gmail in Codex (`codex://plugins/gmail@openai-curated`, or run `codex` and `/plugins`).

Open Setup in the Codex prompt footer to see the same steps again.
```

- [ ] **Step 6: Run unit, browser, and typecheck**

Run:

```bash
npm --prefix services/web test -- src/setup-guide.test.ts
npm --prefix services/web run typecheck
npm --prefix services/web run test:ui -- tests/setup-guide.spec.ts tests/ui.spec.ts -g "renders the three-panel|shows the first-run"
```

Expected: PASS. The first-run spec shows the overlay, Continue hides it, Setup opens it, reload stays hidden. The three-panel spec still reaches Inbox because `ui.spec.ts` sets the seen flag.

- [ ] **Step 7: Commit**

```bash
git add services/web/src/main.ts services/web/src/styles.css README.md
git commit -m "$(cat <<'EOF'
feat(web): show optional first-run Codex setup

Add a static three-step overlay so new users can find Codex and Gmail without Dispatch owning login.
EOF
)"
```
