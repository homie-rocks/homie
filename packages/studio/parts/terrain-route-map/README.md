# Terrain route map

An offline-capable three.js coastal heightfield with a draped route tube, markers,
text labels, touch orbit/pinch and keyboard/TV camera buttons. No tile service is needed.

## For the AI integrating this part

Import `mountTerrainMap` from `@parts/terrain-route-map` and include `src/style.css`.
Give its root an explicit height (minimum 360 px). Await `mountTerrainMap(root,data,options)`;
catch load/WebGL failures in your app. Call `dispose()` on navigation to release GPU resources,
observers and listeners. It returns `command('left'|'right'|'up'|'down'|'in'|'out'|'reset')`,
`camera`, `renderer`, and `render()` (invalidate after your own camera change).

`data` is JSON, illustrated by `preview/route.json`:

- `bounds: [minX,minZ,maxX,maxZ]`: finite local planar coordinates, in metres.
- `heightmap`: same-origin PNG URL, maximum 2048×2048; 128×128 or larger is suitable; the default mesh has 192 segments.
  Red channel 0…255 maps linearly to 0…`height` metres. Row zero is **minZ**, column zero
  is **minX**. No georeferencing, colour-profile elevation interpretation or alpha mask.
- `height`: positive elevation range; `seaLevel`: water elevation, at least zero, below height.
- `route: {type:'LineString',coordinates:[[x,z],…]}`: 2…2048 points inside bounds,
  with no consecutive duplicates. This is GeoJSON-like **local coordinates, not longitude/latitude**.
- `markers: [{coordinates:[x,z],label:'Lookout'}]`: at most 32 text labels, 80 characters each.

Route segments are densified and lifted above terrain/water. Keep data within the documented
budget; excessive total length is refused. The route is a visual guide, not collision or
navigation geometry. Labels project to screen space with leader lines and greedy collision avoidance. Overflow
labels are hidden visually but all markers remain in the accessible list. Curate marker density.
An optional adapter can convert your own geographic data into this format before mounting;
it must project longitude/latitude, handle attribution and provide its own heightmap.

Options: `segments` integer 8…256 (default 192), `pixelRatio` .5…2 (default cap 1.5),
`quality: 'auto'|'full'|'lite'` (default auto). Smooth vertex normals, sun/hemisphere lighting,
baked cavity shading, sky and distance haze need no shadow or postprocessing passes.
Water samples the heightmap for depth colour and animated foam. Instanced highlights flow
along the elevation-aware tube. A gentle 2.2-second camera introduction stops on interaction.
Respect reduced motion: no intro, water/flow animation or recurring frames in that mode.
Rendering pauses offscreen or in hidden documents.

Auto quality measures animation frame intervals after the first two seconds. After 90 samples,
if over 25% exceed 28 ms, it switches once to lite: pixel ratio capped at 1, every second
terrain grid cell drawn (even segment counts), subdued water highlights. Hidden gaps above
250 ms are excluded. `map.quality` exposes the selected mode. This measures combined browser
frame delivery, not device identity; explicitly choose lite for known low-end devices.
Lite keeps the shoreline, labels and route. No external tile or other network service is used. Touch drag rotates, pinch zooms; arrows rotate, +/- zoom and Home
resets while the canvas is focused. Camera buttons work with Tab/Enter or TV focus navigation.
For TV remote bridges call `command`; this part does not claim a hardware remote protocol.

`preview/index.html` is self-contained with its local `demo.js` bundle, PNG and JSON.
Regenerate through `node scripts/build-shared-parts.mjs`; the bundle includes three.js's
MIT notice. The source continues to import the toolkit's pinned three.js stack through npm.

## Built from / rights

Original reusable map from **Terrain route map**, Homie toolkit; Ryan Campbell.
Original analytic heightmap and route, no survey data, imagery or third-party parts.
three.js 0.185.1 (MIT), OrbitControls (MIT). Part source/data Apache-2.0; preserve LICENSE,
NOTICE, THIRD-PARTY-LICENSE and attribution. See `proof/parts-161/README.md` in the
repository for measured device-emulation costs and limitations.

### Heightmap security

Heightmaps must be PNG files, 2–2048 pixels per axis, served as `image/png`, at most
16 MiB compressed. The loader validates the PNG header before decoding. URLs must use
HTTP(S), have a `.png` pathname, and be same-origin; explicitly trusted CDN origins can
be passed in `mountTerrainMap` options as `allowedOrigins`. Credentials in URLs and
redirects are rejected. Keep this allowlist in application code, not imported map data.
