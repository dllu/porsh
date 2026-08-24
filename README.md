# Porsche 959 — realtime study

A high-quality, browser-based Three.js presentation of Wire Wheels Club's 1987 Porsche 959 model. It uses an HDR studio, custom PBR materials, transmission/clearcoat, soft dynamic shadows, GTAO, bloom, adaptive resolution, animated camera presets, paint configuration, lights, fullscreen, and lossless screenshot capture.

## Run locally

First download `006_porsche_959_wwc.zip` from [Wire Wheels Club](https://wirewheelsclub.com/models/1987-porsche-959/). The model is intentionally not distributed in this repository.

```bash
npm ci
npm run setup:model -- ~/Downloads/006_porsche_959_wwc.zip
npm run dev
```

Open the URL shown by Vite. Production output can be generated with `npm run build` and served with `npm run preview`.

The setup command keeps the plaintext FBX and its license under the Git-ignored `local-models/wwc/` directory. It then gzip-compresses the FBX, encrypts it with AES-256-GCM, and writes only a content-addressed `.p9e` payload beneath the Git-ignored `public/models/protected/` directory. The standard `unzip` command is required for initial setup.

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

At runtime, a Web Worker reconstructs the split key, authenticates and decrypts the payload, decompresses it, and gives the resulting bytes to Three.js without making a plaintext FBX request. The production bundle does not contain a `.fbx` file.

This is obfuscation, not DRM: because the browser must eventually receive the key and geometry, a determined user can still recover the model from memory or instrument the loader. Encryption does not grant publication rights or override the [Wire Wheels Club license](https://wirewheelsclub.com/license/). Obtain written permission before publishing any build containing the protected model payload.

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the camera rail or keys `1`–`5` for composed views.
- Press `Space` to toggle auto orbit, `L` for headlights, and `F` for fullscreen.
- **Configure** changes paint, exposure, studio rotation, lights, and render quality.
- The camera icon saves the clean WebGL frame as a PNG.

See [ATTRIBUTION.md](./ATTRIBUTION.md) for the model and HDRI licenses.
