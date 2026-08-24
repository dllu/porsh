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

The site is entirely static. The setup command extracts the FBX and its license into the Git-ignored `public/models/wwc/` directory. It requires the standard `unzip` command; alternatively, manually extract `FBX/87_porsche_959_WWC.fbx` there.

## Deploy to a static server

```bash
npm ci
npm run build
```

Upload the **contents of `dist/`** to the desired directory on the web server. Node.js is only needed during the build; the deployed site has no server-side runtime, database, environment variables, or external model requests. The build uses relative asset paths, so it works at either a domain root such as `https://example.com/` or a subdirectory such as `https://example.com/porsh/`.

Serve the files over HTTP(S), not directly from a `file://` URL. No single-page-app fallback rules are needed because the viewer has no client-side routes.

Important: `npm run build` copies the locally installed FBX into `dist/`. Wire Wheels Club permits use but restricts sharing and distribution of the model. Obtain any permission needed before publishing a build containing it; see [their license](https://wirewheelsclub.com/license/).

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the camera rail or keys `1`–`5` for composed views.
- Press `Space` to toggle auto orbit, `L` for headlights, and `F` for fullscreen.
- **Configure** changes paint, exposure, studio rotation, lights, and render quality.
- The camera icon saves the clean WebGL frame as a PNG.

See [ATTRIBUTION.md](./ATTRIBUTION.md) for the model and HDRI licenses.
