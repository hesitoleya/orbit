# v237 — single 3D Galaxy path, improved detail and corrected viewing geometry

## User-facing changes

The lower-left Gaia panel, measured-only/photo-only mode buttons and their independent rendering branches have been removed. Source-ID search, Shift-selection and mode APIs were removed with that panel. There is one combined photographic-to-three-dimensional journey. Actual Gaia measurements remain a layer inside it, not a selectable second product. Scientific attribution and the artistic/exposure disclosure are in the existing `?` help dialog, not another floating panel.

### Stars and dust

- Fixed stellar positions and perspective remain unchanged.
- Point-spread functions now have actual white cores and small halos, with 1.9..6.2 CSS-pixel footprints rather than mostly transparent small sprites.
- Approximately the brightest10% of the local illustrative sample receives1.8× flux, a3.5CSS-pixel minimum and a wider visible core. This is a selective display enhancement, not a claim that stars have metre-scale enlarged physical surfaces. It fades over3..5kpc to avoid enlarging the whole bulge.
- Display normalization no longer divides by DPR², fixing unnecessary dimming at high pixel density.
- Clouds now use seven overlapping samples of the same continuous warped three-dimensional fractal field, not three repeated flat bright images. Filaments, clumps and porosity replace blurry Gaussian blobs; intermediate blue/rose colors remain alongside warm brown attenuation.
- The 252,000 illustrative source samples and720clouds remain explicitly separate from the390,534actualGaia records.

### Galaxies and groups

- Replaced thin analytic neon-outline galaxies with32original256×256variants in a2048×1024atlas: broad asymmetric disks/arms, dark fractal dust,1100..3800stellar associations per variant and HII-style pink detail.
- Resolved shapes have intrinsic fixed orientations and depth. One centre slice owns the nucleus. Exposure was reduced after actual GPU inspection; atlas support is circular/zero at edges, with cross-tile mipmapping disabled to remove rectangular grazing artifacts.
- Added240fixed spatial groups with11,520illustrative member galaxies across~10^22..10^24m, plus members at47existing catalogue group/supercluster/wall centres. Low-quality prefixes preserve supplied anchors. Known voids are not filled.
- The47catalogue centres are retained in the corrected astronomical frame. Their generated memberships and structure are explicitly illustrative, not measured memberships.
- Warm/young-blue group color differences and small unresolved member signals keep distant groups visible as knots; individual galaxies are not enlarged to cluster size.
- Legacy dashed range rings and cropped rectangular group-photo billboards no longer stand in for physical groups. Object archive/photos remain available separately.

## Was the old Earth-to-Galaxy view real?

Not fully. Several geometric defects were found and fixed rather than retaining an attractive but incorrectly oriented route:

1. **Cinematic direction:** the high-altitude camera previously moved outward while looking outward (`pitch=+1.45`), leaving the Galaxy behind it. It now retreats while looking back (`pitch=-1.45` far from Earth), preserving the captured view basis instead of automatically flipping to an external hero pose.
2. **Ecliptic versus equatorial:** the internal solar scene uses an ecliptic XZ plane but previously treated it as ICRS. Added a proper23.4392911°obliquity rotation at the sky/camera boundaries. Gaia remains ICRS→proper-G without double rotation.
3. **Earth spin:** replaced rotation about an inclined axis without static tilt with static axial tilt×localYspin. Geographic north no longer wobbles during the day.
4. **Old catalogue reflection:** migrated `galWorld` to the same proper-G rotation as camera/Gaia. M31,LMC,M33 and binary RA/Dec loaders now align with the same sky; no second binary flip is applied. Corrected Harris globular nativeYsign at build,label,focus and CMBdipole sign.
5. **Named disk orientation:** use each source's sky-tangent north/east, astronomical PA and inclination rather than a global mirrored Euler. Full near-side/rotation information is not in the catalogue, so the unknown sign remains a deterministic convention.

Geometry checks give Galactic/ecliptic-plane inclination60.188561°, positive determinant, inverse round-trips and stable camera basis. All144Harris records cross-check against their rounded RA-hours/Dec/distance columns.

### Remaining reality boundaries

This is **astronomically oriented illustrative visualization**, not an exact camera recording or ephemeris simulator. No available external photograph of the entire Milky Way can verify this journey frame-for-frame. The original photo is angular, Gaia distances are selected inverse-parallax estimates atJ2016; most stars/dust/full structure and group memberships are generated. Calendar orbital phases, Sun height, spiral phase and motion propagation remain approximate. Automatic Sun→Galactic-centre targeting creates a small curved presentation path, not a unique physically prescribed straight route. The exact exterior appearance depends on departure direction; there is no single universal 'Earth zoom-out view'. Exposure and source visibility are deliberately enhanced to satisfy the user's clearer/brighter request, rather than pretending to be naked-eye brightness.

## Verification

Passed source/Three.jsCPU/VM contracts:

- `tools/test-v237-view-geometry.cjs`: proper ecliptic/ICRS/G frame, inverses, Earth pole, camera lookback, named-source positions/PA/inclination,144Harris cross-checks.
- Existing galaxy bridge, cinematic handoff, sky panorama, solar background, navigation tests.
- `tools/test-cosmic-population.cjs`: atlas support/detail/colors, fixed spatial groups and supplied anchors, empty-void rejection, quality, reversal/disposal.
- `tools/test-milkyway-fill.cjs`: bright local fraction/PSF/DPR and non-global boost, continuous cloud depth, fixed positions/lifecycle.
- Gaia parser/rawCSV/binary/manifest and offline package tests, including exact current app source and absent retired panel/mode APIs.

Actual browser HTTP and file:// GPU checks:

- All390,534Gaia sources retained, retired panel/APIs absent,47catalogue anchors supplied,287total groups.
- No shader program failures, GLerror0 at selected scales1e19..1e24m.
- Repeated forward/back scales keep view basis component drift<=6.36e-16.
- Low-quality1258×662/1069×562 snapshot+PNG times~5..21ms at checked scales, not a steady-state FPS guarantee or a promise for high-quality/allhardware.
- Added procedural layers cost five draws total: two Galactic and three galaxy/group layers.

Actual evidence:

- `docs/v237-stars-dust-final.png`
- `docs/v237-galaxies-packaged.png` (final rebuilt package; legacy group billboards disabled)
- `docs/v237-distant-groups-final.png`
- `docs/v237-cinematic-lookback-updated.png`

The cinematic seek screenshot is taken after scene update; the direct seek helper changes pose/radius before the next render-loop update, so a same-call snapshot without an update can be stale. This is a diagnostic-helper timing distinction, not an alternate production route.

## Build and licenses

Regenerate with `node build.mjs --replace-existing`; all three root entries updated. Service worker version isv237. GaiaESA/DPAC remainsCCBY-NC3.0IGO(noncommercial); nativephotoESO/S.BrunierCCBY4.0. New atlas/cloud detail is original procedural content. No extra lower-left controls are added.
