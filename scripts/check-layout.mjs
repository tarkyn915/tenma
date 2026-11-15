import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the real components and stylesheet in Chromium, not just a column-count helper.
const require = createRequire(import.meta.url);
globalThis.localStorage = { getItem: () => null };
const code = await build({
  stdin: {
    contents: `${await readFile('src/App.tsx', 'utf8')}\nexport { HomeView, AlbumsView, ArtistsView };\nexport { PlaylistsView } from './PlaylistsView';`,
    resolveDir: resolve('src'), loader: 'tsx'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, jsx: 'automatic'
});
const module = { exports: {} };
new Function('require', 'module', 'exports', code.outputFiles[0].text)(require, module, module.exports);
const { HomeView, AlbumsView, ArtistsView, PlaylistsView } = module.exports;
const noop = () => {};
const stylesheet = await readFile('src/styles.css', 'utf8');
const artwork = pathToFileURL(resolve('src-tauri/icons/128x128.png')).href;
const albumFixtures = (count) => Array.from({ length: count }, (_, index) => ({
  id: `layout-album-${index}`, name: `Album ${index + 1} — a long title for overflow checking`,
  artist: `Artist ${index + 1}`, coverArt: artwork, songCount: 1
}));
const cases = [];
for (const count of [0, 1, 2, 7, 8, 9, 24, 25]) {
  const albums = albumFixtures(count);
  cases.push({ kind: 'albums', count, component: React.createElement(AlbumsView, { albums, error: '', onOpen: noop }) });
  cases.push({ kind: 'artists', count, component: React.createElement(ArtistsView, { albums, onOpen: noop }) });
}
cases.push({ kind: 'home', count: 8, component: React.createElement(HomeView, { albums: albumFixtures(8), mode: 'server', localFolder: '', loading: false, onOpen: noop, onConnect: noop }) });
const playlists = [0, 1].map((index) => ({ id: `layout-playlist-${index}`, name: `Playlist ${index + 1}`, comment: '', owner: 'Listener', public: false, songCount: 20, duration: 400, coverArt: artwork }));
cases.push({ kind: 'playlists', count: 2, component: React.createElement(PlaylistsView, { playlists, onOpen: noop }) });
const markup = cases.map(({ kind, count, component }) => `<div class="layout-case" data-kind="${kind}" data-count="${count}">${renderToStaticMarkup(component)}</div>`).join('');

const checks = String.raw`
  const failures = [];
  const results = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  for (const width of [150, 288, 360, 540, 680, 960, 1000, 1440, 1920]) {
    for (const surface of document.querySelectorAll('.layout-case')) {
      surface.style.width = width + 'px';
      const kind = surface.dataset.kind;
      const count = Number(surface.dataset.count);
      const grid = surface.querySelector('.balanced-grid');
      if (!grid) { expect(count === 0, kind + ': missing grid'); continue; }
      const prefix = kind + '/' + count + '@' + width + ': ';
      const style = getComputedStyle(grid);
      expect(style.display === 'grid', prefix + 'CSS override changed display');
      const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
      const cards = [...grid.children];
      const boxes = cards.map((card) => card.getBoundingClientRect());
      const bounds = grid.getBoundingClientRect();
      expect(Math.abs(boxes[0].left - bounds.left) < 1, prefix + 'not left aligned');
      expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width)) < 1, prefix + 'last row grew');
      expect(grid.scrollWidth <= width + 1, prefix + 'grid horizontal overflow');
      expect(boxes.every((box) => box.left >= bounds.left - 1 && box.right <= bounds.right + 1), prefix + 'card outside grid');
      if (count >= tracks.length) {
        expect(Math.abs(boxes[tracks.length - 1].right - bounds.right) < 1, prefix + 'unused strip on right');
      }
      if (kind !== 'artists') {
        const covers = [...grid.querySelectorAll('.album-art-wrap')].map((cover) => cover.getBoundingClientRect());
        expect(covers.every((cover) => Math.abs(cover.width - cover.height) < 1), prefix + 'non-square cover');
      }
      results.push({ kind, count, width, columns: tracks.length, cardWidth: Math.round(boxes[0].width * 100) / 100 });
    }
  }
  const at = (kind, count, width) => results.find((result) => result.kind === kind && result.count === count && result.width === width);
  expect(at('albums', 25, 960).columns === 5, '960px content should use five columns');
  expect(at('albums', 8, 960).cardWidth === at('albums', 25, 960).cardWidth, 'eight albums must keep full-library card width');
  expect(at('playlists', 2, 960).cardWidth === at('albums', 25, 960).cardWidth, 'two playlists must not expand or center');
  expect(at('albums', 25, 1920).columns > 5, 'wide grids must not have a hard five-column cap');
  // Restore a practical content width for optional visual inspection.
  for (const surface of document.querySelectorAll('.layout-case')) surface.style.width = '960px';
  const report = document.createElement('pre'); report.id = 'layout-result'; report.textContent = JSON.stringify({ failures, results }); document.body.prepend(report);
`;

const directory = await mkdtemp(join(tmpdir(), 'tenma-layout-'));
try {
  const page = join(directory, 'layout.html');
  await writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><style>${stylesheet}\nhtml,body{height:auto;overflow:visible}body{padding:28px;background:#252a30}.layout-case{margin:0 0 48px}.app-shell{height:auto;overflow:visible}#layout-result{display:none}</style><body><div class="app-shell theme-gray">${markup}</div><script>${checks}</script></body></html>`, 'utf8');
  const browser = process.env.TENMA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserFlags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--allow-file-access-from-files'];
  const output = execFileSync(browser, [...browserFlags, '--window-size=1100,900', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const reportText = output.match(/<pre id="layout-result">(.*?)<\/pre>/s)?.[1];
  assert.ok(reportText, 'Chromium did not produce a layout report');
  const report = JSON.parse(reportText.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
  assert.deepEqual(report.failures, [], report.failures.join('\n'));
  console.log(`PASS: ${report.results.length} real-browser layout cases: left alignment, equal card widths, full rows reach the right edge, square covers and no grid overflow`);
  console.table(report.results.filter(({ kind, count, width }) => (kind === 'home' || kind === 'playlists' || kind === 'albums' && count === 25) && [360, 960, 1440].includes(width)));
  // Re-run at a real mobile viewport to include responsive stylesheet overrides.
  const mobileOutput = execFileSync(browser, [...browserFlags, '--window-size=430,900', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const mobileText = mobileOutput.match(/<pre id="layout-result">(.*?)<\/pre>/s)?.[1];
  assert.ok(mobileText, 'Chromium did not produce a mobile layout report');
  const mobile = JSON.parse(mobileText.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
  assert.deepEqual(mobile.failures, [], mobile.failures.join('\n'));
  console.log(`PASS: ${mobile.results.length} additional cases with narrow-viewport stylesheet rules`);
  if (process.env.TENMA_LAYOUT_ARTIFACTS) {
    const artifacts = resolve(process.env.TENMA_LAYOUT_ARTIFACTS);
    await mkdir(artifacts, { recursive: true });
    const sidebar = '<aside class="sidebar"><div class="server-switcher"><button class="server-switcher-button"><span class="status-dot online"></span><strong>Layout test fixtures</strong></button></div><nav class="sidebar-navigation"><button class="nav-item active">Library</button></nav></aside>';
    for (const [kind, count] of [['home', 8], ['albums', 25], ['playlists', 2], ['artists', 9]]) {
      const fixture = cases.find((item) => item.kind === kind && item.count === count);
      const visual = join(directory, `${kind}.html`);
      await writeFile(visual, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${stylesheet}\n.content-page { animation: none; }</style><body><div class="app-shell theme-gray">${sidebar}<main class="main-content"><header class="topbar"><span class="topbar-brand">Tenma Player — layout test</span></header><div class="content-scroll"><div class="content-page">${renderToStaticMarkup(fixture.component)}</div></div></main></div></body></html>`, 'utf8');
      const screenshot = join(artifacts, `${kind}.png`);
      execFileSync(browser, [...browserFlags, '--window-size=1280,960', '--hide-scrollbars', `--screenshot=${screenshot}`, pathToFileURL(visual).href], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(`SCREENSHOT: ${screenshot}`);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
