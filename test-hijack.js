/**
 * Tests for the playlist rewriter in src/content/playlist-hijack.js.
 * Run: bun test-hijack.js   (or: node test-hijack.js)
 */

import { readFileSync } from 'node:fs';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
};

const src = readFileSync(new URL('./src/content/playlist-hijack.js', import.meta.url), 'utf8');
const pure = src.slice(0, src.indexOf('// --- XMLHttpRequest'));
const mod = new Function(
  `${pure}; return { rewrite, isMasterPlaylist, parseStreams, shortSide, pickStream };`
)();

const set = (q) => {
  store['xvq:quality'] = q;
};

// Unsorted variants, mixed portrait/landscape, AVERAGE-BANDWIDTH present,
// and a TARGETDURATION line that must not confuse master-playlist detection.
const MASTER = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-STREAM-INF:BANDWIDTH=3170000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'https://video.twimg.com/ext_tw_video/1/pu/vid/1920x1080/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360,CODECS="avc1.4d001e,mp4a.40.2"',
  'https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720,CODECS="avc1.4d001f,mp4a.40.2"',
  'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=632000,AVERAGE-BANDWIDTH=620000,RESOLUTION=480x854,CODECS="avc1.4d001e,mp4a.40.2"',
  'https://video.twimg.com/ext_tw_video/1/pu/vid/480x854/a.m3u8',
  '',
].join('\n');

const MEDIA = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', '#EXTINF:6.0,', 'https://v/seg1.ts', ''].join('\n');
const NO_VARIANTS = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', ''].join('\n');

const chosen = (text) => text.split('\n').filter((l) => l && !l.startsWith('#')).join('').match(/vid\/([^/]+)\//)?.[1];
const variantCount = (text) => text.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF')).length;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

console.log('--- quality selection ---');
// [requested, expected short-side] -- every case must resolve to exactly one variant.
const cases = [
  ['best', '1920x1080'],
  ['2160', '1920x1080'], // above everything -> step down to 1080, never 360
  ['1440', '1920x1080'], // above everything -> 1080
  ['1080', '1920x1080'],
  ['720', '1280x720'],
  ['480', '480x854'], // portrait: 480x854 must satisfy "480p"
  ['360', '640x360'],
  ['240', '640x360'], // below everything -> lowest available
  ['lowest', '640x360'],
];
for (const [q, want] of cases) {
  set(q);
  const out = mod.rewrite(MASTER);
  check(q, [chosen(out), variantCount(out)], [want, 1]);
}

console.log('\n--- step down when the target is missing ---');
// pickStream takes a quality key from the menu, so the step-down rule is exercised
// against real quality values over stream sets that deliberately lack them.
const pick = (quality, heights) =>
  mod.pickStream(heights.map((height) => ({ height, bandwidth: 1 })), quality)?.height;

// Target above everything: take the largest, never the smallest.
check('above everything takes the largest', pick('2160', [1080, 720, 480, 360]), 1080);
check('above everything, only low offers', pick('2160', [360, 240]), 360);
check('one step above the top', pick('1440', [1080, 720, 480]), 1080);

// Target present but the neighbours are not: step down to the closest lower variant.
check('gap below the target', pick('720', [1080, 480, 240]), 480);
check('gap below the target, more variants', pick('720', [1080, 480, 360, 240]), 480);
check('gap between two offers', pick('360', [1080, 720, 240]), 240);

// Target below everything: nothing at or below it, so nothing better than the lowest
// exists. This is the single case where the result is higher than what was asked for.
check('below everything takes the lowest', pick('240', [1080, 720, 480]), 480);

// Exact matches win outright.
check('exact match wins over step-down', pick('720', [1080, 720, 480]), 720);
check('exact match at the top', pick('1080', [1080, 720]), 1080);
// The rule from the spec: pick 720 with 720 and 480 available -> 720.
check('720 with 720 and 480 available -> 720', pick('720', [720, 480]), 720);
// Step down one, never up: 720 missing, 480 is the only thing at or below it.
check('720 missing, steps down to 480 not up to 1080', pick('720', [1080, 480]), 480);
// Each named extreme must behave as itself regardless of what else is present.
check('lowest picks bottom even when others are higher', pick('lowest', [1080, 720, 480]), 480);
check('best picks top even when others are lower', pick('best', [1080, 720, 480]), 1080);

// Named extremes ignore the rule entirely.
check('best picks the largest', pick('best', [1080, 720]), 1080);
check('lowest picks the smallest', pick('lowest', [1080, 720]), 720);
check('best with a single variant', pick('best', [720]), 720);

// End-to-end through rewrite(): this playlist has no 720p at all.
const GAPPY_MID = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=3170000,RESOLUTION=1920x1080',
  'https://video.twimg.com/g/vid/1920x1080/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=426x240',
  'https://video.twimg.com/g/vid/426x240/a.m3u8',
  '',
].join('\n');
set('720');
check('rewrite steps down when target missing', chosen(mod.rewrite(GAPPY_MID)), '426x240');
set('1080');
check('exact match unaffected by step-down', chosen(mod.rewrite(MASTER)), '1920x1080');

console.log('\n--- playlist structure ---');
set('720');
const out = mod.rewrite(MASTER);
check('header preserved', out.startsWith('#EXTM3U'), true);
check('TARGETDURATION preserved', out.includes('#EXT-X-TARGETDURATION:6'), true);
check('MEDIA-SEQUENCE preserved', out.includes('#EXT-X-MEDIA-SEQUENCE:0'), true);
check('CODECS attributes preserved', out.includes('avc1.4d001f'), true);
check('chosen STREAM-INF kept with its URI', out.includes('#EXT-X-STREAM-INF') && out.includes('1280x720/a.m3u8'), true);
check('other variants stripped', !out.includes('1920x1080/a.m3u8') && !out.includes('480x854/a.m3u8'), true);

console.log('\n--- detection & edge cases ---');
check('master playlist detected', mod.isMasterPlaylist(MASTER), true);
check('media playlist not detected', mod.isMasterPlaylist(MEDIA), false);
check('media playlist untouched', (set('1080'), mod.rewrite(MEDIA)), MEDIA);
check('playlist without variants untouched', (set('720'), mod.rewrite(NO_VARIANTS)), NO_VARIANTS);
check('single-variant playlist untouched', mod.rewrite(MASTER.split('\n').slice(0, 4).join('\n')), MASTER.split('\n').slice(0, 4).join('\n'));
check('portrait short side', mod.shortSide('480x854'), 480);
check('landscape short side', mod.shortSide('1920x1080'), 1080);
check('square short side', mod.shortSide('640x640'), 640);
check('missing resolution -> 0', mod.shortSide(undefined), 0);
check('all variants parsed', mod.parseStreams(MASTER).map((s) => s.height).sort((a, b) => a - b), [360, 480, 720, 1080]);
check('AVERAGE-BANDWIDTH preferred over BANDWIDTH', mod.parseStreams(MASTER).find((s) => s.height === 480).bandwidth, 620000);

// Gappy playlist: 480 is missing between 240 and 1080, so step-down picks 240.
const GAPPY = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=426x240',
  'https://video.twimg.com/g/vid/426x240/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=3170000,RESOLUTION=1920x1080',
  'https://video.twimg.com/g/vid/1920x1080/a.m3u8',
  '',
].join('\n');
set('480');
check('missing in-range target steps down', chosen(mod.rewrite(GAPPY)), '426x240');
set('1080');
check('top variant is an exact match', chosen(mod.rewrite(GAPPY)), '1920x1080');
set('2160');
check('above the top variant steps down to it', chosen(mod.rewrite(GAPPY)), '1920x1080');

console.log(`\n${failed ? `${failed} FAILURES` : 'all tests pass'}`);
process.exit(failed ? 1 : 0);