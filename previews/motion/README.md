# Motion previews

Saved from the generative-motion chat on 26 October 2026. These are standalone
design previews, not a desktop overlay or an application feature flag.

- `/` compares the production gold shine with the latest vibrant Claude-orange
  wheel and glossy Codex-blue outward shine, including actual-size indicators,
  scrubbing, slow motion and reduced motion. This colour treatment is preview-only.
- `/needs-input.html` demonstrates a minimized Threadlight indicator collecting
  liquid inside the wheel, pausing for 250 ms, releasing a drop and splashing on
  the simulated taskbar. Provider colours follow Codex blue and Claude orange.
  Opening the simulated app or clearing its input requirement stops the effect.

From the repository root, run `node previews/motion/serve.mjs`, then open the
loopback URL it prints. The default port is 5179; `THREADLIGHT_PREVIEW_PORT` can
select a free port. Stop the server with Ctrl+C.

Run `node node_modules/typescript/bin/tsc -p previews/motion/tsconfig.json` for the
preview type check. With Playwright and Chromium installed, run these in order:

```text
node previews/motion/verify.mjs
node previews/motion/verify-drip.mjs
node previews/motion/verify-smoothness.mjs
node previews/motion/verify-provider-colours.mjs
```

The scripts use local Playwright or `THREADLIGHT_PLAYWRIGHT`, matching the app's
browser checks. `THREADLIGHT_PREVIEW_URL` selects a server on another port.
Synthetic screenshots and filmstrips go under ignored `screenshots-local/` by
default, or `THREADLIGHT_SCREENSHOTS`. `original-geometry.ts` preserves the
comparison baseline. The preview does not control an installed application,
microphone, account, user files or the Windows taskbar.
