import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const configPath = new URL('../config.local.json', import.meta.url);
export const scope = 'https://www.googleapis.com/auth/gmail.readonly';

export async function loadConfig() {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // The public key fixes the unpacked extension ID. No private key is retained.
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config) {
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}

export function extensionId(publicKey) {
  return [...createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}
