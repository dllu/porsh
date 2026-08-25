import { protectModel } from './model-protection.mjs';

protectModel({
  force: process.argv.includes('--force'),
  rebuildTextures: process.argv.includes('--rebuild-textures'),
});
