import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { extensionId, scope } from '../scripts/config.mjs';

const exec = promisify(execFile);
const fixtureClient = '1234567890-testclient.apps.googleusercontent.com';
const generate = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;

async function fixture(run: (root: string, publicKey: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'copyotp-release-test-'));
  const publicKey = generate().export({ type: 'spki', format: 'der' }).toString('base64');
  try {
    await mkdir(join(root, 'scripts'));
    for (const script of ['config.mjs', 'package.mjs', 'store-key.mjs', 'configure.mjs']) {
      await copyFile(new URL(`../scripts/${script}`, import.meta.url), join(root, 'scripts', script));
    }
    await writeFile(join(root, 'config.local.json'), JSON.stringify({ publicKey, clientId: fixtureClient, webClientId: fixtureClient }));
    await run(root, publicKey);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('store key import verifies identity and clears a client bound to the previous ID', async () => fixture(async (root) => {
  const storeKey = generate();
  const publicKey = storeKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await writeFile(join(root, 'store.pem'), storeKey.export({ type: 'spki', format: 'pem' }));
  await exec(process.execPath, ['scripts/store-key.mjs', 'store.pem', extensionId(publicKey)], { cwd: root });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'config.local.json'), 'utf8')), { publicKey });
}));

test('a mismatched store key cannot change local configuration', async () => fixture(async (root, publicKey) => {
  const before = await readFile(join(root, 'config.local.json'), 'utf8');
  await writeFile(join(root, 'store.pem'), generate().export({ type: 'spki', format: 'pem' }));
  await assert.rejects(exec(process.execPath, ['scripts/store-key.mjs', 'store.pem', extensionId(publicKey)], { cwd: root }));
  assert.equal(await readFile(join(root, 'config.local.json'), 'utf8'), before);
}));

test('Brave configuration preserves Chrome identity and rejects invalid arguments', async () => fixture(async (root, publicKey) => {
  await writeFile(join(root, 'scripts', 'build.mjs'), 'export {};');
  const webClientId = '1234567890-webclient.apps.googleusercontent.com';
  await exec(process.execPath, ['scripts/configure.mjs', '--brave', webClientId], { cwd: root });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'config.local.json'), 'utf8')),
    { publicKey, clientId: fixtureClient, webClientId });
  const before = await readFile(join(root, 'config.local.json'), 'utf8');
  for (const args of [['--brave'], ['--brave', 'not-a-client'], [fixtureClient, 'extra']]) {
    await assert.rejects(exec(process.execPath, ['scripts/configure.mjs', ...args], { cwd: root }));
    assert.equal(await readFile(join(root, 'config.local.json'), 'utf8'), before);
  }
}));

test('draft and release ZIPs contain only allowed files and enforce identity/configuration gates', async () => fixture(async (root, publicKey) => {
  await mkdir(join(root, 'dist', 'icons'), { recursive: true });
  const manifest = { version: '0.2.0', key: publicKey, oauth2: { client_id: fixtureClient, scopes: [scope] } };
  await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify(manifest));
  const files = ['background.js', 'oauth-config.js', 'popup.js', 'popup.html', 'popup.css', 'THIRD_PARTY_NOTICES.txt', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'];
  for (const file of files) await writeFile(join(root, 'dist', file), 'synthetic file');
  const oauthConfig = `export const webClientId = ${JSON.stringify(fixtureClient)};\n`;
  await writeFile(join(root, 'dist', 'oauth-config.js'), oauthConfig);
  await writeFile(join(root, 'dist', 'private-email.txt'), 'must not ship');
  await writeFile(join(root, 'LICENSE'), 'MIT fixture');
  const run = (...args: string[]) => exec(process.execPath, ['scripts/package.mjs', ...args], { cwd: root });
  await assert.rejects(run());
  await assert.rejects(run('--id', 'a'.repeat(32)));
  await run('--draft');
  const draft = join(root, 'artifacts/releases/copyotp-0.2.0-draft.zip');
  const draftManifest = JSON.parse((await exec('unzip', ['-p', draft, 'manifest.json'])).stdout);
  assert.equal(draftManifest.key, undefined);
  assert.equal(draftManifest.oauth2, undefined);
  assert.equal((await exec('unzip', ['-p', draft, 'oauth-config.js'])).stdout, "export const webClientId = '';\n");
  await run('--id', extensionId(publicKey));
  const release = join(root, 'artifacts/releases/copyotp-0.2.0.zip');
  const contents = (await exec('unzip', ['-Z1', release])).stdout.trim().split('\n').sort();
  assert.deepEqual(contents, ['LICENSE', 'manifest.json', ...files].sort());
  const releaseManifest = JSON.parse((await exec('unzip', ['-p', release, 'manifest.json'])).stdout);
  assert.equal(releaseManifest.key, undefined);
  assert.deepEqual(releaseManifest.oauth2, manifest.oauth2);
  assert.equal((await exec('unzip', ['-p', release, 'oauth-config.js'])).stdout, oauthConfig);
  await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify({ ...manifest, oauth2: undefined }));
  await assert.rejects(run('--id', extensionId(publicKey)));
}));
