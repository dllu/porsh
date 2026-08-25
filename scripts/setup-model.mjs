import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  localModelDirectory,
  protectModel,
  sourceLicensePath,
  sourceModelPath,
  sourceTextureDirectory,
} from './model-protection.mjs';

const archiveName = 'WireWheelsClub_87_POR_959_v2_ADV.zip';
const archiveArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
  ?? join(homedir(), 'Downloads', archiveName);
const archivePath = resolve(archiveArgument.replace(/^~(?=$|\/)/, homedir()));
const archiveRoot = 'WireWheelsClub_87_POR_959_v2_ADV';
const modelEntry = `${archiveRoot}/FBX/87_POR_959_wwc_ADV_v2.fbx`;
const licenseEntry = `${archiveRoot}/License.txt`;
const texturePattern = `${archiveRoot}/textures/*`;
const force = process.argv.includes('--force');
const rebuildTextures = process.argv.includes('--rebuild-textures');

const installedTextureCount = existsSync(sourceTextureDirectory)
  ? readdirSync(sourceTextureDirectory).filter((name) => /\.(?:jpe?g|png)$/i.test(name)).length
  : 0;

if (!existsSync(sourceModelPath) || installedTextureCount < 50) {
  if (!existsSync(archivePath)) {
    console.error(`Advanced model archive not found: ${archivePath}`);
    console.error('Purchase/download the advanced WWC model and pass its ZIP path to this command.');
    process.exit(1);
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'porsche-959-advanced-'));
  const temporaryTextureDirectory = join(temporaryDirectory, 'textures');

  try {
    mkdirSync(temporaryTextureDirectory, { recursive: true });
    const modelExtraction = spawnSync(
      'unzip',
      ['-j', '-o', archivePath, modelEntry, licenseEntry, '-d', temporaryDirectory],
      { stdio: 'inherit' },
    );
    const textureExtraction = spawnSync(
      'unzip',
      ['-j', '-o', archivePath, texturePattern, '-d', temporaryTextureDirectory],
      { stdio: 'inherit' },
    );

    if (modelExtraction.error?.code === 'ENOENT' || textureExtraction.error?.code === 'ENOENT') {
      throw new Error('The `unzip` command is required to install the purchased WWC archive.');
    }
    if (modelExtraction.status !== 0 || textureExtraction.status !== 0) {
      throw new Error('Could not extract the advanced WWC archive.');
    }

    const extractedModel = join(temporaryDirectory, '87_POR_959_wwc_ADV_v2.fbx');
    const extractedLicense = join(temporaryDirectory, 'License.txt');
    if (!existsSync(extractedModel)) throw new Error('The advanced FBX was not found inside the archive.');

    mkdirSync(localModelDirectory, { recursive: true });
    mkdirSync(sourceTextureDirectory, { recursive: true });
    renameSync(extractedModel, sourceModelPath);
    if (existsSync(extractedLicense)) renameSync(extractedLicense, sourceLicensePath);
    for (const texture of readdirSync(temporaryTextureDirectory)) {
      renameSync(join(temporaryTextureDirectory, texture), join(sourceTextureDirectory, texture));
    }
    console.log(`Installed the advanced FBX and source textures under ${localModelDirectory}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

protectModel({ force, rebuildTextures });
