# v235 — native photographic reference + Gaia DR3 measured sources

## What changed

- Removed the v234 photo-depth emissivity module and blurred constraints from all active entry points and generated builds. Historical sources are retained only as unused history.
- The original ESO/S. Brunier 6000×3000 JPEG is unchanged byte-for-byte. No low-pass/diffuse swap, image mirroring, finite photo shell or generated stellar depth.
- Added 390,534 actual Gaia DR3 sources selected by G≤10, positive parallax, published parallax_over_error≥10, RUWE<1.4 and non-null BP−RP. This is a bright/high-quality **subset**, not all Gaia or the entire Milky Way.
- Precise uint64 source IDs are decoded as decimal strings, never JS Number. RA/Dec are float64; published scalar measurements packed float32, with exact original CSV archived.
- Three-dimensional heliocentric positions come from inverse parallax only for this high-S/N subset. Approximate random errors are retained, without pretending these are exact distances.
- Camera and new measured stars share an orthonormal proper-rotation frame. No negative projection/texture flip. Scale-dependent quaternion SLERP removed from both directions.
- Wheel, pinch, inertia and cinematic journey share the early bridge. Main animation rechecks scene ownership after inertia to prevent one-frame stale scenes.

## Controls

At cosmic scales the lower-left **Gaia DR3 · 实测恒星子集** panel offers:

1. **摄影 → 实测** — native angular photo reference gradually yields to measured stars by actual heliocentric displacement (about 1–100 pc); this is an honest reference transition, NOT proof that every photo pixel has depth.
2. **仅实测三维** — only Gaia source points are rendered; unrelated external galaxies, black-hole symbols and artistic structures are isolated away.
3. **仅原片参照** — original angular photo alone, no fake parallax/depth. It remains a directional reference even far away; it is not a physically valid displaced sky.

Shift-click a rendered Gaia point to inspect it, or enter an exact Gaia `source_id` and choose **查测量**. The card reports RA/Dec, published parallax±error, inverse-parallax distance±linear propagated random error, G, BP−RP and RUWE.

Display exposure is ×6 for legibility, explicitly labelled; BP−RP-to-RGB is a display approximation. These are not calibrated naked-eye/spectral colors.

## Dataset and scientific limits

- Epoch J2016.0, ICRS angular astrometry. No current-epoch proper-motion propagation.
- Distance `1000/parallax_mas` pc. Error `1000*parallax_error/parallax²` pc is random linear propagation only.
- No parallax zero-point, Bayesian distance, extinction or photometric-band correction.
- Selected distances about 1.302–8335.8 pc; median ~488 pc. Strong selection effects: missing/faint/poor-quality sources are absent, not filled with invented stars.
- No false cross-identification of photographic bright spots and Gaia source IDs.
- Dust, nebulae and faint unresolved populations do not become measured 3D objects in this release. Therefore the Gaia-only view is sparser than the original long-exposure photograph, and the externally viewed bright-source subset is not a reconstructed complete galaxy.
- Legacy extragalactic catalogue uses an older reflected coordinate convention; it is not used as the new Gaia/photo astrometric frame. Pure Gaia/photo modes hide those unrelated layers. No claim of global legacy-catalogue astrometric migration.

## Provenance and licence

Data: ESA/Gaia/DPAC via Heidelberg ARI TAP, `gaiadr3.gaia_source`.

- Official data licence: https://www.cosmos.esa.int/web/gaia-users/license
- Gaia **CC BY-NC 3.0 IGO**, non-commercial restriction. Commercial use must follow ESA archive terms, not assume unrestricted commercial redistribution: https://www.cosmos.esa.int/web/esdc/terms-and-conditions
- Full data credit, query, source hashes, raw CSV and limitations: `public/data/gaia/PROVENANCE.md` and `manifest.json`.
- Source binary SHA-256: `76691d3bd0b5c446a9d4ba575c816c88c28a92c396f410224bc91c8342bc37e7`.
- ESO photograph remains separately credited ESO/S. Brunier, CC BY4.0.

## Validation performed

### Data and package

`tools/test-gaia-stars.cjs`, `test-gaia-built.cjs`, `test-galaxy-bridge.cjs`, `test-gaia-bridge-cine.cjs`, prior native-photo/background/navigation suites pass.

All 390,534 raw CSV records match packed IDs/RA/Dec/scalars; manifest counts/hash match; offline decoded binary equals source bytes; offline `space.html` and `index.html` identical; native JPEG bytes unchanged. HTTP pack uses relative Gaia/photo resources and excludes obsolete blur/depth module.

### Actual browser / GPU

- HTTP source preview loaded and parsed all 390,534 records, geometry attribute count 390,534, source lookup returned actual published values.
- Actual file:// offline build loaded inline Gaia data (24,994,220 base64 characters), no external Gaia resource requests, all records parsed and rendered.
- GPU error=0 in both paths; actual PNG captured from renderer.
- Paused simulation zoom sequence 2e16→1e18→1e19→2e16 preserved forward/right/up in equatorial frame with max component drift ~2.34e-13; no automatic roll or flip.
- Reverse handoff preserved frame after animation (~1.06e-11 component drift); same-call diagnostic initially read stale main camera until next animation. Added immediate `placeCamera()` to reverse handoff to eliminate that diagnostic/stale-camera gap, covered by CPU tests and rebuilt.
- Pure measured offline frame: `docs/gaia-v235-offline-measured.png`. This is actual measured-source rendering, not a promotional image or proof of complete photographic 3D reconstruction.

## Build

`node build.mjs --replace-existing` regenerates root `space.html`, `index.html`, `space-http.html`. Offline file about 146.5 MB, includes real 18.75 MB catalogue; HTTP artifact keeps data external. Existing preview server port8194 remains unchanged.
