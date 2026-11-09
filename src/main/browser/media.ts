// This closure lives in the frame's isolated world. A new document starts
// with no remembered players, even when its URL is the same.
export const pauseBrowserPlayback = `(() => {
  if (globalThis.__threadlightResumePlayback) return;
  const playing = new Map();
  const roots = [];
  function keepPaused(event) {
    if (event.target instanceof HTMLMediaElement && !event.target.paused) event.target.pause();
  }
  function visit(root) {
    roots.push(root);
    root.addEventListener('play', keepPaused, true);
    for (const node of root.querySelectorAll('*')) {
      if (node instanceof HTMLMediaElement && !node.paused && !node.ended) {
        playing.set(node, { src: node.currentSrc, stream: node.srcObject });
        node.pause();
      }
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  }
  visit(document);
  globalThis.__threadlightResumePlayback = () => {
    delete globalThis.__threadlightResumePlayback;
    for (const root of roots) root.removeEventListener('play', keepPaused, true);
    for (const [node, source] of playing) {
      if (node.isConnected && node.paused && !node.ended &&
          node.currentSrc === source.src && node.srcObject === source.stream)
        node.play().catch(() => {});
    }
  };
})()`

export const resumeBrowserPlayback = 'globalThis.__threadlightResumePlayback?.()'

// A fullscreen request can precede metadata, or fullscreen the player's container.
export const fullscreenVideoAspect = `(async () => {
  // Electron can signal entry before Chromium commits the fullscreen element.
  if (!document.fullscreenElement) await new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', done);
      resolve();
    };
    const timer = setTimeout(done, 1000);
    document.addEventListener('fullscreenchange', done);
  });
  const root = document.fullscreenElement;
  const video = root?.matches('video') ? root : root?.querySelector('video');
  if (!video) return null;
  if (!video.videoHeight) await new Promise(resolve => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      document.removeEventListener('fullscreenchange', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    document.addEventListener('fullscreenchange', done);
  });
  return root === document.fullscreenElement && video.videoHeight ? video.videoWidth / video.videoHeight : null;
})()`

// Runs inside each frame's isolated inspection world. Read-only, including text tracks.
export const mediaInspection = `globalThis.__threadlightElements.flatMap((media, index) => {
  if (!media.matches('video,audio')) return [];
  const finite = (value) => (Number.isFinite(value) ? value : null);
  const ranges = (value) =>
    Array.from({ length: Math.min(value.length, 20) }, (_, i) => ({
      start: value.start(i),
      end: value.end(i),
    }));
  const tracks = Array.from(media.textTracks)
    .slice(0, 20)
    .map((track) => {
      const cues = Array.from(track.cues || []).slice(0, 10000);
      const nearby = cues
        .filter(
          (c) =>
            c.endTime >= media.currentTime - 45 && c.startTime <= media.currentTime + 15,
        )
        .slice(0, 30);
      return {
        kind: track.kind,
        language: track.language,
        label: track.label,
        mode: track.mode,
        available: track.cues !== null,
        truncated: (track.cues?.length || 0) > 10000,
        nearby: nearby.map((c) => ({
          start: c.startTime,
          end: c.endTime,
          text: String(c.text || '').slice(0, 1000),
        })),
      };
    });
  const rect = media.getBoundingClientRect();
  const player = media.closest('#movie_player,.video-js,.jwplayer');
  const displayedCaptions = player
    ? Array.from(
        player.querySelectorAll(
          '.ytp-caption-segment,.vjs-text-track-display,.jw-text-track-cue',
        ),
      )
        .filter(
          (node) =>
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== 'hidden',
        )
        .map((node) => node.textContent || '')
        .join(' ')
        .slice(0, 6000)
    : '';

  return [
    {
      element: index + 1,
      kind: media.tagName.toLowerCase(),
      currentTime: finite(media.currentTime),
      duration: finite(media.duration),
      durationKind: Number.isFinite(media.duration)
        ? 'finite'
        : media.duration === Infinity
          ? 'unbounded'
          : 'unknown',
      paused: media.paused,
      ended: media.ended,
      seeking: media.seeking,
      playbackRate: media.playbackRate,
      muted: media.muted,
      volume: media.volume,
      readyState: media.readyState,
      buffering: !media.paused && !media.ended && media.readyState < 3,
      seekable: ranges(media.seekable),
      fullscreen:
        !!document.fullscreenElement &&
        (document.fullscreenElement === media ||
          document.fullscreenElement.contains(media)),
      visible:
        media.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth,
      width: rect.width,
      height: rect.height,
      observedAt: Date.now(),
      tracks,
      displayedCaptions,
      chapter:
        tracks
          .filter((t) => t.kind === 'chapters')
          .flatMap((t) => t.nearby)
          .find((c) => c.start <= media.currentTime && c.end > media.currentTime) || null,
      error: media.error
        ? { code: media.error.code, message: media.error.message }
        : null,
    },
  ];
})`

export function mediaAction(action: string, element: number, seconds?: number, rate?: number) {
  return `(async () => {
    const command = ${JSON.stringify({ action, element, seconds, rate })};
    const media = globalThis.__threadlightElements?.[command.element - 1];
    if (!media?.isConnected || !media.matches('video,audio') ||
        globalThis.__threadlightSignature(media) !== globalThis.__threadlightSignatures[command.element - 1]) {
      throw Error('Media changed. Inspect again.');
    }
    if (command.action === 'play') {
      await media.play();
      return;
    }
    if (command.action === 'pause') {
      media.pause();
      return;
    }
    if (command.action === 'rate') {
      media.playbackRate = command.rate;
      return;
    }
    const target = command.action === 'skip' ? media.currentTime + command.seconds : command.seconds;
    if (!Number.isFinite(target) || target < 0) {
      throw Error('Requested position is outside this video.');
    }
    const ranges = Array.from({ length: media.seekable.length }, (_, index) =>
      [media.seekable.start(index), media.seekable.end(index)]);
    if (!ranges.some(([start, end]) => target >= start && target <= end)) {
      throw Error('Requested position is not currently seekable. Inspect the available range.');
    }
    media.currentTime = target;
  })()`
}
