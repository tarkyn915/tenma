// Now Playing screen: full-bleed layout (no black band), Up Next/Lyrics tabs,
// queue selection, fade-out close, and optional screenshots for visual review.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'tenma-now-playing-'));
try {
  const artwork = pathToFileURL(resolve('src-tauri/icons/128x128.png')).href;
  const tracks = Array.from({ length: 3 }, (_, index) => ({
    id: `np-song-${index}`, title: `Track ${index + 1}`, artist: `Artist ${index + 1}`, album: 'Fixture album', duration: 200 + index,
    bitRate: 320, coverArt: artwork, streamUrl: `fixture://track/${index}`, source: 'local'
  }));
  let source = await readFile('src/App.tsx', 'utf8');
  const replacements = [
    ['const [queue, setQueue] = useState<PlayerTrack[]>([]);', `const [queue, setQueue] = useState<PlayerTrack[]>(${JSON.stringify(tracks)});`],
    ['const [currentIndex, setCurrentIndex] = useState(-1);', 'const [currentIndex, setCurrentIndex] = useState(0);'],
    ['const [playing, setPlaying] = useState(false);', 'const [playing, setPlaying] = useState(true);'],
    ['const [nowPlayingOpen, setNowPlayingOpen] = useState(false);', 'const [nowPlayingOpen, setNowPlayingOpen] = useState(true);'],
    ['useState<NavidromeApi | null>(null)', "useState<NavidromeApi | null>(new NavidromeApi({ server: 'https://fixture.invalid', username: 'fixture' }, 'fixture'))"]
  ];
  for (const [from, to] of replacements) {
    assert.equal(source.split(from).length, 2, `Now Playing fixture must match once: ${from}`);
    source = source.replace(from, to);
  }
  const tests = String.raw`
    const sleep = (time = 50) => new Promise((resolve) => setTimeout(resolve, time));
    const waitFor = async (predicate, name) => { for (let i=0; i<80; i++) { if (predicate()) return; await sleep(); } throw new Error('Timed out: ' + name); };
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const report = { failures: [], checks: [] };
    const pass = (name) => report.checks.push(name);
    const tabs = () => [...document.querySelectorAll('.now-playing-tabs [role="tab"]')];
    (async () => {
      try {
        await waitFor(() => document.querySelector('.now-playing-screen'), 'now playing open');
        await sleep(300);
        const screen = document.querySelector('.now-playing-screen');
        const rect = screen.getBoundingClientRect();
        expect(Math.abs(rect.bottom - window.innerHeight) <= 1, 'Now Playing must extend to the window bottom (no black band), bottom=' + rect.bottom + ' window=' + window.innerHeight);
        expect(getComputedStyle(screen).backgroundColor === getComputedStyle(document.querySelector('.app-shell')).backgroundColor, 'Now Playing background must follow the app theme');
        expect(document.querySelector('footer.player'), 'Player footer must stay mounted underneath Now Playing to avoid flicker');
        pass('full-bleed black screen reaches the window bottom');
        const main = document.querySelector('.now-playing-main');
        const grid = document.querySelector('.now-playing-grid');
        const art = document.querySelector('.now-playing-art').getBoundingClientRect();
        if (window.innerWidth > 720) {
          expect(grid.scrollHeight <= grid.clientHeight + 1, 'Now Playing grid must not scroll vertically: scroll=' + grid.scrollHeight + ' client=' + grid.clientHeight);
          expect(main.scrollHeight <= main.clientHeight + 1, 'Left column must fit on screen without scrolling: scroll=' + main.scrollHeight + ' client=' + main.clientHeight);
          expect(Math.abs(art.width - art.height) <= 1 && art.width <= 401, 'Cover must be a square that shrinks to fit, got ' + Math.round(art.width) + 'x' + Math.round(art.height));
          pass('cover scales down to fit; the whole column stays on screen without scrolling');
        } else {
          expect(Math.abs(art.width - art.height) <= 1 && art.width > 200, 'Mobile layout must keep a readable square cover, got ' + Math.round(art.width) + 'x' + Math.round(art.height));
          pass('mobile layout keeps a readable square cover');
        }
        expect(tabs().length === 2 && tabs()[0].getAttribute('aria-selected') === 'true', 'Up Next tab must be selected by default');
        const rows = () => [...document.querySelectorAll('.now-playing-queue-track')];
        expect(rows().length === 3, 'Up Next must list every queued track');
        expect(rows()[0].classList.contains('current'), 'Current track is not highlighted in Up Next');
        expect(document.querySelector('.now-playing-queue-meta').textContent.startsWith('1/3'), 'Queue position summary is wrong');
        rows()[1].click(); await sleep(100);
        expect(document.querySelector('.now-playing-meta h1').textContent === 'Track 2', 'Selecting an Up Next row did not switch tracks');
        expect(rows()[1].classList.contains('current') && document.querySelector('.now-playing-queue-meta').textContent.startsWith('2/3'), 'Queue highlight/position did not follow the selected track');
        pass('Up Next lists the queue, highlights and switches tracks');
        tabs()[1].click(); await sleep(200);
        const syncedList = document.querySelector('.lyrics-list.synced');
        expect(syncedList, 'Synced lyrics list was not rendered');
        expect(syncedList.querySelectorAll('.lyrics-line').length === 6, 'Synced lyric lines are missing');
        expect(syncedList.querySelector('.lyrics-line.active .lyrics-line-text')?.textContent === 'Synced line 1', 'The active lyric line is wrong');
        const blurOf = (line) => parseFloat(((getComputedStyle(line).filter || '').match(/blur\(([\d.]+)px\)/) || [])[1] || '-1');
        const lyricLines = [...syncedList.querySelectorAll('.lyrics-line')];
        expect(blurOf(lyricLines[1]) === 1 && blurOf(lyricLines[2]) === 2 && blurOf(lyricLines[3]) === 3, 'Graded blur 1/2/3px expected, got ' + [1, 2, 3].map((i) => blurOf(lyricLines[i])).join('/'));
        expect(parseFloat(getComputedStyle(lyricLines[3]).opacity) < parseFloat(getComputedStyle(lyricLines[1]).opacity), 'Opacity must fall with distance');
        expect(!/filter/.test(getComputedStyle(lyricLines[1]).transitionProperty), 'Blur must not be animated');
        expect(blurOf(syncedList.querySelector('.lyrics-line.active')) <= 0, 'The active line must stay sharp');
        expect(syncedList.querySelectorAll('.lyrics-spacer').length === 2, 'Centering spacers are missing');
        const checkHighlight = (text, percent) => {
          const active = syncedList.querySelector('.lyrics-line.active');
          const spans = active.querySelectorAll('.lyrics-line-text');
          if (spans.length > 1) {
            const tops = [...spans].map(span => { const range = document.createRange(); range.selectNodeContents(span); return range.getBoundingClientRect().top; });
            throw new Error('Duplicate lyric glyphs at y=' + tops.join('/') + ' for ' + text);
          }
          expect(active.textContent === text && blurOf(active) <= 0, 'The current lyric must be sharp and rendered once');
          const paint = getComputedStyle(spans[0]);
          expect(paint.backgroundImage === 'none' && paint.color === 'rgb(255, 255, 255)', 'Active line must be plain white without per-word fill (at ' + percent + '%)');
        };
        expect(document.querySelector('.lyrics-tools .settings-select'), 'The lyrics source selector is missing');
        const offsetLabel = () => document.querySelector('.lyrics-offset .lyrics-offset-input')?.value;
        expect(offsetLabel() === '0.0s', 'The lyrics offset must start at zero');
        document.querySelectorAll('.lyrics-offset button')[1].click(); await sleep(60);
        expect(offsetLabel() === '+0.5s', 'The forward offset button must advance lyrics timing');
        document.querySelector('.lyrics-offset button:first-child').click(); await sleep(60);
        expect(offsetLabel() === '0.0s', 'The back offset button must return to zero');
        const audio = document.querySelector('audio');
        // Control the media clock separately from browser timeupdate notifications.
        Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 45 });
        await audio.play(); audio.dispatchEvent(new Event('timeupdate')); await sleep(150);
        checkHighlight('仿佛你在身旁', 50);
        for (const [time, percent] of [[45.3, 51], [45.6, 52]]) {
          audio.currentTime = time; await sleep(45);
          checkHighlight('仿佛你在身旁', percent);
        }
        audio.pause(); await sleep(100);
        checkHighlight('仿佛你在身旁', 52);
        audio.currentTime = 39; audio.dispatchEvent(new Event('seeked')); await sleep(50);
        checkHighlight('仿佛你在身旁', 30);
        await audio.play(); audio.currentTime = 60; await sleep(50);
        checkHighlight('Synced line 3', 0);
        expect(lyricLines[1].textContent === '仿佛你在身旁' && getComputedStyle(lyricLines[1].firstElementChild).backgroundImage === 'none', 'The previous line must release its highlight');
        tabs()[0].click(); await sleep(100);
        tabs()[1].click(); await sleep(100);
        const restoredList = document.querySelector('.lyrics-list.synced');
        expect(restoredList.querySelector('.lyrics-line.active .lyrics-line-text')?.textContent === 'Synced line 3', 'The active line was lost when switching tabs');
        if (window.innerWidth > 720) {
          const tabTop = tabs()[0].getBoundingClientRect().top;
          expect(tabTop < grid.getBoundingClientRect().top, 'Queue and Lyrics tabs should use the space beside the toolbar');
          await waitFor(() => {
            const line = restoredList.querySelector('.lyrics-line.active').getBoundingClientRect();
            const center = line.top + line.height / 2 - restoredList.getBoundingClientRect().top;
            return Math.abs(center - restoredList.clientHeight * 0.42) < 2;
          }, 'active lyric just above the center after returning to Lyrics');
        }
        pass('Lyrics: graded class blur without filter transition, sharp active line, raised reading position restored when switching tabs');
        document.querySelector('.now-playing-menu-button').click(); await sleep(100);
        expect(document.querySelector('.track-context-menu'), 'Now Playing ... button did not open the track context menu, debug=' + JSON.stringify({ button: !!document.querySelector('.now-playing-menu-button'), w: window.innerWidth, h: window.innerHeight }));
        expect([...document.querySelectorAll('.track-context-menu button')].some((button) => button.textContent.trim() === 'Add to playlist' && button.disabled), 'Local mode should disable add-to-playlist in Now Playing');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep();
        expect(!document.querySelector('.track-context-menu'), 'Escape did not close the Now Playing context menu');
        pass('Now Playing ... button opens the shared track context menu');
        document.querySelector('.now-playing-toolbar button').click();
        await sleep(40);
        expect(document.querySelector('.now-playing-screen.leaving'), 'Closing must play the fade-out phase before unmounting');
        await sleep(350);
        expect(!document.querySelector('.now-playing-screen'), 'Now Playing did not close after the fade-out');
        expect(document.querySelector('footer.player'), 'Player footer must return after closing');
        pass('fade-out close restores the player footer');
      } catch (error) { report.failures.push(String(error.stack || error)); }
      const result = document.createElement('pre'); result.id = 'np-result'; result.textContent = JSON.stringify(report); result.style.display = 'none'; document.body.append(result);
    })();
  `;
  const entry = `${source}\nimport { createRoot } from 'react-dom/client';\n// Deterministic under virtual time: rAF runs as a zero-delay timer with a fake clock.\nlet rafNow = 0;\nglobalThis.requestAnimationFrame = (callback) => setTimeout(() => { rafNow += 50; callback(rafNow); }, 0);\nglobalThis.cancelAnimationFrame = (id) => clearTimeout(id);\n// Deterministic under virtual time: never let a stale scroll event close an open menu.\ndocument.addEventListener('scroll', (event) => { if (document.querySelector('.track-context-menu')) event.stopImmediatePropagation(); }, true);\n// No real network in tests: the online lyrics fallback must answer "not found",
// while the server fixture returns synced lyrics.
globalThis.fetch = async (url) => {
  const address = String(url);
  if (address.includes('getLyricsBySongId.view')) return { ok: true, status: 200, json: async () => ({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics: [{ synced: true, line: [1, 2, 3, 4, 5, 6].map((index) => ({ value: index === 2 ? '仿佛你在身旁' : 'Synced line ' + index, start: (index - 1) * 30000 })) }] } } }) };
  return { ok: false, status: 404, json: async () => null };
};\nconst audioStates = new WeakMap(); const audioSources = new WeakMap();\nObject.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return audioSources.get(this) || ''; }, set(value) { audioSources.set(this,value); } });\nObject.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return audioStates.get(this) !== true; } });\nHTMLMediaElement.prototype.load = function() { this.currentTime=0; };\nHTMLMediaElement.prototype.play = function() { audioStates.set(this,true); this.dispatchEvent(new Event('play')); return Promise.resolve(); };\nHTMLMediaElement.prototype.pause = function() { audioStates.set(this,false); this.dispatchEvent(new Event('pause')); };\ncreateRoot(document.getElementById('root')).render(<App />);\nif (!new URLSearchParams(location.search).has('static')) { ${tests} }`;
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('src'), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(join(directory, 'np.js'), bundle.outputFiles[0].text);
  const stylesheet = await readFile('src/styles.css', 'utf8');
  assert.ok(stylesheet.includes('@keyframes now-playing-in') && stylesheet.includes('@keyframes now-playing-out'), 'Now Playing fade keyframes are missing');
  assert.ok(stylesheet.includes('.now-playing-screen.leaving'), 'Now Playing leaving style is missing');
  const page = join(directory, 'np.html');
  // CSS animations do not advance under --virtual-time-budget; disable them for layout assertions.
  await writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${stylesheet}\n.now-playing-screen { animation: none !important; }</style><body><div id="root"></div><script>localStorage.setItem('tenma.language','en');localStorage.setItem('northstar.preferences',JSON.stringify({theme:'gray'}));localStorage.removeItem('tenma.localLibraryPath');</script><script src="np.js"></script></body></html>`);
  const browser = process.env.TENMA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  for (const [viewport, height] of [[1280, 960], [430, 960], [1100, 640]]) {
    const output = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--allow-file-access-from-files', `--window-size=${viewport},${height}`, '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const text = output.match(/<pre id="np-result"[^>]*>(.*?)<\/pre>/s)?.[1];
    assert.ok(text, `Missing Now Playing report for ${viewport}`);
    const report = JSON.parse(text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
    assert.deepEqual(report.failures, [], report.failures.join('\n'));
    console.log(`PASS: now-playing@${viewport}x${height}: ${report.checks.join('; ')}`);
  }
  if (process.env.TENMA_NOW_PLAYING_ARTIFACTS) {
    const artifacts = resolve(process.env.TENMA_NOW_PLAYING_ARTIFACTS); await mkdir(artifacts, { recursive: true });
    for (const [viewport, height] of [[1280, 960], [430, 960]]) {
      const screenshot = join(artifacts, `now-playing-${viewport}.png`);
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(directory, 'profile')}`, '--allow-file-access-from-files', `--window-size=${viewport},${height}`, '--virtual-time-budget=4000', `--screenshot=${screenshot}`, `${pathToFileURL(page).href}?static=1`], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(`SCREENSHOT: ${screenshot}`);
    }
  }
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
