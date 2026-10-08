import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionId, scope } from './config.mjs';

const args = process.argv.slice(2);
const draft = args.length === 1 && args[0] === '--draft';
const expectedId = args.length === 2 && args[0] === '--id' ? args[1] : undefined;
if (!draft && !/^[a-p]{32}$/.test(expectedId || '')) {
  throw new Error('Use --draft for the FIRST dashboard upload only, or --id STORE_ITEM_ID for a configured release.');
}
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
if (draft) {
  delete manifest.key;
  delete manifest.oauth2;
} else {
  if (!manifest.key || extensionId(manifest.key) !== expectedId) throw new Error('Build key does not match the supplied Store Item ID.');
  if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(manifest.oauth2?.client_id || '')) throw new Error('Configure a real Chrome Extension OAuth client before packaging.');
  if (JSON.stringify(manifest.oauth2.scopes) !== JSON.stringify([scope])) throw new Error('Unexpected OAuth scopes.');
  delete manifest.key;
}
const folder = fileURLToPath(new URL('../artifacts/releases/', import.meta.url));
await mkdir(folder, { recursive: true });
const archive = join(folder, `copyotp-${manifest.version}${draft ? '-draft' : ''}.zip`);
const stage = await mkdtemp(join(tmpdir(), 'copyotp-release-'));
try {
  await mkdir(join(stage, 'icons'));
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = ['background.js', 'oauth-config.js', 'popup.js', 'popup.html', 'popup.css', 'THIRD_PARTY_NOTICES.txt', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'];
  for (const file of files) await copyFile(join(dist, file), join(stage, file));
  if (draft) await writeFile(join(stage, 'oauth-config.js'), "export const webClientId = '';\n");
  await copyFile(fileURLToPath(new URL('../LICENSE', import.meta.url)), join(stage, 'LICENSE'));
  await rm(archive, { force: true });
  execFileSync('zip', ['-X', '-q', archive, 'manifest.json', 'LICENSE', ...files], { cwd: stage });
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  if (entries.length !== files.length + 2) throw new Error('Unexpected ZIP entries.');
  console.log(`${draft ? 'DRAFT ONLY - NOT FOR DISTRIBUTION' : 'Release - confirm OAuth client Item ID in Google Cloud'}\n${archive}\nmanifest.json is at the ZIP root. Local configuration and test artifacts are excluded.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
