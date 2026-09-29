/**
 * ============================================================================
 *  VarianceSpecAA.ts — Kaplanyan normal-variance filtering on the FINAL
 *  shading normal, for a material this library did not build.
 * ============================================================================
 *
 *  READ THIS BEFORE YOU MERGE IT WITH ./SpecularAA.ts. The two are NOT one
 *  thing and the collision is the reason this file is named the way it is:
 *
 *    · `SpecularAA.addSpecularAA` folds `dot(dNdx,dNdx) + dot(dNdy,dNdy)` into
 *      α² at `<normal_fragment_maps>` — an anchor that only exists when the
 *      material carries a tangent-space normal map.
 *    · this one takes `max(|dNdx|,|dNdy|)` componentwise, at
 *      `<lights_physical_fragment>` — an anchor that is ALWAYS there, because
 *      half the point is to reach the thin geometry that has no normal map at
 *      all. A 42 mm handrail tube at 80 m is the case, and it has no map.
 *
 *  Different estimator, different anchor, different uniform, different key. A
 *  shared `addSpecularAA()` would compile, pass everything, and quietly give
 *  one game the other's filtering — `solveTyre`/`solveAxle`, again. So they are
 *  two exported names, and the space racer carried BOTH under one identifier
 *  until this move: its liveries module imported the package's, its props
 *  module imported this one, and the only thing separating them was which
 *  module the import line named.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * Materials that already carry variance-filtered roughness, so the standalone
 * injection below never doubles up on one.
 *
 * `injectBreakup` installs `SPEC_AA_GEO` by REPLACING `<normal_fragment_maps>`,
 * which means a later `.replace` aimed at that same anchor finds nothing and
 * quietly does nothing — the exact silent-no-op class of bug this codebase has
 * paid for twice. A set is cheaper to reason about than an ordering argument.
 */
const _specFiltered = new WeakSet<THREE.Material>();

/**
 * Kaplanyan normal-variance filtering, for a material this library did not build.
 *
 * ===========================================================================
 *  THE ART DIRECTION NAMES THIS ONE: "aliasing crawl on thin geometry
 *  (handrails, truss diagonals)", an automatic penalty.
 * ===========================================================================
 *  Every generator in this file gets the term through `injectBreakup`'s
 *  `specAA`. The problem is that most of the thin geometry in the frame is not
 *  built by this file: the props module's `railSteel` / `railSteelInst` carry
 *  the 42 mm handrail tube, the 1.80 m stanchions and every gantry
 *  catwalk rail, and they are assembled from that module's own `TexLib` with
 *  no filtering of any kind. A 42 mm tube at 80 m is a third of a pixel wide,
 *  its shading normal sweeps most of a hemisphere inside that pixel, and a
 *  0.66-roughness lobe standing on it is a sub-pixel mirror pointed at a 5.6
 *  key. That is the saturated 2–6 px white ribbon with the bloom halo, and
 *  the grid capture proves it is not motion blur, because its report records
 *  speed 0 on that frame.
 *
 *  Three's own `geometryRoughness` in `<lights_physical_fragment>` does this
 *  for the GEOMETRIC normal and is why a bare cylinder does not strobe. It
 *  deliberately excludes the mapped normal, so a normal-mapped cylinder does.
 *  This measures the final shading normal — mapped included — and folds it
 *  into α² the same way, so the two compose instead of fighting.
 *
 *  Anchored ahead of `<lights_physical_fragment>` rather than on
 *  `<normal_fragment_maps>`: the latter is only present when the material has
 *  a tangent-space normal map, and half the point is to reach the ones that do
 *  not. `roughnessFactor` and `normal` are both live and unconsumed there.
 *
 *  Costs two derivatives and a sqrt on materials that ask for it. It is a
 *  no-op on anything resolved — a flat deck plate measures zero swing across a
 *  pixel and keeps exactly the roughness it was authored with.
 */
export function addVarianceSpecAA(mat: THREE.Material, strength = 1.0): void {
  if (_specFiltered.has(mat)) return;
  _specFiltered.add(mat);
  const u = { value: strength };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uGeoSpecAA = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGeoSpecAA;\n')
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        {
          // α'² = α² + 2σ². Quadratic on purpose: at σ = 0.1 (a resolved 0.9 m
          // chord at 30 m) this is +0.05 of roughness and the chamfer specular
          // survives; at σ = 2 (a 42 mm tube at 80 m) α saturates, the lobe
          // becomes the cylinder's own average, and the member converges to a
          // value instead of a mirror hit.
          vec3 kGNd = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
          float kGSig = max( max( kGNd.x, kGNd.y ), kGNd.z ) * uGeoSpecAA;
          roughnessFactor = sqrt( min( 1.0,
            roughnessFactor * roughnessFactor + 2.0 * kGSig * kGSig ) );
        }
        #include <lights_physical_fragment>`,
      );
  };
  const key = `geoaa${strength}`;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * ===========================================================================
 *  THE IDEMPOTENCE REGISTER, EXPORTED BY IDENTITY. Same contract as
 *  `geoWearClaim` in ./GeoWear.ts, and read that note — it is the long form.
 * ===========================================================================
 * Two callers need this set and neither of them is `addVarianceSpecAA`:
 *
 *   · A LIBRARY THAT CLONES MATERIALS. `MatLibShape.claims` in ./MaterialLib.ts
 *     compares by IDENTITY, so a second, equivalent WeakSet leaves every
 *     variant clone re-entering the filter its original already carries.
 *   · A CALLER THAT CLAIMS AHEAD OF THE COMPILE. The space racer's
 *   `injectBreakup`
 *     adds the material the moment it sees `specAA`, because the deck sweep in
 *     `Materials.update` runs long before any of those shaders is built and a
 *     set populated only at compile time would let it install a second,
 *     competing filter on a surface that already has one.
 *
 * That second caller is why this is a mutable set and not a query.
 */
export { _specFiltered as varianceSpecAAClaim };

/* ==========================================================================
 *  THE SAME FILTER, INSTALLED ONCE INTO three's OWN CHUNK, FOR A GAME WHOSE
 *  MATERIALS ARE BUILT IN FIVE DIFFERENT MODULES.
 * ==========================================================================
 *
 *  WHY A SECOND ENTRY POINT AND NOT A SECOND FILE. `addVarianceSpecAA` above
 *  is per material: the caller has the material in its hand and injects into
 *  its `onBeforeCompile`. That is the right shape when a library builds the
 *  material. It is the WRONG shape when the game does not — the space racer
 *  builds MeshStandardMaterials in five modules, several of which already
 *  chain an `onBeforeCompile`, and its own note is the argument:
 *
 *    "a fix that has to be remembered at every construction site is a fix that
 *    will be missing from the sixth."
 *
 *  So this one patches `THREE.ShaderChunk.lights_physical_fragment` once, at
 *  import, and every physical material in the process gets the term whoever
 *  built it. three resolves the chunk AFTER every `onBeforeCompile` has run,
 *  so it composes with all of them.
 *
 *  IT IS THE GAME'S VERSION, PROMOTED, NOT A REWRITE. This shipped as
 *  `installSpecularAA()` inside the space racer's renderer —
 *  a 1,796-line file that was otherwise a fork of `pipeline.ts`. Two things
 *  in it are strictly better than what this package had and every consumer
 *  now gains them:
 *
 *    1. THE CEILING IS A DISTANCE RAMP, not a constant. `addVarianceSpecAA`'s
 *       kernel is unbounded above by anything but the `min(1.0, …)`; the
 *       game's own finding is that the near-field threshold held out to
 *       the horizon "reprinted the truss as white chips", because the pixel
 *       footprint a prefiltered NDF has to cover grows with distance.
 *    2. THE DEPTH TERM IS ONLY THE FLOOR OF THE CEILING. A 42 mm tube is
 *       sub-pixel from 42 m out — the BOTTOM of the ramp — so the frames the
 *       aliasing storm is worst in are the ones depth cannot reach. The second
 *       ramp asks the fragment whether its normal is RESOLVED instead of how
 *       far away it is.
 *
 *  EVERY NUMBER IS REQUIRED AND NONE HAS A DEFAULT. They are fitted against
 *  one game's geometry and one game's key, and a default would hand the next
 *  consumer the space racer's art direction under the name of a correctness fix
 *  — which is precisely the failure that looks completely fine.
 */

/** Set once the chunk has been patched, so a second import cannot double-patch. */
let _chunkPatched = false;

/**
 * The six numbers. Every one is a measurement, not a preference; the deriving
 * game keeps its derivation beside the call.
 */
export interface ChunkVarianceSpecAA {
  /** Scale on `dot(dNdx,dNdx) + dot(dNdy,dNdy)` before it becomes a kernel. */
  readonly sigma2: number;
  /** NEAR-field ceiling on the roughness-squared the filter may add. */
  readonly kappa: number;
  /** FAR-field ceiling, reached at `farM` and by a fully unresolved normal. */
  readonly kappaFar: number;
  /** Metres at which the depth ramp starts leaving `kappa`. */
  readonly nearM: number;
  /** Metres at which the depth ramp has fully reached `kappaFar`. */
  readonly farM: number;
  /**
   * Kernel value at which a normal counts as completely unresolved, so the
   * ceiling is raised to `kappaFar` regardless of distance. Must be > `kappa`
   * or the second ramp divides by zero or worse, inverts.
   */
  readonly varUnresolved: number;
}

export function installChunkVarianceSpecAA(t: ChunkVarianceSpecAA): void {
  if (_chunkPatched) return;
  for (const [name, v] of [
    ['sigma2', t.sigma2], ['kappa', t.kappa], ['kappaFar', t.kappaFar],
    ['nearM', t.nearM], ['farM', t.farM], ['varUnresolved', t.varUnresolved],
  ] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(
        `@homie-rocks/render: ChunkVarianceSpecAA.${name} must be a finite number, got ${String(v)}. `
          + 'This is a fitted measurement and this package will not default one.');
    }
  }
  if (t.varUnresolved <= t.kappa) {
    throw new RangeError(
      `@homie-rocks/render: ChunkVarianceSpecAA.varUnresolved (${t.varUnresolved}) must be greater `
        + `than kappa (${t.kappa}). The overshoot ramp divides by their difference.`);
  }

  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const src = chunks.lights_physical_fragment;
  const varianceAnchor = 'float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );';
  const roughnessAnchor = 'material.roughness = min( material.roughness, 1.0 );';
  // `vViewPosition` is the depth the ramp is keyed on and it is the ONE symbol
  // the patch borrows from outside its own two anchors. meshphysical's fragment
  // stage declares it unconditionally today; a future three that moves it
  // behind an ifdef would turn this into a link failure at first use, which is
  // the "screen flashes black" class of bug, so it is checked here where the
  // answer is a console line instead.
  const physicalFrag = (THREE.ShaderLib as { physical?: { fragmentShader?: string } })
    ?.physical?.fragmentShader;
  const hasViewPosition = typeof physicalFrag === 'string'
    && /varying\s+vec3\s+vViewPosition\s*;/.test(physicalFrag);
  if (typeof src !== 'string'
    || !src.includes(varianceAnchor) || !src.includes(roughnessAnchor)
    || !hasViewPosition) {
    // GUARDED RATHER THAN ASSUMED, and it says so out loud. A future three that
    // renames the anchors leaves the chunk untouched — a look regression a
    // reviewer can read in the console, not a shader that fails to compile.
    console.warn('[render] lights_physical_fragment does not look like three r185; '
      + 'chunk-level variance specular antialiasing not installed. Thin bright geometry '
      + 'will sparkle.');
    _chunkPatched = true;
    return;
  }

  // `normal` is the SHADING normal and is final by this point: the physical
  // fragment shader runs normal_fragment_begin and normal_fragment_maps
  // immediately before this chunk, so the normal map has already been applied.
  // That is the whole difference between this and three's own term, which reads
  // `nonPerturbedNormal` and therefore cannot see a normal map at all.
  const patched = src
    .replace(varianceAnchor, varianceAnchor + `
	// --- @homie-rocks/render: normal-variance specular antialiasing ----------------
	vec3 unSpecDx = dFdx( normal );
	vec3 unSpecDy = dFdy( normal );
	float unNormalVariance = ${t.sigma2.toFixed(4)} * ( dot( unSpecDx, unSpecDx ) + dot( unSpecDy, unSpecDy ) );
	// The ceiling is a depth ramp, not a constant: the pixel footprint a
	// prefiltered NDF has to cover grows with distance, and holding the
	// near-field threshold out to the horizon is what reprints thin structure
	// as white chips. vViewPosition is - mvPosition.xyz, declared
	// unconditionally by meshphysical's fragment stage, so its length is the
	// fragment's view distance in metres.
	float unSpecDepth = length( vViewPosition );
	float unSpecKappa = mix( ${t.kappa.toFixed(4)}, ${t.kappaFar.toFixed(4)},
		smoothstep( ${t.nearM.toFixed(1)}, ${t.farM.toFixed(1)}, unSpecDepth ) );
	// ...and the depth term is only the FLOOR of the ceiling. Sub-pixel tube
	// geometry is unresolved from the BOTTOM of that ramp, which is where the
	// storm is worst and where depth cannot reach. Raise the ceiling by how far
	// the measured variance overshoots the near threshold, which asks the
	// fragment whether its normal is resolved instead of how far away it is.
	// The min below is unchanged, so a resolved surface cannot be moved at all.
	float unSpecKernel = 2.0 * unNormalVariance;
	float unSpecOver = clamp( ( unSpecKernel - ${t.kappa.toFixed(4)} )
		/ ${(t.varUnresolved - t.kappa).toFixed(4)}, 0.0, 1.0 );
	unSpecKappa = mix( unSpecKappa, ${t.kappaFar.toFixed(4)}, unSpecOver );
	float unRoughnessKernel = min( unSpecKernel, unSpecKappa );`)
    // Convolved in roughness-SQUARED, which is where a Gaussian lobe width
    // actually composes; adding it to `roughness` directly would over-roughen
    // smooth materials and under-roughen rough ones by the same mistake in
    // opposite directions.
    .replace(roughnessAnchor, roughnessAnchor + `
	material.roughness = sqrt( min( 1.0, material.roughness * material.roughness + unRoughnessKernel ) );`)
    // The clearcoat lobe is narrower than the base lobe and sits on the same
    // geometry, so it aliases first. It reuses the base kernel rather than
    // taking derivatives of `clearcoatNormal`: nothing that reaches this yet
    // carries a clearcoat normal map, so the two are the same vector, and a
    // second pair of derivatives would be paid on every physical material for
    // nothing.
    .replace('material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );',
      'material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );\n'
      + '\tmaterial.clearcoatRoughness = sqrt( min( 1.0, material.clearcoatRoughness * material.clearcoatRoughness + unRoughnessKernel ) );');

  chunks.lights_physical_fragment = patched;
  _chunkPatched = true;
}
