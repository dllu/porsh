import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { keyShareA as encodedKeyShareA, modelMeta } from 'virtual:p959-model-runtime';
import './style.css';

const MODEL_META = modelMeta;
const MODEL_URL = `${import.meta.env.BASE_URL}${MODEL_META.publicPath}`;
const ENVIRONMENT_URL = `${import.meta.env.BASE_URL}environment/studio-small-09-2k.hdr`;

const canvas = document.querySelector('#scene');
const loadingProgress = document.querySelector('#loading-progress');
const loadingPercent = document.querySelector('#loading-percent');
const loadingLabel = document.querySelector('#loading-label');
const errorState = document.querySelector('#error-state');
const toast = document.querySelector('#toast');

const webglContext = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  depth: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
  stencil: false,
});

if (!webglContext) {
  document.querySelector('#loading-screen').hidden = true;
  errorState.hidden = false;
  throw new Error('WebGL 2 is unavailable.');
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  context: webglContext,
  antialias: false,
  powerPreference: 'high-performance',
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.setClearColor(0x08090a, 1);

const scene = new THREE.Scene();
scene.background = createStudioBackdrop();
scene.environmentIntensity = 0.56;
scene.backgroundIntensity = 1;

const camera = new THREE.PerspectiveCamera(33, 1, 0.04, 80);
camera.position.set(4.45, 1.78, 5.35);

const controls = new OrbitControls(camera, canvas);
controls.target.set(-0.22, 0.63, 0.05);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 9.5;
controls.minPolarAngle = 0.42;
controls.maxPolarAngle = 1.54;
controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
controls.autoRotateSpeed = 0.34;
controls.zoomToCursor = true;

const stage = createStage();
scene.add(stage.group);

const lights = createLighting();
scene.add(lights.group);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const gtaoPass = new GTAOPass(
  scene,
  camera,
  window.innerWidth,
  window.innerHeight,
  undefined,
  {
    radius: 0.3,
    distanceExponent: 1.2,
    thickness: 0.72,
    distanceFallOff: 0.8,
    scale: 1.25,
    samples: 12,
  },
  {
    lumaPhi: 8,
    depthPhi: 1.5,
    normalPhi: 2.5,
    radius: 5,
    radiusExponent: 1.7,
    rings: 2,
    samples: 12,
  },
);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.blendIntensity = 0.66;

// Bloom is a fixed camera response. Lamp switches change radiance at the
// emitters only, so unrelated studio reflections never pulse with a light.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.018,
  0.3,
  1.6,
);
const smaaPass = new SMAAPass();
const outputPass = new OutputPass();

composer.addPass(renderPass);
composer.addPass(gtaoPass);
composer.addPass(bloomPass);
composer.addPass(smaaPass);
composer.addPass(outputPass);

const progress = { model: 0, environment: 0 };
const clock = new THREE.Clock();
const INDICATOR_PERIOD = 0.72;
const INDICATOR_ON_TIME = 0.36;
// Keep lamp brightness local to the emitters so bloom responds to their HDR
// radiance without changing the camera response for paint and studio highlights.
const ACTIVE_LAMP_RADIANCE_SCALE = 8;
const INDICATOR_REFLECTION_PEAK_MULTIPLIER = 2.5;
const headlightCenter = new THREE.Vector3(0, 0.68, 1.88);
const headlightTarget = new THREE.Vector3(0, 0.25, 9);
const headlightViewDirection = new THREE.Vector3();
const headlightBeamDirection = new THREE.Vector3();
const cameraPresets = {
  hero: {
    label: 'HERO',
    position: new THREE.Vector3(4.45, 1.78, 5.35),
    target: new THREE.Vector3(-0.22, 0.63, 0.05),
    fov: 33,
  },
  front: {
    label: 'FRONT',
    position: new THREE.Vector3(0, 1.24, 6.25),
    target: new THREE.Vector3(0, 0.63, 0.35),
    fov: 31,
  },
  profile: {
    label: 'PROFILE',
    position: new THREE.Vector3(5.7, 1.34, 0.08),
    target: new THREE.Vector3(0, 0.61, 0),
    fov: 32,
  },
  rear: {
    label: 'REAR',
    position: new THREE.Vector3(-3.85, 1.62, -5.2),
    target: new THREE.Vector3(0.12, 0.66, -0.05),
    fov: 34,
  },
  cockpit: {
    label: 'COCKPIT',
    position: new THREE.Vector3(2.08, 1.52, 1.15),
    target: new THREE.Vector3(0.08, 1.02, 0.16),
    fov: 39,
  },
};

const paintProfiles = {
  'Guards Red': {
    color: 0xa51420,
    metalness: 0.08,
    roughness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.08,
  },
  'Silver Metallic': {
    color: 0xbfc3c4,
    metalness: 0.32,
    roughness: 0.46,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.85,
    useRoughnessMap: false,
  },
  'Graphite Metallic': {
    color: 0x62696c,
    metalness: 0.82,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.98,
    useRoughnessMap: false,
  },
  'Basalt Black': {
    color: 0x0b0c0e,
    metalness: 0.12,
    roughness: 1.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.11,
    envMapIntensity: 1.05,
  },
  'Grand Prix White': {
    color: 0xd9d5ca,
    metalness: 0.04,
    roughness: 1.12,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1,
  },
  'Night Blue': {
    color: 0x1b2c46,
    metalness: 0.22,
    roughness: 1.15,
    clearcoat: 0.95,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.08,
  },
};

let car = null;
let bodyMaterial = null;
let bodyRoughnessMap = null;
const lampMaterials = {
  headlights: null,
  indicatorReflectorsOff: null,
  indicatorReflectors: null,
  indicatorHotspots: null,
  sideIndicatorHotspots: null,
  tailBulbs: null,
  tailLampReflectors: null,
  reverseBulbs: null,
  reverseReflectors: null,
};
const lampMeshes = {
  indicatorLenses: [],
};
const vehicleLightState = {
  headlights: false,
  indicators: false,
  brakes: false,
  reverse: false,
  indicatorStartedAt: 0,
  indicatorLit: false,
};
const indicatorRenderComponents = {
  reflections: true,
  hotspots: true,
};
let cameraTween = null;
let activeView = 'hero';
let currentQuality = 'auto';
let currentPixelRatio = 1;
let toastTimer = 0;
let adaptiveSampleFrames = 0;
let adaptiveSampleTime = 0;
let adaptiveQualityChecked = false;
let ready = false;
let portraitLayout = false;
let indicatorReflectionCalibration = null;

configureQuality('auto', false);
setupInterface();
resize();
window.addEventListener('resize', resize, { passive: true });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

if (import.meta.env.DEV) {
  window.__P959_DEBUG__ = {
    setView(name) {
      const autoRotate = document.querySelector('#autorotate-toggle');
      autoRotate.checked = false;
      controls.autoRotate = false;
      moveToPreset(name, true);
    },
    setCamera(position, target, fov = 30) {
      const autoRotate = document.querySelector('#autorotate-toggle');
      autoRotate.checked = false;
      controls.autoRotate = false;
      cameraTween = null;
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      controls.update();
    },
    getLightState() {
      return { ...vehicleLightState };
    },
    getIndicatorReflectionCalibration() {
      return indicatorReflectionCalibration
        ? { ...indicatorReflectionCalibration }
        : null;
    },
    setIndicatorComponents(components = {}) {
      indicatorRenderComponents.reflections = components.reflections !== false;
      indicatorRenderComponents.hotspots = components.hotspots !== false;
      applyIndicatorIllumination(vehicleLightState.indicatorLit);
    },
  };
}

renderer.setAnimationLoop(render);
loadExperience();

async function loadExperience() {
  try {
    setLoadingLabel('Lighting the studio');
    const [environment, model] = await Promise.all([
      loadEnvironment(),
      loadModel(),
    ]);

    attenuateEnvironmentGroundHemisphere(environment);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const environmentMap = pmremGenerator.fromEquirectangular(environment).texture;
    const indicatorReflectionEnvironment = createIndicatorReflectionEnvironment(environment);
    indicatorReflectionCalibration = { ...indicatorReflectionEnvironment.userData };
    const indicatorReflectionMap = pmremGenerator
      .fromEquirectangular(indicatorReflectionEnvironment)
      .texture;
    scene.environment = environmentMap;
    environment.dispose();
    indicatorReflectionEnvironment.dispose();
    pmremGenerator.dispose();

    installCar(model.scene, model.textures, environmentMap, indicatorReflectionMap);
    setStudioRotation(18);
    setLoadingLabel('Compiling materials');
    setProgress('model', 0.96);

    if (renderer.compileAsync) {
      await renderer.compileAsync(scene, camera);
    } else {
      renderer.compile(scene, camera);
    }

    renderer.shadowMap.needsUpdate = true;
    composer.render(0);
    setProgress('model', 1);
    setProgress('environment', 1);
    setLoadingLabel('Ready');

    await new Promise((resolve) => window.setTimeout(resolve, 260));
    moveToPreset(activeView, true);
    ready = true;
    document.body.classList.add('is-ready');
    canvas.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    document.querySelector('#loading-screen').hidden = true;
    errorState.hidden = false;
    errorState.querySelector('h2').textContent = 'The 3D assets could not be loaded.';
    errorState.querySelector('p').textContent = 'Check the protected model setup and refresh the page.';
  }
}

function loadEnvironment() {
  return new Promise((resolve, reject) => {
    new HDRLoader().load(
      ENVIRONMENT_URL,
      resolve,
      (event) => {
        const ratio = event.total ? event.loaded / event.total : Math.min(event.loaded / 6_300_000, 0.96);
        setProgress('environment', ratio);
      },
      reject,
    );
  });
}

function attenuateEnvironmentGroundHemisphere(environment) {
  const { data, width, height } = environment.image;
  const horizon = Math.floor(height * 0.5);
  const fadeDepth = Math.max(Math.floor(height * 0.16), 1);
  const groundIntensity = 0.12;
  const halfFloat = environment.type === THREE.HalfFloatType;

  for (let y = horizon; y < height; y += 1) {
    const linearFade = THREE.MathUtils.clamp((y - horizon) / fadeDepth, 0, 1);
    const smoothFade = linearFade * linearFade * (3 - 2 * linearFade);
    const attenuation = THREE.MathUtils.lerp(1, groundIntensity, smoothFade);
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + x * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const index = pixelOffset + channel;
        const value = halfFloat ? THREE.DataUtils.fromHalfFloat(data[index]) : data[index];
        data[index] = halfFloat
          ? THREE.DataUtils.toHalfFloat(value * attenuation)
          : value * attenuation;
      }
    }
  }

  environment.needsUpdate = true;
}

function createIndicatorReflectionEnvironment(studioEnvironment) {
  const width = 1024;
  const height = 512;
  const signal = new Float32Array(width * height);
  const data = studioEnvironment.type === THREE.HalfFloatType
    ? new Uint16Array(width * height * 4)
    : new Float32Array(width * height * 4);
  // One source lobe faces each front, rear, and side housing. The lobes are
  // deliberately broad enough to illuminate the concave reflector while
  // retaining a direction-dependent highlight instead of becoming a flat fill.
  const lobeCenters = [0, 0.25, 0.5, 0.75];
  let signalPeak = 0;

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const dv = v - 0.5;

    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      let du = 1;
      lobeCenters.forEach((center) => {
        const wrapped = ((((u - center) + 0.5) % 1) + 1) % 1 - 0.5;
        if (Math.abs(wrapped) < Math.abs(du)) du = wrapped;
      });

      // A localized source represents the bulb itself. Reflector curvature,
      // the authored normal map, and PMREM roughness spread it across the
      // housing without turning the entire environment into an amber flood.
      const halo = 95 * Math.exp(-0.5 * (
        (du / 0.0052) ** 2 + (dv / 0.0145) ** 2
      ));
      const softbox = 85 * Math.exp(-(
        (Math.abs(du) / 0.003) ** 6 + (Math.abs(dv) / 0.0105) ** 6
      ));
      const filament = 120 * Math.exp(-0.5 * (
        (du / 0.001) ** 2 + (dv / 0.0048) ** 2
      ));
      const facetA = 42 * Math.exp(-0.5 * (
        ((du - 0.0024) / 0.0014) ** 2 + ((dv + 0.002) / 0.0072) ** 2
      ));
      const facetB = 36 * Math.exp(-0.5 * (
        ((du + 0.0027) / 0.0015) ** 2 + ((dv - 0.0024) / 0.0066) ** 2
      ));
      const radiance = halo + softbox + filament + facetA + facetB;
      signal[y * width + x] = radiance;
      signalPeak = Math.max(signalPeak, radiance);
    }
  }

  const {
    data: studioData,
    width: studioWidth,
    height: studioHeight,
  } = studioEnvironment.image;
  const halfFloatStudio = studioEnvironment.type === THREE.HalfFloatType;
  const readStudioChannel = (offset) => (
    halfFloatStudio
      ? THREE.DataUtils.fromHalfFloat(studioData[offset])
      : studioData[offset]
  );
  const writeChannel = (offset, value) => {
    data[offset] = halfFloatStudio
      ? THREE.DataUtils.toHalfFloat(value)
      : value;
  };
  let studioPeakLuminance = 0;
  for (let offset = 0; offset < studioData.length; offset += 4) {
    const red = readStudioChannel(offset);
    const green = readStudioChannel(offset + 1);
    const blue = readStudioChannel(offset + 2);
    studioPeakLuminance = Math.max(
      studioPeakLuminance,
      red * 0.2126 + green * 0.7152 + blue * 0.0722,
    );
  }

  const warmColor = new THREE.Color(1, 0.32, 0.035);
  const warmLuminance = (
    warmColor.r * 0.2126 + warmColor.g * 0.7152 + warmColor.b * 0.0722
  );
  const syntheticPeakLuminance = (
    studioPeakLuminance * INDICATOR_REFLECTION_PEAK_MULTIPLIER
  );
  let combinedPeakLuminance = 0;

  for (let y = 0; y < height; y += 1) {
    const studioY = Math.min(Math.floor((y + 0.5) * studioHeight / height), studioHeight - 1);
    for (let x = 0; x < width; x += 1) {
      const studioX = Math.min(Math.floor((x + 0.5) * studioWidth / width), studioWidth - 1);
      const studioOffset = (studioY * studioWidth + studioX) * 4;
      const syntheticLuminance = (
        (signal[y * width + x] / signalPeak) * syntheticPeakLuminance
      );
      const syntheticRadiance = syntheticLuminance / warmLuminance;
      const red = readStudioChannel(studioOffset) + syntheticRadiance * warmColor.r;
      const green = readStudioChannel(studioOffset + 1) + syntheticRadiance * warmColor.g;
      const blue = readStudioChannel(studioOffset + 2) + syntheticRadiance * warmColor.b;
      const offset = (y * width + x) * 4;
      writeChannel(offset, red);
      writeChannel(offset + 1, green);
      writeChannel(offset + 2, blue);
      writeChannel(offset + 3, 1);
      combinedPeakLuminance = Math.max(
        combinedPeakLuminance,
        red * 0.2126 + green * 0.7152 + blue * 0.0722,
      );
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    studioEnvironment.type,
  );
  texture.name = 'indicator-lit-reflection-environment';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = studioEnvironment.flipY;
  texture.userData.studioPeakLuminance = studioPeakLuminance;
  texture.userData.syntheticPeakLuminance = syntheticPeakLuminance;
  texture.userData.combinedPeakLuminance = combinedPeakLuminance;
  texture.userData.syntheticPeakMultiplier = INDICATOR_REFLECTION_PEAK_MULTIPLIER;
  texture.needsUpdate = true;
  return texture;
}

async function loadModel() {
  setLoadingLabel('Downloading protected model');
  const encryptedPayload = await fetchProtectedModel();
  setProgress('model', 0.63);
  const bundle = await decryptProtectedModel(encryptedPayload);
  setProgress('model', 0.7);

  const textures = await loadMaterialTextures(bundle.textures);
  setProgress('model', 0.89);
  setLoadingLabel('Building 2.19m triangles');

  // Let the loading UI paint before the necessarily synchronous FBX parse.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=');
  const result = new FBXLoader(manager).parse(bundle.model, '');
  bundle.model = null;
  setProgress('model', 0.94);
  return { scene: result, textures };
}

async function loadMaterialTextures(textureAssets) {
  if (textureAssets.length !== MODEL_META.textureCount) {
    throw new Error('Protected material texture set is incomplete.');
  }

  setLoadingLabel(`Transcoding ${textureAssets.length} PBR maps`);
  const loader = new KTX2Loader()
    .setTranscoderPath(import.meta.env.DEV ? `${import.meta.env.BASE_URL}basis/` : '')
    .setWorkerLimit(Math.min(navigator.hardwareConcurrency || 4, 4))
    .detectSupport(renderer);
  const textures = new Map();
  let loadedTextures = 0;

  try {
    await Promise.all(textureAssets.map((asset) => new Promise((resolve, reject) => {
      loader.parse(
        asset.payload,
        (texture) => {
          texture.name = asset.name;
          texture.flipY = false;
          texture.userData.role = asset.role;
          textures.set(asset.name, texture);
          loadedTextures += 1;
          setProgress('model', 0.7 + (loadedTextures / textureAssets.length) * 0.18);
          resolve();
        },
        reject,
      );
    })));
  } finally {
    loader.dispose();
  }

  return textures;
}

async function fetchProtectedModel() {
  const response = await fetch(MODEL_URL, {
    cache: 'force-cache',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Protected model request failed (${response.status}).`);
  }

  const expectedBytes = MODEL_META.payloadBytes;
  if (!response.body) {
    const payload = await response.arrayBuffer();
    if (payload.byteLength !== expectedBytes) throw new Error('Protected model download is incomplete.');
    setProgress('model', 0.61);
    return payload;
  }

  const reader = response.body.getReader();
  const payload = new Uint8Array(expectedBytes);
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (receivedBytes + value.byteLength > payload.byteLength) {
      await reader.cancel();
      throw new Error('Protected model download is larger than expected.');
    }
    payload.set(value, receivedBytes);
    receivedBytes += value.byteLength;
    const downloadRatio = receivedBytes / expectedBytes;
    setProgress('model', downloadRatio * 0.61);
    if (downloadRatio > 0.08) setLoadingLabel('Loading protected geometry and materials');
  }

  if (receivedBytes !== expectedBytes) throw new Error('Protected model download is incomplete.');
  return payload.buffer;
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decryptProtectedModel(payload) {
  const worker = new Worker(new URL('./model-decrypt.worker.js', import.meta.url), { type: 'module' });
  const keyShareA = decodeBase64(encodedKeyShareA);

  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();

    worker.onmessage = (event) => {
      if (event.data.type === 'phase') {
        if (event.data.phase === 'decrypting') {
          setLoadingLabel('Unlocking model');
          setProgress('model', 0.64);
        } else if (event.data.phase === 'unpacking') {
          setLoadingLabel('Unpacking materials');
          setProgress('model', 0.67);
        }
        return;
      }

      if (event.data.type === 'complete') {
        finish();
        resolve({ model: event.data.model, textures: event.data.textures });
        return;
      }

      finish();
      reject(new Error(event.data.message ?? 'Protected model could not be unlocked.'));
    };

    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Protected model worker failed.'));
    };

    worker.postMessage(
      {
        payload,
        keyShareA: keyShareA.buffer,
        expectedBytes: MODEL_META.sourceBytes,
      },
      [payload, keyShareA.buffer],
    );
  });
}

function setProgress(part, value) {
  progress[part] = THREE.MathUtils.clamp(value, 0, 1);
  const combined = progress.model * 0.68 + progress.environment * 0.32;
  const percent = Math.min(Math.round(combined * 100), 100);
  loadingProgress.style.width = `${percent}%`;
  loadingPercent.value = `${percent}%`;
}

function setLoadingLabel(label) {
  loadingLabel.textContent = label;
}

function installCar(model, textures, studioReflectionMap, indicatorReflectionMap) {
  car = model;
  const wwcMaterials = createAdvancedMaterials(
    textures,
    studioReflectionMap,
    indicatorReflectionMap,
  );
  car.scale.setScalar(MODEL_META.modelScale ?? 1);

  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 12);
  const preparedMaterials = new Set();
  const tireMeshes = [];
  const indicatorLensMeshes = [];

  car.traverse((object) => {
    if (!object.isMesh) return;

    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const resolvedMaterials = sourceMaterials.map((material) => (
      wwcMaterials.get(material?.name) ?? wwcMaterials.get('default')
    ));
    object.material = Array.isArray(object.material) ? resolvedMaterials : resolvedMaterials[0];
    if (resolvedMaterials.length === 1 && resolvedMaterials[0].name === 'exterior-badges') {
      assignLicensePlateMaterial(object, wwcMaterials.get('license-plates'));
    }
    if (resolvedMaterials.length === 1 && resolvedMaterials[0].name === 'glass-orange') {
      assignLampEndMaterial(object, wwcMaterials.get('glass-orange-ends'), true);
      indicatorLensMeshes.push(object);
    }
    const installedMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const isOccluder = installedMaterials.some((material) => material.name === 'shadow-planes');
    object.castShadow = !isOccluder && installedMaterials.every((material) => (
      !material.transparent && !material.transmission
    ));
    object.receiveShadow = !isOccluder;
    if (installedMaterials.some((material) => material.name === 'wheels-tires')) tireMeshes.push(object);
    installedMaterials.forEach((material) => {
      if (preparedMaterials.has(material)) return;
      preparedMaterials.add(material);
      prepareMaterial(material, maxAnisotropy);
    });
    sourceMaterials.forEach((material) => material?.dispose());
  });

  car.updateMatrixWorld(true);
  const tireBounds = new THREE.Box3();
  tireMeshes.forEach((mesh) => tireBounds.union(new THREE.Box3().setFromObject(mesh, true)));
  if (!tireBounds.isEmpty()) {
    const plinthSurface = -0.003;
    const tireSink = 0.006;
    car.position.y += plinthSurface - tireSink - tireBounds.min.y;
    car.updateMatrixWorld(true);
  }

  bodyMaterial = wwcMaterials.get('carpaint') ?? null;
  bodyRoughnessMap = bodyMaterial?.roughnessMap ?? null;
  lampMaterials.headlights = wwcMaterials.get('glass-headlights') ?? null;
  lampMaterials.indicatorReflectorsOff = wwcMaterials.get('glass-orange-ends') ?? null;
  lampMaterials.indicatorReflectors = wwcMaterials.get('glass-orange-ends-lit') ?? null;
  lampMaterials.indicatorHotspots = wwcMaterials.get('indicator-hotspots') ?? null;
  lampMaterials.sideIndicatorHotspots = wwcMaterials.get('indicator-hotspots-side') ?? null;
  lampMaterials.tailBulbs = wwcMaterials.get('tail-lamp-bulbs') ?? null;
  lampMaterials.tailLampReflectors = wwcMaterials.get('tail-lamp-reflectors') ?? null;
  lampMaterials.reverseBulbs = wwcMaterials.get('reverse-lamp-bulbs') ?? null;
  lampMaterials.reverseReflectors = wwcMaterials.get('reverse-lamp-reflectors') ?? null;
  lampMeshes.indicatorLenses = indicatorLensMeshes;
  [
    lampMaterials.indicatorReflectorsOff,
    lampMaterials.indicatorReflectors,
    lampMaterials.indicatorHotspots,
    lampMaterials.sideIndicatorHotspots,
    lampMaterials.tailBulbs,
    lampMaterials.tailLampReflectors,
    lampMaterials.reverseBulbs,
    lampMaterials.reverseReflectors,
  ].filter(Boolean).forEach((material) => prepareMaterial(material, maxAnisotropy));
  car.add(createIndicatorLampInternals(
    lampMaterials.indicatorHotspots,
    lampMaterials.sideIndicatorHotspots,
  ));
  car.add(createRearLampInternals(
    lampMaterials.tailBulbs,
    lampMaterials.tailLampReflectors,
    lampMaterials.reverseBulbs,
    lampMaterials.reverseReflectors,
  ));

  scene.add(car);
  applyIndicatorIllumination(vehicleLightState.indicatorLit);
  applyRearLampState();
  updateHeadlightEmission();
  gtaoPass.setSceneClipBox(new THREE.Box3(
    new THREE.Vector3(-3.6, -0.15, -3.6),
    new THREE.Vector3(3.6, 2.2, 3.6),
  ));
}

function prepareMaterial(material, anisotropy) {
  for (const value of Object.values(material)) {
    if (!value?.isTexture) continue;
    value.anisotropy = anisotropy;
    value.needsUpdate = true;
  }
  material.needsUpdate = true;
}

function createIndicatorLampInternals(
  hotspotMaterial,
  sideHotspotMaterial,
) {
  const group = new THREE.Group();
  group.name = 'indicator-lamp-internals';
  if (
    !hotspotMaterial
    || !sideHotspotMaterial
  ) {
    return group;
  }

  const emitters = [
    // Positions are in the FBX root's Z-up coordinate system.
    { position: [-0.574, -2.005, 0.366] },
    { position: [0.574, -2.005, 0.366] },
    { position: [-0.744, 1.99, 0.584] },
    { position: [0.744, 1.99, 0.584] },
    { position: [-0.786, -0.754, 0.68] },
    { position: [0.786, -0.754, 0.68] },
  ];

  // The Gaussian sources have fixed world-space dimensions, so their blur
  // naturally occupies fewer screen pixels as the camera moves away. Oriented
  // planes also prevent the opposite end of the car shining through a lens.
  const hotspotGeometry = new THREE.PlaneGeometry(2, 2);
  const hotspots = [
    { position: emitters[0].position, scale: [0.036, 0.022], rotation: [Math.PI / 2, 0, 0], material: hotspotMaterial },
    { position: emitters[1].position, scale: [0.036, 0.022], rotation: [Math.PI / 2, 0, 0], material: hotspotMaterial },
    { position: emitters[2].position, scale: [0.034, 0.025], rotation: [-Math.PI / 2, 0, 0], material: hotspotMaterial },
    { position: emitters[3].position, scale: [0.034, 0.025], rotation: [-Math.PI / 2, 0, 0], material: hotspotMaterial },
    { position: emitters[4].position, scale: [0.012, 0.019], rotation: [0, -Math.PI / 2, 0], material: sideHotspotMaterial },
    { position: emitters[5].position, scale: [0.012, 0.019], rotation: [0, Math.PI / 2, 0], material: sideHotspotMaterial },
  ];
  hotspots.forEach(({ position, scale, rotation, material }, index) => {
    const hotspot = new THREE.Mesh(hotspotGeometry, material);
    hotspot.name = `indicator-hotspot-${index}`;
    hotspot.position.fromArray(position);
    hotspot.scale.set(scale[0], scale[1], 1);
    hotspot.rotation.set(...rotation);
    hotspot.castShadow = false;
    hotspot.receiveShadow = false;
    hotspot.visible = false;
    material.userData.lampMeshes ??= [];
    material.userData.lampMeshes.push(hotspot);
    group.add(hotspot);
  });

  return group;
}

function createRearLampInternals(
  tailBulbMaterial,
  tailReflectorMaterial,
  reverseBulbMaterial,
  reverseReflectorMaterial,
) {
  const group = new THREE.Group();
  group.name = 'rear-lamp-internals';
  if (
    !tailBulbMaterial
    || !tailReflectorMaterial
    || !reverseBulbMaterial
    || !reverseReflectorMaterial
  ) {
    return group;
  }

  // These sit behind the untouched source lens shells. The transmissive lens
  // and its native normal map provide the optical relief and soften the bulb.
  const bulbGeometry = new THREE.SphereGeometry(1, 18, 12);
  const reflectorGeometry = new THREE.PlaneGeometry(2, 2);
  const lamps = [
    {
      x: -0.587,
      y: 2.055,
      bulb: tailBulbMaterial,
      reflector: tailReflectorMaterial,
      scale: [0.03, 0.034],
      bulbRadius: 0.0045,
    },
    {
      x: 0.587,
      y: 2.055,
      bulb: tailBulbMaterial,
      reflector: tailReflectorMaterial,
      scale: [0.03, 0.034],
      bulbRadius: 0.0045,
    },
    {
      x: -0.643,
      y: 2.035,
      bulb: reverseBulbMaterial,
      reflector: reverseReflectorMaterial,
      scale: [0.018, 0.034],
      bulbRadius: 0.0035,
    },
    {
      x: 0.643,
      y: 2.035,
      bulb: reverseBulbMaterial,
      reflector: reverseReflectorMaterial,
      scale: [0.018, 0.034],
      bulbRadius: 0.0035,
    },
  ];

  lamps.forEach(({
    x,
    y,
    bulb: bulbMaterial,
    reflector: reflectorMaterial,
    scale,
    bulbRadius,
  }) => {
    const reflector = new THREE.Mesh(reflectorGeometry, reflectorMaterial);
    reflector.position.set(x, y, 0.584);
    reflector.scale.set(scale[0], scale[1], 1);
    reflector.rotation.x = -Math.PI / 2;
    reflector.castShadow = false;
    reflector.receiveShadow = false;
    group.add(reflector);

    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
    bulb.position.set(x, y + 0.009, 0.584);
    bulb.scale.setScalar(bulbRadius);
    bulb.castShadow = false;
    bulb.receiveShadow = false;
    group.add(bulb);
  });

  return group;
}

function assignLampEndMaterial(mesh, endMaterial, includeRear = false) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  if (!position || !endMaterial || Array.isArray(mesh.material)) return;

  // The FBX batches front, side, and rear lamp components into shared meshes.
  // Select isolated endpoint bands with material groups; position and UV data stay untouched.
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const extent = new THREE.Vector3().subVectors(max, min);
  const longitudinalAxis = extent.x > extent.y
    ? (extent.x > extent.z ? 0 : 2)
    : (extent.y > extent.z ? 1 : 2);
  const frontBoundary = min.getComponent(longitudinalAxis)
    + extent.getComponent(longitudinalAxis) * 0.12;
  const rearBoundary = max.getComponent(longitudinalAxis)
    - extent.getComponent(longitudinalAxis) * 0.12;
  const drawCount = index ? index.count : position.count;
  const materialIndices = new Uint8Array(drawCount / 3);
  let endTriangleCount = 0;

  for (let offset = 0; offset < drawCount; offset += 3) {
    let longitudinalCentroid = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index ? index.getX(offset + corner) : offset + corner;
      if (longitudinalAxis === 0) longitudinalCentroid += position.getX(vertexIndex);
      else if (longitudinalAxis === 1) longitudinalCentroid += position.getY(vertexIndex);
      else longitudinalCentroid += position.getZ(vertexIndex);
    }
    const endPosition = longitudinalCentroid / 3;
    const isEnd = endPosition < frontBoundary || (includeRear && endPosition > rearBoundary);
    materialIndices[offset / 3] = isEnd ? 1 : 0;
    if (isEnd) endTriangleCount += 1;
  }

  if (endTriangleCount === 0) return;

  geometry.clearGroups();
  let groupStart = 0;
  let activeMaterial = materialIndices[0];
  for (let triangle = 1; triangle < materialIndices.length; triangle += 1) {
    const materialIndex = materialIndices[triangle];
    if (materialIndex === activeMaterial) continue;
    const groupEnd = triangle * 3;
    geometry.addGroup(groupStart, groupEnd - groupStart, activeMaterial);
    groupStart = groupEnd;
    activeMaterial = materialIndex;
  }
  geometry.addGroup(groupStart, drawCount - groupStart, activeMaterial);
  mesh.material = [mesh.material, endMaterial];
}

function assignLicensePlateMaterial(mesh, plateMaterial) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  if (!position || !plateMaterial) return;

  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const extent = new THREE.Vector3().subVectors(max, min);
  const longitudinalAxis = extent.x > extent.y
    ? (extent.x > extent.z ? 0 : 2)
    : (extent.y > extent.z ? 1 : 2);
  const endpointDepth = extent.getComponent(longitudinalAxis) * 0.012;
  const endpointMin = min.getComponent(longitudinalAxis);
  const endpointMax = max.getComponent(longitudinalAxis);
  const triangleCount = index ? index.count : position.count;
  let groupStart = 0;
  let activeMaterial = null;
  let plateTriangles = 0;

  geometry.clearGroups();
  for (let offset = 0; offset < triangleCount; offset += 3) {
    let longitudinalCentroid = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index ? index.getX(offset + corner) : offset + corner;
      if (longitudinalAxis === 0) longitudinalCentroid += position.getX(vertexIndex);
      else if (longitudinalAxis === 1) longitudinalCentroid += position.getY(vertexIndex);
      else longitudinalCentroid += position.getZ(vertexIndex);
    }
    longitudinalCentroid /= 3;

    const materialIndex = longitudinalCentroid < endpointMin + endpointDepth
      || longitudinalCentroid > endpointMax - endpointDepth ? 1 : 0;
    if (materialIndex === 1) plateTriangles += 1;
    if (activeMaterial === null) activeMaterial = materialIndex;
    if (materialIndex === activeMaterial) continue;

    geometry.addGroup(groupStart, offset - groupStart, activeMaterial);
    groupStart = offset;
    activeMaterial = materialIndex;
  }
  geometry.addGroup(groupStart, triangleCount - groupStart, activeMaterial);

  if (plateTriangles > 0) mesh.material = [mesh.material, plateMaterial];
}

function createIndicatorHotspotMaterial(name) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      lampColor: { value: new THREE.Color(0xff5a08) },
      lampRadiance: { value: 0 },
      lampOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vHotspotPosition;

      void main() {
        vHotspotPosition = (uv - 0.5) * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 lampColor;
      uniform float lampRadiance;
      uniform float lampOpacity;
      varying vec2 vHotspotPosition;

      void main() {
        float radiusSquared = dot(vHotspotPosition, vHotspotPosition);
        float radius = sqrt(radiusSquared);
        float core = exp(-18.0 * radiusSquared);
        float scattered = exp(-3.8 * radiusSquared);
        float aperture = 1.0 - smoothstep(0.82, 1.0, radius);
        float response = (0.72 * core + 0.28 * scattered) * aperture;
        float alpha = response * lampOpacity;
        if (alpha < 0.0005) discard;
        gl_FragColor = vec4(lampColor * lampRadiance, alpha);
      }
    `,
    // Composite the local optical hotspot without writing depth. The passive
    // lens and HDR-reflective housing remain visible underneath every pixel.
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

function createAdvancedMaterials(textures, studioReflectionMap, indicatorReflectionMap) {
  // Lamp maps retain the source asset's native KTX2 orientation and FBX UVs.
  const texture = (name) => {
    const result = textures.get(name);
    if (!result) throw new Error(`Advanced material texture is missing: ${name}`);
    return result;
  };
  const normalScale = (value) => new THREE.Vector2(value, value);
  const physical = (name, parameters) => new THREE.MeshPhysicalMaterial({ name, ...parameters });
  const standard = (name, parameters) => new THREE.MeshStandardMaterial({ name, ...parameters });
  const softenTransmission = (material, roughness) => {
    // Keep the authored lens relief sharp while sampling internals from a softer framebuffer mip.
    const source = /n\s*,\s*v\s*,\s*material\.roughness\s*,\s*material\.diffuseContribution/;
    const replacement = `n, v, ${roughness.toFixed(3)}, material.diffuseContribution`;
    const transmissionChunk = THREE.ShaderChunk.transmission_fragment.replace(source, replacement);
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <transmission_fragment>',
        transmissionChunk,
      );
    };
    material.customProgramCacheKey = () => `${material.name}-transmission-${roughness}`;
    return material;
  };
  // The lamp covers are thin closed shells. Render only the authored inward face
  // with depth writes so the opposite wall cannot blend back through the lens.
  const finishFrostedLensShell = (material, {
    normalStrength = 0.07,
    roughness = 0.28,
    transmission = 0.45,
    thickness = 0.018,
    attenuationDistance = material.attenuationDistance,
    emissiveIntensity = material.emissiveIntensity,
    envMapIntensity = 0.5,
    transmissionRoughness = 0.42,
  } = {}) => {
    material.normalScale?.setScalar(normalStrength);
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
    material.roughness = roughness;
    material.transmission = transmission;
    material.thickness = thickness;
    material.attenuationDistance = attenuationDistance;
    material.emissiveIntensity = emissiveIntensity;
    material.clearcoat = 0;
    material.envMapIntensity = envMapIntensity;
    material.side = THREE.BackSide;
    return softenTransmission(material, transmissionRoughness);
  };
  const materials = new Map();
  const add = (material) => {
    materials.set(material.name, material);
    return material;
  };

  add(standard('undercarriage', {
    color: 0xffffff,
    map: texture('undercarriage_BaseColor.jpg'),
    normalMap: texture('undercarriage_Normal.png'),
    normalScale: normalScale(0.85),
    roughness: 1,
    roughnessMap: texture('undercarriage_Roughness.jpg'),
    metalness: 0.08,
    envMapIntensity: 0.5,
  }));
  add(standard('shadow-planes', {
    color: 0x020203,
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0,
  }));

  add(finishFrostedLensShell(physical('glass-reflector', {
    color: 0x87050b,
    normalMap: texture('glass_reflector_normal_2.jpg'),
    normalScale: normalScale(1.55),
    metalness: 0,
    roughness: 0.15,
    transmission: 0.16,
    opacity: 0.96,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    thickness: 0.024,
    attenuationColor: 0xa00008,
    attenuationDistance: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.28,
    side: THREE.DoubleSide,
  }), {
    normalStrength: 0.09,
    roughness: 0.25,
    transmission: 0.34,
    attenuationDistance: 0.1,
    emissiveIntensity: 0,
    envMapIntensity: 0.52,
    transmissionRoughness: 0.38,
  }));
  add(standard('tail-lamp-bulbs', {
    color: 0x260000,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.38,
    envMapIntensity: 0.15,
  }));
  add(standard('tail-lamp-reflectors', {
    color: 0x290003,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0.82,
    roughness: 0.2,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  }));
  add(standard('reverse-lamp-bulbs', {
    color: 0x282722,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.36,
    envMapIntensity: 0.15,
  }));
  add(standard('reverse-lamp-reflectors', {
    color: 0xbab7ae,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0.88,
    roughness: 0.17,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide,
  }));
  const orangeLensMaterial = add(physical('glass-orange', {
    color: 0xd05005,
    emissive: 0x000000,
    emissiveIntensity: 0,
    normalMap: texture('glass-orange_normal.jpg'),
    normalScale: normalScale(1.35),
    metalness: 0,
    roughness: 0.16,
    transmission: 0.55,
    opacity: 0.72,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    thickness: 0.024,
    attenuationColor: 0xff7218,
    attenuationDistance: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
  }));
  const endOrangeLensMaterial = orangeLensMaterial.clone();
  endOrangeLensMaterial.name = 'glass-orange-ends';
  // The authored inner face is the reflective lamp housing. Keep two
  // precompiled variants so blinking swaps only its reflection environment;
  // neither material emits any light.
  const indicatorReflectorOffMaterial = add(finishFrostedLensShell(endOrangeLensMaterial, {
    transmission: 0.62,
    attenuationDistance: 0.18,
    emissiveIntensity: 0,
    envMapIntensity: scene.environmentIntensity,
    transmissionRoughness: 0.46,
  }));
  indicatorReflectorOffMaterial.envMap = studioReflectionMap;
  const indicatorReflectorMaterial = indicatorReflectorOffMaterial.clone();
  indicatorReflectorMaterial.name = 'glass-orange-ends-lit';
  indicatorReflectorMaterial.envMap = indicatorReflectionMap;
  indicatorReflectorMaterial.envMapIntensity = 0.7;
  indicatorReflectorMaterial.normalScale.setScalar(0.9);
  indicatorReflectorMaterial.roughness = 0.14;
  add(indicatorReflectorMaterial);
  const indicatorHotspotMaterial = add(
    createIndicatorHotspotMaterial('indicator-hotspots'),
  );
  const sideIndicatorHotspotMaterial = indicatorHotspotMaterial.clone();
  sideIndicatorHotspotMaterial.name = 'indicator-hotspots-side';
  add(sideIndicatorHotspotMaterial);
  add(finishFrostedLensShell(physical('glass-red-1', {
    color: 0x8a0309,
    emissive: 0x000000,
    emissiveIntensity: 0,
    normalMap: texture('glass-red_normal.jpg'),
    normalScale: normalScale(1.45),
    metalness: 0,
    roughness: 0.14,
    transmission: 0.22,
    opacity: 0.93,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    thickness: 0.024,
    attenuationColor: 0xb5000a,
    attenuationDistance: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.27,
    side: THREE.DoubleSide,
  }), {
    normalStrength: 0.08,
    roughness: 0.25,
    transmission: 0.38,
    attenuationDistance: 0.1,
    emissiveIntensity: 0,
    envMapIntensity: 0.52,
    transmissionRoughness: 0.38,
  }));
  add(physical('glass-clear', {
    color: 0xf4f7f7,
    metalness: 0,
    roughness: 0.08,
    transmission: 0.55,
    opacity: 0.66,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  }));
  add(physical('glass-headlights', {
    color: 0xf6f5ef,
    bumpMap: texture('glass-headlights_bump.jpg'),
    bumpScale: 2.75,
    metalness: 0,
    roughness: 0.09,
    transmission: 0.62,
    opacity: 0.62,
    transparent: true,
    depthWrite: false,
    ior: 1.52,
    thickness: 0.018,
    emissive: 0x000000,
    emissiveMap: texture('glass-headlights_bump.jpg'),
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  }));
  add(finishFrostedLensShell(physical('glass-tail-white', {
    color: 0xf0f1eb,
    normalMap: texture('glass-orange_normal.jpg'),
    normalScale: normalScale(1),
    metalness: 0,
    roughness: 0.1,
    transmission: 0.62,
    opacity: 0.8,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    thickness: 0.018,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
  }), {
    roughness: 0.23,
    transmission: 0.55,
    thickness: 0.016,
    envMapIntensity: 0.58,
    transmissionRoughness: 0.34,
  }));
  add(finishFrostedLensShell(physical('glass-red-2', {
    color: 0x710207,
    emissive: 0x000000,
    emissiveIntensity: 0,
    normalMap: texture('glass-orange_normal.jpg'),
    normalScale: normalScale(1),
    metalness: 0,
    roughness: 0.13,
    transmission: 0.18,
    opacity: 0.94,
    transparent: true,
    depthWrite: false,
    ior: 1.48,
    thickness: 0.024,
    attenuationColor: 0x970008,
    attenuationDistance: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  }), {
    normalStrength: 0.08,
    roughness: 0.25,
    transmission: 0.36,
    attenuationDistance: 0.1,
    emissiveIntensity: 0,
    envMapIntensity: 0.52,
    transmissionRoughness: 0.38,
  }));
  add(physical('glass-windows', {
    color: 0x90a4a8,
    metalness: 0,
    roughness: 0.065,
    transmission: 0.92,
    opacity: 1,
    transparent: false,
    depthWrite: true,
    ior: 1.58,
    thickness: 0.0025,
    attenuationColor: 0xc4d8dc,
    attenuationDistance: 12,
    clearcoat: 0.3,
    clearcoatRoughness: 0.08,
    specularIntensity: 1,
    envMapIntensity: 1.15,
    side: THREE.FrontSide,
  }));

  add(physical('interior-decal-B', {
    color: 0xffffff,
    map: texture('interior-decal-B_BaseColor.jpg'),
    normalMap: texture('interior-decal-B_Normal.png'),
    normalScale: normalScale(0.65),
    roughness: 1,
    roughnessMap: texture('interior-decal-B_Roughness.jpg'),
    metalness: 0,
  }));
  add(physical('interior-decal-A', {
    color: 0xffffff,
    map: texture('interior-decal-A_BaseColor.jpg'),
    normalMap: texture('interior-decal-A_Normal.png'),
    normalScale: normalScale(0.65),
    roughness: 1,
    roughnessMap: texture('interior-decal-A_Roughness.jpg'),
    metalness: 0,
    specularIntensity: 1,
    specularIntensityMap: texture('interior-decal-A_Specular.jpg'),
  }));
  add(physical('interior-leather', {
    color: 0xffffff,
    map: texture('interior-leather_BaseColor.jpg'),
    normalMap: texture('interior-leather_Normal.png'),
    normalScale: normalScale(0.75),
    roughness: 1,
    roughnessMap: texture('interior-leather_Roughness.jpg'),
    metalness: 0,
    sheen: 0.18,
    sheenRoughness: 0.72,
  }));
  add(physical('interior-seats', {
    color: 0xffffff,
    map: texture('interior-seats_BaseColor.jpg'),
    normalMap: texture('interior-seats_Normal.png'),
    normalScale: normalScale(0.75),
    roughness: 1,
    roughnessMap: texture('interior-seats_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('interior-seats_Metallic.jpg'),
    sheen: 0.16,
    sheenRoughness: 0.75,
  }));
  add(physical('interior-fabric', {
    color: 0xffffff,
    map: texture('interior-fabric_BaseColor.jpg'),
    normalMap: texture('interior-fabric_Normal.png'),
    normalScale: normalScale(0.8),
    roughness: 0.82,
    metalness: 0,
    specularIntensity: 1,
    specularIntensityMap: texture('interior-fabric_Specular.jpg'),
    sheen: 0.34,
    sheenRoughness: 0.86,
  }));
  add(physical('interior-common', {
    color: 0xffffff,
    map: texture('interior-common_BaseColor.jpg'),
    normalMap: texture('interior-common_Normal.png'),
    normalScale: normalScale(0.85),
    roughness: 1,
    roughnessMap: texture('interior-common_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('interior-common_Metallic.jpg'),
    specularIntensity: 1,
    specularIntensityMap: texture('interior-common_Specular.jpg'),
  }));

  add(physical('exterior-badges', {
    color: 0xffffff,
    map: texture('exterior-badges_BaseColor.jpg'),
    normalMap: texture('exterior-badges_Normal.png'),
    normalScale: normalScale(0.85),
    roughness: 1,
    roughnessMap: texture('exterior-badges_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('exterior-badges_Metallic.jpg'),
    clearcoat: 0.16,
    clearcoatRoughness: 0.12,
  }));
  add(standard('exterior-common', {
    color: 0xffffff,
    map: texture('exterior-common_BaseColor.jpg'),
    normalMap: texture('exterior-common_Normal.png'),
    normalScale: normalScale(0.9),
    roughness: 1,
    roughnessMap: texture('exterior-common_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('exterior-common_Metallic.jpg'),
    envMapIntensity: 1.25,
  }));
  add(physical('carpaint', {
    color: 0xa51420,
    normalMap: texture('carpaint_Normal.png'),
    normalScale: normalScale(0.32),
    roughness: 1,
    roughnessMap: texture('carpaint_Roughness.jpg'),
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    ior: 1.48,
    envMapIntensity: 1.08,
  }));
  add(standard('exterior-bolts', {
    color: 0xffffff,
    map: texture('exterior-bolts_BaseColor.jpg'),
    roughness: 1,
    roughnessMap: texture('exterior-bolts_Roughness.jpg'),
    metalness: 0.55,
    envMapIntensity: 1.3,
  }));

  add(standard('wheels-caliper', {
    color: 0xffffff,
    map: texture('wheels-caliper_BaseColor.jpg'),
    roughness: 1,
    roughnessMap: texture('wheels-caliper_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('wheels-caliper_Metallic.jpg'),
    envMapIntensity: 0.78,
  }));
  add(physical('wheels-tires', {
    color: 0xffffff,
    map: texture('wheels-tires_BaseColor.jpg'),
    normalMap: texture('wheels-tires_Normal.png'),
    normalScale: normalScale(0.82),
    roughness: 1,
    roughnessMap: texture('wheels-tires_Roughness.jpg'),
    metalness: 0,
    specularIntensity: 1,
    specularIntensityMap: texture('wheels-tires_Specular.jpg'),
    envMapIntensity: 0.72,
  }));
  add(standard('wheels-disc', {
    color: 0xffffff,
    map: texture('wheels-disc_BaseColor.jpg'),
    normalMap: texture('wheels-disc_Normal.png'),
    normalScale: normalScale(0.72),
    roughness: 1,
    roughnessMap: texture('wheels-disc_Roughness.jpg'),
    metalness: 1,
    metalnessMap: texture('wheels-disc_Metallic.jpg'),
    envMapIntensity: 0.88,
  }));
  add(standard('wheels-rim', {
    color: 0xb8bab8,
    normalMap: texture('wheels-rim_Normal.png'),
    normalScale: normalScale(0.72),
    roughness: 0.5,
    metalness: 0.42,
    envMapIntensity: 0.68,
  }));
  add(standard('license-plates', {
    color: 0x111315,
    roughness: 0.62,
    metalness: 0.08,
    envMapIntensity: 0.35,
  }));
  add(standard('default', { color: 0x292b2d, metalness: 0.15, roughness: 0.5 }));
  return materials;
}

function createStage() {
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshStandardMaterial({
      color: 0x090a0c,
      metalness: 0.05,
      roughness: 0.76,
      envMapIntensity: 0.5,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.105;
  floor.receiveShadow = true;
  group.add(floor);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(3.08, 3.08, 0.11, 160),
    new THREE.MeshStandardMaterial({
      color: 0x08090b,
      metalness: 0,
      roughness: 0.9,
      envMapIntensity: 0.08,
    }),
  );
  plinth.position.y = -0.058;
  plinth.receiveShadow = true;
  group.add(plinth);

  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.62, 3.72),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      color: 0x000000,
      opacity: 0.5,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.002;
  contactShadow.renderOrder = 1;
  group.add(contactShadow);

  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(3.08, 0.008, 8, 192),
    new THREE.MeshBasicMaterial({ color: 0x3d4044, toneMapped: false }),
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.001;
  group.add(edge);

  return { group, floor, plinth, contactShadow, edge };
}

function createContactShadowTexture() {
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 512;
  shadowCanvas.height = 512;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(256, 256, 12, 256, 256, 246);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.38, 'rgba(255, 255, 255, 0.66)');
  gradient.addColorStop(0.72, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
  return new THREE.CanvasTexture(shadowCanvas);
}

function createStudioBackdrop() {
  const backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = 1024;
  backdropCanvas.height = 512;
  const context = backdropCanvas.getContext('2d');

  const vertical = context.createLinearGradient(0, 0, 0, backdropCanvas.height);
  vertical.addColorStop(0, '#090a0c');
  vertical.addColorStop(0.34, '#17191c');
  vertical.addColorStop(0.62, '#2a2b2e');
  vertical.addColorStop(0.82, '#121315');
  vertical.addColorStop(1, '#070809');
  context.fillStyle = vertical;
  context.fillRect(0, 0, backdropCanvas.width, backdropCanvas.height);

  const glow = context.createRadialGradient(530, 278, 10, 530, 278, 360);
  glow.addColorStop(0, 'rgba(196, 201, 207, 0.16)');
  glow.addColorStop(0.45, 'rgba(117, 121, 126, 0.06)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, backdropCanvas.width, backdropCanvas.height);

  const texture = new THREE.CanvasTexture(backdropCanvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createLighting() {
  const group = new THREE.Group();
  const studioRig = new THREE.Group();
  group.add(studioRig);

  const hemisphere = new THREE.HemisphereLight(0xcbd3dc, 0x080707, 0.22);
  group.add(hemisphere);

  // The HDRI supplies the visible softboxes and ambient fill. This directional
  // light is only a shadow-casting proxy for the panorama's dominant broad
  // source, centered near 38 degrees azimuth and 24 degrees elevation.
  const key = new THREE.DirectionalLight(0xfff5eb, 0.46);
  key.position.set(7.6, 4.6, 5.8);
  key.target.position.set(0, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.left = -4.2;
  key.shadow.camera.right = 4.2;
  key.shadow.camera.top = 4.2;
  key.shadow.camera.bottom = -4.2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 18;
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 24;
  studioRig.add(key, key.target);

  const headlightTargets = [];
  const headlightSpots = [-0.61, 0.61].map((x) => {
    const spot = new THREE.SpotLight(0xffe8c7, 0, 13, 0.25, 0.7, 1.35);
    spot.position.set(x, 0.68, 1.88);
    spot.target.position.set(x * 0.72, 0.25, 9);
    headlightTargets.push(spot.target);
    group.add(spot, spot.target);
    return spot;
  });

  return { group, studioRig, hemisphere, key, headlightSpots, headlightTargets };
}

function setupInterface() {
  const settingsPanel = document.querySelector('#settings-panel');
  const settingsButton = document.querySelector('#settings-button');
  const settingsClose = document.querySelector('#settings-close');
  const creditsCard = document.querySelector('#credits-card');
  const creditsButton = document.querySelector('#credits-button');

  const setPanel = (open) => {
    settingsPanel.classList.toggle('is-open', open);
    settingsPanel.setAttribute('aria-hidden', String(!open));
    settingsButton.setAttribute('aria-expanded', String(open));
  };

  const setCredits = (open) => {
    creditsCard.classList.toggle('is-open', open);
    creditsCard.setAttribute('aria-hidden', String(!open));
    creditsButton.setAttribute('aria-expanded', String(open));
  };

  settingsButton.addEventListener('click', () => setPanel(!settingsPanel.classList.contains('is-open')));
  settingsClose.addEventListener('click', () => setPanel(false));
  creditsButton.addEventListener('click', () => setCredits(!creditsCard.classList.contains('is-open')));
  document.querySelector('#credits-close').addEventListener('click', () => setCredits(false));

  document.querySelectorAll('[data-camera]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      moveToPreset(button.dataset.camera);
    });
  });

  document.querySelectorAll('.swatch').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((swatch) => {
        const selected = swatch === button;
        swatch.classList.toggle('is-active', selected);
        swatch.setAttribute('aria-checked', String(selected));
      });
      document.querySelector('#paint-name').value = button.dataset.paint;
      applyPaintProfile(button.dataset.paint);
      renderer.shadowMap.needsUpdate = true;
    });
  });

  const exposure = document.querySelector('#exposure');
  initializeRange(exposure);
  exposure.addEventListener('input', () => {
    renderer.toneMappingExposure = Number(exposure.value);
    document.querySelector('#exposure-value').value = Number(exposure.value).toFixed(2);
    updateRange(exposure);
  });

  const studioRotation = document.querySelector('#studio-rotation');
  initializeRange(studioRotation);
  studioRotation.addEventListener('input', () => {
    const degrees = Number(studioRotation.value);
    setStudioRotation(degrees);
    document.querySelector('#rotation-value').value = `${degrees}°`;
    updateRange(studioRotation);
  });

  const autorotate = document.querySelector('#autorotate-toggle');
  autorotate.checked = controls.autoRotate;
  autorotate.addEventListener('change', () => {
    controls.autoRotate = autorotate.checked;
    if (controls.autoRotate) cameraTween = null;
  });

  document.querySelector('#headlights-toggle').addEventListener('change', (event) => {
    setHeadlights(event.target.checked);
  });
  document.querySelector('#indicators-toggle').addEventListener('change', (event) => {
    setIndicators(event.target.checked);
  });
  document.querySelector('#brakes-toggle').addEventListener('change', (event) => {
    setBrakeLights(event.target.checked);
  });
  document.querySelector('#reverse-toggle').addEventListener('change', (event) => {
    setReverseLights(event.target.checked);
  });

  document.querySelectorAll('[data-quality]').forEach((button) => {
    button.addEventListener('click', () => configureQuality(button.dataset.quality));
  });

  document.querySelector('#fullscreen-button').addEventListener('click', toggleFullscreen);
  document.querySelector('#capture-button').addEventListener('click', captureImage);

  document.addEventListener('fullscreenchange', () => {
    const button = document.querySelector('#fullscreen-button');
    button.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
    button.dataset.tooltip = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });

  controls.addEventListener('start', () => {
    cameraTween = null;
    document.body.classList.add('has-interacted');
    controls.autoRotate = false;
    autorotate.checked = false;
  });

  window.addEventListener('keydown', (event) => {
    if (event.target.matches('input')) return;
    const presetKeys = { Digit1: 'hero', Digit2: 'front', Digit3: 'profile', Digit4: 'rear', Digit5: 'cockpit' };
    if (presetKeys[event.code]) moveToPreset(presetKeys[event.code]);
    if (event.code === 'Space') {
      event.preventDefault();
      autorotate.checked = !autorotate.checked;
      controls.autoRotate = autorotate.checked;
    }
    if (event.code === 'KeyL') {
      const toggle = document.querySelector('#headlights-toggle');
      toggle.checked = !toggle.checked;
      setHeadlights(toggle.checked);
    }
    if (event.code === 'KeyI') {
      const toggle = document.querySelector('#indicators-toggle');
      toggle.checked = !toggle.checked;
      setIndicators(toggle.checked);
    }
    if (event.code === 'KeyB') {
      const toggle = document.querySelector('#brakes-toggle');
      toggle.checked = !toggle.checked;
      setBrakeLights(toggle.checked);
    }
    if (event.code === 'KeyR') {
      const toggle = document.querySelector('#reverse-toggle');
      toggle.checked = !toggle.checked;
      setReverseLights(toggle.checked);
    }
    if (event.code === 'KeyF') toggleFullscreen();
    if (event.code === 'Escape') {
      setPanel(false);
      setCredits(false);
    }
  });
}

function initializeRange(input) {
  updateRange(input);
}

function applyPaintProfile(name) {
  const profile = paintProfiles[name];
  if (!bodyMaterial || !profile) return;

  bodyMaterial.color.setHex(profile.color);
  bodyMaterial.roughnessMap = profile.useRoughnessMap === false ? null : bodyRoughnessMap;
  bodyMaterial.metalness = profile.metalness;
  bodyMaterial.roughness = profile.roughness;
  bodyMaterial.clearcoat = profile.clearcoat;
  bodyMaterial.clearcoatRoughness = profile.clearcoatRoughness;
  bodyMaterial.envMapIntensity = profile.envMapIntensity;
  bodyMaterial.needsUpdate = true;
}

function updateRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--range-progress', `${percent}%`);
}

function setStudioRotation(degrees) {
  const radians = THREE.MathUtils.degToRad(degrees);
  scene.environmentRotation.y = radians;
  lampMaterials.indicatorReflectorsOff?.envMapRotation.set(0, radians, 0);
  lampMaterials.indicatorReflectors?.envMapRotation.set(0, radians, 0);
  lights.studioRig.rotation.y = radians;
  lights.studioRig.updateMatrixWorld(true);
  renderer.shadowMap.needsUpdate = true;
}

function setHeadlights(enabled) {
  vehicleLightState.headlights = enabled;
  lights.headlightSpots.forEach((spot) => {
    spot.intensity = enabled ? 190 : 0;
  });

  applyRearLampState();
  updateHeadlightEmission();
}

function setIndicators(enabled) {
  vehicleLightState.indicators = enabled;
  vehicleLightState.indicatorStartedAt = performance.now() * 0.001;
  applyIndicatorIllumination(enabled);
}

function setBrakeLights(enabled) {
  vehicleLightState.brakes = enabled;
  applyRearLampState();
}

function setReverseLights(enabled) {
  vehicleLightState.reverse = enabled;
  applyRearLampState();
}

function setMaterialEmission(material, color, intensity) {
  if (!material) return;
  material.emissive.setHex(color);
  material.emissiveIntensity = intensity;
}

function setIndicatorHousingReflection(lit) {
  const offMaterial = lampMaterials.indicatorReflectorsOff;
  const onMaterial = lampMaterials.indicatorReflectors;
  const activeMaterial = lit ? onMaterial : offMaterial;
  if (!offMaterial || !onMaterial || !activeMaterial) return;

  lampMeshes.indicatorLenses.forEach((mesh) => {
    const installedMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    installedMaterials.forEach((material, index) => {
      if (material !== offMaterial && material !== onMaterial) return;
      installedMaterials[index] = activeMaterial;
    });
    mesh.material = Array.isArray(mesh.material)
      ? installedMaterials
      : installedMaterials[0];
  });
}

function setIndicatorHotspotRadiance(lit) {
  const setHotspot = (material, radiance, opacity) => {
    if (!material) return;
    material.uniforms.lampColor.value.setHex(0xff5a08);
    material.uniforms.lampRadiance.value = lit ? radiance : 0;
    material.uniforms.lampOpacity.value = lit ? opacity : 0;
    material.userData.lampMeshes?.forEach((mesh) => {
      mesh.visible = lit;
    });
  };
  setHotspot(lampMaterials.indicatorHotspots, 8, 0.84);
  setHotspot(lampMaterials.sideIndicatorHotspots, 2.8, 0.72);
}

function applyIndicatorIllumination(lit) {
  vehicleLightState.indicatorLit = vehicleLightState.indicators && lit;
  setIndicatorHousingReflection(
    vehicleLightState.indicatorLit && indicatorRenderComponents.reflections,
  );
  setIndicatorHotspotRadiance(
    vehicleLightState.indicatorLit && indicatorRenderComponents.hotspots,
  );
}

function applyRearLampState() {
  const running = vehicleLightState.headlights;
  const tailBulbIntensity = vehicleLightState.brakes
    ? ACTIVE_LAMP_RADIANCE_SCALE
    : running ? 0.5 : 0;
  const tailReflectorIntensity = vehicleLightState.brakes
    ? 3 * ACTIVE_LAMP_RADIANCE_SCALE
    : running ? 2 : 0;
  // Every cover shell stays passive. Bulbs and reflector housings provide all
  // lamp radiance from behind the authored lenses.
  setMaterialEmission(
    lampMaterials.tailBulbs,
    tailBulbIntensity > 0 ? 0xff1204 : 0x000000,
    tailBulbIntensity,
  );
  setMaterialEmission(
    lampMaterials.tailLampReflectors,
    tailReflectorIntensity > 0 ? 0xff0000 : 0x000000,
    tailReflectorIntensity,
  );
  setMaterialEmission(
    lampMaterials.reverseBulbs,
    vehicleLightState.reverse ? 0xfff1d2 : 0x000000,
    vehicleLightState.reverse ? 0.5 * ACTIVE_LAMP_RADIANCE_SCALE : 0,
  );
  setMaterialEmission(
    lampMaterials.reverseReflectors,
    vehicleLightState.reverse ? 0xfff4dc : 0x000000,
    vehicleLightState.reverse ? 1.5 * ACTIVE_LAMP_RADIANCE_SCALE : 0,
  );
}

function updateIndicators(timestamp) {
  if (!vehicleLightState.indicators) return;
  const elapsed = (timestamp - vehicleLightState.indicatorStartedAt) % INDICATOR_PERIOD;
  const lit = elapsed < INDICATOR_ON_TIME;
  if (lit !== vehicleLightState.indicatorLit) applyIndicatorIllumination(lit);
}

function updateHeadlightEmission() {
  let directness = 0;
  if (vehicleLightState.headlights) {
    headlightViewDirection.subVectors(camera.position, headlightCenter).normalize();
    headlightBeamDirection.subVectors(headlightTarget, headlightCenter).normalize();
    const alignment = headlightViewDirection.dot(headlightBeamDirection);
    directness = Math.pow(THREE.MathUtils.smoothstep(alignment, 0.84, 0.985), 1.7);
  }

  if (lampMaterials.headlights) {
    lampMaterials.headlights.emissive.setHex(
      vehicleLightState.headlights ? 0xffe4b5 : 0x000000,
    );
    lampMaterials.headlights.emissiveIntensity = vehicleLightState.headlights
      ? 1.6 + directness * 28
      : 0;
  }
}

function moveToPreset(name, immediate = false) {
  const preset = resolveCameraPreset(name);
  if (!preset) return;

  activeView = name;
  document.querySelector('#active-view-label').textContent = preset.label;
  document.querySelectorAll('.camera-nav [data-camera]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.camera === name);
  });

  const autorotateEnabled = document.querySelector('#autorotate-toggle').checked;
  controls.autoRotate = false;

  if (immediate) {
    cameraTween = null;
    camera.position.copy(preset.position);
    controls.target.copy(preset.target);
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
    controls.update();
    controls.autoRotate = autorotateEnabled;
    return;
  }

  cameraTween = {
    elapsed: 0,
    duration: name === 'cockpit' ? 1.65 : 1.35,
    startPosition: camera.position.clone(),
    endPosition: preset.position.clone(),
    startTarget: controls.target.clone(),
    endTarget: preset.target.clone(),
    startFov: camera.fov,
    endFov: preset.fov,
    restoreAutoRotate: autorotateEnabled,
  };
}

function resolveCameraPreset(name) {
  const base = cameraPresets[name];
  if (!base) return null;

  const resolved = {
    label: base.label,
    position: base.position.clone(),
    target: base.target.clone(),
    fov: base.fov,
  };

  if (window.innerWidth <= 600) {
    const distanceScale = name === 'cockpit' ? 1.12 : 1.42;
    resolved.position.sub(resolved.target).multiplyScalar(distanceScale).add(resolved.target);
    resolved.target.y -= name === 'cockpit' ? 0 : 0.06;
    resolved.fov = name === 'cockpit' ? 48 : 52;
  }

  return resolved;
}

function updateCameraTween(delta) {
  if (!cameraTween) return;
  cameraTween.elapsed += delta;
  const linear = Math.min(cameraTween.elapsed / cameraTween.duration, 1);
  const eased = 1 - Math.pow(1 - linear, 4);

  camera.position.lerpVectors(cameraTween.startPosition, cameraTween.endPosition, eased);
  controls.target.lerpVectors(cameraTween.startTarget, cameraTween.endTarget, eased);
  camera.fov = THREE.MathUtils.lerp(cameraTween.startFov, cameraTween.endFov, eased);
  camera.updateProjectionMatrix();

  if (linear === 1) {
    controls.autoRotate = cameraTween.restoreAutoRotate;
    cameraTween = null;
  }
}

function configureQuality(mode, announce = true) {
  currentQuality = mode;
  adaptiveQualityChecked = mode !== 'auto';
  adaptiveSampleFrames = 0;
  adaptiveSampleTime = 0;

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const nativePixelRatio = window.devicePixelRatio || 1;
  const maxSamples = renderer.capabilities.maxSamples;
  let profile;

  if (mode === 'balanced') {
    profile = {
      dpr: Math.min(Math.max(nativePixelRatio, mobile ? 1 : 1.15), mobile ? 1.15 : 1.35),
      shadow: 2048,
      ao: 8,
      msaa: Math.min(maxSamples, 2),
    };
  } else if (mode === 'ultra') {
    profile = {
      dpr: Math.min(Math.max(nativePixelRatio, 2), 2),
      shadow: 4096,
      ao: 16,
      msaa: Math.min(maxSamples, 8),
    };
  } else {
    const capable = cores >= 8 && memory >= 6 && !mobile;
    profile = {
      dpr: mobile
        ? Math.min(Math.max(nativePixelRatio, 1.12), 1.35)
        : Math.min(Math.max(nativePixelRatio, capable ? 1.5 : 1.3), capable ? 1.8 : 1.5),
      shadow: capable ? 4096 : 2048,
      ao: capable ? 12 : 8,
      msaa: Math.min(maxSamples, mobile ? 2 : 4),
    };
  }

  currentPixelRatio = Math.max(profile.dpr, 0.85);
  renderer.setPixelRatio(currentPixelRatio);
  composer.setPixelRatio(currentPixelRatio);
  composer.renderTarget1.samples = profile.msaa;
  composer.renderTarget2.samples = profile.msaa;
  lights.key.shadow.mapSize.set(profile.shadow, profile.shadow);
  lights.key.shadow.radius = profile.shadow / 112;
  if (lights.key.shadow.map) {
    lights.key.shadow.map.dispose();
    lights.key.shadow.map = null;
  }
  renderer.shadowMap.needsUpdate = true;
  gtaoPass.updateGtaoMaterial({ samples: profile.ao });
  gtaoPass.updatePdMaterial({ samples: profile.ao });
  resize();

  document.querySelectorAll('[data-quality]').forEach((button) => {
    const selected = button.dataset.quality === mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-checked', String(selected));
  });

  const qualityName = mode[0].toUpperCase() + mode.slice(1);
  document.querySelector('#quality-value').value = qualityName;
  document.querySelector('#render-status').textContent = `PBR / ${mode === 'balanced' ? 'BALANCED' : 'HIGH'}`;
  if (announce) showToast(`${qualityName} render quality`);
}

function adaptQuality(delta) {
  if (!ready || currentQuality !== 'auto' || adaptiveQualityChecked || document.hidden) return;
  adaptiveSampleFrames += 1;
  adaptiveSampleTime += Math.min(delta, 0.1);

  if (adaptiveSampleFrames < 150) return;
  const fps = adaptiveSampleFrames / adaptiveSampleTime;
  adaptiveQualityChecked = true;
  if (fps < 42 && currentPixelRatio > 1.05) {
    currentPixelRatio = Math.max(1, currentPixelRatio * 0.8);
    renderer.setPixelRatio(currentPixelRatio);
    composer.setPixelRatio(currentPixelRatio);
    resize();
    document.querySelector('#render-status').textContent = 'PBR / ADAPTIVE';
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const nextPortraitLayout = width <= 600;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  controls.maxDistance = nextPortraitLayout ? 16 : 9.5;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);

  if (nextPortraitLayout !== portraitLayout) {
    portraitLayout = nextPortraitLayout;
    moveToPreset(activeView, true);
  }
}

function render(timestamp) {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateCameraTween(delta);
  controls.update(delta);
  updateIndicators(timestamp * 0.001);
  updateHeadlightEmission();
  composer.render(delta);
  adaptQuality(delta);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.querySelector('#app').requestFullscreen();
    }
  } catch {
    showToast('Fullscreen is unavailable');
  }
}

function captureImage() {
  if (!ready) return;
  composer.render(0);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('Image capture failed');
      return;
    }
    const link = document.createElement('a');
    link.download = `porsche-959-${activeView}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast('Image saved');
  }, 'image/png');
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
}
