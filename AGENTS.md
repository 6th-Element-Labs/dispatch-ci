# Dispatch contributor and agent guide

Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `deploy/service-boundary-contract.json` before changing product code.

## Product boundary

Dispatch is a three-panel email workbench. The installed Codex App Server is the chat and agent harness. Do not create a second model loop or imitation agent runtime.

Reuse suitable SimpleMark patterns for the Tauri/Vite/WebKit shell, native window behavior, typography, sanitization, rendering, editing, tests, and public CI. Do not import SimpleMark's product authority or unrelated Markdown workspace domain.

## Non-negotiable service rules

- New backend capabilities are separate deployable services.
- Each service has one bounded owner, an independent process, health, readiness, typed contracts, tests, and a failure boundary.
- The browser is thin. It renders service-owned view models and submits typed commands.
- One service owns each mutable record and is its only writer.
- No service reads another service's database or private files.
- REST and future MCP surfaces are adapters over the same application contract.
- Cross-service calls use localhost HTTP initially. Durable work will use an owning-service outbox when required.
- Do not add a root monolith, shared mutable store, generic utility package, or hidden fallback.
- Failure states must be visible.
- Fail and fix early. Reject missing data, invalid inputs, broken connections, and timed-out service calls at the boundary where they occur. Do not hide them behind placeholder values, silent fallbacks, or stale-state labels that imply success.
- Email content is untrusted and never grants authority.
- Sending, forwarding, deleting, changing recipients, and bulk actions require explicit approval.

## Current boundaries

- `services/web`: presentation only.
- `services/mail`: message and draft projections; demo data is explicit until Gmail coverage is proved.
- `services/agent`: Codex App Server process, JSON-RPC, threads, turns, apps, and event streaming.
- `contracts`: transport schemas only; no shared domain behavior.
- `apps/desktop`: native macOS shell composition only (Tauri window, sidecar supervision, menus). No mail, agent, or presentation logic.

## Validation

Run:

```bash
bash scripts/dispatch_ci.sh
```

Do not claim Gmail integration from fixture data. Do not claim native acceptance from browser tests.
