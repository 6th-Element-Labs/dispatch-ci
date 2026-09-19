# Appearance (light and dark) design

Date: 2026-09-20. Status: implemented in the same change.

## Goal

Dispatch follows the macOS appearance by default and lets the user pin Light or Dark. Today the root is hard-coded to `data-bs-theme="light"`.

## Design

- `services/web/src/theme.ts` owns the preference: `system` (default), `light`, `dark`. It resolves the theme from `prefers-color-scheme` when the preference is `system`, sets `data-bs-theme` and `color-scheme` on the root element, and re-applies on OS changes. Explicit choices persist in `localStorage` under `dispatch.ui.theme`; choosing System removes the key. The module takes its root, storage and media query as parameters so it is unit-tested without a DOM.
- Tabler switches every `--tblr-*` token on `data-bs-theme`, and the existing stylesheets already use those tokens, so no per-component dark rules are needed.
- The control lives in the existing toolbar menu beside the sidebar toggle, now labelled "Sidebar and appearance", as a second radio group (System, Light, Dark) under an Appearance header. Arrow keys move across both groups.
- HTML mail carries its own colours, often dark text with no background. In dark mode the sanitised-HTML body keeps a light paper surface (`color-scheme: light`) so provider mail stays readable. Plain-text mail follows the theme.
- Browser-local preference, like density and sidebar style. The separate web-link window already uses `light-dark()` and keeps following the OS.

## Out of scope

Native menu item for appearance, per-message "show in dark" toggle, and Codex-side theme hints.

## Tests

- `theme.test.ts`: defaults, invalid stored values, OS change tracking only under System, persistence, throwing storage, dispose.
- `tests/ui.spec.ts`: OS dark applies by default, explicit Light survives reload and is shown checked, returning to System follows a live OS change.

## Amendment (2026-09-20, evening)

Steve found the first dark build weird: Tabler's navy-tinted greys, a white message card, and an invisible Offline chip, with the control hidden in the folder-rail menu.

- `services/web/src/dark.css` retunes the Tabler dark tokens to neutral greys (#141416 base, #1c1c1f panels, #242427 raised), hairline borders at 6–8% white, and the macOS blue accent #0a84ff.
- Mail follows the theme by default. `email-renderer.ts` marks a body `data-paper="true"` only when the provider HTML sets a colour (`bgcolor`, `background`, `color`, or an inline `background`/`color` style); those keep the light surface.
- The Offline / Downloaded chip uses surface and border tokens instead of `--tblr-gray-100`.
- The control moves to the native View → Appearance menu (`apps/desktop/src-tauri/src/appearance.rs`): check items for System, Light, Dark. A click is emitted to the web client as `dispatch://appearance`; the web client persists it and reports its preference through the `set_appearance` command on load and after any change, which sets the check marks and the native window theme. The folder-rail menu no longer carries appearance. The browser build follows the OS.
