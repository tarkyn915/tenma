import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Each phase runs the real production entry point in a new Edge process with
// the same isolated profile. Replace only the browser transport, not App/API.
function setup(phase) {
  if (phase === 'disconnect') {
    for (const [key, value] of Object.entries({ server: 'https://a.invalid', username: 'user-a', password: 'pass-a', rememberPassword: 'true' })) {
      localStorage.setItem('northstar.' + key, value);
    }
  }
  window.calls = [];
  window.fetch = async (input) => {
    const url = new URL(input);
    window.calls.push(url.href);
    const status = phase === 'reject' ? 'failed' : 'ok';
    return Response.json({ 'subsonic-response': { status, error: { code: 40 } } });
  };
}

async function run(phase) {
  const report = document.querySelector('#result');
  const $ = (selector) => document.querySelector(selector);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (ok, message) => { if (!ok) throw Error(message); };
  async function wait(selector) {
    for (let i = 0; i < 100; i++) { if ($(selector)) return $(selector); await delay(25); }
    throw Error('Missing ' + selector);
  }
  async function click(selector) { (await wait(selector)).click(); await delay(25); }
  const tabs = '.library-mode-switch button';
  const form = '.settings-form';
  async function fill(selector, value) {
    const el = await wait(form + ' ' + selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(25);
  }
  try {
    const startup = phase === 'disconnect' || phase === 'reconnect';
    await wait(startup ? '.server-switcher-button .online' : '.server-switcher-button');
    await click('.server-switcher-button');
    await click('.server-add');
    await wait(tabs);
    if (startup) {
      if (!$(tabs + ':last-child.active')) await click(tabs + ':last-child');
      const summary = await wait('.connection-summary');
      const host = phase === 'disconnect' ? 'a.invalid' : 'b.invalid';
      check(summary.textContent.includes(host), 'Connected summary must identify ' + host);
      if (phase === 'disconnect') {
        const before = calls.length;
        await click('.danger-button');
        await wait(form);
        check($(tabs + ':last-child').getAttribute('aria-pressed') === 'true', 'Disconnect left remote tab');
        await click(tabs + ':first-child');
        await wait('.local-library-settings');
        await click(tabs + ':last-child');
        await wait(form);
        await delay(250);
        check(calls.length === before, 'Disconnect or tab browsing initiated a request');
      }
    } else {
      await click(tabs + ':last-child');
      await wait(form);
      await delay(250);
      check(calls.length === 0, 'Startup or remote tab reconnected before submission');
      await fill('input[type=url]', 'https://b.invalid');
      await fill('[autocomplete=username]', 'user-b');
      await fill('input[type=password]', 'pass-b');
      const remember = $(form + ' input[type=checkbox]');
      if (!remember.checked) remember.click();
      await click(form + ' .primary-button');
      if (phase === 'reject') {
        await wait('.toast.error');
        await wait(form + ' .primary-button:not(:disabled)');
        check(calls.length === 1 && !$('.connection-summary'), 'Failed B should not establish a session');
      } else check((await wait('.connection-summary')).textContent.includes('b.invalid'), 'B did not connect');
    }
    report.textContent = JSON.stringify({ calls });
  } catch (error) { report.textContent = JSON.stringify({ error: error.message, calls }); }
}

const directory = await mkdtemp(join(tmpdir(), 'tenma-connection-'));
try {
  await build({ entryPoints: ['src/main.tsx'], bundle: true, outfile: join(directory, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const page = join(directory, 'app.html');
  const browser = process.env.TENMA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  for (const phase of ['disconnect', 'reject', 'connect', 'reconnect']) {
    await writeFile(page, `<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="connect-src 'none'"><div id="root"></div><pre id="result"></pre><script>(${setup})('${phase}')</script><script src="app.js"></script><script>(${run})('${phase}')</script>`);
    const output = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${join(directory, 'profile')}`, '--allow-file-access-from-files', '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const text = output.match(/<pre id="result">(.*?)<\/pre>/s)?.[1];
    assert.ok(text, `${phase}: browser returned no test report (stdout length ${output.length})`);
    const { calls, error } = JSON.parse(text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    assert.ok(!error, `${phase}: ${error}; requests: ${calls.map((s) => new URL(s).pathname)}`);
    const id = phase === 'disconnect' ? 'a' : 'b';
    const urls = calls.map((s) => new URL(s));
    assert.equal(urls.filter((u) => u.pathname === '/rest/ping.view').length, 1, `${phase}: expected one connection attempt`);
    for (const { host, searchParams } of urls) {
      assert.equal(host, `${id}.invalid`);
      assert.equal(searchParams.get('u'), `user-${id}`);
      assert.equal(searchParams.get('t'), createHash('md5').update(`pass-${id}` + searchParams.get('s')).digest('hex'), `${phase}: wrong password`);
    }
    console.log(`PASS: ${phase}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
