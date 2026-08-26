import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(projectRoot, 'local-models', 'wwc-advanced', 'protection-manifest.json');
const protectedDirectory = resolve(projectRoot, 'public', 'models', 'protected');
const basisDirectory = resolve(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
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
    modelScale: manifest.modelScale,
    modelFormat: manifest.modelFormat,
    textureCount: manifest.textureCount,
    assetVariant: manifest.assetVariant,
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

function basisTranscoderDevPlugin() {
  const assets = new Map([
    ['basis/basis_transcoder.js', {
      path: resolve(basisDirectory, 'basis_transcoder.js'),
      contentType: 'text/javascript; charset=utf-8',
    }],
    ['basis/basis_transcoder.wasm', {
      path: resolve(basisDirectory, 'basis_transcoder.wasm'),
      contentType: 'application/wasm',
    }],
  ]);

  return {
    name: 'p959-basis-transcoder-dev',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/^\//, '');
        const asset = assets.get(pathname);
        if (!asset) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', asset.contentType);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(readFileSync(asset.path));
      });
    },
  };
}

export default defineConfig(() => {
  const manifest = loadProtectedModelConfig();
  return {
    base: './',
    plugins: [protectedModelPlugin(manifest), basisTranscoderDevPlugin()],
    server: {
      watch: {
        ignored: ['**/local-models/**'],
      },
    },
    worker: {
      plugins: () => [protectedModelPlugin(manifest)],
    },
  };
});
