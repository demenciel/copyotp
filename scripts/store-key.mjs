import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig, saveConfig, extensionId } from './config.mjs';

const [path, expectedId] = process.argv.slice(2);
if (!path || !/^[a-p]{32}$/.test(expectedId || '')) {
  throw new Error('Usage: npm run store:key -- /path/to/store-public-key.pem STORE_ITEM_ID');
}
const input = await readFile(path, 'utf8');
if (input.includes('PRIVATE KEY')) throw new Error('Use the public key from the Web Store, never a private key.');
const key = createPublicKey(input.includes('BEGIN PUBLIC KEY') ? input : {
  key: Buffer.from(input.replace(/\s/g, ''), 'base64'), format: 'der', type: 'spki'
});
const publicKey = key.export({ type: 'spki', format: 'der' }).toString('base64');
if (extensionId(publicKey) !== expectedId) throw new Error('The public key does not match the store Item ID. No changes saved.');
const config = await loadConfig();
if (config.publicKey !== publicKey) {
  // A Chrome OAuth client is bound to an ID. Never carry it to a new identity.
  delete config.clientId;
  delete config.webClientId;
}
await saveConfig({ ...config, publicKey });
console.log(`Store key saved: ${expectedId}. Configure an OAuth client registered to this exact Item ID, then rebuild.`);
