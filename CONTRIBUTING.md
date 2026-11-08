# Contributing to Threadlight

Thanks for helping. This guide covers setup, the code layout and the few rules that
matter most.

## Setup

1. Install [Node.js](https://nodejs.org/) 22.16 or later (the repo pins 22 in `.nvmrc`).
2. Clone the repo and run `npm ci`.
3. If `npm ci` finished but Electron will not start ("cannot find electron.exe"),
   run `node node_modules/electron/install.js` once to download its binary.
4. `npm run dev` starts the app with hot reload.

## Scripts

| Command             | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Run the app with hot reload                  |
| `npm run build`     | Build to `out/`                              |
| `npm run start`     | Run the built app                            |
| `npm run test`      | Run the unit tests (Vitest)                  |
| `npm run lint`      | ESLint                                       |
| `npm run typecheck` | TypeScript: main, renderer and browser tests |
| `npm run format`    | Format everything with Prettier              |
| `npm run check`     | Everything CI runs, in one go                |

Plugin assets are generated from the canonical bridge, protocol and shared-memory skill.
Run `npm run plugins:package` after editing these sources; `npm run plugins:check`
rejects stale copies before the normal check suite. The plugin packages do not depend
on application `node_modules` at runtime. See
[the plugin specification](docs/specs/SHARED-MEMORY-PLUGINS-SPEC.md).

## Layout

- `src/main/`: Electron main process (Node). Reads files, checks processes, owns windows.
- `src/preload/`: the bridge. Exposes a small typed API to the UI and nothing else.
- `src/renderer/`: the React UI. It has no file or Node access.
- `src/shared/`: types and the IPC contract used by both sides.
- `test/`: unit tests.

See [the original design](docs/specs/SPEC.md) and the feature specifications in
`docs/specs/`. Specifications can include planned work; use the README and linked
validation records for implemented scope.

## Rules

- **Never commit real data.** Test fixtures, screenshots and examples must be made
  up. No real transcripts, thread titles, names, paths or emails.
- **Keep provider paths inside their adapters.** Claude session paths live in
  `src/main/sessions/paths.ts`; other providers have their own adapter modules.
  Their local formats can change, so keep discovery separate from the UI.
- **The renderer never touches Node.** New capabilities go through `src/shared/ipc.ts`
  and the preload bridge.
- Comments explain _why_, not _what_. Keep modules small and named for what they do.
- Run `npm run check` before opening a pull request.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat: …`, `fix: …`, `docs: …`).
- Update `CHANGELOG.md` under _Unreleased_ as each notable user-visible change
  lands, before calling the work complete, even without a commit or PR. Use the
  Added, Changed, Fixed or Security section and describe the user's result.
- Update the README and affected setup/plugin guides when capabilities,
  navigation, requirements or limitations change. Preserve release gates and
  distinguish implemented, tested and released behavior. Keep detailed test
  evidence in `docs/validation/`; proposals belong in `docs/specs/`.
- Coordinate shared documentation edits with other active chats. Preserve their
  entries and re-read before patching. See [AGENTS.md](AGENTS.md) for the shared
  completion rules. Work in an unmerged checkout is not yet a primary-checkout
  feature; reconcile its documentation when integrating it.
- Keep pull requests focused on one change.

## Public preview scope

This is a Windows source preview. Read [known limitations](docs/LIMITATIONS.md)
before choosing work. Claude compatibility needs a current validation pass; Kimi
is deliberately hidden in public settings while its integration develops.
Do not enable unfinished provider UI as part of an unrelated change.

UI smoke checks use synthetic data and never require a paid provider request.
After a build, set `THREADLIGHT_PLAYWRIGHT` to an installed Playwright module and
run `node test/ui/providers.smoke.mjs`. Focus a check with
`THREADLIGHT_UI_FOCUS`, for example `provider-settings` or `account-chat-replies`.
Keep generated captures and real account data out of commits.
