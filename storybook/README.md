# Storybook

The real Threadlight panel, driven by an invented working day (two providers, four projects,
a few threads asking for you), photographed scene by scene. It is the source of the frames for
the product tour film in `docs/video/threadlight-tour-storyboard.md`.

```
npm run build        # the storybook serves out/renderer
npm run storybook    # every scene
node storybook/run.mjs dual   # only scenes whose id contains "dual"
```

Frames go to `storybook/frames/` (ignored by git), with `index.html` as a contact sheet and
`manifest.json` for whatever assembles the film. `STORYBOOK_SCALE=3` shoots at 3x.

Nothing here touches a real machine: the main process is replaced by the stand-in in
`run.mjs` and the people and projects live in `world.mjs`. Add a scene in `scenes.mjs`.

Not in the storybook yet: Shared Spaces (needs the real stores, as in `test/ui/spaces.smoke.mjs`),
voice and the live drips on the dot. Those shots are best filmed from the real app.
