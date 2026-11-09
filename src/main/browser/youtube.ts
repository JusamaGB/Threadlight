export function isYouTubePage(url: string) {
  try {
    const parsed = new URL(url)
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

// Runs in an isolated world and only changes the supported YouTube layout.
const youtubeStyle = `@media (max-width: 700px) {
  html {
    --ytd-masthead-height: 42px !important;
  }
  ytd-masthead,
  ytd-masthead #container {
    height: 42px !important;
    min-height: 42px !important;
  }
  ytd-masthead #container {
    padding: 0 6px !important;
  }
  ytd-masthead #center {
    min-width: 0 !important;
  }
  ytd-masthead yt-searchbox {
    margin: 0 4px !important;
  }
  ytd-masthead .ytSearchboxComponentInputBox,
  ytd-masthead .ytSearchboxComponentSearchButton {
    height: 30px !important;
    min-height: 30px !important;
  }
  ytd-masthead .ytSearchboxComponentInput {
    font-size: 14px !important;
    line-height: 20px !important;
  }
  ytd-masthead .ytSearchboxComponentSearchButton {
    width: 36px !important;
  }
  ytd-masthead #back-button,
  ytd-masthead #voice-search-button {
    margin: 0 !important;
  }
  ytd-masthead yt-icon-button {
    width: 32px !important;
    height: 32px !important;
    padding: 4px !important;
  }
  ytd-page-manager { margin-top: 42px !important; }
  ytd-search-header-renderer { height: 36px !important; min-height: 36px !important; padding: 0 !important; }
  ytd-search-header-renderer #chip-bar { height: 36px !important; padding: 0 !important; margin: 0 !important; }
  ytd-radio-renderer #video-title, ytd-playlist-renderer #video-title { font-size: 14px !important; line-height: 18px !important; }
  ytd-feed-filter-chip-bar-renderer {
    --ytd-rich-grid-chips-bar-top: 42px !important;
  }
  ytd-feed-filter-chip-bar-renderer #chips-wrapper,
  ytd-feed-filter-chip-bar-renderer #chips {
    height: 36px !important;
  }
  yt-chip-cloud-chip-renderer {
    height: 26px !important;
    margin: 4px !important;
  }
  yt-chip-cloud-chip-renderer #text {
    font-size: 12px !important;
  }
  ytd-search #container.ytd-search {
    padding: 8px !important;
  }
  ytd-video-renderer {
    margin-bottom: 12px !important;
  }
  ytd-video-renderer #video-title {
    font-size: 14px !important;
    line-height: 18px !important;
  }
  ytd-video-renderer #metadata-line {
    font-size: 12px !important;
    line-height: 16px !important;
  }
  ytd-miniplayer[data-threadlight-collapsed="true"] {
    box-sizing: border-box !important;
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    left: 8px !important;
    right: 8px !important;
    bottom: 8px !important;
    width: auto !important;
    max-width: calc(100% - 16px) !important;
    contain: paint !important;
    overflow: hidden !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: 0 -2px 8px rgb(0 0 0 / 25%) !important;
    background: #202020 !important;
  }
  ytd-miniplayer[data-threadlight-collapsed="true"]
    > :not([data-threadlight-video-strip]) {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  [data-threadlight-video-strip] {
    position: absolute;
    z-index: 10000;
    bottom: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    background: #202020;
    color: #f1f1f1;
    border-radius: 5px;
    font:
      13px/18px Arial,
      sans-serif;
  }
  [data-threadlight-video-title] {
    display: none;
  }
  ytd-miniplayer[data-threadlight-collapsed="true"]
    [data-threadlight-video-strip] {
    inset: 0;
    padding: 2px 6px;
    border-radius: 0;
  }
  ytd-miniplayer[data-threadlight-collapsed="true"]
    [data-threadlight-video-title] {
    display: block;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  [data-threadlight-video-strip] button {
    flex: 0 0 26px;
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font:
      16px Arial,
      sans-serif;
    cursor: pointer;
  }
  [data-threadlight-video-strip] button:focus-visible {
    outline: 2px solid #9ac7ff;
    outline-offset: 1px;
  }
  html[data-threadlight-mini-active] ytd-search {
    padding-bottom: 44px !important;
  }
}
@media (min-width: 701px) {
  [data-threadlight-video-strip] {
    display: none !important;
  }
}`

export const youtubeLayoutScript = `(() => {
  if (globalThis.__threadlightYouTubeLayout) return;
  globalThis.__threadlightYouTubeLayout = true;
  const style = document.createElement('style');
  style.id = 'threadlight-youtube-layout';
  style.textContent = ${JSON.stringify(youtubeStyle)};
  document.documentElement.append(style);
  function icon(button, kind) {
    const paths = {
      play: 'M6 3L21 12L6 21Z',
      pause: 'M6 4H10V20H6ZM14 4H18V20H14Z',
      expand: 'M15 3H21V9M9 21H3V15M21 3L14 10M3 21L10 14',
      collapse: 'M4 14H10V20M20 10H14V4M14 10L21 3M3 21L10 14',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[kind]);
    path.setAttribute('fill', kind === 'play' || kind === 'pause' ? 'currentColor' : 'none');
    path.setAttribute('stroke', kind === 'play' || kind === 'pause' ? 'none' : 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    button.replaceChildren(svg);
  }
  let lastTitle = '';
  const players = new Map();
  const narrow = matchMedia('(max-width: 700px)');
  function nativeFocus(player, controls, collapsed) {
    for (const [node, wasInert] of controls.inert) {
      if (!collapsed || node.parentElement !== player) {
        node.inert = wasInert;
        controls.inert.delete(node);
      }
    }
    if (collapsed) {
      for (const node of player.children) {
        if (node === controls.strip) continue;
        if (!controls.inert.has(node)) controls.inert.set(node, node.inert);
        node.inert = true;
      }
    }
  }
  function update() {
    const watchTitle = document
      .querySelector('ytd-watch-metadata h1, h1.ytd-video-primary-info-renderer')
      ?.textContent?.trim();
    if (location.pathname === '/watch' && watchTitle) lastTitle = watchTitle;
    for (const [player, controls] of players) {
      if (!player.isConnected) {
        nativeFocus(player, controls, false);
        players.delete(player);
      }
    }
    let active = false;
    for (const player of document.querySelectorAll('ytd-miniplayer')) {
      const video = player.querySelector('video');
      if (!video) {
        const controls = players.get(player);
        if (controls) nativeFocus(player, controls, false);
        continue;
      }
      const visible =
        player.getClientRects().length > 0 && getComputedStyle(player).visibility !== 'hidden';
      active ||= visible && narrow.matches;
      let controls = players.get(player);
      if (!controls || !controls.strip.isConnected) {
        const strip = document.createElement('div');
        strip.dataset.threadlightVideoStrip = '';
        strip.setAttribute('role', 'group');
        strip.setAttribute('aria-label', 'Active video');
        const title = document.createElement('span');
        title.dataset.threadlightVideoTitle = '';
        const playback = document.createElement('button');
        playback.type = 'button';
        const expand = document.createElement('button');
        expand.type = 'button';
        strip.append(title, playback, expand);
        // Keep the site's draggable and playlist handlers out of these controls.
        for (const event of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup'])
          strip.addEventListener(event, (e) => e.stopPropagation());
        playback.addEventListener('click', (event) => {
          event.stopPropagation();
          const media = player.querySelector('video');
          if (!media) return;
          const nativePlayback = player.querySelector('.ytp-miniplayer-play-button, .ytp-play-button');
          if (nativePlayback) {
            nativePlayback.click();
            schedule();
            return;
          }
          if (media.paused)
            media.play().catch(() => {
              playback.title = 'Playback could not start. Expand the player to retry.';
            });
          else media.pause();
          update();
        });
        expand.addEventListener('click', (event) => {
          event.stopPropagation();
          player.dataset.threadlightCollapsed = String(
            player.dataset.threadlightCollapsed !== 'true',
          );
          update();
        });
        player.dataset.threadlightCollapsed = 'true';
        player.append(strip);
        controls = { strip, title, playback, expand, inert: new Map() };
        players.set(player, controls);
      }
      const nativeTitle = player
        .querySelector('.ytdMiniplayerInfoBarTitle, #video-title, .miniplayer-title')
        ?.textContent?.trim();
      const title = nativeTitle || lastTitle || 'Active video';
      if (controls.title.textContent !== title) controls.title.textContent = title;
      controls.title.title = title;
      const playLabel = video.paused ? 'Play video' : 'Pause video';
      if (controls.playback.getAttribute('aria-label') !== playLabel) {
        controls.playback.setAttribute('aria-label', playLabel);
        controls.playback.title = playLabel;
        icon(controls.playback, video.paused ? 'play' : 'pause');
      }
      const collapsed = player.dataset.threadlightCollapsed === 'true';
      nativeFocus(player, controls, collapsed && narrow.matches);
      const expandLabel = collapsed ? 'Expand video preview' : 'Collapse video preview';
      if (controls.expand.getAttribute('aria-label') !== expandLabel) {
        controls.expand.setAttribute('aria-label', expandLabel);
        controls.expand.title = expandLabel;
        controls.expand.setAttribute('aria-expanded', String(!collapsed));
        icon(controls.expand, collapsed ? 'expand' : 'collapse');
      }
    }
    document.documentElement.toggleAttribute('data-threadlight-mini-active', active);
  }
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  document.addEventListener('play', schedule, true);
  document.addEventListener('pause', schedule, true);
  document.addEventListener('yt-navigate-finish', schedule);
  narrow.addEventListener('change', schedule);
  update();
})()`
