# First-run setup (optional three-step guide)

Date: 2026-09-20
Status: approved by Steve on 2026-09-20 (optional static wizard, no checks)
Slice: presentation in `services/web`, plus one exact custom URL in the existing desktop web-link adapter

## Problem

A new user cannot tell that Dispatch is a Codex client. Gmail login lives in Codex, not in Dispatch. The app today shows a status dot and a mail error when a gate is missing. That is not enough for a first install.

A user who already has the Codex CLI, a ChatGPT session, and a linked Gmail plugin already succeeds today. Dispatch finds that install and syncs mail. That path must stay unchanged.

## Goal

Show one optional setup screen with three static steps and links. Do not probe Codex or Gmail. Do not block the workbench. Do not add a Dispatch account.

## Decisions

- Dispatch stays a Codex client. It does not own Google OAuth and does not start ChatGPT login.
- The screen does not read `/v1/account`, app list, or Gmail inventory to decide what to show.
- Each step is an instruction plus a link. Continue always works.
- A complete Codex-plus-Gmail install opens mail after Continue with no extra Dispatch sign-in.
- Agent and mail do not change. The desktop shell keeps its existing trusted `open_web_link` command. HTTP pages open in Dispatch's controlled web window. Only the pinned Gmail `codex://` URL may pass from that command to the OS.
- Claude Code, signed packages, LICENSE, and a setup service are out of this slice.

## Screens

First visit (no `dispatch.setup.seen` in `localStorage`) shows a full-viewport overlay on top of the workbench. Mail and agent still start. The overlay does not wait for them.

Three steps, always all visible:

1. **Install Codex** — button or link opens `https://developers.openai.com/codex/cli`.
2. **Sign in to ChatGPT** — short copy: run `codex login`, or sign in in ChatGPT desktop. No Dispatch login form. No API-key field.
3. **Connect Gmail** — button opens `codex://plugins/gmail@openai-curated`. Visible fallback: open ChatGPT desktop Plugins, or run `codex`, then `/plugins`, then connect Google.

Primary action: **Continue**. It writes `dispatch.setup.seen=1` and hides the overlay. The three-panel workbench is already there. An optional close control, if present, does the same two writes. There is no second dismiss path.

A **Setup** control in the Codex prompt footer (same row as the status dots) opens the overlay again. It does not clear the seen flag. After the user hides the overlay once, a reload does not show it. The footer control remains the way back.

Already-seen visits skip the overlay and show the workbench.

## Architecture

```text
services/web
  main.ts      overlay + localStorage + footer Setup
  setup-guide.ts  pinned copy and storage
  web-links.ts  route the codex scheme through the trusted native link command
  styles.css   full-viewport overlay
  ui.spec.ts   wizard presence, Continue, reopen
apps/desktop
  web_links.rs  allow only the pinned Gmail custom URL
```

Rules:

1. No new agent or mail routes. No `GET /v1/setup`. No `account/login/start`.
2. The desktop shell still does not draw setup. Its trusted web-link command opens the install page in Dispatch and passes only the pinned Gmail custom URL to the OS.
3. Browser links use normal anchor behavior. Dispatch.app routes the same links through its existing trusted command. Agent does not spawn Codex UI.
4. Demo mail stays behind `DISPATCH_DEMO_MAIL=1`. Setup never enables it.

## Data flow

1. On load, if `localStorage.dispatch.setup.seen` is missing, show the overlay.
2. Continue (or the optional close control) writes the flag and hides the overlay.
3. Footer Setup shows the same overlay. Steps stay static.
4. Existing connector and agent probes keep driving the Gmail and Codex dots. Setup does not write those dots.

## Error handling

- Setup never reports that Codex or Gmail is connected.
- A failed link leaves the same screen. Fallback text stays visible.
- Empty or blocked `localStorage` shows the overlay again.
- After Continue, a missing `codex` binary, a logged-out ChatGPT session, and “No Gmail connector” stay visible on the workbench as they do today.
- The setup overlay is a modal dialog. It isolates the workbench, moves focus to its heading, restores focus when closed, and scrolls on short or zoomed viewports.

## Testing

Web unit tests:

- Missing seen flag shows the three steps and Continue.
- Continue writes `dispatch.setup.seen` and hides the overlay.
- Footer Setup shows the overlay again.

Browser tests in `services/web/tests/ui.spec.ts`:

- First visit shows the wizard and Continue.
- After Continue, the three panels are visible.
- Do not assert that Gmail or Codex is connected.
- Do not claim native-shell acceptance.

No new agent or mail tests.

## Docs

Add a short “First run” section to the root `README.md` with the same three steps and the same two URLs. Do not claim Gmail integration from fixture data.

## Non-goals

- Driving ChatGPT login through App Server
- Detecting the next missing gate
- `plugin/install` or Google OAuth in Dispatch
- API-key login UI
- Skip-into-empty-mail as a separate control (Continue already leaves setup)
- Windows, Linux, Claude Code, notarization
