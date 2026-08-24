import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const archiveName = '006_porsche_959_wwc.zip';
const archiveArgument = process.argv[2] ?? join(homedir(), 'Downloads', archiveName);
const archivePath = resolve(archiveArgument.replace(/^~(?=$|\/)/, homedir()));
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(projectRoot, 'public', 'models', 'wwc');
const outputModel = join(outputDirectory, '87_porsche_959_WWC.fbx');
const modelEntry = 'WireWheelsClub_87_POR_959_free/FBX/87_porsche_959_WWC.fbx';
const licenseEntry = 'WireWheelsClub_87_POR_959_free/License.txt';

if (!existsSync(archivePath)) {
  console.error(`Archive not found: ${archivePath}`);
  console.error('Download the free model from https://wirewheelsclub.com/models/1987-porsche-959/ and pass the ZIP path to this command.');
  process.exit(1);
}

if (existsSync(outputModel)) {
  console.log(`Model is already installed at ${outputModel}`);
  process.exit(0);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'porsche-959-model-'));

try {
  const extraction = spawnSync(
    'unzip',
    ['-j', archivePath, modelEntry, licenseEntry, '-d', temporaryDirectory],
    { stdio: 'inherit' },
  );

  if (extraction.error?.code === 'ENOENT') {
    throw new Error('The `unzip` command is required. Extract the FBX manually if it is unavailable.');
  }
  if (extraction.status !== 0) throw new Error(`Could not extract the WWC archive (exit ${extraction.status}).`);

  const extractedModel = join(temporaryDirectory, '87_porsche_959_WWC.fbx');
  const extractedLicense = join(temporaryDirectory, 'License.txt');
  if (!existsSync(extractedModel)) throw new Error('The expected FBX was not found inside the archive.');

  mkdirSync(outputDirectory, { recursive: true });
  renameSync(extractedModel, outputModel);
  if (existsSync(extractedLicense)) renameSync(extractedLicense, join(outputDirectory, 'License.txt'));
  console.log(`Installed the local WWC model at ${outputModel}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
