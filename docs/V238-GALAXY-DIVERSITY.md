# v238 — galaxy diversity and deep-range continuity

## Defects found

1. `aArmColor` and `aCoreColor` were uploaded as instance attributes but were not consumed by the resolved-galaxy fragment shader. Most objects therefore reused the same atlas blue arms and warm-white cores irrespective of their intended colour records.
2. Fixed groups ended near1.66e24m, while the application also multiplied all procedural galaxy light by `1-smoothstep(logR,24.25,25.15)`. At much larger radii this erased the entire population even if a member happened to be visible.
3. Prefix quality reduction favoured earlier groups, reducing the far-range distribution instead of sampling every spatial level.

## Changes

The application now keeps the galaxy layer enabled throughout the observable-volume interior. Only the existing physical interior/exterior transition owns its final fade. This does not place galaxies beyond the represented observable volume or force a resolved spiral image to remain large on screen at cosmological distance.

Individual appearance now uses actually connected arm/core/HII colours, with icy-blue, dust-rose, teal-blue, lavender, amber, coral, silver and violet-blue palette families plus independent seeded channel variation. Uploaded colours no longer sit unused. Disk brightness is separated from the old baked blue hue before recolouring, so warm/rose choices are not suppressed by multiplying against a blue texture.

There are eleven morphology families, including lenticular, dwarf, merger and tidal structures in addition to the previous seven. Sixty-four atlas variants combine with per-instance shape stretching, radial twist, asymmetric displacement, dust contrast, lopsided light and independent detail levels. Randomness is seeded and fixed in space: revisiting a galaxy does not regenerate its shape or move it.

Fixed spatial groups now span 24 radial levels through approximately3×10^26m. Members are rank-interleaved over all groups so low quality samples every radial level and sky direction instead of deleting the remote half. Individual galaxy physical sizes remain bounded; remote structures use small unresolved member signals. Catalogue-centred illustrative memberships and empty-void rejection remain intact.

## Verification and release

- Actual HTTP GPU image: `docs/v238-diversity-r1.png`, showing independent rose/lavender/teal/amber/silver/blue objects, mergers and elongated/tidal structures rather than the former two-tone repeated spirals.
- Actual final offline package: `docs/v238-far-ranges-final.png`, three physical scales1e24,1e25,1e26m. All retain12,648active low-quality members, gain1.8, GLerror0; repeated scale traversal has view-basis drift0. The background CMB and pre-existing diagram/flow curves remain separate legacy layers, not member galaxies or evidence of resolved distant shapes.
- Loaded64atlas variants,527totalgroups(480generated+47catalogueanchors), no failed shader programs. Fixed outer anchors reach3.01995e26m.
- Unresolved member footprint minimum2.25CSSpx, maximum3.5CSSpx; small representational signals, not inflated physical galaxy disks. Far groups have extended relative angular separations instead of all stacking at the centre.
- Passed diverse module syntax/Three.js contracts: real shader colour/morph wiring, all11families/8palette families, deterministic samples,24radiallevels/allgroup quality coverage, four view axes at1e22..1e26m, dimensions/provenance/lifecycle.
- Passed physical geometry, main/cosmic bridge, cinematic handoff, native panorama, Gaia data, solar-background, navigation and continuity regressions. Build regenerated all root entries and packaged-source/data checks passed. Offline143140KB,HTTP25376KB.
- An additional old `tools/test-cosmic-depth.cjs` test was run and failed at its pre-existing v237-incompatible exact string `CS.mainGalaxy.visible=mainMwHaloVisible;` (current code also gates BODY). It was not represented as a pass or weakened to hide the mismatch; the current continuity/geometry/module tests cover this change.

Service worker versionv238. Atlas original generated content; Gaia/photo licenses unchanged.

## Reality boundary

All added generated shapes, colours and memberships remain illustrative. Known group centres remain separate catalogue anchors. Changes affect diversity and visible representation, not invented claims of measured galaxy imagery or exact cosmic reconstruction. Individual source diameters remain physical; distant unresolved groups are represented by small member signals rather than giant resized galaxy pictures.
