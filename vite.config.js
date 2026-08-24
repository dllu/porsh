import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(projectRoot, 'local-models', 'wwc', 'protection-manifest.json');
const protectedDirectory = resolve(projectRoot, 'public', 'models', 'protected');

function loadProtectedModelConfig() {
  if (!existsSync(manifestPath)) {
    throw new Error('Protected model manifest is missing. Run `npm run setup:model` before starting Vite.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const payloadPath = resolve(projectRoot, 'public', manifest.publicPath ?? '');
  const protectedPrefix = `${protectedDirectory}${sep}`;
  if (!payloadPath.startsWith(protectedPrefix) || !existsSync(payloadPath)) {
    throw new Error('Protected model payload is missing or invalid. Run `npm run protect:model`.');
  }
  if (statSync(payloadPath).size !== manifest.payloadBytes) {
    throw new Error('Protected model payload is incomplete. Run `npm run protect:model -- --force`.');
  }

  return manifest;
}

export default defineConfig(() => {
  const manifest = loadProtectedModelConfig();
  return {
    base: './',
    define: {
      __P959_MODEL_META__: JSON.stringify({
        formatVersion: manifest.formatVersion,
        publicPath: manifest.publicPath,
        payloadBytes: manifest.payloadBytes,
        sourceBytes: manifest.sourceBytes,
      }),
      __P959_MODEL_KEY_SHARE_A__: JSON.stringify(manifest.keyShareA),
      __P959_MODEL_KEY_SHARE_B__: JSON.stringify(manifest.keyShareB),
    },
  };
});
