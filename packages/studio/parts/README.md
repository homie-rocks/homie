# Toolkit parts catalogue

These are reusable files, not new npm packages or complete apps. The catalogue entries
are the standard `part.json` records, also collected in `catalogue.json` for local browsing.

| Part | What it supplies | Source | Licence |
| --- | --- | --- | --- |
| [Owner action checklist](owner-action-checklist/README.md) | Consequence-first owner/staff action UI, server integration boundary, optional undo | Owner action checklist / Homie toolkit | Apache-2.0 |
| [Terrain route map](terrain-route-map/README.md) | Local heightmap coast, draped route, markers and phone/TV camera controls | Terrain route map / Homie toolkit | Apache-2.0 (three.js MIT) |
| [Venue desk](venue-desk/README.md) | Venue info, booking contact and confirmation, waitlist and owner outbox as studio tools, schema.org outputs | Venue desk / Homie toolkit | Apache-2.0 |

Each folder includes its licence, attribution, AI integration contract, tunables and small
working preview. Ryan Campbell authored both. To preview locally, serve this directory with
a static HTTP server, then open `<id>/preview/index.html`.

These public source parts are explicitly shared in their manifests. This checkout is not
a deployed studio and does not invent a catalogue host or claim a live directory listing.
To distribute from a studio, retain the original provenance/credit, place these original
source folders under that studio's `parts/`, run the existing `parts share` checks/packing,
and deploy. The standard well-known catalogue then advertises exact immutable releases;
consuming studios use `parts_find` / `part_add`, never copy another studio's release by hand.
Follow [PARTS.md](PARTS.md) for hashes, licence checks, packing and delivery. Do not serve
unpacked source as an immutable release. Later changes to a shared release need a new part
version. These initial parts are 1.0.0; no toolkit version is changed.

Maintainers: `node scripts/build-shared-parts.mjs` builds the local map preview and rewrites
hashes with `writeHashes`. `node --test packages/studio/test/shared-parts.test.mjs` checks
logic, licences and real pack/catalogue/integrity paths. Run
`node scripts/check-shared-parts.mjs` for one short browser check and 4× CPU measurements.
