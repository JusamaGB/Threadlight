# Provider UI smoke test

Build the app, then run `node test/ui/providers.smoke.mjs`. This optional test needs
an installed Playwright module and its Chromium browser. It uses ordinary module
resolution, or `THREADLIGHT_PLAYWRIGHT` can name an existing Playwright module's
absolute directory. It is separate from the default Vitest suite so normal installs
do not download a browser.

The test serves the built renderer on a temporary loopback port with synthetic IPC.
It never launches Electron, either chat CLI, or a hook server, and needs no accounts.
It exercises the actual settings controls, combined lists and workspaces, draft and
pending-answer retention, live copy/open, exact send targeting, pause/resume settings,
and the paused dot/hotkey. Provider aggregation and settings validation use the real
shared modules. Optional `THREADLIGHT_SCREENSHOTS` writes synthetic `.local.png`
previews to a chosen directory. The browser and temporary HTTP server close on exit.
