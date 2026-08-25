import { verifyProtectedModel } from './model-protection.mjs';

const manifest = verifyProtectedModel();
console.log(
  `Protected model verified: ${manifest.payloadFile} `
  + `(${(manifest.payloadBytes / 1_000_000).toFixed(1)} MB encrypted, `
  + `${manifest.textureCount} KTX2 textures).`,
);
