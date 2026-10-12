/**
 * Runs in the page's MAIN world (same JS realm as Twitter/X's own player) so we can
 * patch the XHR/fetch prototypes the player actually uses.
 *
 * X serves videos as HLS master playlists on video.twimg.com. A master playlist
 * lists one variant per quality (240p, 480p, 720p, 1080p). The player picks from
 * that list, and its own setting + data-saver heuristics pick for you.
 *
 * We rewrite the master playlist so only the variant you picked survives. The
 * player then has exactly one option and cannot override it.
 */

const STORE_KEY = 'xvq:quality';
const FALLBACK_KEY = 'xvq:fallback';

const QUALITIES = {
  best: { label: 'Best available', height: Infinity },
  '2160': { label: '2160p (4K)', height: 2160 },
  '1440': { label: '1440p', height: 1440 },
  '1080': { label: '1080p', height: 1080 },
  '720': { label: '720p', height: 720 },
  '480': { label: '480p', height: 480 },
  '360': { label: '360p', height: 360 },
  '240': { label: '240p', height: 240 },
  lowest: { label: 'Lowest available', height: -Infinity },
};

function readSetting(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function isHlsUrl(url) {
  return typeof url === 'string' && /^https:\/\/video\.twimg\.com\/.+\.m3u8(\?.*)?$/i.test(url);
}

/**
 * A master playlist advertises variants via EXT-X-STREAM-INF; a media playlist only
 * has media segments and never does. That presence is the reliable signal on its own
 * -- gating on TARGETDURATION too caused false negatives when X emitted both.
 */
function isMasterPlaylist(text) {
  return text.includes('#EXT-X-STREAM-INF');
}

/** Short side of RESOLUTION=WxH -- portrait videos are 1080x1920, not 1920x1080. */
function shortSide(resolution) {
  if (!resolution) return 0;
  const [w, h] = resolution.split('x').map(Number);
  if (!w || !h) return 0;
  return Math.min(w, h);
}

function parseStreams(text) {
  const lines = text.split(/\r?\n/);
  const streams = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;

    const attrs = {};
    for (const part of lines[i].slice('#EXT-X-STREAM-INF:'.length).split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
      attrs[key] = value;
    }

    // The variant URI is the next non-comment, non-empty line.
    let uriIndex = i + 1;
    while (uriIndex < lines.length && (!lines[uriIndex] || lines[uriIndex].startsWith('#'))) {
      uriIndex++;
    }
    if (uriIndex >= lines.length) continue;

    streams.push({
      index: i,
      uriIndex,
      height: shortSide(attrs.RESOLUTION),
      bandwidth: Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH || 0),
    });
  }

  return streams;
}

/**
 * Pick the stream to keep.
 * Exact height wins. When the target is absent we honor the user's fallback rule
 * ("lowest" takes the smallest variant, "nearest" the closest, "highest" the largest).
 *
 * One exception: if the target is *above* everything available, we use the highest
 * instead. Asking for 2160p and silently getting 360p is never what was meant.
 */
function pickStream(streams, quality, fallback) {
  if (streams.length <= 1) return streams[0] || null;

  const heights = streams.map((s) => s.height);
  const byHeightDesc = [...streams].sort((a, b) => b.height - a.height);
  const byHeightAsc = [...streams].sort((a, b) => a.height - b.height);
  const rule = QUALITIES[quality] || QUALITIES['1080'];

  // Named extremes don't depend on the fallback rule.
  if (rule.height === Infinity) return byHeightDesc[0];
  if (rule.height === -Infinity) return byHeightAsc[0];

  const exact = streams.filter((s) => s.height === rule.height);
  if (exact.length) return exact[0];

  const maxHeight = Math.max(...heights);

  let candidates;
  if (rule.height > maxHeight) {
    candidates = byHeightDesc;
  } else if (fallback === 'lowest') {
    candidates = byHeightAsc;
  } else if (fallback === 'highest') {
    candidates = byHeightDesc;
  } else {
    // nearest by height, ties go to the lower one so we never upscale
    candidates = [...streams].sort(
      (a, b) => Math.abs(a.height - rule.height) - Math.abs(b.height - rule.height) || a.height - b.height
    );
  }

  // No variant matched the rule -- fall back to the lowest so playback still works.
  if (!candidates.length) return null;
  return candidates[0];
}

function rewrite(text) {
  const streams = parseStreams(text);
  if (!streams.length) return text;

  const chosen = pickStream(streams, readSetting(STORE_KEY, 'best'), readSetting(FALLBACK_KEY, 'lowest'));
  if (!chosen) return text;

  const lines = text.split(/\r?\n/);
  // Keep every header line up to the first variant, then only the chosen variant.
  const header = lines.slice(0, streams[0].index);
  const block = [lines[chosen.index], lines[chosen.uriIndex]];

  return [...header, ...block, ''].join('\n');
}

// --- XMLHttpRequest (the player loads playlists this way) ------------------------

const realOpen = XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  if (isHlsUrl(url)) {
    this.addEventListener('readystatechange', function () {
      if (this.readyState !== 4) return;
      let original;
      try {
        original = this.responseText;
      } catch {
        return; // not a text response
      }
      if (typeof original !== 'string' || !isMasterPlaylist(original)) return;

      const modified = rewrite(original);
      Object.defineProperty(this, 'responseText', { value: modified, configurable: true });
      if (this.responseType === '' || this.responseType === 'text') {
        Object.defineProperty(this, 'response', { value: modified, configurable: true });
      }
    });
  }
  return realOpen.call(this, method, url, ...rest);
};

// --- fetch (some players use it) -------------------------------------------------

const realFetch = window.fetch;

window.fetch = async function (input, init) {
  const response = await realFetch.call(this, input, init);
  const url = typeof input === 'string' ? input : input?.url;

  if (!isHlsUrl(url) || !isMasterPlaylistSafe(response)) return response;

  try {
    const text = await response.clone().text();
    if (!isMasterPlaylist(text)) return response;

    const modified = rewrite(text);
    const headers = new Headers(response.headers);
    // Content-Length no longer matches; let the browser recompute it.
    headers.delete('content-length');
    headers.delete('content-encoding');

    return new Response(modified, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};

function isMasterPlaylistSafe(response) {
  const type = response.headers.get('content-type') || '';
  return /mpegurl|m3u8/i.test(type);
}

// --- Status badge ----------------------------------------------------------------
// Read-only on purpose: the setting is owned by the popup (chrome.storage), and this
// script only mirrors it into the page's localStorage for the rewriter to read.

const STYLES = `
#xvq-badge{position:fixed;right:8px;bottom:8px;z-index:2147483647;background:rgba(0,0,0,.75);
  color:#fff;font:12px/1.4 system-ui,sans-serif;padding:6px 10px;border-radius:6px;user-select:none}
`;

function currentLabel() {
  const quality = readSetting(STORE_KEY, 'best');
  return QUALITIES[quality]?.label ?? 'Best available';
}

function mountBadge() {
  if (document.getElementById('xvq-badge')) return;

  const style = document.createElement('style');
  style.textContent = STYLES;

  const badge = document.createElement('div');
  badge.id = 'xvq-badge';
  badge.title = 'Set this in the X Video Quality extension popup';

  document.body.append(style, badge);
  renderBadge();
}

function renderBadge() {
  const badge = document.getElementById('xvq-badge');
  if (!badge) return;
  badge.textContent = `Video quality: ${currentLabel()}`;
}

// React to the popup writing a new setting (mirrored into localStorage by the bridge).
window.addEventListener('storage', (event) => {
  if (event.key === STORE_KEY || event.key === FALLBACK_KEY) renderBadge();
});

// X is a SPA -- wait for the document to be usable before adding UI.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountBadge, { once: true });
} else {
  mountBadge();
}