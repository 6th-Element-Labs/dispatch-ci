# Optional incremental Gmail sync

Dispatch keeps the installed Codex App Server and Gmail connector. A mail-owned,
read-only Google REST adapter can optionally synchronize mailbox metadata with
Gmail history. Drafts, sending, full conversation reads, attachments and Codex
tools keep the existing application contracts and connector paths.

## Existing installations

- Without a Dispatch OAuth client configuration or an account authorization,
  the existing connector synchronization remains active. No Google setup is
  required to keep using Dispatch.
- An account becomes eligible for direct history sync only after its own Google
  sign-in succeeds and its Gmail profile matches the selected connector account.
- Other accounts remain on connector sync. No user authorization is included in
  an app build, repository, CI job, or browser response.
- Mail activity → Gmail sync shows connection state. **Use existing connection**
  explicitly returns that account to connector sync. This preference persists
  across restart; cached mail, drafts and history checkpoints remain intact.
- A revoked direct grant remains a visible failure until the user reconnects or
  explicitly selects the existing connection. It is never silently substituted.

## Synchronization and recovery

The first authorized pass captures `profile.historyId` before enumerating all
message IDs, including Spam and Trash. It hydrates message metadata with at most
four reads at once. A complete baseline and its initial history checkpoint commit
in one SQLite transaction; then history catches changes made during enumeration.

Subsequent refresh, wake, startup and six-hour passes use unfiltered
`history.list(startHistoryId)` across all folders. Changed IDs are deduplicated;
the current message determines final labels, and an exact message 404 confirms
permanent deletion. The terminal history ID is stored as a decimal string, never
a JavaScript number. All pages and changed messages must succeed before rows,
deletions and the new checkpoint commit together. Pending local label/read
commands keep their existing overlays. Confirmed permanent deletions remove only
those IDs from queued label commands.

An expired history checkpoint (history endpoint 404) triggers a new full baseline.
Failed enumeration, repeated page tokens, the page safety limit, malformed data,
storage failure and cancellation keep the prior rows and checkpoint. Each pass
is bounded; an initial baseline can take longer than an ordinary history check.
OAuth expiry renews one shared token request. A rejected GET retries once after
renewal. Gmail rate limits persist through the mail owner's existing account
backoff. A failed account cannot prevent another account from committing changes.

For accounts already authorized directly, connector account discovery runs
independently of history polling. A Codex restart therefore need not delay their
mailbox updates. The app still needs its connector for the separate operations
listed above. This does not download while macOS is fully asleep; wake and network
recovery trigger synchronization.

## One Dispatch registration; individual user consent

Distribution should use one Google Desktop OAuth client registered for Dispatch,
with Dispatch branding and the Gmail API enabled. Users should not have to create
their own Cloud project. Each user separately grants
`https://www.googleapis.com/auth/gmail.readonly` to their own accounts.

Before distributing an enabled registration, complete Google's applicable
production and restricted-scope verification requirements. Do not ship an external
consent app in Testing as the normal client connection: Google documents seven-day
refresh-token expiry for that mode with Gmail scopes. A development registration
and fixture tests do not prove production authorization or live sync performance.
Do not reuse another product's OAuth client or alter its consent configuration.

For local development, put the downloaded Google **Desktop** client JSON at
`~/Library/Application Support/Dispatch/gmail-sync.json` (mode 0600) and restart
the mail service when idle. This file identifies the application; it is not a user's
Gmail token. An explicit `DISPATCH_GMAIL_OAUTH_CONFIG` path or
`DISPATCH_GMAIL_OAUTH_CLIENT_ID` / `DISPATCH_GMAIL_OAUTH_CLIENT_SECRET` can configure
a service process. Invalid configuration is visible in Gmail sync settings and
cannot disable the existing connector path.

Sign-in uses the external browser, S256 PKCE, a random state, and a temporary
127.0.0.1 callback. Token exchange and Gmail requests reject redirects. Tokens
remain in the mail service and macOS Keychain. The keychain writer uses stdin so
tokens do not appear in process arguments. Expired or revoked grants preserve
mail and pending drafts, with a working reconnect or connector-choice control.

## Release evidence

Public CI only: use `scripts/ci-sandbox.sh`. Verify the exact release commit.
Existing connector coverage, history pagination/restart/recovery, concurrent
account failure, OAuth renewal/identity/state, storage rollback, and settings
rollback must pass before enabling direct sync in a distributed build.

Live acceptance still requires the registered app and actual account consent:
compare new-message/label convergence after wake, off-head changes, restart,
revocation and checkpoint expiry against Gmail's actual state. Measure initial
baseline duration and steady-state provider requests; fixture tests cannot stand
in for these results.

Local verification on 2026-10-01 passed 720 checks across scripts, mail, agent,
web units and browser acceptance, plus 43 native Rust tests. One existing optional
browser screenshot test was skipped. A real macOS Keychain round-trip used only
an owned fake credential and removed that fixture afterward. These checks do not
prove a real Gmail authorization, native pilot acceptance or sync performance.

References: [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync),
[history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list),
[native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[refresh-token expiry](https://developers.google.com/identity/protocols/oauth2),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
