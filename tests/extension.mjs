import { chromium } from 'playwright';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { extensionId } from '../scripts/config.mjs';

const extension = fileURLToPath(new URL('../dist/', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'copyotp-chrome-'));
let context;
try {
  // Use Chromium or Chrome for Testing; regular Chrome may disable sideload flags.
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH,
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
  if (!manifest.oauth2) {
    await page.getByRole('heading', { name: 'OAuth client needed' }).waitFor();
    assert.equal(await page.locator('#extension-id').textContent(), id);
  } else await page.getByRole('button', { name: 'Connect Gmail' }).waitFor();
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(stored, {}, 'Loading alone never connects or stores email data');
  assert.deepEqual(errors, [], 'Real extension popup has no browser errors');
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../artifacts/extension.png', import.meta.url)) });
  console.log(`PASS actual extension loads, starts its worker, and opens its popup (${id})`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
