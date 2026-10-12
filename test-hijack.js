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
const mod = new Function(`${pure}; return { rewrite, isMasterPlaylist, parseStreams, shortSide };`)();

const set = (q, f) => {
  store['xvq:quality'] = q;
  store['xvq:fallback'] = f;
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
const cases = [
  ['best', 'lowest', '1920x1080'],
  ['2160', 'lowest', '1920x1080'], // above everything -> highest, never 360
  ['1080', 'lowest', '1920x1080'],
  ['720', 'lowest', '1280x720'],
  ['480', 'lowest', '480x854'], // portrait: 480x854 must satisfy "480p"
  ['360', 'lowest', '640x360'],
  ['lowest', 'lowest', '640x360'],
  ['1440', 'lowest', '1920x1080'], // above max -> highest, not 360
  ['240', 'lowest', '640x360'],
  ['1440', 'nearest', '1920x1080'],
  ['1440', 'highest', '1920x1080'],
  ['240', 'nearest', '640x360'],
];
for (const [q, f, want] of cases) {
  set(q, f);
  const out = mod.rewrite(MASTER);
  check(`${q} / ${f}`, [chosen(out), variantCount(out)], [want, 1]);
}

console.log('\n--- playlist structure ---');
set('720', 'lowest');
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
check('media playlist untouched', (set('1080', 'lowest'), mod.rewrite(MEDIA)), MEDIA);
check('playlist without variants untouched', (set('720', 'lowest'), mod.rewrite(NO_VARIANTS)), NO_VARIANTS);
check('single-variant playlist untouched', mod.rewrite(MASTER.split('\n').slice(0, 4).join('\n')), MASTER.split('\n').slice(0, 4).join('\n'));
check('portrait short side', mod.shortSide('480x854'), 480);
check('landscape short side', mod.shortSide('1920x1080'), 1080);
check('square short side', mod.shortSide('640x640'), 640);
check('missing resolution -> 0', mod.shortSide(undefined), 0);
check('all variants parsed', mod.parseStreams(MASTER).map((s) => s.height).sort((a, b) => a - b), [360, 480, 720, 1080]);
check('AVERAGE-BANDWIDTH preferred over BANDWIDTH', mod.parseStreams(MASTER).find((s) => s.height === 480).bandwidth, 620000);

// Gappy playlist: 480 is missing but is below the max, so the lowest rule must apply.
const GAPPY = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=426x240',
  'https://video.twimg.com/g/vid/426x240/a.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=3170000,RESOLUTION=1920x1080',
  'https://video.twimg.com/g/vid/1920x1080/a.m3u8',
  '',
].join('\n');
set('480', 'lowest');
check('missing in-range target honours "lowest" fallback', chosen(mod.rewrite(GAPPY)), '426x240');
set('480', 'highest');
check('missing in-range target honours "highest" fallback', chosen(mod.rewrite(GAPPY)), '1920x1080');
set('480', 'nearest');
check('missing in-range target honours "nearest" fallback', chosen(mod.rewrite(GAPPY)), '426x240');

console.log(`\n${failed ? `${failed} FAILURES` : 'all tests pass'}`);
process.exit(failed ? 1 : 0);