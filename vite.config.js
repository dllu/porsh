import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(projectRoot, 'local-models', 'wwc', 'protection-manifest.json');
const protectedDirectory = resolve(projectRoot, 'public', 'models', 'protected');
const modelRuntimeModule = 'virtual:p959-model-runtime';
const modelWorkerKeyModule = 'virtual:p959-model-worker-key';
const resolvedModelRuntimeModule = `\0${modelRuntimeModule}`;
const resolvedModelWorkerKeyModule = `\0${modelWorkerKeyModule}`;

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

function protectedModelPlugin(manifest) {
  const modelMeta = {
    formatVersion: manifest.formatVersion,
    publicPath: manifest.publicPath,
    payloadBytes: manifest.payloadBytes,
    sourceBytes: manifest.sourceBytes,
  };

  return {
    name: 'p959-protected-model',
    resolveId(source) {
      if (source === modelRuntimeModule) return resolvedModelRuntimeModule;
      if (source === modelWorkerKeyModule) return resolvedModelWorkerKeyModule;
      return null;
    },
    load(id) {
      if (id === resolvedModelRuntimeModule) {
        return [
          `export const modelMeta = ${JSON.stringify(modelMeta)};`,
          `export const keyShareA = ${JSON.stringify(manifest.keyShareA)};`,
        ].join('\n');
      }
      if (id === resolvedModelWorkerKeyModule) {
        return `export const keyShareB = ${JSON.stringify(manifest.keyShareB)};`;
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  const manifest = loadProtectedModelConfig();
  return {
    base: './',
    plugins: [protectedModelPlugin(manifest)],
    worker: {
      plugins: () => [protectedModelPlugin(manifest)],
    },
  };
});
