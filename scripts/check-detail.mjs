import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Mount the real app and its playback handlers with isolated test-only initial detail data.
const directory = await mkdtemp(join(tmpdir(), 'tenma-detail-'));
try {
  const artwork = pathToFileURL(resolve('src-tauri/icons/128x128.png')).href;
  const songs = Array.from({ length: 5 }, (_, index) => ({
    id: index === 4 ? 'detail-song-0' : `detail-song-${index}`,
    title: `Track ${index + 1}`, artist: `Artist ${index + 1}`, artistId: `artist-${index + 1}`, album: 'Fixture album', albumId: 'detail-album', duration: 180 + index, bitRate: [128, 320, 256, 192, 128][index],
    coverArt: index === 1 ? undefined : index === 2 ? pathToFileURL(join(directory, 'missing-cover.png')).href : artwork,
    streamUrl: `fixture://track/${index}`
  }));
  const fixtures = {
    album: { id: 'detail-album', name: 'Fixture album', artist: 'Fixture artist', artistId: 'fixture-artist', coverArt: artwork, songCount: songs.length, songs },
    playlist: { id: 'detail-playlist', name: 'Fixture playlist', public: false, comment: 'Test playlist with individual track covers', owner: 'Listener', songCount: songs.length, duration: 910, coverArt: artwork, songs }
  };
  const targetPlaylist = { ...fixtures.playlist, id: 'target-playlist', name: 'Target playlist', songs: [] };
  const relatedAlbum = { ...fixtures.album, id: 'second-album', name: 'Second album', artist: 'Artist 1', artistId: 'artist-1' };
  const sameNameArtistAlbum = { ...fixtures.album, id: 'wrong-artist-album', name: 'Another same-name artist album', artist: 'Artist 1', artistId: 'different-artist-id' };
  const outsideAlbum = { ...fixtures.album, id: 'outside-album', name: 'Outside index album', artist: 'Outside artist', artistId: 'outside-artist' };
  const remotePlaylist = { ...fixtures.playlist, songs: songs.map((song, index) => index === 3 ? { ...song, albumId: outsideAlbum.id, album: outsideAlbum.name, artist: outsideAlbum.artist, artistId: outsideAlbum.artistId } : song) };
  let source = await readFile('src/App.tsx', 'utf8');
  const replacements = [
    ['pages: [loadPreferences().startPage]', "pages: [new URLSearchParams(location.search).get('view') === 'album' ? 'album' : 'playlist']"],
    ['useState<Album | null>(null)', `useState<Album | null>(${JSON.stringify(fixtures.album)})`],
    ['useState<Playlist | null>(null)', `useState<Playlist | null>(new URLSearchParams(location.search).has('remote') ? ${JSON.stringify(remotePlaylist)} : ${JSON.stringify(fixtures.playlist)})`],
    ['const [playlists, setPlaylists] = useState<Playlist[]>(emptyLocalPlaylists)', `const [playlists, setPlaylists] = useState<Playlist[]>(${JSON.stringify([fixtures.playlist, targetPlaylist])})`],
    ['const [albums, setAlbums] = useState<Album[]>(emptyLocalAlbums)', `const [albums, setAlbums] = useState<Album[]>(new URLSearchParams(location.search).has('remote') ? ${JSON.stringify([fixtures.album, relatedAlbum, sameNameArtistAlbum])} : ${JSON.stringify([fixtures.album, relatedAlbum])})`],
    ['useState<NavidromeApi | null>(null)', "useState<NavidromeApi | null>(() => new URLSearchParams(location.search).has('remote') ? new NavidromeApi({ server: 'https://fixture.invalid', username: 'fixture' }, 'fixture') : null)"]
  ];
  for (const [from, to] of replacements) {
    assert.equal(source.split(from).length, 2, `Test initialization must have one exact match: ${from}`);
    source = source.replace(from, to);
  }
  const tests = String.raw`
    const sleep = (time = 50) => new Promise((resolve) => setTimeout(resolve, time));
    const waitFor = async (predicate, name) => { for (let i=0; i<80; i++) { if (predicate()) return; await sleep(); } throw new Error('Timed out: ' + name); };
    // Under --virtual-time-budget, scroll-restoration events from earlier navigation can be
    // delivered right after the menu opens and immediately close it again. Let scrolling
    // settle first, and allow one retry so the assertion measures the menu, not the race.
    const settleMenu = async () => { await sleep(300); };
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const byText = (text) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
    const footerButton = (label) => document.querySelector('footer button[aria-label="' + label + '"]');
    const queueTitles = () => [...document.querySelectorAll('.queue-track-copy')].map((span) => span.firstChild.textContent);
    const currentTitle = () => document.querySelector('.track-label strong')?.textContent;
    const report = { failures: [], view: new URLSearchParams(location.search).get('view'), checks: [] };
    const pass = (name) => report.checks.push(name);
    (async () => {
      try {
        await waitFor(() => byText('Shuffle play'), 'details ready');
        await sleep(200);
        const rows = [...document.querySelectorAll('.detail-track')];
        expect(rows.length === 5, 'Missing song rows');
        expect(rows.every((row) => row.querySelector('.detail-track-cover')), 'Each song needs a thumbnail');
        expect(rows[2].querySelector('.cover-fallback'), 'Broken cover must show a placeholder');
        if (report.view === 'album') expect(rows[1].querySelector('img.detail-track-cover'), 'Missing album-track cover must use album art');
        else expect(rows[1].querySelector('.cover-fallback'), 'Missing playlist-track cover must use a placeholder');
        for (const row of rows) {
          const cover = row.querySelector('.detail-track-cover').getBoundingClientRect();
          const bounds = row.getBoundingClientRect();
          expect(cover.width >= 38 && Math.abs(cover.width - cover.height) < 1, 'Thumbnail size/square aspect ratio');
          expect(row.scrollWidth <= bounds.width + 1, 'Track row overflows horizontally');
          expect(cover.left >= bounds.left && cover.right <= bounds.right, 'Thumbnail outside row');
        }
        pass('individual covers, missing/broken placeholders, responsive row bounds');
        if (report.view === 'playlist') {
          const rate = getComputedStyle(rows[0].querySelector('.detail-track-bit-rate'));
          if (window.innerWidth > 720) expect(rows[0].querySelector('.detail-track-bit-rate').textContent === '128 kbps' && rate.display !== 'none', 'Bit rate column is missing');
          else expect(rate.display === 'none', 'Bit rate should be hidden at narrow widths');
          pass('bit rate values and narrow-screen column behavior');
        }
        const shell = document.querySelector('.app-shell');
        shell.classList.add('hide-song-durations');
        expect(getComputedStyle(rows[0].querySelector('.song-duration')).display === 'none', 'Duration preference not applied');
        const overflow = rows.filter((row) => row.scrollWidth > row.getBoundingClientRect().width + 1).map((row) => ({ page: document.querySelector('.detail-content h1')?.textContent, listClass: document.querySelector('.detail-track-list')?.className, width: row.getBoundingClientRect().width, scroll: row.scrollWidth, columns: getComputedStyle(row).gridTemplateColumns, children: [...row.children].map((child) => ({ className: child.className, left: child.getBoundingClientRect().left, right: child.getBoundingClientRect().right, scroll: child.scrollWidth })) }));
        expect(overflow.length === 0, 'Hidden duration breaks row grid: ' + JSON.stringify(overflow));
        shell.classList.remove('hide-song-durations');
        pass('hidden-duration preference');

        byText(report.view === 'album' ? 'Play album' : 'Play playlist').click();
        await waitFor(() => currentTitle() === 'Track 1' && footerButton('Pause'), 'normal playback');
        footerButton('Playback queue').click(); await sleep();
        expect(JSON.stringify(queueTitles()) === JSON.stringify(['Track 1','Track 2','Track 3','Track 4','Track 5']), 'Normal action must use source order');
        expect(footerButton('Shuffle').getAttribute('aria-pressed') === 'false', 'Normal play should disable shuffle');
        pass('normal play starts the original ordered queue');
        rows[4].click(); await sleep();
        expect(currentTitle() === 'Track 5', 'Clicking the duplicate-ID row selected the first occurrence');
        expect(document.querySelectorAll('.queue-track')[4].classList.contains('control-active'), 'Duplicate-ID row has the wrong queue position');
        pass('clicking a repeated-ID song selects its exact list entry');
        byText('Shuffle play').click(); await sleep();
        const randomized = queueTitles();
        expect(randomized.length === 5 && new Set(randomized).size === 5, 'Shuffle dropped a song or a repeated ID');
        expect(JSON.stringify(randomized) !== JSON.stringify(['Track 1','Track 2','Track 3','Track 4','Track 5']), 'Shuffle action did not reorder the queue');
        expect(currentTitle() === randomized[0], 'Shuffle starts the wrong queue entry');
        expect(footerButton('Shuffle').getAttribute('aria-pressed') === 'true', 'Shuffle mode indicator not enabled');
        pass('shuffle button creates and starts a full randomized queue');
        for (let i=1; i<randomized.length; i++) {
          footerButton('Next track').click(); await sleep();
          expect(currentTitle() === randomized[i], 'Next did not follow shuffled queue at ' + i);
        }
        footerButton('Previous track').click(); await sleep();
        expect(currentTitle() === randomized[3], 'Previous did not follow shuffled queue');
        footerButton('Next track').click(); await sleep();
        footerButton('Next track').click(); await sleep();
        expect(footerButton('Play'), 'End of non-repeating shuffled queue must stop');
        pass('next/previous follow queue without repeats; end of queue stops');
        byText('Shuffle play').click(); await sleep();
        const endedOrder = queueTitles();
        for (let i=1; i<endedOrder.length; i++) {
          document.querySelector('audio').dispatchEvent(new Event('ended')); await sleep();
          expect(currentTitle() === endedOrder[i], 'Natural end skipped the shuffled queue at ' + i);
        }
        document.querySelector('audio').dispatchEvent(new Event('ended')); await sleep();
        expect(footerButton('Play'), 'Natural end of queue must stop without repeat');
        footerButton('Repeat').click(); await sleep();
        footerButton('Next track').click(); await sleep();
        expect(currentTitle() === endedOrder[0], 'Repeating the queue must return to its first entry');
        footerButton('Repeat').click(); await sleep();
        pass('natural track endings and queue repeat use the same shuffled order');

        byText('Shuffle play').click(); await sleep();
        const audio = document.querySelector('audio');
        audio.currentTime = 37; audio.dispatchEvent(new Event('timeupdate'));
        const titleBefore = currentTitle(); const loadsBefore = window.fixtureAudioLoads;
        footerButton('Shuffle').click(); await sleep();
        expect(currentTitle() === titleBefore && audio.currentTime === 37 && window.fixtureAudioLoads === loadsBefore, 'Toggling shuffle off restarted the current track');
        expect(JSON.stringify(queueTitles()) === JSON.stringify(['Track 1','Track 2','Track 3','Track 4','Track 5']), 'Toggling shuffle off did not restore source order');
        footerButton('Shuffle').click(); await sleep();
        expect(currentTitle() === titleBefore && audio.currentTime === 37 && window.fixtureAudioLoads === loadsBefore, 'Toggling shuffle on restarted the current track');
        pass('shuffle toggles preserve current track and progress');
        byText(report.view === 'album' ? 'Play album' : 'Play playlist').click(); await sleep();
        expect(currentTitle() === 'Track 1' && queueTitles()[0] === 'Track 1', 'Ordered play failed after shuffle');
        footerButton('Playback queue').click();
        const getRows = () => [...document.querySelectorAll('.detail-track')];
        const openRowMenu = async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            await settleMenu();
            getRows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: 320, clientY: 300, button: 2 }));
            await sleep(200);
            const opened = document.querySelector('.track-context-menu');
            if (opened) return opened;
          }
          return null;
        };
        const visibleLink = (root, type) => [...root.querySelectorAll('button.metadata-link')].find((button) => button.getAttribute('aria-label')?.startsWith(type) && button.getBoundingClientRect().width > 0);
        const goBack = async () => { document.querySelector('.detail-back').click(); await sleep(); };
        const title = () => document.querySelector('.detail-content h1')?.textContent;
        const originalTitle = report.view === 'album' ? 'Fixture album' : 'Fixture playlist';
        const visibleMetadata = [...document.querySelectorAll('button.metadata-link')].filter((button) => button.getBoundingClientRect().width > 0);
        expect(visibleMetadata.length > 0, 'No visible metadata links');
        for (const button of visibleMetadata) {
          const style = getComputedStyle(button);
          expect(!style.textDecorationLine.includes('underline'), 'Metadata link should not be underlined by default');
          const hoverRule = [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.selectorText?.includes('.metadata-link:hover') && rule.style.textDecorationLine === 'underline'));
          expect(hoverRule, 'Hover underline rule is missing');
          expect(parseFloat(style.textUnderlineOffset) >= 3, 'Underline is too close to the text');
          button.focus();
          if (button.matches(':focus-visible')) {
            expect(parseFloat(getComputedStyle(button).textDecorationThickness) >= 2, 'Focused link should have a stronger underline');
          }
          button.blur();
        }
        pass('metadata links reveal underline only on hover or keyboard focus');
        const savedTitle = currentTitle(); const savedLoads = window.fixtureAudioLoads;
        audio.currentTime = 41; audio.dispatchEvent(new Event('timeupdate'));
        const scroller = document.querySelector('.content-scroll');
        scroller.scrollTop = 120; const originalScroll = scroller.scrollTop;
        if (report.view === 'album') {
          const headerLink = document.querySelector('.detail-meta button.metadata-link');
          expect(headerLink, 'Album artist name is not a button');
          headerLink.click(); await sleep();
          expect(document.querySelector('.artist-detail') && title() === 'Fixture artist', 'Album artist link opens wrong artist');
          await goBack();
          expect(title() === originalTitle, 'Back from album artist did not restore album');
          expect(Math.abs(scroller.scrollTop - originalScroll) <= 1, 'Back did not restore album scroll position');
        }
        visibleLink(getRows()[0], 'View artist').click(); await sleep();
        expect(document.querySelector('.artist-detail') && title() === 'Artist 1', 'Track artist link opens wrong artist');
        expect(currentTitle() === savedTitle && audio.currentTime === 41 && window.fixtureAudioLoads === savedLoads, 'Artist navigation changed playback');
        const second = [...document.querySelectorAll('.album-card')].find((button) => button.textContent.includes('Second album'));
        expect(second, 'Artist page does not expose its related album');
        expect(![...document.querySelectorAll('.album-card')].some((button) => button.textContent.includes('Another same-name artist')), 'Artist ID lookup mixed same-named artists');
        if (new URLSearchParams(location.search).has('remote')) expect(window.fixtureApiCalls.includes('getArtist.view:artist-1'), 'Remote artist navigation did not use getArtist with the supplied ID');
        second.click(); await sleep();
        expect(title() === 'Second album', 'Artist album card opened wrong album');
        document.querySelector('.detail-meta button.metadata-link').click(); await sleep();
        expect(title() === 'Artist 1' && document.querySelector('.artist-detail'), 'Second album artist link failed');
        await goBack(); expect(title() === 'Second album', 'Second album snapshot lost');
        await goBack(); expect(title() === 'Artist 1' && document.querySelector('.artist-detail'), 'Artist snapshot lost');
        await goBack(); expect(title() === originalTitle, 'Original detail snapshot replaced by another album');
        pass('artist navigation, nested detail history and scroll restoration without changing playback');
        if (report.view === 'playlist') {
          visibleLink(getRows()[0], 'View album').click(); await sleep();
          expect(title() === 'Fixture album' && byText('Play album'), 'Playlist album link opens wrong album');
          expect(getRows().length === 5, 'Playlist album link opened partial album');
          await goBack(); expect(title() === 'Fixture playlist', 'Back from album did not restore playlist');
          pass('playlist album names open the full matching album and back restores playlist');
          if (new URLSearchParams(location.search).has('remote')) {
            visibleLink(getRows()[3], 'View album').click(); await sleep();
            expect(title() === 'Outside index album', 'Unindexed remote album did not load by albumId');
            expect(window.fixtureApiCalls.includes('getAlbum.view:outside-album'), 'Unindexed album did not request getAlbum by ID');
            await goBack(); expect(title() === 'Fixture playlist', 'Back from unindexed album did not restore playlist');
            pass('remote unindexed album is fetched by ID');
          }
        }
        if (report.view !== 'playlist') {
          const rate = getComputedStyle(getRows()[0].querySelector('.detail-track-bit-rate'));
          if (window.innerWidth > 720) expect(rate.display !== 'none' && getRows()[0].querySelector('.detail-track-bit-rate').textContent === '128 kbps', 'Bit rate missing outside playlist detail');
          else expect(rate.display === 'none', 'Narrow-screen bit rate should be hidden');
          const row = getRows()[0];
          const anchoredMenu = await openRowMenu();
          expect(anchoredMenu, 'Right click missing outside playlist detail');
          expect(anchoredMenu.offsetParent === null, 'Context menu must stay viewport-anchored, not inside an animated ancestor');
          if (window.innerWidth > 720) {
            const menuRect = anchoredMenu.getBoundingClientRect();
            expect(Math.abs(menuRect.left - 320) <= 2 && Math.abs(menuRect.top - 300) <= 2, 'Context menu must open at the mouse position, got ' + Math.round(menuRect.left) + ',' + Math.round(menuRect.top));
          }
          byText('Go to artist').click(); await sleep();
          expect(document.querySelector('.artist-detail'), 'Context menu artist navigation failed outside playlist detail');
          await goBack(); expect(title() === originalTitle, 'Back after context menu failed outside playlist detail');
          await settleMenu();
          getRows()[0].querySelector('.detail-track-menu-button').click(); await sleep(100);
          expect(document.querySelector('.track-context-menu'), 'Menu button missing outside playlist detail');
          byText('Go to album').click(); await sleep();
          expect(title() === 'Fixture album', 'Context menu album navigation failed outside playlist detail');
          await goBack(); expect(title() === originalTitle, 'Back after album context menu failed outside playlist detail');
          if (!new URLSearchParams(location.search).has('remote')) expect(byText('Add to playlist').disabled, 'Local mode should disable add-to-playlist everywhere');
          pass('bit rate and right-click menu in album/artist detail views');
        }
        if (report.view === 'playlist') {
          const openContextMenu = async () => {
            const row = getRows()[0];
            window.contextDebug = [];
            window.contextObserver?.disconnect();
            window.contextObserver = new MutationObserver(() => window.contextDebug.push(document.querySelector('.track-context-menu') ? 'menu-open' : 'menu-closed'));
            window.contextObserver.observe(document.body, { childList: true, subtree: true });
            const opened = await openRowMenu();
            if (!opened) {
              throw new Error('Right click did not open: ' + JSON.stringify({ page: title(), list: document.querySelector('.detail-track-list')?.className, rows: getRows().length, button: !!row.querySelector('.detail-track-menu-button'), events: window.contextDebug }));
            }
            await waitFor(() => document.querySelector('.track-context-menu'), 'track context menu');
            await sleep(100);
            const anchoredMenu = document.querySelector('.track-context-menu');
            expect(anchoredMenu.offsetParent === null, 'Context menu must stay viewport-anchored, not inside an animated ancestor');
            if (window.innerWidth > 720) {
              const menuRect = anchoredMenu.getBoundingClientRect();
              expect(Math.abs(menuRect.left - 320) <= 2 && Math.abs(menuRect.top - 300) <= 2, 'Context menu must open at the mouse position, got ' + Math.round(menuRect.left) + ',' + Math.round(menuRect.top));
            }
          };
          const menuLoadCount = window.fixtureAudioLoads;
          await openContextMenu();
          expect(byText('Go to artist') && byText('Go to album'), 'Context menu is missing navigation actions');
          expect(currentTitle() === savedTitle && window.fixtureAudioLoads === menuLoadCount, 'Right click played a track');
          byText('Go to artist').click(); await sleep();
          expect(document.querySelector('.artist-detail') && title() === 'Artist 1', 'Context-menu Go to artist failed');
          await goBack(); expect(title() === 'Fixture playlist', 'Back after context-menu artist navigation failed');
          await openContextMenu(); byText('Go to album').click(); await sleep();
          expect(title() === 'Fixture album', 'Context-menu Go to album failed');
          await goBack(); expect(title() === 'Fixture playlist', 'Back after context-menu album navigation failed');
          await openContextMenu();
          if (new URLSearchParams(location.search).has('remote')) {
            byText('Add to playlist').click(); await sleep();
            byText('Target playlist').click(); await sleep(120);
            expect(window.fixtureApiCalls.some((call) => call.startsWith('updatePlaylist.view:')), 'Context menu did not call updatePlaylist for target');
            expect(document.querySelector('.toast')?.textContent.includes('Added to Target playlist'), 'Playlist add success feedback missing');
            const updatesBefore = window.fixtureApiCalls.filter((call) => call.startsWith('updatePlaylist.view:')).length;
            await openContextMenu();
            byText('Add to playlist').click(); await sleep();
            const duplicateOption = byText('Fixture playlist');
            expect(duplicateOption, 'Duplicate target option missing: ' + JSON.stringify({ menu: !!document.querySelector('.track-context-menu'), options: [...document.querySelectorAll('.track-context-menu button')].map((button) => button.textContent.trim()) }));
            duplicateOption.click(); await sleep(150);
            expect(window.fixtureApiCalls.filter((call) => call.startsWith('updatePlaylist.view:')).length === updatesBefore, 'Duplicate add must not call updatePlaylist again');
            expect(document.querySelector('.toast')?.textContent.includes('already in'), 'Duplicate add must show an already-in-playlist notice');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep();
          } else {
            expect(byText('Add to playlist').disabled, 'Add to playlist should be unavailable without a server connection');
          }
          await sleep();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep();
          expect(!document.querySelector('.track-context-menu'), 'Escape did not close context menu');
          await settleMenu();
          getRows()[0].querySelector('.detail-track-menu-button').click();
          await waitFor(() => document.querySelector('.track-context-menu'), 'small-screen menu button');
          await sleep(100);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          pass('context-menu navigation, right-click versus playback, add-to-playlist, disabled local mode and menu button');
        }
        expect(!document.querySelector('button button'), 'Nested interactive buttons in track rows');
        expect(currentTitle() === savedTitle && audio.currentTime === 41 && window.fixtureAudioLoads === savedLoads, 'Metadata navigation changed the queue, track or progress');
      } catch (error) { report.failures.push(String(error.stack || error)); }
      const result = document.createElement('pre'); result.id='detail-result'; result.textContent=JSON.stringify(report); result.style.display='none'; document.body.append(result);
    })();
  `;
  const entry = `${source}\nimport { createRoot } from 'react-dom/client';\n// Keep context-menu assertions deterministic under --virtual-time-budget: timers fast-forward\n// without frames, so a stale scroll-restoration event can close a freshly opened menu mid-test.\n// Scroll handling is paused only while a menu is open; no test scrolls an open menu.\ndocument.addEventListener('scroll', (event) => { if (document.querySelector('.track-context-menu')) event.stopImmediatePropagation(); }, true);\nwindow.fixtureApiCalls=[]; globalThis.fetch=async(url)=>{const address=new URL(url), endpoint=address.pathname.split('/').pop(), id=address.searchParams.get('id');window.fixtureApiCalls.push(endpoint+':'+id);const album=(${JSON.stringify([fixtures.album, relatedAlbum, outsideAlbum])}).find((item)=>item.id===id);return {ok:true,json:async()=>({'subsonic-response':{status:'ok',...(endpoint==='getArtist.view'?{artist:{id,album:(${JSON.stringify([fixtures.album, relatedAlbum])}).filter((item)=>item.artistId===id)}}:endpoint==='getPlaylists.view'?{playlists:{playlist:(${JSON.stringify([fixtures.playlist, targetPlaylist])})}}:endpoint==='getPlaylist.view'?{playlist:{id, name:(${JSON.stringify(fixtures.playlist)}).name, entry: id==='target-playlist'?[]:(${JSON.stringify(fixtures.playlist)}).songs}}:{album:album?{...album,song:album.songs}:undefined})}})}};\nconst audioStates = new WeakMap(); const audioSources = new WeakMap(); window.fixtureAudioLoads = 0;\nObject.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return audioSources.get(this) || ''; }, set(value) { audioSources.set(this,value); } });\nObject.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return audioStates.get(this) !== true; } });\nHTMLMediaElement.prototype.load = function() { window.fixtureAudioLoads++; this.currentTime=0; };\nHTMLMediaElement.prototype.play = function() { audioStates.set(this,true); this.dispatchEvent(new Event('play')); return Promise.resolve(); };\nHTMLMediaElement.prototype.pause = function() { audioStates.set(this,false); this.dispatchEvent(new Event('pause')); };\nlet seed=7; Math.random=()=>((seed=(seed*16807)%2147483647)-1)/2147483646;\ncreateRoot(document.getElementById('root')).render(<App />);\n${tests}`;
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('src'), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(join(directory, 'detail.js'), bundle.outputFiles[0].text);
  const stylesheet = await readFile('src/styles.css', 'utf8');
  const page = join(directory, 'detail.html');
  await writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${stylesheet}\n.content-page { animation: none; }</style><body><div id="root"></div><script>localStorage.setItem('tenma.language','en');localStorage.setItem('northstar.preferences',JSON.stringify({theme:'noir'}));localStorage.removeItem('tenma.localLibraryPath');</script><script src="detail.js"></script></body></html>`);
  const browser = process.env.TENMA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  for (const [view, viewport, remote = false] of [['album', 1280], ['playlist', 1280], ['album', 430], ['playlist', 430], ['album', 1280, true], ['playlist', 1280, true]]) {
    const output = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--allow-file-access-from-files', `--window-size=${viewport},960`, '--virtual-time-budget=40000', '--dump-dom', `${pathToFileURL(page).href}?view=${view}${remote ? '&remote=1' : ''}`], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore','pipe','pipe'] });
    const text = output.match(/<pre id="detail-result"[^>]*>(.*?)<\/pre>/s)?.[1];
    assert.ok(text, `Missing browser interaction report for ${view}@${viewport}`);
    const report = JSON.parse(text.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"'));
    assert.deepEqual(report.failures, [], report.failures.join('\n'));
    console.log(`PASS: ${remote ? 'remote ' : 'local '}${view}@${viewport}: ${report.checks.join('; ')}`);
    if (process.env.TENMA_DETAIL_ARTIFACTS && viewport === 1280 && (!remote || view === 'playlist')) {
      const artifacts = resolve(process.env.TENMA_DETAIL_ARTIFACTS); await mkdir(artifacts, { recursive: true });
      const screenshot = join(artifacts, `${view}${remote ? '-remote' : ''}-detail.png`);
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(directory,'profile')}`, '--allow-file-access-from-files', '--window-size=1280,960', '--virtual-time-budget=10000', `--screenshot=${screenshot}`, `${pathToFileURL(page).href}?view=${view}`], { timeout:60000, stdio:['ignore','ignore','pipe'] });
      console.log(`SCREENSHOT: ${screenshot}`);
    }
  }
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
