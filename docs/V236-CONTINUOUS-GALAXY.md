# v236 — continuous artistic Milky Way and colorful galaxy fly-through

## User-directed change

Combined mode now deliberately fills missing stars, nebulae and dust with labelled procedural illustration. It is not claimed to be an observed full-Galaxy scan. The original Gaia catalogue remains unchanged and accessible in measured-only mode.

## Spatial continuity

- Native 6K photographic panorama remains unblurred. As it fades over actual heliocentric displacement, fixed local/disk stellar fill grows as `(1-photo)^0.65`.
- Added 252,000 deterministic illustrative sources: 72,000 solar-neighbourhood sources and 180,000 thin/thick disk, four-arm and bulge sources. These are draw samples, not a claim of modelling each physical Galactic star.
- Added 720 illustrative nebula/dust clouds, three intrinsically oriented depth slices each. Pink/blue emission and brown extinction are original procedural shapes.
- Analytic Galactic emission/extinction volume starts overlapping at log radius18..19.1. Interior volume opacity is low (.045), rising toward .72 outside log20.25..20.95, avoiding a blown-out fog screen.
- Stellar and cloud positions stay fixed in proper-G heliocentric parsecs. Camera translation is subtracted before render-unit scaling. Zoom does not respawn/wrap objects or change the view's residual rotation.
- Existing stellar fly-past therefore remains true observer translation through the same field. Continuing backward reveals the external three-dimensional Galactic disk.

## Galaxies toward the group scale

- Added 1,152 fixed illustrative galaxies across heliocentric10^21..10^24m, including fixed clustered neighbourhoods. Real named catalogue objects remain separate.
- Seven original shapes: spiral, barred, elliptical, irregular, ring, edge-on, flocculent; blue/cyan/purple arms, warm gold nuclei and pink HII-style detail.
- Five fixed-oriented geometric depth slices each, 5,760 instanced quads in one draw. These are geometric illustrative depth samples, not observed tomographic reconstruction.
- Centre slice alone owns the sharp nucleus to remove duplicated five-core appearance; outer slices taper radially and vertically. Pixel-aware arm width/detail suppression reduces unresolved flicker.
- Galaxies are not enlarged stellar dots and do not face the camera. Position and orientation do not depend on elapsed time. Apparent passage comes from the retreating physical camera.
- The recognisable fly-through range is roughly10^21..3×10^22m. At much larger distances galaxies naturally shrink to points; they are not forced to retain a false minimum apparent diameter.

## Modes and attribution

The panel offers **摄影 → 立体银河**, **仅实测三维**, **仅原片参照**. Combined mode labels procedural fill; measured-only hides invented layers. No invented Gaia IDs or invented data records are created. Shift-click/source-ID lookup remains for real Gaia sources only.

Gaia retains ESA/Gaia/DPAC credit and CC BY-NC3.0IGO restrictions. Native photograph remains ESO/S.Brunier, CC BY4.0. Procedural illustration is original code with no new external imagery.

## Validation

Passed:

- `tools/test-milkyway-fill.cjs`: deterministic populations, physical coordinates, observer translation/reversal, quality and resource lifecycle.
- `tools/test-cosmic-population.cjs`: morphology diversity, single nuclei, fixed orientations, geometric depth, anti-alias detail, quality, lifecycle.
- `tools/test-v236-continuity.cjs`: no18.5..20.5 handoff gap, one update per frame with current pixel scale, truth-mode isolation, physical camera reversibility.
- Existing Gaia, camera bridge, cinematic journey and actual binary/offline package contracts.

Actual browser checks used HTTP source and file:// generated offline build. New shaders compiled, no unrunnable programs, GL error0; all390,534 Gaia records retained. Offline external Gaia requests0. Fixed-ray zoom1e19→1e22→1e19 component drift3.33e-16.

Actual GPU evidence:

- `docs/v236-galactic-interior-final.png`: photo fully absent at1e19m, new fixed stars/clouds and low-opacity Galactic volume remain visible.
- `docs/v236-galaxy-exit.png`: original fixed view retreats beyond the Galactic body, showing the Galaxy and nearby illustrative galaxies.
- `docs/v236-galaxy-group-final.png`: refined multi-colour galaxies at3e21m.

Snapshot/export timings at low quality1258×661 or1069×561 were about10–37ms/frame across selected scales, including rendering plus PNG export. This is not a steady-state FPS benchmark or a guarantee for all hardware/high quality. Added population costs three draws total (two Galactic fill, one galaxy instancing), not one mesh per galaxy.

## Build

`node build.mjs --replace-existing` updates the three root release entries. Both new modules are inlined for offline operation and included in the service-worker core. Existing server port8194 remains the preview endpoint; no replacement server was started.
