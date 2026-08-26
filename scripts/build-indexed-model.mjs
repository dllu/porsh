import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LoadingManager,
  MeshStandardMaterial,
  Texture,
  TextureLoader,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : null;
const outputPath = process.argv[3] ? resolve(process.argv[3]) : null;

if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/build-indexed-model.mjs <source.fbx> <output.glb>');
}

class NodeFileReader {
  result = null;

  error = null;

  onloadend = null;

  onerror = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.({ target: this });
    }).catch((error) => {
      this.error = error;
      this.onerror?.(error);
      this.onloadend?.({ target: this });
    });
  }
}

globalThis.FileReader = NodeFileReader;

// Material maps are supplied separately as protected KTX2 assets. The offline
// geometry pass only needs the FBX hierarchy and source material names.
TextureLoader.prototype.load = function loadPlaceholder(url, onLoad) {
  const texture = new Texture();
  texture.name = String(url);
  if (onLoad) queueMicrotask(() => onLoad(texture));
  return texture;
};

function byteLengthOfGeometry(geometry) {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  for (const attributes of Object.values(geometry.morphAttributes)) {
    for (const attribute of attributes) bytes += attribute.array.byteLength;
  }
  return bytes;
}

function rawWordView(array) {
  if (array.BYTES_PER_ELEMENT === 1) {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  }
  if (array.BYTES_PER_ELEMENT === 2) {
    return new Uint16Array(array.buffer, array.byteOffset, array.byteLength / 2);
  }
  if (array.BYTES_PER_ELEMENT === 4) {
    return new Uint32Array(array.buffer, array.byteOffset, array.byteLength / 4);
  }
  if (array.BYTES_PER_ELEMENT === 8) {
    return new BigUint64Array(array.buffer, array.byteOffset, array.byteLength / 8);
  }
  throw new Error(`Unsupported geometry component size: ${array.BYTES_PER_ELEMENT}`);
}

function indexExactVertices(geometry) {
  const attributeNames = Object.keys(geometry.attributes);
  const attributes = attributeNames.map((name) => geometry.getAttribute(name));
  if (attributes.some((attribute) => attribute.isInterleavedBufferAttribute)) {
    throw new Error('Indexed model pipeline does not support interleaved source attributes.');
  }
  if (Object.values(geometry.morphAttributes).some((attributesForName) => attributesForName.length)) {
    throw new Error('Indexed model pipeline does not support morph targets.');
  }

  const position = geometry.getAttribute('position');
  const sourceIndex = geometry.getIndex();
  const drawCount = sourceIndex?.count ?? position.count;
  const rawViews = attributes.map((attribute) => rawWordView(attribute.array));
  const targetArrays = attributes.map((attribute) => (
    new attribute.array.constructor(attribute.array.length)
  ));
  const vertexLookup = new Map();
  const targetIndices = new Array(drawCount);
  let targetVertexCount = 0;

  for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
    const sourceVertex = sourceIndex ? sourceIndex.getX(drawIndex) : drawIndex;
    let key = '';
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex];
      const rawView = rawViews[attributeIndex];
      const offset = sourceVertex * attribute.itemSize;
      for (let component = 0; component < attribute.itemSize; component += 1) {
        key += `${rawView[offset + component].toString(36)},`;
      }
    }

    let targetVertex = vertexLookup.get(key);
    if (targetVertex === undefined) {
      targetVertex = targetVertexCount;
      targetVertexCount += 1;
      vertexLookup.set(key, targetVertex);
      for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
        const attribute = attributes[attributeIndex];
        const sourceOffset = sourceVertex * attribute.itemSize;
        const targetOffset = targetVertex * attribute.itemSize;
        for (let component = 0; component < attribute.itemSize; component += 1) {
          targetArrays[attributeIndex][targetOffset + component] = attribute.array[sourceOffset + component];
        }
      }
    }
    targetIndices[drawIndex] = targetVertex;
  }

  const result = geometry.clone();
  attributeNames.forEach((name, attributeIndex) => {
    const sourceAttribute = attributes[attributeIndex];
    const targetArray = targetArrays[attributeIndex].slice(
      0,
      targetVertexCount * sourceAttribute.itemSize,
    );
    result.setAttribute(name, new sourceAttribute.constructor(
      targetArray,
      sourceAttribute.itemSize,
      sourceAttribute.normalized,
    ));
  });
  result.setIndex(targetIndices);
  return result;
}

const source = readFileSync(inputPath);
const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const model = new FBXLoader(new LoadingManager()).parse(sourceBuffer, '');
const cleanMaterials = new Map();
let meshCount = 0;
let triangleCount = 0;
let sourceVertices = 0;
let indexedVertices = 0;
let sourceGeometryBytes = 0;
let indexedGeometryBytes = 0;

model.traverse((object) => {
  if (!object.isMesh) return;
  if (object.isSkinnedMesh) throw new Error(`Indexed model pipeline does not support skinned mesh: ${object.name}`);

  const sourceGeometry = object.geometry;
  const sourcePosition = sourceGeometry.getAttribute('position');
  const sourceDrawCount = sourceGeometry.index?.count ?? sourcePosition?.count ?? 0;
  if (!sourcePosition || sourceDrawCount % 3 !== 0) {
    throw new Error(`Model mesh has invalid triangle geometry: ${object.name}`);
  }

  const indexedGeometry = indexExactVertices(sourceGeometry);
  const indexedDrawCount = indexedGeometry.index?.count ?? 0;
  if (indexedDrawCount !== sourceDrawCount) {
    throw new Error(`Indexing changed the triangle stream for mesh: ${object.name}`);
  }

  meshCount += 1;
  triangleCount += sourceDrawCount / 3;
  sourceVertices += sourcePosition.count;
  indexedVertices += indexedGeometry.getAttribute('position').count;
  sourceGeometryBytes += byteLengthOfGeometry(sourceGeometry);
  indexedGeometryBytes += byteLengthOfGeometry(indexedGeometry);
  indexedGeometry.name = sourceGeometry.name;
  object.geometry = indexedGeometry;
  sourceGeometry.dispose();

  const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
  const replacements = sourceMaterials.map((material) => {
    const name = material?.name || 'default';
    if (!cleanMaterials.has(name)) cleanMaterials.set(name, new MeshStandardMaterial({ name }));
    return cleanMaterials.get(name);
  });
  object.material = Array.isArray(object.material) ? replacements : replacements[0];
});

if (meshCount === 0 || indexedVertices >= sourceVertices) {
  throw new Error('Model indexing did not reduce the source geometry.');
}

const glb = await new GLTFExporter().parseAsync(model, {
  binary: true,
  includeCustomExtensions: false,
  onlyVisible: false,
  trs: false,
});
writeFileSync(outputPath, Buffer.from(glb));

console.log(
  `Indexed ${meshCount} meshes / ${triangleCount.toLocaleString()} triangles: `
  + `${sourceVertices.toLocaleString()} → ${indexedVertices.toLocaleString()} vertices, `
  + `${(sourceGeometryBytes / 1_000_000).toFixed(1)} → ${(indexedGeometryBytes / 1_000_000).toFixed(1)} MB.`,
);
