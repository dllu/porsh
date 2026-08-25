import { keyShareB as encodedKeyShareB } from 'virtual:p959-model-worker-key';

const HEADER_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 2;
const COMPRESSION_NONE = 0;
const KEY_BYTES = 32;
const KEY_SCRAMBLE_MULTIPLIER = 73;
const KEY_SCRAMBLE_OFFSET = 41;
const MAGIC = new Uint8Array([0x50, 0x39, 0x35, 0x39, 0x45, 0x4e, 0x43, 0x00]);

const BUNDLE_HEADER_BYTES = 16;
const BUNDLE_FORMAT_VERSION = 1;
const BUNDLE_MAGIC = new Uint8Array([0x50, 0x39, 0x35, 0x39, 0x42, 0x4e, 0x44, 0x00]);

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function matchesMagic(bytes, magic) {
  return magic.every((value, index) => bytes[index] === value);
}

function unpackBundle(bundleBuffer, expectedBytes) {
  const bundle = new Uint8Array(bundleBuffer);
  if (bundle.byteLength !== expectedBytes || !matchesMagic(bundle, BUNDLE_MAGIC)) {
    throw new Error('Protected asset bundle header is invalid.');
  }

  const bundleView = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  if (
    bundleView.getUint8(8) !== BUNDLE_FORMAT_VERSION
    || bundleView.getUint16(10, true) !== BUNDLE_HEADER_BYTES
  ) throw new Error('Protected asset bundle version is unsupported.');

  const directoryBytes = bundleView.getUint32(12, true);
  const dataStart = BUNDLE_HEADER_BYTES + directoryBytes;
  if (dataStart > bundle.byteLength) throw new Error('Protected asset bundle directory is invalid.');

  const directoryJson = new TextDecoder().decode(bundle.subarray(BUNDLE_HEADER_BYTES, dataStart));
  const directory = JSON.parse(directoryJson);
  if (!Array.isArray(directory.entries) || directory.entries.length > 128) {
    throw new Error('Protected asset bundle entries are invalid.');
  }

  let dataOffset = dataStart;
  let model = null;
  const textures = [];
  const transfer = [];
  for (const entry of directory.entries) {
    if (
      !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength <= 0
      || dataOffset + entry.byteLength > bundle.byteLength
    ) throw new Error('Protected asset bundle entry length is invalid.');

    const entryBuffer = bundle.buffer.slice(
      bundle.byteOffset + dataOffset,
      bundle.byteOffset + dataOffset + entry.byteLength,
    );
    dataOffset += entry.byteLength;
    transfer.push(entryBuffer);

    if (entry.kind === 'model') {
      if (model) throw new Error('Protected asset bundle contains multiple models.');
      model = entryBuffer;
    } else if (entry.kind === 'texture') {
      textures.push({ name: entry.name, role: entry.role, payload: entryBuffer });
    } else {
      throw new Error('Protected asset bundle contains an unknown entry type.');
    }
  }

  if (!model || !textures.length || dataOffset !== bundle.byteLength) {
    throw new Error('Protected asset bundle contents are incomplete.');
  }
  return { model, textures, transfer };
}

self.onmessage = async (event) => {
  let key;
  let keyShareA;
  let keyShareB;

  try {
    const payload = new Uint8Array(event.data.payload);
    keyShareA = new Uint8Array(event.data.keyShareA);
    keyShareB = decodeBase64(encodedKeyShareB).reverse();

    if (payload.byteLength <= HEADER_BYTES + AUTH_TAG_BYTES || !matchesMagic(payload, MAGIC)) {
      throw new Error('Protected model header is invalid.');
    }

    const header = payload.subarray(0, HEADER_BYTES);
    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (headerView.getUint8(8) !== FORMAT_VERSION || headerView.getUint8(9) !== COMPRESSION_NONE) {
      throw new Error('Protected model format is unsupported.');
    }
    if (headerView.getUint16(10, true) !== HEADER_BYTES) {
      throw new Error('Protected model header length is invalid.');
    }
    if (keyShareA.length !== KEY_BYTES || keyShareB.length !== KEY_BYTES) {
      throw new Error('Protected model key material is invalid.');
    }

    key = new Uint8Array(KEY_BYTES);
    for (let index = 0; index < KEY_BYTES; index += 1) {
      const scramble = ((index * KEY_SCRAMBLE_MULTIPLIER) + KEY_SCRAMBLE_OFFSET) & 0xff;
      key[index] = keyShareA[index] ^ keyShareB[index] ^ scramble;
    }

    self.postMessage({ type: 'phase', phase: 'decrypting' });
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: header.subarray(16, 28),
        additionalData: header,
        tagLength: AUTH_TAG_BYTES * 8,
      },
      cryptoKey,
      payload.subarray(HEADER_BYTES),
    );

    self.postMessage({ type: 'phase', phase: 'unpacking' });
    const expectedBytes = headerView.getUint32(12, true);
    if (expectedBytes !== event.data.expectedBytes) {
      throw new Error('Protected model bundle size is invalid.');
    }
    const unpacked = unpackBundle(decrypted, expectedBytes);
    self.postMessage(
      { type: 'complete', model: unpacked.model, textures: unpacked.textures },
      unpacked.transfer,
    );
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    key?.fill(0);
    keyShareA?.fill(0);
    keyShareB?.fill(0);
  }
};
