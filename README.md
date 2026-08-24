# Porsche 959 — realtime study

A high-quality, browser-based Three.js presentation of Yakpower's Porsche 959 model. It uses an HDR studio, PBR materials, transmission/clearcoat, soft dynamic shadows, GTAO, bloom, adaptive resolution, animated camera presets, paint configuration, lights, fullscreen, and lossless screenshot capture.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown by Vite. Production output can be generated with `npm run build` and served with `npm run preview`.

The site is entirely static. After dependencies are installed, the model and lighting environment are served locally and no Sketchfab login is needed.

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the camera rail or keys `1`–`5` for composed views.
- Press `Space` to toggle auto orbit, `L` for headlights, and `F` for fullscreen.
- **Configure** changes paint, exposure, studio rotation, lights, and render quality.
- The camera icon saves the clean WebGL frame as a PNG.

See [ATTRIBUTION.md](./ATTRIBUTION.md) for the model and HDRI licenses.
