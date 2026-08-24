import { gunzipSync } from 'fflate';
import { keyShareB as encodedKeyShareB } from 'virtual:p959-model-worker-key';

const HEADER_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 1;
const COMPRESSION_GZIP = 1;
const KEY_BYTES = 32;
const KEY_SCRAMBLE_MULTIPLIER = 73;
const KEY_SCRAMBLE_OFFSET = 41;
const MAGIC = new Uint8Array([0x50, 0x39, 0x35, 0x39, 0x45, 0x4e, 0x43, 0x00]);

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function matchesMagic(bytes) {
  return MAGIC.every((value, index) => bytes[index] === value);
}

self.onmessage = async (event) => {
  let key;
  let keyShareA;
  let keyShareB;

  try {
    const payload = new Uint8Array(event.data.payload);
    keyShareA = new Uint8Array(event.data.keyShareA);
    keyShareB = decodeBase64(encodedKeyShareB).reverse();

    if (payload.byteLength <= HEADER_BYTES + AUTH_TAG_BYTES || !matchesMagic(payload)) {
      throw new Error('Protected model header is invalid.');
    }

    const header = payload.subarray(0, HEADER_BYTES);
    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (headerView.getUint8(8) !== FORMAT_VERSION || headerView.getUint8(9) !== COMPRESSION_GZIP) {
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

    self.postMessage({ type: 'phase', phase: 'decompressing' });
    const source = gunzipSync(new Uint8Array(decrypted));
    const expectedBytes = headerView.getUint32(12, true);
    if (source.byteLength !== expectedBytes || source.byteLength !== event.data.expectedBytes) {
      throw new Error('Protected model expanded to an unexpected size.');
    }

    const sourceBuffer = source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
      ? source.buffer
      : source.slice().buffer;
    self.postMessage({ type: 'complete', payload: sourceBuffer }, [sourceBuffer]);
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
