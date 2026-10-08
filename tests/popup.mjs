import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../dist/', import.meta.url);
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!['/popup.html', '/popup.js', '/popup.css'].includes(pathname)) { response.writeHead(404).end(); return; }
  const type = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html';
  try { response.writeHead(200, { 'Content-Type': type }); response.end(await readFile(new URL(pathname.slice(1), root))); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/popup.html`;
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
let browser;
let tests = 0;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  async function pageFor(scenario, width = 380) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.clock.install();
    const errors = [];
    const remote = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!request.url().startsWith(url.replace('/popup.html', ''))) remote.push(request.url()); });
    await page.addInitScript((scenario) => {
      if (scenario.brave) Object.defineProperty(navigator, 'brave', { value: { isBrave: async () => true }, configurable: true });
      window.__actions = [];
      window.__copied = [];
      window.__scenario = scenario;
      const body = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const makeMessage = (id, code, receivedAt = Date.now(), html = false) => ({
        id, internalDate: String(receivedAt), payload: {
          headers: [{ name: 'Subject', value: scenario.subject || 'Your verification code' }, { name: 'From', value: scenario.sender || 'Example <login@example.com>' }],
          mimeType: html ? 'text/html' : 'text/plain', body: { data: body(html ?
            `<img src="https://example.invalid/tracker.png"><script>window.__unsafe=true</script><p>Your code is <b>${code}</b>.</p><blockquote>Your code is 999999.</blockquote>` : `Your verification code is ${code}.`) }
        }
      });
      let listener;
      let disconnectListener;
      let scanCount = 0;
      const port = {
        onMessage: { addListener: (fn) => { listener = fn; } },
        onDisconnect: { addListener: (fn) => { disconnectListener = fn; } },
        postMessage: (request) => {
          window.__actions.push(request);
          let result;
          if (request.action === 'status') result = { kind: 'status', configured: scenario.configured !== false, connected: scenario.connected !== false, extensionId: 'abcdefghijklmnopabcdefghijklmnop', setupMessage: scenario.brave ? 'Configure a Web Application OAuth client with the Brave redirect URL in the project README.' : undefined };
          if (request.action === 'connect') result = scenario.denied ? { kind: 'error', code: 'auth', message: 'Connection was not completed. Try connecting again.' } : { kind: 'connected' };
          if (request.action === 'disconnect') result = { kind: 'disconnected' };
          if (request.action === 'cancel') result = { kind: 'cancelled' };
          if (request.action === 'scan') {
            scanCount++;
            if (scenario.error) result = { kind: 'error', code: scenario.error, message: scenario.error === 'rate-limit' ? 'Gmail is limiting requests. Please wait before refreshing.' : 'Could not reach Gmail.', retryAt: Date.now() + 30_000 };
            else {
              let messages = [];
              if (!scenario.empty || (scenario.arriveOnScan && scanCount >= scenario.arriveOnScan)) {
                messages = [makeMessage('first', scenario.code || '001234', Date.now() - (scenario.oldBy || 10_000), scenario.html)];
                if (scenario.multiple) messages.push(makeMessage('second', '654321', Date.now() - 20_000));
                if (request.pageToken) messages = [makeMessage('third', '567890')];
              }
              result = { kind: 'scan', messages, email: 'alex@example.com', scannedAt: Date.now(), scanId: 'scan-1', nextPageToken: scenario.more && !request.pageToken ? 'page-2' : undefined };
            }
          }
          setTimeout(() => listener?.({ id: request.id, result }), request.action === 'scan' ? scenario.delay || 10 : 1);
        },
        disconnect: () => { listener = undefined; disconnectListener = undefined; }
      };
      Object.defineProperty(window, 'chrome', { value: { runtime: { connect: () => port } }, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => {
        if (scenario.copyFails) throw new Error('Blocked');
        window.__copied.push(text);
      } }, configurable: true });
    }, scenario);
    await page.goto(url);
    return { page, errors, remote };
  }
  async function run(name, scenario, check, width) {
    const { page, errors, remote } = await pageFor(scenario, width);
    try {
      await check(page);
      assert.deepEqual(errors, [], 'No browser errors');
      assert.deepEqual(remote, [], 'No remote resources');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
      tests++;
      console.log(`PASS ${name}`);
    } finally { await page.close(); }
  }

  await run('setup state displays the extension ID', { configured: false }, async (page) => {
    await page.getByRole('heading', { name: 'OAuth client needed' }).waitFor();
    await page.getByRole('button', { name: 'Copy extension ID' }).click();
    assert.deepEqual(await page.evaluate(() => window.__copied), ['abcdefghijklmnopabcdefghijklmnop']);
    assert.equal(await page.getByRole('button', { name: 'Connect Gmail' }).isVisible(), false);
    await page.screenshot({ path: fileURLToPath(new URL('setup.png', artifacts)) });
  });
  await run('explicit OAuth connection then code scan', { connected: false }, async (page) => {
    await page.getByRole('button', { name: 'Connect Gmail' }).click();
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__actions.map((item) => item.action)), ['status', 'connect', 'scan']);
  });
  await run('Brave routes every request to its web OAuth provider', { brave: true, connected: false }, async (page) => {
    await page.getByRole('button', { name: 'Connect Gmail' }).click();
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    assert.ok(await page.evaluate(() => window.__actions.every((item) => item.browser === 'brave')));
  });
  await run('Brave missing-client state shows the correct OAuth setup', { brave: true, configured: false }, async (page) => {
    await page.getByRole('heading', { name: 'OAuth client needed' }).waitFor();
    assert.match(await page.locator('#configuration-detail').textContent(), /Web Application/);
    assert.equal(await page.getByRole('button', { name: 'Connect Gmail' }).isVisible(), false);
  });
  await run('copy preserves leading zeros', {}, async (page) => {
    await page.getByRole('button', { name: 'Copy code 001234' }).click();
    await page.getByRole('status').filter({ hasText: 'Code copied.' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__copied), ['001234']);
    await page.locator('body').screenshot({ path: fileURLToPath(new URL('code.png', artifacts)) });
  });
  await run('ambiguous results require selection', { multiple: true, more: true }, async (page) => {
    await page.getByRole('heading', { name: 'Choose a code' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__copied), []);
    assert.equal(await page.locator('.candidate').count(), 2);
    await page.getByRole('button', { name: 'Check more recent messages' }).click();
    await page.getByRole('button', { name: 'Copy code 567890' }).waitFor();
    assert.equal(await page.locator('.candidate').count(), 3);
    const action = await page.evaluate(() => window.__actions.at(-1));
    assert.equal(action.pageToken, 'page-2'); assert.equal(action.scanId, 'scan-1');
    await page.screenshot({ path: fileURLToPath(new URL('choices.png', artifacts)) });
  });
  await run('HTML mail stays inert and drops quoted codes', { html: true }, async (page) => {
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    assert.equal(await page.locator('.candidate').count(), 1);
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  });
  await run('copy failure leaves code selectable', { copyFails: true }, async (page) => {
    await page.getByRole('button', { name: 'Copy code 001234' }).click();
    await page.getByRole('status').filter({ hasText: 'Could not copy.' }).waitFor();
    assert.equal(await page.locator('.otp').textContent(), '001234');
    assert.deepEqual(await page.evaluate(() => window.__copied), []);
  });
  await run('denied consent can be retried', { connected: false, denied: true }, async (page) => {
    await page.getByRole('button', { name: 'Connect Gmail' }).click();
    await page.getByRole('status').filter({ hasText: 'Connection was not completed.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Connect Gmail' }).isEnabled(), true);
  });
  await run('empty scan, timed waiting and cancellation', { empty: true }, async (page) => {
    await page.getByRole('heading', { name: 'No recent code' }).waitFor();
    await page.getByRole('button', { name: 'Wait for code' }).click();
    await page.getByRole('heading', { name: 'Waiting for your code' }).waitFor();
    await page.clock.runFor(5200);
    assert.equal(await page.evaluate(() => window.__actions.filter((item) => item.action === 'scan').length), 3);
    await page.getByRole('button', { name: 'Stop waiting' }).click();
    const count = await page.evaluate(() => window.__actions.filter((item) => item.action === 'scan').length);
    await page.clock.runFor(15_000);
    assert.equal(await page.evaluate(() => window.__actions.filter((item) => item.action === 'scan').length), count);
    assert.equal(await page.getByRole('button', { name: 'Wait for code' }).isVisible(), true);
  });
  await run('wait ends when a code arrives', { empty: true, arriveOnScan: 3 }, async (page) => {
    await page.getByRole('heading', { name: 'No recent code' }).waitFor();
    await page.getByRole('button', { name: 'Wait for code' }).click();
    await page.clock.runFor(5500);
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stop waiting' }).isVisible(), false);
  });
  await run('wait ends after one minute', { empty: true }, async (page) => {
    await page.getByRole('heading', { name: 'No recent code' }).waitFor();
    await page.getByRole('button', { name: 'Wait for code' }).click();
    await page.clock.runFor(60_100);
    await page.getByRole('heading', { name: 'No code arrived yet' }).waitFor();
    const count = await page.evaluate(() => window.__actions.filter((item) => item.action === 'scan').length);
    await page.clock.runFor(10_000);
    assert.equal(await page.evaluate(() => window.__actions.filter((item) => item.action === 'scan').length), count);
  });
  await run('rate limit disables requests until retry time', { error: 'rate-limit' }, async (page) => {
    await page.getByRole('status').filter({ hasText: 'Gmail is limiting requests.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Refresh codes' }).isEnabled(), false);
    assert.equal(await page.getByRole('button', { name: 'Wait for code' }).isEnabled(), false);
    await page.clock.runFor(31_000);
    assert.equal(await page.getByRole('button', { name: 'Refresh codes' }).isEnabled(), true);
  });
  await run('stale code cannot be copied', {}, async (page) => {
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    await page.clock.runFor(301_000);
    assert.equal(await page.getByRole('button', { name: 'Copy code 001234' }).isEnabled(), false);
  });
  await run('disconnect during a scan cannot restore results', { delay: 300 }, async (page) => {
    await page.getByRole('button', { name: 'Disconnect Gmail' }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole('button', { name: 'Connect Gmail' }).isVisible(), true);
    assert.equal(await page.locator('.candidate').count(), 0);
  });
  await run('long email content fits a narrow popup', { multiple: true, sender: 'Very long organization name <a-very-long-email-address@example-provider.com>', subject: 'A long verification message subject containing additional account context for your login' }, async (page) => {
    await page.getByRole('heading', { name: 'Choose a code' }).waitFor();
    const overlaps = await page.locator('.candidate').evaluateAll((rows) => rows.some((row) => {
      const code = row.querySelector('.otp').getBoundingClientRect();
      const button = row.querySelector('.copy-button').getBoundingClientRect();
      return code.right > button.left || row.scrollWidth > row.clientWidth;
    }));
    assert.equal(overlaps, false);
    await page.screenshot({ path: fileURLToPath(new URL('narrow.png', artifacts)) });
  }, 320);

  await run('eight digit code and icon controls fit without layout shift', { code: '00123456' }, async (page) => {
    const button = page.getByRole('button', { name: 'Copy code 00123456' });
    await button.waitFor();
    const before = await button.boundingBox();
    await button.click();
    const after = await button.boundingBox();
    assert.deepEqual(after, before);
    const fit = await page.locator('.code-row').evaluate((row) => {
      const code = row.querySelector('.otp').getBoundingClientRect();
      const copy = row.querySelector('.copy-button').getBoundingClientRect();
      return code.right <= copy.left;
    });
    assert.equal(fit, true);
    assert.equal(await button.getAttribute('title'), 'Copied');
  }, 320);

  await run('dark interface and disconnected disclosure', { connected: false }, async (page) => {
    await page.getByRole('button', { name: 'Connect Gmail' }).waitFor();
    assert.equal(await page.locator('body').evaluate((body) => getComputedStyle(body).colorScheme), 'dark');
    assert.equal(await page.locator('#setup').innerText().then((text) => text.includes('No email or codes are sent to AlexWorks.')), true);
    await page.locator('body').screenshot({ path: fileURLToPath(new URL('connect.png', artifacts)) });
  });

  await run('marketplace screenshot uses synthetic data', {}, async (page) => {
    await page.getByRole('button', { name: 'Copy code 001234' }).waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addStyleTag({ content: 'body { margin: 100px auto 0; }' });
    await page.screenshot({ path: fileURLToPath(new URL('store-code.png', artifacts)) });
    const mark = await page.locator('.brand-mark').innerHTML();
    const promo = await browser.newPage({ viewport: { width: 440, height: 280 } });
    try {
      await promo.setContent(`<!doctype html><html><head><style>
        * { box-sizing: border-box; } body { margin: 0; background: #090909; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: 0; }
        main { width: 440px; height: 280px; padding: 30px; display: flex; flex-direction: column; }
        header { display: flex; align-items: center; gap: 10px; font-size: 24px; font-weight: 600; }
        .mark { display: grid; place-items: center; width: 32px; height: 32px; background: #f4f4f5; color: #090909; border-radius: 4px; }
        svg { width: 18px; height: 18px; } h1 { margin: 27px 0 0; font-size: 30px; font-weight: 500; line-height: 1.2; }
        footer { margin-top: auto; padding-top: 14px; border-top: 1px solid #333; font: 10px ui-monospace, monospace; color: #b0b0b5; }
      </style></head><body><main><header><span class="mark">${mark}</span>CopyOTP</header><h1>Your login code.<br>Within reach.</h1><footer>GMAIL / READ ONLY / LOCAL PROCESSING</footer></main></body></html>`);
      await promo.screenshot({ path: fileURLToPath(new URL('store-promo.png', artifacts)) });
    } finally { await promo.close(); }
  });

  const names = ['manifest.json', 'background.js', 'popup.js', 'popup.html', 'popup.css', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'];
  const bytes = (await Promise.all(names.map(async (name) => (await stat(new URL(name, root))).size))).reduce((a, b) => a + b, 0);
  assert.ok(bytes < 250_000, `Package too large: ${bytes}`);
  console.log(`${tests} browser checks passed. Built extension: ${(bytes / 1024).toFixed(1)} KB.`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
