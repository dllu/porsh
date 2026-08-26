import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { cpus } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 2;
const COMPRESSION_NONE = 0;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_SCRAMBLE_MULTIPLIER = 73;
const KEY_SCRAMBLE_OFFSET = 41;
const PAYLOAD_PATTERN = /^p959-[0-9a-f]{20}\.p9e$/;
const MAGIC = Buffer.from([0x50, 0x39, 0x35, 0x39, 0x45, 0x4e, 0x43, 0x00]);

const BUNDLE_HEADER_BYTES = 16;
const BUNDLE_FORMAT_VERSION = 1;
const BUNDLE_MAGIC = Buffer.from([0x50, 0x39, 0x35, 0x39, 0x42, 0x4e, 0x44, 0x00]);
const TEXTURE_PIPELINE_VERSION = 2;
const GEOMETRY_PIPELINE_VERSION = 2;
const ASSET_VARIANT = 'advanced-v2-indexed';
const MODEL_SCALE = 1;
const EXCLUDED_TEXTURES = new Set([
  'wwc_background.jpg',
  'wwc_environment.exr',
  'wwc_floor_opacity.jpg',
]);
const LAMP_TEXTURES = new Set([
  'glass-headlights_bump.jpg',
  'glass-orange_normal.jpg',
  'glass-red_normal.jpg',
  'glass_reflector_normal_2.jpg',
]);

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localModelDirectory = join(projectRoot, 'local-models', 'wwc-advanced');
export const sourceModelPath = join(localModelDirectory, '87_POR_959_wwc_ADV_v2.fbx');
export const indexedModelPath = join(localModelDirectory, '87_POR_959_wwc_ADV_v2.indexed.glb');
export const sourceLicensePath = join(localModelDirectory, 'License.txt');
export const sourceTextureDirectory = join(localModelDirectory, 'textures');
export const webTextureDirectory = join(localModelDirectory, 'web-textures');
export const protectedModelDirectory = join(projectRoot, 'public', 'models', 'protected');
export const manifestPath = join(localModelDirectory, 'protection-manifest.json');
const texturePipelineManifestPath = join(localModelDirectory, 'texture-pipeline.json');
const geometryPipelineManifestPath = join(localModelDirectory, 'geometry-pipeline.json');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function keyScrambleByte(index) {
  return ((index * KEY_SCRAMBLE_MULTIPLIER) + KEY_SCRAMBLE_OFFSET) & 0xff;
}

export function unwrapKey(keyShareAValue, keyShareBValue) {
  const keyShareA = Buffer.from(keyShareAValue, 'base64');
  const reversedKeyShareB = Buffer.from(keyShareBValue, 'base64');
  const keyShareB = Buffer.from(reversedKeyShareB).reverse();

  if (keyShareA.length !== KEY_BYTES || keyShareB.length !== KEY_BYTES) {
    throw new Error('The protected-model key material is invalid. Run `npm run setup:model` again.');
  }

  const key = Buffer.allocUnsafe(KEY_BYTES);
  for (let index = 0; index < KEY_BYTES; index += 1) {
    key[index] = keyShareA[index] ^ keyShareB[index] ^ keyScrambleByte(index);
  }

  keyShareA.fill(0);
  keyShareB.fill(0);
  reversedKeyShareB.fill(0);
  return key;
}

function buildHeader(sourceBytes, iv) {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(FORMAT_VERSION, 8);
  header.writeUInt8(COMPRESSION_NONE, 9);
  header.writeUInt16LE(HEADER_BYTES, 10);
  header.writeUInt32LE(sourceBytes, 12);
  iv.copy(header, 16);
  randomBytes(4).copy(header, 28);
  return header;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function payloadPathForManifest(manifest) {
  if (!manifest?.payloadFile || !PAYLOAD_PATTERN.test(manifest.payloadFile)) return null;
  return join(protectedModelDirectory, manifest.payloadFile);
}

function classifyTexture(name) {
  if (/_BaseColor\./i.test(name)) return 'color';
  if (/_Specular\./i.test(name)) return 'specular';
  if (/Normal|_normal|bump/i.test(name)) return 'normal';
  return 'data';
}

function textureOrientation(name) {
  return 'lower-left';
}

function textureResize(name) {
  if (/^interior-(common|fabric|leather|seats)_/i.test(name)) return '2048x2048';
  if (name === 'carpaint_Roughness.jpg') return '4096x4096';
  return null;
}

function listTextureSources() {
  if (!existsSync(sourceTextureDirectory)) return [];
  return readdirSync(sourceTextureDirectory)
    .filter((name) => /\.(?:jpe?g|png)$/i.test(name) && !EXCLUDED_TEXTURES.has(name))
    .sort()
    .map((name) => ({
      name,
      path: join(sourceTextureDirectory, name),
      outputName: name.replace(/\.[^.]+$/, '.ktx2'),
      role: classifyTexture(name),
      orientation: textureOrientation(name),
      resize: textureResize(name),
    }));
}

function collectSourceSignature(textureSources) {
  const modelStat = statSync(sourceModelPath);
  return {
    model: {
      name: '87_POR_959_wwc_ADV_v2.fbx',
      size: modelStat.size,
      modified: Math.trunc(modelStat.mtimeMs),
    },
    textures: textureSources.map((texture) => {
      const textureStat = statSync(texture.path);
      return {
        name: texture.name,
        size: textureStat.size,
        modified: Math.trunc(textureStat.mtimeMs),
        role: texture.role,
        orientation: texture.orientation,
        resize: texture.resize,
      };
    }),
  };
}

function signaturesMatch(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function geometryPipelineIsCurrent(manifest, modelSignature) {
  if (
    manifest?.pipelineVersion !== GEOMETRY_PIPELINE_VERSION
    || !signaturesMatch(manifest.sourceModel, modelSignature)
    || !existsSync(indexedModelPath)
  ) return false;

  const output = readFileSync(indexedModelPath);
  return output.length === manifest.byteLength && sha256(output) === manifest.sha256;
}

function prepareIndexedModel(modelSignature) {
  const previousManifest = readJson(geometryPipelineManifestPath);
  if (geometryPipelineIsCurrent(previousManifest, modelSignature)) {
    console.log(`Indexed geometry is current (${(previousManifest.byteLength / 1_000_000).toFixed(1)} MB GLB).`);
    return previousManifest;
  }

  const temporaryOutputPath = `${indexedModelPath}.${process.pid}.tmp`;
  rmSync(temporaryOutputPath, { force: true });
  console.log('Indexing FBX geometry for the protected web model...');
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=8192',
      join(projectRoot, 'scripts', 'build-indexed-model.mjs'),
      sourceModelPath,
      temporaryOutputPath,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 || !existsSync(temporaryOutputPath)) {
    rmSync(temporaryOutputPath, { force: true });
    throw new Error(`Indexed geometry build failed (exit ${result.status}).`);
  }

  const output = readFileSync(temporaryOutputPath);
  if (output.length < 1_000_000) {
    rmSync(temporaryOutputPath, { force: true });
    throw new Error('Indexed geometry output is unexpectedly small.');
  }
  renameSync(temporaryOutputPath, indexedModelPath);
  const manifest = {
    pipelineVersion: GEOMETRY_PIPELINE_VERSION,
    sourceModel: modelSignature,
    outputName: '87_POR_959_wwc_ADV_v2.indexed.glb',
    byteLength: output.length,
    sha256: sha256(output),
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomically(geometryPipelineManifestPath, manifest);
  return manifest;
}

function findToktx() {
  const candidates = [
    process.env.P959_TOKTX,
    process.env.TOKTX,
    join(projectRoot, 'local-models', '.tools', 'ktx-4.4.2', 'bin', 'toktx'),
    'toktx',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }

  throw new Error(
    'Khronos `toktx` is required to prepare the advanced textures. '
    + 'Install KTX-Software 4.4.2+ or set P959_TOKTX=/path/to/toktx.',
  );
}

function texturePipelineIsCurrent(manifest, sourceSignature) {
  if (
    manifest?.pipelineVersion !== TEXTURE_PIPELINE_VERSION
    || !signaturesMatch(manifest.sourceSignature, sourceSignature)
    || !Array.isArray(manifest.entries)
  ) return false;

  return manifest.entries.every((entry) => {
    const outputPath = join(webTextureDirectory, entry.outputName ?? '');
    return existsSync(outputPath) && statSync(outputPath).size === entry.byteLength;
  });
}

function encodeTexture(toktx, texture, index, count) {
  const outputPath = join(webTextureDirectory, texture.outputName);
  const temporaryOutputPath = join(
    webTextureDirectory,
    `${texture.outputName.replace(/\.ktx2$/, '')}.tmp-${process.pid}.ktx2`,
  );
  const transferFunction = texture.role === 'color' ? 'srgb' : 'linear';
  const primaries = texture.role === 'color' ? 'srgb' : 'none';
  const rdoLambda = texture.role === 'normal' ? '0.5' : texture.role === 'color' ? '0.75' : '1.0';
  const args = [
    '--t2',
    '--encode', 'uastc',
    '--uastc_quality', '2',
    '--uastc_rdo_l', rdoLambda,
    '--zcmp', '18',
    '--genmipmap',
    '--filter', 'lanczos4',
    texture.orientation === 'upper-left'
      ? '--upper_left_maps_to_s0t0'
      : '--lower_left_maps_to_s0t0',
    '--assign_oetf', transferFunction,
    '--assign_primaries', primaries,
    '--target_type', texture.role === 'specular' ? 'RGBA' : 'RGB',
    '--threads', String(Math.min(Math.max(cpus().length, 1), 8)),
  ];
  if (texture.role === 'specular') args.push('--input_swizzle', 'rrrr');
  if (texture.resize) args.push('--resize', texture.resize);
  args.push(temporaryOutputPath, texture.path);

  console.log(`[${index + 1}/${count}] Encoding ${texture.name}${texture.resize ? ` at ${texture.resize}` : ''}...`);
  const result = spawnSync(toktx, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') throw new Error(`Could not run toktx at ${toktx}.`);
  if (result.status !== 0) throw new Error(`toktx failed for ${texture.name} (exit ${result.status}).`);
  renameSync(temporaryOutputPath, outputPath);
}

function prepareWebTextures(textureSources, sourceSignature, rebuildTextures) {
  const previousManifest = readJson(texturePipelineManifestPath);
  if (!rebuildTextures && texturePipelineIsCurrent(previousManifest, sourceSignature)) {
    console.log(`Web texture set is current (${previousManifest.entries.length} KTX2 maps).`);
    return previousManifest;
  }

  const previousSignatures = new Map(
    previousManifest?.sourceSignature?.textures?.map((texture) => [texture.name, texture]) ?? [],
  );
  const currentSignatures = new Map(
    sourceSignature.textures.map((texture) => [texture.name, texture]),
  );
  const previousEntries = new Map(
    previousManifest?.entries?.map((entry) => [entry.sourceName, entry]) ?? [],
  );
  const canReuseEntries = !rebuildTextures
    && previousManifest?.pipelineVersion === TEXTURE_PIPELINE_VERSION;
  const texturesToEncode = textureSources.filter((texture) => {
    if (!canReuseEntries) return true;
    const previousEntry = previousEntries.get(texture.name);
    const outputPath = join(webTextureDirectory, texture.outputName);
    return !signaturesMatch(
      previousSignatures.get(texture.name),
      currentSignatures.get(texture.name),
    )
      || previousEntry?.outputName !== texture.outputName
      || !existsSync(outputPath)
      || statSync(outputPath).size !== previousEntry.byteLength;
  });

  if (texturesToEncode.length > 0) {
    const toktx = findToktx();
    mkdirSync(webTextureDirectory, { recursive: true });
    texturesToEncode.forEach((texture, index) => (
      encodeTexture(toktx, texture, index, texturesToEncode.length)
    ));
  }

  const entries = textureSources.map((texture) => {
    const outputPath = join(webTextureDirectory, texture.outputName);
    const output = readFileSync(outputPath);
    return {
      sourceName: texture.name,
      outputName: texture.outputName,
      role: texture.role,
      orientation: texture.orientation,
      byteLength: output.length,
      sha256: sha256(output),
    };
  });
  const manifest = {
    pipelineVersion: TEXTURE_PIPELINE_VERSION,
    sourceSignature,
    entries,
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomically(texturePipelineManifestPath, manifest);

  const expectedOutputs = new Set(entries.map((entry) => entry.outputName));
  for (const entry of readdirSync(webTextureDirectory)) {
    if (entry.endsWith('.ktx2') && !expectedOutputs.has(entry)) {
      rmSync(join(webTextureDirectory, entry));
    }
  }

  return manifest;
}

function buildAssetBundle(model, textureManifest) {
  const textureAssets = textureManifest.entries.map((entry) => ({
    buffer: readFileSync(join(webTextureDirectory, entry.outputName)),
    metadata: {
      kind: 'texture',
      name: entry.sourceName,
      role: entry.role,
      mimeType: 'image/ktx2',
      byteLength: entry.byteLength,
    },
  }));
  const assets = [
    {
      buffer: model,
      metadata: {
        kind: 'model',
        name: '87_POR_959_wwc_ADV_v2.indexed.glb',
        mimeType: 'model/gltf-binary',
        byteLength: model.length,
      },
    },
    ...textureAssets,
  ];
  const directory = Buffer.from(JSON.stringify({
    formatVersion: BUNDLE_FORMAT_VERSION,
    entries: assets.map((asset) => asset.metadata),
  }));
  const header = Buffer.alloc(BUNDLE_HEADER_BYTES);
  BUNDLE_MAGIC.copy(header, 0);
  header.writeUInt8(BUNDLE_FORMAT_VERSION, 8);
  header.writeUInt16LE(BUNDLE_HEADER_BYTES, 10);
  header.writeUInt32LE(directory.length, 12);
  return Buffer.concat([header, directory, ...assets.map((asset) => asset.buffer)]);
}

function validateAssetBundle(bundle, expectedTextureCount, expectedModelFormat) {
  if (bundle.length < BUNDLE_HEADER_BYTES || !bundle.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) {
    throw new Error('Protected asset bundle header is invalid.');
  }
  if (bundle.readUInt8(8) !== BUNDLE_FORMAT_VERSION || bundle.readUInt16LE(10) !== BUNDLE_HEADER_BYTES) {
    throw new Error('Protected asset bundle version is unsupported.');
  }
  const directoryBytes = bundle.readUInt32LE(12);
  const dataOffset = BUNDLE_HEADER_BYTES + directoryBytes;
  if (dataOffset > bundle.length) throw new Error('Protected asset bundle directory is invalid.');
  const directory = JSON.parse(bundle.subarray(BUNDLE_HEADER_BYTES, dataOffset).toString('utf8'));
  if (!Array.isArray(directory.entries)) throw new Error('Protected asset bundle entries are missing.');
  const modelEntries = directory.entries.filter((entry) => entry.kind === 'model');
  const textureEntries = directory.entries.filter((entry) => entry.kind === 'texture');
  const declaredBytes = directory.entries.reduce((total, entry) => total + entry.byteLength, 0);
  if (
    modelEntries.length !== 1
    || textureEntries.length !== expectedTextureCount
    || dataOffset + declaredBytes !== bundle.length
  ) throw new Error('Protected asset bundle contents are invalid.');
  if (
    expectedModelFormat === 'glb'
    && (
      modelEntries[0].mimeType !== 'model/gltf-binary'
      || !modelEntries[0].name.endsWith('.glb')
    )
  ) throw new Error('Protected asset bundle does not contain indexed GLB geometry.');
  return directory;
}

function previousPayloadIsCurrent(manifest, sourceSignature) {
  const payloadPath = payloadPathForManifest(manifest);
  return manifest?.formatVersion === FORMAT_VERSION
    && manifest?.assetVariant === ASSET_VARIANT
    && manifest?.texturePipelineVersion === TEXTURE_PIPELINE_VERSION
    && manifest?.geometryPipelineVersion === GEOMETRY_PIPELINE_VERSION
    && manifest?.modelFormat === 'glb'
    && signaturesMatch(manifest?.sourceSignature, sourceSignature)
    && payloadPath
    && existsSync(payloadPath)
    && statSync(payloadPath).size === manifest.payloadBytes
    && sha256(readFileSync(payloadPath)) === manifest.payloadSha256;
}

export function protectModel({ force = false, rebuildTextures = false } = {}) {
  if (!existsSync(sourceModelPath) || !existsSync(sourceTextureDirectory)) {
    throw new Error(
      `Advanced model assets are missing. Run \`npm run setup:model -- ~/Downloads/WireWheelsClub_87_POR_959_v2_ADV.zip\` first.`,
    );
  }

  const textureSources = listTextureSources();
  if (textureSources.length < 50) {
    throw new Error(`Expected the advanced PBR texture set, but found only ${textureSources.length} supported maps.`);
  }
  const sourceSignature = collectSourceSignature(textureSources);
  const previousManifest = readJson(manifestPath);
  if (!force && !rebuildTextures && previousPayloadIsCurrent(previousManifest, sourceSignature)) {
    console.log(`Protected advanced model is current: ${relative(projectRoot, payloadPathForManifest(previousManifest))}`);
    return { manifest: previousManifest, reused: true };
  }

  const textureManifest = prepareWebTextures(textureSources, sourceSignature, rebuildTextures);
  const geometryManifest = prepareIndexedModel(sourceSignature.model);
  const model = readFileSync(indexedModelPath);
  console.log(`Bundling ${Math.round(model.length / 1_000_000)} MB indexed GLB with ${textureManifest.entries.length} KTX2 maps...`);
  const bundle = buildAssetBundle(model, textureManifest);
  validateAssetBundle(bundle, textureManifest.entries.length, 'glb');
  const sourceSha256 = sha256(bundle);
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = buildHeader(bundle.length, iv);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(bundle), cipher.final(), cipher.getAuthTag()]);
  const payload = Buffer.concat([header, encrypted]);
  const payloadSha256 = sha256(payload);
  const payloadFile = `p959-${payloadSha256.slice(0, 20)}.p9e`;
  const payloadPath = join(protectedModelDirectory, payloadFile);

  const keyShareA = randomBytes(KEY_BYTES);
  const keyShareB = Buffer.allocUnsafe(KEY_BYTES);
  for (let index = 0; index < KEY_BYTES; index += 1) {
    keyShareB[index] = key[index] ^ keyShareA[index] ^ keyScrambleByte(index);
  }

  mkdirSync(protectedModelDirectory, { recursive: true });
  const temporaryPayloadPath = `${payloadPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPayloadPath, payload, { mode: 0o600 });
  renameSync(temporaryPayloadPath, payloadPath);

  const publicPath = relative(join(projectRoot, 'public'), payloadPath).split(sep).join('/');
  const manifest = {
    formatVersion: FORMAT_VERSION,
    assetVariant: ASSET_VARIANT,
    modelScale: MODEL_SCALE,
    encryption: 'AES-256-GCM',
    compression: 'none',
    textureEncoding: 'KTX2/UASTC',
    texturePipelineVersion: TEXTURE_PIPELINE_VERSION,
    geometryPipelineVersion: GEOMETRY_PIPELINE_VERSION,
    modelFormat: 'glb',
    textureCount: textureManifest.entries.length,
    payloadFile,
    publicPath,
    payloadBytes: payload.length,
    sourceBytes: bundle.length,
    modelSourceBytes: model.length,
    originalModelSourceBytes: sourceSignature.model.size,
    modelSha256: geometryManifest.sha256,
    sourceSha256,
    payloadSha256,
    sourceSignature,
    keyShareA: keyShareA.toString('base64'),
    keyShareB: Buffer.from(keyShareB).reverse().toString('base64'),
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomically(manifestPath, manifest);

  for (const entry of readdirSync(protectedModelDirectory)) {
    if (entry !== payloadFile && PAYLOAD_PATTERN.test(entry)) {
      rmSync(join(protectedModelDirectory, entry));
    }
  }

  key.fill(0);
  keyShareA.fill(0);
  keyShareB.fill(0);
  model.fill(0);
  bundle.fill(0);

  console.log(
    `Protected advanced model written to ${relative(projectRoot, payloadPath)} `
    + `(${(payload.length / 1_000_000).toFixed(1)} MB encrypted).`,
  );
  return { manifest, reused: false };
}

export function verifyProtectedModel() {
  const manifest = readJson(manifestPath);
  const payloadPath = payloadPathForManifest(manifest);
  if (!manifest || !payloadPath || !existsSync(payloadPath)) {
    throw new Error('Protected advanced model is missing. Run `npm run setup:model` first.');
  }

  const payload = readFileSync(payloadPath);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Protected model header is invalid.');
  if (payload.readUInt8(8) !== FORMAT_VERSION) throw new Error('Protected model version is unsupported.');
  if (payload.readUInt8(9) !== COMPRESSION_NONE) throw new Error('Protected model compression is unsupported.');
  const headerBytes = payload.readUInt16LE(10);
  if (headerBytes !== HEADER_BYTES) throw new Error('Protected model header length is invalid.');

  const textureSignatures = new Map(
    manifest.sourceSignature?.textures?.map((texture) => [texture.name, texture]) ?? [],
  );
  for (const name of LAMP_TEXTURES) {
    if (textureSignatures.get(name)?.orientation !== 'lower-left') {
      throw new Error(`Protected lamp atlas has an invalid orientation: ${name}`);
    }
  }

  const header = payload.subarray(0, headerBytes);
  const iv = header.subarray(16, 16 + IV_BYTES);
  const encryptedWithTag = payload.subarray(headerBytes);
  const encrypted = encryptedWithTag.subarray(0, -AUTH_TAG_BYTES);
  const authTag = encryptedWithTag.subarray(-AUTH_TAG_BYTES);
  const key = unwrapKey(manifest.keyShareA, manifest.keyShareB);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);
  const bundle = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  key.fill(0);

  if (bundle.length !== manifest.sourceBytes || bundle.length !== header.readUInt32LE(12)) {
    throw new Error('Protected model decrypted to an unexpected size.');
  }
  if (sha256(bundle) !== manifest.sourceSha256) throw new Error('Protected model checksum does not match.');
  validateAssetBundle(bundle, manifest.textureCount, manifest.modelFormat);
  return manifest;
}
