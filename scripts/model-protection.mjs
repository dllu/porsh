import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  constants as zlibConstants,
  gunzipSync,
  gzipSync,
} from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 1;
const COMPRESSION_GZIP = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_SCRAMBLE_MULTIPLIER = 73;
const KEY_SCRAMBLE_OFFSET = 41;
const PAYLOAD_PATTERN = /^p959-[0-9a-f]{20}\.p9e$/;
const MAGIC = Buffer.from([0x50, 0x39, 0x35, 0x39, 0x45, 0x4e, 0x43, 0x00]);

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localModelDirectory = join(projectRoot, 'local-models', 'wwc');
export const sourceModelPath = join(localModelDirectory, '87_porsche_959_WWC.fbx');
export const sourceLicensePath = join(localModelDirectory, 'License.txt');
export const legacyModelDirectory = join(projectRoot, 'public', 'models', 'wwc');
export const legacyModelPath = join(legacyModelDirectory, '87_porsche_959_WWC.fbx');
export const protectedModelDirectory = join(projectRoot, 'public', 'models', 'protected');
export const manifestPath = join(localModelDirectory, 'protection-manifest.json');

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
  header.writeUInt8(COMPRESSION_GZIP, 9);
  header.writeUInt16LE(HEADER_BYTES, 10);
  header.writeUInt32LE(sourceBytes, 12);
  iv.copy(header, 16);
  randomBytes(4).copy(header, 28);
  return header;
}

function readManifest() {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function payloadPathForManifest(manifest) {
  if (!manifest?.payloadFile || !PAYLOAD_PATTERN.test(manifest.payloadFile)) return null;
  return join(protectedModelDirectory, manifest.payloadFile);
}

function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function migrateLegacyModel() {
  if (!existsSync(legacyModelPath)) return false;

  mkdirSync(localModelDirectory, { recursive: true });
  if (!existsSync(sourceModelPath)) {
    renameSync(legacyModelPath, sourceModelPath);
  }

  const legacyLicensePath = join(legacyModelDirectory, 'License.txt');
  if (existsSync(legacyLicensePath) && !existsSync(sourceLicensePath)) {
    renameSync(legacyLicensePath, sourceLicensePath);
  }

  if (existsSync(legacyModelPath)) {
    throw new Error(`Both legacy and local model files exist. Remove the duplicate at ${legacyModelPath}.`);
  }

  try {
    if (readdirSync(legacyModelDirectory).length === 0) rmdirSync(legacyModelDirectory);
  } catch {
    // An unrelated file may remain in the legacy directory; leave it untouched.
  }

  console.log(`Moved the plaintext FBX out of public/ to ${sourceModelPath}`);
  return true;
}

export function protectModel({ force = false } = {}) {
  migrateLegacyModel();

  if (!existsSync(sourceModelPath)) {
    throw new Error(
      `Local model not found at ${sourceModelPath}. Run \`npm run setup:model -- /path/to/006_porsche_959_wwc.zip\` first.`,
    );
  }

  const source = readFileSync(sourceModelPath);
  const sourceSha256 = sha256(source);
  const previousManifest = readManifest();
  const previousPayloadPath = payloadPathForManifest(previousManifest);

  const previousPayloadIsCurrent = previousPayloadPath
    && existsSync(previousPayloadPath)
    && statSync(previousPayloadPath).size === previousManifest?.payloadBytes
    && sha256(readFileSync(previousPayloadPath)) === previousManifest?.payloadSha256;

  if (
    !force
    && previousManifest?.formatVersion === FORMAT_VERSION
    && previousManifest?.sourceSha256 === sourceSha256
    && previousManifest?.sourceBytes === source.length
    && previousPayloadIsCurrent
  ) {
    console.log(`Protected model is current: ${relative(projectRoot, previousPayloadPath)}`);
    source.fill(0);
    return { manifest: previousManifest, reused: true };
  }

  console.log(`Compressing ${Math.round(source.length / 1_000_000)} MB model...`);
  const compressed = gzipSync(source, {
    level: zlibConstants.Z_BEST_COMPRESSION,
  });
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = buildHeader(source.length, iv);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
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
    encryption: 'AES-256-GCM',
    compression: 'gzip',
    payloadFile,
    publicPath,
    payloadBytes: payload.length,
    sourceBytes: source.length,
    sourceSha256,
    payloadSha256,
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
  source.fill(0);
  compressed.fill(0);

  console.log(
    `Protected model written to ${relative(projectRoot, payloadPath)} `
    + `(${(payload.length / 1_000_000).toFixed(1)} MB encrypted).`,
  );
  return { manifest, reused: false };
}

export function verifyProtectedModel() {
  const manifest = readManifest();
  const payloadPath = payloadPathForManifest(manifest);
  if (!manifest || !payloadPath || !existsSync(payloadPath)) {
    throw new Error('Protected model is missing. Run `npm run setup:model` first.');
  }

  const payload = readFileSync(payloadPath);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Protected model header is invalid.');
  if (payload.readUInt8(8) !== FORMAT_VERSION) throw new Error('Protected model version is unsupported.');
  if (payload.readUInt8(9) !== COMPRESSION_GZIP) throw new Error('Protected model compression is unsupported.');
  const headerBytes = payload.readUInt16LE(10);
  if (headerBytes !== HEADER_BYTES) throw new Error('Protected model header length is invalid.');

  const header = payload.subarray(0, headerBytes);
  const iv = header.subarray(16, 16 + IV_BYTES);
  const encryptedWithTag = payload.subarray(headerBytes);
  const encrypted = encryptedWithTag.subarray(0, -AUTH_TAG_BYTES);
  const authTag = encryptedWithTag.subarray(-AUTH_TAG_BYTES);
  const key = unwrapKey(manifest.keyShareA, manifest.keyShareB);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const source = gunzipSync(compressed);
  key.fill(0);

  if (source.length !== manifest.sourceBytes || source.length !== header.readUInt32LE(12)) {
    throw new Error('Protected model unpacked to an unexpected size.');
  }
  if (sha256(source) !== manifest.sourceSha256) throw new Error('Protected model checksum does not match.');
  return manifest;
}
