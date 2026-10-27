# Contributing to Threadlight

Thanks for helping. This guide covers setup, the code layout and the few rules that
matter most.

## Setup

1. Install [Node.js](https://nodejs.org/) 22.16 or later (the repo pins 22 in `.nvmrc`).
2. Clone the repo and run `npm install`.
3. If `npm install` finished but Electron will not start ("cannot find electron.exe"),
   run `node node_modules/electron/install.js` once to download its binary.
4. `npm run dev` starts the app with hot reload.

## Scripts

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Run the app with hot reload                    |
| `npm run build`     | Build to `out/`                                |
| `npm run start`     | Run the built app                              |
| `npm run test`      | Run the unit tests (Vitest)                    |
| `npm run lint`      | ESLint                                         |
| `npm run typecheck` | TypeScript, both the Node side and the UI side |
| `npm run format`    | Format everything with Prettier                |
| `npm run check`     | Everything CI runs, in one go                  |

Plugin assets are generated from the canonical bridge, protocol and shared-memory skill.
Run `npm run plugins:package` after editing these sources; `npm run plugins:check`
rejects stale copies before the normal check suite. The plugin packages do not depend
on application `node_modules` at runtime. See `SHARED-MEMORY-PLUGINS-SPEC.md`.

## Layout

- `src/main/`: Electron main process (Node). Reads files, checks processes, owns windows.
- `src/preload/`: the bridge. Exposes a small typed API to the UI and nothing else.
- `src/renderer/`: the React UI. It has no file or Node access.
- `src/shared/`: types and the IPC contract used by both sides.
- `test/`: unit tests.

See `SPEC.md` for the full design.

## Rules

- **Never commit real data.** Test fixtures, screenshots and examples must be made
  up. No real transcripts, thread titles, names, paths or emails.
- **Every on-disk location lives in `src/main/sessions/paths.ts`.** Claude's file
  formats are undocumented, so keeping them in one place keeps breakage contained.
- **The renderer never touches Node.** New capabilities go through `src/shared/ipc.ts`
  and the preload bridge.
- Comments explain _why_, not _what_. Keep modules small and named for what they do.
- Run `npm run check` before opening a pull request.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat: …`, `fix: …`, `docs: …`).
- Add a line to `CHANGELOG.md` under _Unreleased_ for user-visible changes.
- Keep pull requests focused on one change.
