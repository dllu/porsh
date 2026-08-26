# Porsche 959 — realtime study

<img width="4096" height="2166" alt="porsche-959-profile(2)" src="https://github.com/user-attachments/assets/7e41465a-10e2-4362-8a04-a60276b6d929" />

A high-quality, browser-based Three.js presentation of Wire Wheels Club's advanced 1987 Porsche 959 model. It uses the model's authored PBR texture set, an HDR studio, transmission/clearcoat, soft dynamic shadows, GTAO, bloom, adaptive resolution, animated camera presets, paint configuration, lights, fullscreen, and lossless screenshot capture.

## Run locally

Purchase and download the advanced model archive, `WireWheelsClub_87_POR_959_v2_ADV.zip`, from [Wire Wheels Club](https://wirewheelsclub.com/models/1987-porsche-959/). The model and its textures are intentionally not distributed in this repository.

The one-time texture preparation requires `unzip` and the `toktx` executable from [Khronos KTX-Software](https://github.com/KhronosGroup/ktx-software) 4.4.2 or newer. Put `toktx` on `PATH` or set `P959_TOKTX=/absolute/path/to/toktx`.

```bash
npm ci
npm run setup:model -- ~/Downloads/WireWheelsClub_87_POR_959_v2_ADV.zip
npm run dev
```

Open the URL shown by Vite. Production output can be generated with `npm run build` and served with `npm run preview`.

For lighting and material iteration, run `npm run test:render`. It launches a
UI-free, deterministic browser harness and writes clean comparison frames for
the front, rear, and side lamps under `render-tests/`. Set
`P959_RENDER_OUTPUT=/absolute/path` to write them elsewhere, or use a
comma-separated `P959_RENDER_STATES` list to render only named frames shown in
`scripts/render-test.mjs`.

The setup command keeps the plaintext FBX, source textures, and local license under the Git-ignored `local-models/wwc-advanced/` directory. It losslessly indexes the static FBX geometry into a local GLB, prepares 54 GPU-compressed KTX2/UASTC maps with mipmaps, and authenticates/encrypts the bundle with AES-256-GCM. Only a content-addressed `.p9e` payload is written beneath the Git-ignored `public/models/protected/` directory.

The first setup is CPU-intensive because it indexes the geometry and encodes the full texture set. Later runs reuse both prepared artifacts. Use `npm run setup:model -- /path/to/archive.zip --rebuild-textures` only when you intentionally want to regenerate every KTX2 map.

`npm run dev` and `npm run build` automatically verify that the protected payload matches the local source model. To rotate the generated key and payload, run:

```bash
npm run protect:model -- --force
```

## Deploy to a static server

```bash
npm ci
npm run build
```

Upload the **contents of `dist/`** to the desired directory on the web server. Node.js is only needed during the build; the deployed site has no server-side runtime, database, environment variables, or external model requests. The build uses relative asset paths, so it works at either a domain root such as `https://example.com/` or a subdirectory such as `https://example.com/porsh/`.

Serve production deployments over HTTPS because browser decryption uses Web Crypto; Vite's local HTTP origin is also accepted by browsers as a secure context. Do not open the build directly from a `file://` URL. No single-page-app fallback rules are needed because the viewer has no client-side routes. The server may serve `.p9e` as `application/octet-stream`; enable that MIME type if a host rejects unknown extensions. The hashed payload can safely receive a long-lived immutable cache header.

At runtime, a Web Worker reconstructs the split key, authenticates and decrypts the payload, and unpacks the model and textures in memory. Three.js loads the indexed geometry and transcodes the KTX2 maps directly to a GPU-supported compressed format. The browser never makes a plaintext model or texture request, and the production build does not contain standalone `.fbx`, `.glb`, `.jpg`, `.png`, or `.ktx2` files.

This is obfuscation, not DRM: because the browser must eventually receive the key, geometry, and textures, a determined user can still recover the assets from memory or instrument the loader. Encryption does not grant publication rights or override the purchased model's license. Review the license included with your archive and the [Wire Wheels Club license page](https://wirewheelsclub.com/license/) before publishing a build containing the protected payload.

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the camera rail or keys `1`–`5` for composed views.
- Press `Space` to toggle auto orbit, `L` for headlights, `I` for indicators,
  `B` for brake lights, `R` for reverse lights, and `F` for fullscreen.
- **Configure** changes paint, exposure, studio rotation, lights, and render quality.
- The camera icon saves the clean WebGL frame as a PNG.

See [ATTRIBUTION.md](./ATTRIBUTION.md) for the model and HDRI licenses.
