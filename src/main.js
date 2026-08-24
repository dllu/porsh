import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
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
renderer.toneMappingExposure = 0.88;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

RectAreaLightUniformsLib.init();

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
    radius: 0.22,
    distanceExponent: 1.15,
    thickness: 1.2,
    distanceFallOff: 0.7,
    scale: 1,
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
gtaoPass.blendIntensity = 0.58;

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.045,
  0.42,
  1.35,
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

let car = null;
let bodyMaterial = null;
let headlightMaterial = null;
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

    environment.mapping = THREE.EquirectangularReflectionMapping;
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const environmentMap = pmremGenerator.fromEquirectangular(environment).texture;
    scene.environment = environmentMap;
    pmremGenerator.dispose();

    installCar(model.scene);
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
    new RGBELoader().load(
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

async function loadModel() {
  setLoadingLabel('Downloading protected model');
  const encryptedPayload = await fetchProtectedModel();
  setProgress('model', 0.74);
  let source = await decryptProtectedModel(encryptedPayload);
  setProgress('model', 0.88);
  setLoadingLabel('Building 2.57m triangles');

  // Let the loading UI paint before the necessarily synchronous FBX parse.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const result = new FBXLoader().parse(source, '');
  source = null;
  setProgress('model', 0.94);
  return { scene: result };
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
    setProgress('model', 0.72);
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
    setProgress('model', downloadRatio * 0.72);
    if (downloadRatio > 0.12) setLoadingLabel('Loading protected geometry');
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
          setProgress('model', 0.78);
        } else if (event.data.phase === 'decompressing') {
          setLoadingLabel('Expanding geometry');
          setProgress('model', 0.83);
        }
        return;
      }

      if (event.data.type === 'complete') {
        finish();
        resolve(event.data.payload);
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

function installCar(model) {
  car = model;
  const wwcMaterials = createWwcMaterials();
  car.scale.setScalar(0.01);

  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 12);
  const preparedMaterials = new Set();
  const tireMeshes = [];

  car.traverse((object) => {
    if (!object.isMesh) return;

    object.material = resolveWwcMaterial(object.name, wwcMaterials);

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const isOccluder = object.name.startsWith('ShadowPlanes_');
    object.castShadow = !isOccluder && materials.every((material) => !material?.transparent);
    object.receiveShadow = !isOccluder;
    if (materials.some((material) => material?.name === 'Tyre')) tireMeshes.push(object);
    materials.forEach((material) => {
      if (!material || preparedMaterials.has(material)) return;
      preparedMaterials.add(material);
      prepareMaterial(material, maxAnisotropy);
    });
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

  bodyMaterial = [...preparedMaterials].find((material) => material.name === 'body') ?? null;
  headlightMaterial = [...preparedMaterials].find((material) => material.name === 'headlights') ?? null;

  if (bodyMaterial) {
    bodyMaterial.color.set('#a51420');
    bodyMaterial.metalness = 0.08;
    bodyMaterial.roughness = 0.3;
    bodyMaterial.clearcoat = 1;
    bodyMaterial.clearcoatRoughness = 0.065;
    bodyMaterial.ior = 1.48;
    bodyMaterial.envMapIntensity = 1.34;
    bodyMaterial.needsUpdate = true;
  }

  if (headlightMaterial) {
    headlightMaterial.depthWrite = false;
    headlightMaterial.ior = 1.52;
    headlightMaterial.thickness = 0.018;
    headlightMaterial.envMapIntensity = 1.28;
    headlightMaterial.needsUpdate = true;
  }

  scene.add(car);
  gtaoPass.setSceneClipBox(new THREE.Box3(
    new THREE.Vector3(-3.6, -0.15, -3.6),
    new THREE.Vector3(3.6, 2.2, 3.6),
  ));
}

function prepareMaterial(material, anisotropy) {
  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.anisotropy = anisotropy;
      value.needsUpdate = true;
    }
  }

  material.envMapIntensity = Math.max(material.envMapIntensity ?? 1, 1.04);

  if (material.name === 'window') {
    const glassDetail = material.map?.clone() ?? null;
    if (glassDetail) {
      glassDetail.colorSpace = THREE.NoColorSpace;
      glassDetail.needsUpdate = true;
    }
    material.map = null;
    material.transmissionMap = null;
    material.roughnessMap = glassDetail;
    material.color.set('#90a4a8');
    material.transmission = 0.92;
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
    material.roughness = 0.065;
    material.ior = 1.58;
    material.thickness = 0.0025;
    material.attenuationColor?.set('#c4d8dc');
    material.attenuationDistance = 12;
    material.clearcoat = 0.3;
    material.clearcoatRoughness = 0.08;
    material.specularIntensity = 1;
    material.envMapIntensity = 1.15;
    material.side = THREE.FrontSide;
  }

  if (material.name === 'chrome' || material.name === 'mirrormat') {
    material.envMapIntensity = 1.55;
  }

  if (material.name === 'inner_rim') {
    material.metalness = 0.52;
    material.roughness = 0.3;
    material.envMapIntensity = 1.3;
  }

  if (material.name === 'outer_rim') {
    material.metalness = 0.72;
    material.roughness = 0.2;
    material.envMapIntensity = 1.45;
  }

  if (material.name === 'Tyre') {
    material.roughness = Math.max(material.roughness, 0.74);
  }

  material.needsUpdate = true;
}

function createWwcMaterials() {
  const physical = (name, parameters) => new THREE.MeshPhysicalMaterial({ name, ...parameters });
  const standard = (name, parameters) => new THREE.MeshStandardMaterial({ name, ...parameters });

  return {
    body: physical('body', {
      color: 0xa51420,
      metalness: 0.08,
      roughness: 0.26,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
    window: physical('window', {
      color: 0x90a4a8,
      metalness: 0,
      roughness: 0.065,
      transmission: 0.92,
      opacity: 1,
      transparent: false,
      depthWrite: true,
      ior: 1.58,
      thickness: 0.0025,
      clearcoat: 0.3,
      clearcoatRoughness: 0.08,
      side: THREE.FrontSide,
    }),
    headlights: physical('headlights', {
      color: 0xf4f6f4,
      metalness: 0,
      roughness: 0.1,
      transmission: 0.74,
      opacity: 0.46,
      transparent: true,
      depthWrite: false,
      emissive: 0x000000,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    }),
    clearGlass: physical('clear_glass', {
      color: 0xf3f6f7,
      metalness: 0,
      roughness: 0.08,
      transmission: 0.55,
      opacity: 0.65,
      transparent: true,
      depthWrite: false,
      clearcoat: 0.7,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    }),
    tailGlass: physical('tail_glass', {
      color: 0x9f0710,
      emissive: 0x180002,
      emissiveIntensity: 0.35,
      metalness: 0,
      roughness: 0.2,
      transmission: 0.14,
      opacity: 0.88,
      transparent: true,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
    orangeGlass: physical('orange_glass', {
      color: 0xd65a08,
      emissive: 0x321000,
      emissiveIntensity: 0.28,
      metalness: 0,
      roughness: 0.18,
      transmission: 0.18,
      opacity: 0.9,
      transparent: true,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
    chrome: standard('chrome', { color: 0xdde2e5, metalness: 1, roughness: 0.12 }),
    mirror: standard('mirrormat', { color: 0xe8edf0, metalness: 1, roughness: 0.035 }),
    satinMetal: standard('satin_metal', { color: 0x8d9295, metalness: 0.82, roughness: 0.3 }),
    gunmetal: standard('gunmetal', { color: 0x292d30, metalness: 0.78, roughness: 0.34 }),
    rim: standard('outer_rim', { color: 0xb4b6b5, metalness: 0.82, roughness: 0.2 }),
    tire: standard('Tyre', { color: 0x08090a, metalness: 0, roughness: 0.84 }),
    brakeDisc: standard('brake_disc', { color: 0x666b6d, metalness: 0.9, roughness: 0.3 }),
    caliper: standard('caliper', { color: 0xe5b416, metalness: 0.18, roughness: 0.3 }),
    rubber: standard('rubber', { color: 0x090a0b, metalness: 0, roughness: 0.78 }),
    blackPlastic: standard('black_plastic', { color: 0x0c0d0f, metalness: 0, roughness: 0.58 }),
    ruggedPlastic: standard('rugged_plastic', { color: 0x101113, metalness: 0, roughness: 0.82 }),
    colorPlastic: standard('color_plastic', { color: 0x3a332f, metalness: 0, roughness: 0.52 }),
    redPlastic: standard('red_plastic', { color: 0x8d1019, metalness: 0, roughness: 0.48 }),
    blackLeather: physical('black_leather', { color: 0x0d0d0e, metalness: 0, roughness: 0.62, sheen: 0.18 }),
    colorLeather: physical('color_leather', { color: 0x49413b, metalness: 0, roughness: 0.54, sheen: 0.22 }),
    silverLeather: physical('silver_leather', { color: 0x7e7c77, metalness: 0, roughness: 0.56, sheen: 0.2 }),
    whiteLeather: physical('white_leather', { color: 0xb4aea4, metalness: 0, roughness: 0.58, sheen: 0.18 }),
    carpet: standard('carpet', { color: 0x09090a, metalness: 0, roughness: 0.96 }),
    belts: standard('seat_belts', { color: 0x191a1c, metalness: 0, roughness: 0.72 }),
    decalGlossy: physical('decal_glossy', { color: 0x090a0b, metalness: 0, roughness: 0.24, clearcoat: 0.5 }),
    decalSatin: standard('decal_satin', { color: 0x17191b, metalness: 0, roughness: 0.6 }),
    plate: standard('license_plate', { color: 0xd5d3c9, metalness: 0.02, roughness: 0.48 }),
    occluder: standard('cavity_occluder', {
      color: 0x030304,
      metalness: 0,
      roughness: 1,
      envMapIntensity: 0,
      side: THREE.DoubleSide,
    }),
    default: standard('wwc_default', { color: 0x26282a, metalness: 0.15, roughness: 0.48 }),
  };
}

function resolveWwcMaterial(name, materials) {
  if (name.startsWith('ShadowPlanes_')) return materials.occluder;
  if (name.startsWith('Paint_')) return materials.body;
  if (name.startsWith('GlassWindows_')) return materials.window;
  if (name === 'GlassHL_HL') return materials.headlights;
  if (name.startsWith('GlassHL_TL_') || name.startsWith('GlassRed_') || name.startsWith('GlassReflector_')) return materials.tailGlass;
  if (name.startsWith('GlassOrange_')) return materials.orangeGlass;
  if (name.startsWith('GlassClear_')) return materials.clearGlass;
  if (name.startsWith('Mirrors_')) return materials.mirror;
  if (name.startsWith('MetalChrome_') || name.startsWith('Metal_')) return materials.chrome;
  if (name.startsWith('MetalSatin_')) return materials.satinMetal;
  if (name.startsWith('Gunmetal_')) return materials.gunmetal;
  if (name.startsWith('Rims_')) return materials.rim;
  if (name.startsWith('Tires_')) return materials.tire;
  if (name.startsWith('BrakeDisc_')) return materials.brakeDisc;
  if (name.startsWith('Calipers_')) return materials.caliper;
  if (name.startsWith('Rubber_')) return materials.rubber;
  if (name.startsWith('PlasticBlack_')) return materials.blackPlastic;
  if (name.startsWith('PlasticRugged_')) return materials.ruggedPlastic;
  if (name.startsWith('PlasticColor_')) return materials.colorPlastic;
  if (name.startsWith('PlasticRed_')) return materials.redPlastic;
  if (name.startsWith('LeatherBlack_')) return materials.blackLeather;
  if (name.startsWith('LeatherColor_')) return materials.colorLeather;
  if (name.startsWith('LeatherSilver_')) return materials.silverLeather;
  if (name.startsWith('LeatherWhite_')) return materials.whiteLeather;
  if (name.startsWith('Carpet_')) return materials.carpet;
  if (name === 'Seat_belts') return materials.belts;
  if (name.startsWith('DecalGlossy_')) return materials.decalGlossy;
  if (name.startsWith('DecalSatin_')) return materials.decalSatin;
  if (name === 'License_plates') return materials.plate;
  return materials.default;
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

  const hemisphere = new THREE.HemisphereLight(0xdbe6ff, 0x170d0b, 0.16);
  group.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff5eb, 0.72);
  key.position.set(-3.8, 7.8, 4.8);
  key.target.position.set(0, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.left = -4.2;
  key.shadow.camera.right = 4.2;
  key.shadow.camera.top = 4.2;
  key.shadow.camera.bottom = -4.2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 18;
  key.shadow.bias = -0.00016;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3;
  group.add(key, key.target);

  const frontSoftbox = new THREE.RectAreaLight(0xffe7d0, 1.15, 4.2, 3.1);
  frontSoftbox.position.set(4.7, 4.1, 4.2);
  frontSoftbox.lookAt(0, 0.65, 0.2);
  group.add(frontSoftbox);

  const rimSoftbox = new THREE.RectAreaLight(0xb8d1ff, 0.9, 3.5, 2.4);
  rimSoftbox.position.set(-4.2, 3.2, -3.8);
  rimSoftbox.lookAt(0, 0.75, -0.2);
  group.add(rimSoftbox);

  const overhead = new THREE.RectAreaLight(0xffffff, 0.55, 5.5, 2.2);
  overhead.position.set(0, 5.6, -0.2);
  overhead.rotation.x = -Math.PI / 2;
  group.add(overhead);

  const cabinFill = new THREE.PointLight(0xffead7, 2.2, 2.1, 2);
  cabinFill.position.set(0, 1.02, -0.12);
  group.add(cabinFill);

  const headlightTargets = [];
  const headlightSpots = [-0.61, 0.61].map((x) => {
    const spot = new THREE.SpotLight(0xffe8c7, 0, 13, 0.25, 0.7, 1.35);
    spot.position.set(x, 0.68, 1.88);
    spot.target.position.set(x * 0.72, 0.25, 9);
    headlightTargets.push(spot.target);
    group.add(spot, spot.target);
    return spot;
  });

  return { group, key, cabinFill, headlightSpots, headlightTargets };
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
      if (bodyMaterial) {
        bodyMaterial.color.set(button.dataset.color);
        bodyMaterial.metalness = Number(button.dataset.metalness);
        bodyMaterial.needsUpdate = true;
      }
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

function updateRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--range-progress', `${percent}%`);
}

function setStudioRotation(degrees) {
  const radians = THREE.MathUtils.degToRad(degrees);
  scene.environmentRotation.y = radians;
}

function setHeadlights(enabled) {
  lights.headlightSpots.forEach((spot) => {
    spot.intensity = enabled ? 190 : 0;
  });

  if (headlightMaterial) {
    headlightMaterial.emissive.set(enabled ? 0xffe4b5 : 0x000000);
    headlightMaterial.emissiveIntensity = enabled ? 5.5 : 0;
    if (!headlightMaterial.emissiveMap && headlightMaterial.map) {
      headlightMaterial.emissiveMap = headlightMaterial.map;
    }
    headlightMaterial.needsUpdate = true;
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

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateCameraTween(delta);
  controls.update(delta);
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
