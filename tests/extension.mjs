import { chromium } from 'playwright';
import { mkdtemp, rm, readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extensionId, loadConfig } from '../scripts/config.mjs';

const extension = fileURLToPath(new URL('../dist/', import.meta.url));
const brave = process.argv.includes('--brave');
const bravePaths = ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/usr/bin/brave-browser', '/usr/bin/brave'];
const executablePath = brave ? process.env.BRAVE_PATH || bravePaths.find(existsSync) : process.env.CHROME_PATH;
if (brave && !executablePath) throw new Error('Set BRAVE_PATH to your Brave executable.');
const config = await loadConfig();
const profile = await mkdtemp(join(tmpdir(), brave ? 'copyotp-brave-' : 'copyotp-chrome-'));
let context;
try {
  // Use Chromium or Chrome for Testing; regular Chrome may disable sideload flags.
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const id = new URL(worker.url()).hostname;
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  assert.equal(id, extensionId(manifest.key), 'Stable extension ID matches public key');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  if (brave) assert.equal(await page.evaluate(() => navigator.brave?.isBrave()), true, 'Real Brave detection works');
  if (brave ? !config.webClientId : !manifest.oauth2) {
    await page.getByRole('heading', { name: 'OAuth client needed' }).waitFor();
    assert.equal(await page.locator('#extension-id').textContent(), id);
    if (brave) assert.match(await page.locator('#configuration-detail').textContent(), /Web Application/);
  } else await page.getByRole('button', { name: 'Connect Gmail' }).waitFor();
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(stored, {}, 'Loading alone never connects or stores email data');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get(null)), {}, 'Loading never stores a session token');
  assert.deepEqual(errors, [], 'Real extension popup has no browser errors');
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(brave ? '../artifacts/brave-extension.png' : '../artifacts/extension.png', import.meta.url)) });
  console.log(`PASS actual ${brave ? 'Brave' : 'Chrome'} extension loads, detects its browser, starts its worker, and opens its popup (${id})`);
  if (brave) {
    await context.close();
    // The second isolated build substitutes only a synthetic public client ID.
    // Browser identity and Gmail responses are mocked, never live credentials.
    const fixture = join(profile, 'fixture');
    await cp(extension, fixture, { recursive: true });
    await writeFile(join(fixture, 'oauth-config.js'), 'export const webClientId = "1234567890-synthetic.apps.googleusercontent.com";\n');
    context = await chromium.launchPersistentContext(join(profile, 'synthetic-profile'), {
      executablePath, channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`]
    });
    const syntheticWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await syntheticWorker.evaluate(() => {
      globalThis.__authCalls = [];
      chrome.identity.getAuthToken = async () => { throw new Error('Brave must not use Chrome profile sign-in'); };
      chrome.identity.clearAllCachedAuthTokens = async () => { throw new Error('Brave must not depend on Chrome profile tokens'); };
      chrome.identity.launchWebAuthFlow = async (details) => {
        const url = new URL(details.url);
        globalThis.__authCalls.push(Object.fromEntries(url.searchParams));
        return chrome.identity.getRedirectURL() + '#' + new URLSearchParams({
          state: url.searchParams.get('state'), access_token: 'synthetic-token',
          token_type: 'Bearer', expires_in: '3600', scope: 'https://www.googleapis.com/auth/gmail.readonly'
        });
      };
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.origin !== 'https://gmail.googleapis.com' || options?.headers?.Authorization !== 'Bearer synthetic-token') {
          throw new Error('Unexpected fixture API request');
        }
        const result = url.pathname.endsWith('/profile') ? { emailAddress: 'synthetic@example.com' }
          : url.pathname.endsWith('/messages') ? { messages: [{ id: 'one' }] }
          : { id: 'one', internalDate: String(Date.now()), payload: { mimeType: 'text/plain',
            headers: [{ name: 'From', value: 'Example <login@example.com>' }, { name: 'Subject', value: 'Your verification code' }],
            body: { data: btoa('Your login code is 001234.') } } };
        return new Response(JSON.stringify(result));
      };
    });
    const syntheticPage = await context.newPage();
    await syntheticPage.goto(`chrome-extension://${id}/popup.html`);
    await syntheticPage.getByRole('button', { name: 'Connect Gmail' }).click();
    await syntheticPage.getByRole('button', { name: 'Copy code 001234' }).click();
    await syntheticPage.getByRole('status').filter({ hasText: 'Code copied.' }).waitFor();
    assert.deepEqual(await syntheticWorker.evaluate(() => chrome.storage.local.get(null)), { connected: true });
    const cache = await syntheticWorker.evaluate(() => chrome.storage.session.get(null));
    assert.equal(cache.webOAuth.accessToken, 'synthetic-token');
    const flows = await syntheticWorker.evaluate(() => globalThis.__authCalls);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].scope, 'https://www.googleapis.com/auth/gmail.readonly');
    assert.equal(flows[0].redirect_uri, `https://${id}.chromiumapp.org/`);
    await syntheticPage.screenshot({ path: fileURLToPath(new URL('../artifacts/brave-synthetic-code.png', import.meta.url)) });
    await syntheticPage.getByRole('button', { name: 'Disconnect Gmail' }).click();
    await syntheticWorker.evaluate(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!(await chrome.storage.session.get('webOAuth')).webOAuth) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Session token was not cleared');
    });
    assert.deepEqual(await syntheticWorker.evaluate(() => chrome.storage.local.get(null)), { connected: false });
    assert.equal(await syntheticPage.getByRole('status').isVisible(), false, 'Disconnect does not depend on Chrome Google-login settings');
    console.log('PASS Brave synthetic OAuth -> Gmail scan -> copy -> disconnect; no persistent token or real mailbox access');
  }
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
