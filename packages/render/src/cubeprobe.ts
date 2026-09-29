/**
 * ============================================================================
 *  cubeprobe.ts — photograph a scene into a cube map, one face at a time, and
 *  scrub the face before anything convolves it.
 * ============================================================================
 *
 * ## Two things, and the second one is the reason this exists
 *
 * **One face per call.** `THREE.CubeCamera.update` renders all six and stalls
 * the frame it runs on. A probe that has to refresh while a game is running
 * needs to spread those six across six frames, and doing that by hand means
 * reproducing `update`'s coordinate-system handshake and its render-state
 * save/restore — which is what this is.
 *
 * **A PRODUCER-SIDE NON-FINITE SCRUB, and it is not belt-and-braces.** Every
 * face goes to a scratch target first and is blitted into the cube through a
 * shader that zeroes any channel outside a finite bound and clamps negatives.
 * The blit is an exact texel copy — nearest filtering, a 1:1 fullscreen quad,
 * the scratch target's colour space matched to the cube's — so nothing but a
 * non-finite or negative value changes value.
 *
 * ## Why the scrub is HERE and not at the consumer, measured
 *
 * A rig that scrubbed only where its probes were blended reasoned that the
 * convolution was manufacturing the bad values. Both halves of that were wrong,
 * and the ablation said so — sky dome hidden, everything else identical:
 *
 *     everything visible      cube: 75 Inf + 276 NaN     atlas: 27,681 Inf
 *     starfield hidden        cube: 75 Inf + 276 NaN     atlas: unchanged
 *     SKY DOME hidden         cube:  0     +   0         atlas: 0
 *
 * They are INFINITIES, not NaN — which is why an isNaN-shaped hunt found a
 * "clean" cube and blamed the convolution — and the producer was one fragment
 * shader upstream.
 *
 * What a PMREM convolution then does with them is the whole argument. The blur
 * is a weighted sum and `weight * Inf` is `Inf`, so each of the seven mip levels
 * smears the poison further: **25 bad texels in became 9,227 out, 4.7% of the
 * atlas.** Scrubbing at the consumer therefore does not merely arrive late — it
 * throws away 4.7% of the atlas's REAL convolved energy, most of it in the mips
 * carrying the diffuse irradiance every material in the scene reads. Catching it
 * before the convolution costs 25 texels instead of 9,227.
 *
 * The failure mode this prevents is the worst-shaped one there is: an
 * environment map is the single lighting term every opaque material shares, so
 * a poisoned one turns the entire frame black while the renderer issues a full
 * complement of draw calls — invisible to a draw-call counter, invisible to a
 * per-object visibility ablation, and it looks like a mystery occluder.
 *
 * A boundary that hands out one shared lighting term should not trust its input,
 * and it still should not once the upstream shader is fixed.
 *
 * ## What is the caller's
 *
 * **`finiteBound` is required and there is no default.** It is a statement
 * about the game's own emissive ladder: it must sit above the brightest value
 * the art direction authorises and far enough below half-float's 65,504 that no
 * accumulation downstream reaches the overflow. A shared default would either
 * clip somebody's sun disc or let somebody else's overflow through.
 *
 * **What to render, when, and what to do with the cube afterwards.** This owns
 * the target and the camera. Convolution, probe storage, cross-fading and the
 * refresh schedule are the caller's, and there is nothing here that knows a
 * probe from a reflection.
 */
import * as THREE from 'three';

// ═════════════════════════════════════════════════════════════════════════════
//                      NO BACKTICKS BELOW THIS LINE
//
// The shaders live in /* glsl */ template literals. A backtick anywhere inside
// one — including one quoting an identifier in a comment, which is this repo's
// house style everywhere else — closes the string, and the rest of the file
// parses as TypeScript and fails far from the real error. Under Vite the module
// 500s and the game does not boot.
// ═════════════════════════════════════════════════════════════════════════════

const BLIT_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/**
 * The scrub. `uBound` is the caller's ceiling, pushed as a uniform so the value
 * is visible in a debugger and adjustable in a sweep rather than baked in.
 *
 * RELATIONAL, NOT A SELF-COMPARE. `v != v` is the idiomatic NaN test and it is
 * the one test a compiler may fold to a constant — ANGLE does exactly that
 * under fast-math, and the fold is why an in-shader self-compare reported an
 * atlas clean while a Float32 read-back of the same atlas found 27,603
 * non-finite channels.
 */
const SCRUB_FRAGMENT = /* glsl */`
uniform sampler2D uSrc;
uniform float uBound;
varying vec2 vUv;

void main() {
	vec3 c = texture2D( uSrc, vUv ).rgb;
	bvec3 ok = lessThan( abs( c ), vec3( uBound ) );
	c = vec3( ok.x ? c.x : 0.0, ok.y ? c.y : 0.0, ok.z ? c.z : 0.0 );
	// A negative radiance SUBTRACTS light from every surface that samples this.
	// Same class of silent whole-frame failure, one shade less severe.
	gl_FragColor = vec4( max( c, vec3( 0.0 ) ), 1.0 );
}
`;

export interface CubeProbeSpec {
  /** Cube face size in texels. Square by construction. */
  size: number;
  /** Any channel whose magnitude reaches this is zeroed. See the header. */
  finiteBound: number;
  /** Prefix for the target textures' `name`, so a GPU capture is readable. */
  name: string;
  near: number;
  far: number;
  /** World position the six cameras sit at. */
  position: THREE.Vector3;
}

/**
 * A cube render target plus the machinery to fill one face of it at a time,
 * through the scrub.
 */
export class ScrubbedCubeProbe {
  readonly target: THREE.WebGLCubeRenderTarget;
  readonly camera: THREE.CubeCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scratch: THREE.WebGLRenderTarget;
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blitMaterial: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, spec: CubeProbeSpec) {
    this.renderer = renderer;

    this.target = new THREE.WebGLCubeRenderTarget(spec.size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = spec.name + 'Cube';

    this.camera = new THREE.CubeCamera(spec.near, spec.far, this.target);
    this.camera.position.copy(spec.position);
    this.camera.updateMatrixWorld();

    // NEAREST on the scratch, because the blit is 1:1 and any filtering would
    // make it an approximate copy of a buffer whose whole job is to be exact.
    // Depth IS wanted — the scene renders here, not into the cube.
    this.scratch = new THREE.WebGLRenderTarget(spec.size, spec.size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.scratch.texture.name = spec.name + 'FaceScratch';
    this.scratch.texture.colorSpace = this.target.texture.colorSpace;

    this.blitMaterial = new THREE.ShaderMaterial({
      name: spec.name + 'FaceScrub',
      uniforms: {
        uSrc: { value: this.scratch.texture },
        uBound: { value: spec.finiteBound },
      },
      vertexShader: BLIT_VERTEX,
      fragmentShader: SCRUB_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial));
  }

  /**
   * Render one face of `scene` into the cube, through the scrub.
   *
   * FEEDBACK IS THE CALLER'S CHOICE AND IS BOUNDED WHEN THEY TAKE IT: if
   * `scene.environment` is already a texture derived from this probe, the render
   * samples the previous bake. That is one bounce and it converges, because
   * every material reflects less than it receives — and it is the only way a
   * metal-heavy scene photographs its own metals at all.
   */
  renderFace(scene: THREE.Scene, face: number): void {
    const renderer = this.renderer;

    // The six child cameras are only oriented once the coordinate system is
    // known, and `CubeCamera.update` is what normally does that. Doing it here
    // keeps the per-face path identical to the batch one.
    if (this.camera.coordinateSystem !== renderer.coordinateSystem) {
      this.camera.coordinateSystem = renderer.coordinateSystem;
      this.camera.updateCoordinateSystem();
    }

    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;

    // A composer-driven pipeline usually turns autoClear off; the cube faces
    // need a defined depth buffer or face two draws over face one's depth.
    renderer.autoClear = true;
    renderer.xr.enabled = false;

    const cam = this.camera.children[face] as THREE.PerspectiveCamera;
    renderer.setRenderTarget(this.scratch);
    renderer.render(scene, cam);

    renderer.setRenderTarget(this.target, face, 0);
    renderer.render(this.blitScene, this.blitCamera);

    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXr;
  }

  /** Face size in texels, for a caller sizing a read-back buffer. */
  get size(): number { return this.target.width; }

  dispose(): void {
    this.target.dispose();
    this.scratch.dispose();
    this.blitMaterial.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a cube back
// ─────────────────────────────────────────────────────────────────────────────

export interface CubeElevationBand {
  /** Band centre, degrees above the horizon. -90 is straight down. */
  elev: number;
  /** Mean luminance of every texel whose own direction falls in this band. */
  lum: number;
}

export interface CubeElevationProfile {
  size: number;
  bands: number;
  /** Plain mean of the +Y face. No orientation choice can affect it. */
  faceUp: number;
  /** Plain mean of the -Y face. */
  faceDown: number;
  faceMean: number[];
  /**
   * TRUE means the t axis is the right way up. FALSE means either the profile
   * is mirrored about the horizon OR the check could not run — read
   * `polarBandsPopulated` before believing a false. See `cubeElevationProfile`.
   */
  signCheck: boolean;
  /**
   * WHETHER THE SIGN CHECK COULD RUN AT ALL, and it is not decoration.
   *
   * The check compares the two EXTREME bands against the +Y and -Y face means,
   * and on a small face at a fine band count nothing lands in them: at 16
   * texels a side the texel nearest the pole points 84.9 degrees up, which at
   * 36 bands is band 34 and not band 35. Both extremes then read 0, the
   * comparison is between two zeros and a face mean, and `signCheck` comes back
   * FALSE for a profile that is perfectly correct.
   *
   * A "could not measure" and a "measured it and it is wrong" must never render
   * as the same colour, so they are two fields. `signCheck === false &&
   * polarBandsPopulated === false` means take a coarser `bands` or a larger
   * face; it does not mean the cube is upside down.
   */
  polarBandsPopulated: boolean;
  profile: CubeElevationBand[];
}

/**
 * THE CUBE'S RADIANCE AS A FUNCTION OF ELEVATION — the reading a per-face mean
 * cannot give.
 *
 * "How bright is the environment" and "is the atlas finite" are both answerable
 * from face means. WHAT A REFLECTION RAY FINDS FIVE DEGREES BELOW THE HORIZON
 * is not, and on any world with a bright ground and a dark sky that single
 * number decides the look of every tall metal thing in the frame: a vertical
 * cylinder photographed from a distance only ever reflects a narrow band of
 * elevations either side of horizontal. A per-face mean averages the bright
 * ground under the probe together with that band and hides it completely.
 *
 * So this bins every texel of all six faces by the ELEVATION OF ITS OWN
 * DIRECTION and reports mean luminance per band.
 *
 * ── HOW THE INSTRUMENT VALIDATES ITSELF ─────────────────────────────────────
 *
 * The one thing that can silently be wrong is the sign of the t axis. GL stores
 * cube faces top-row-first and `readRenderTargetPixels` reads bottom-row-first,
 * and getting it backwards MIRRORS THE PROFILE ABOUT THE HORIZON — which on a
 * world lit from below is exactly the finding it is looking for, and would read
 * as entirely plausible. So the result carries `faceUp` and `faceDown`, the
 * plain means of the +Y and -Y faces which no orientation choice can affect,
 * and `signCheck`: the +90 band must be nearer `faceUp` than `faceDown`, and
 * the -90 band the other way. A caller that reports the profile without
 * checking that flag is reporting a coin toss.
 *
 * ## What is the caller's
 *
 * `decode` and `buf`, because the target's texture type is the caller's choice
 * and this must not guess it: a half-float cube needs a `Uint16Array` and a
 * half-to-float decode, a float cube needs a `Float32Array` and the identity,
 * and reading a half-float target into the wrong array returns plausible
 * rubbish rather than an error. `buf` must be `size * size * 4` long.
 *
 * `bands` too. 36 is five degrees a band; the right number depends entirely on
 * how narrow the feature being hunted is.
 *
 * Costs a full GPU stall per face. Diagnostic only.
 */
export function cubeElevationProfile(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLCubeRenderTarget,
  bands: number,
  decode: (raw: number) => number,
  buf: Uint8Array | Uint16Array | Float32Array,
): CubeElevationProfile {
  const N = target.width;
  const sum = new Float64Array(bands);
  const cnt = new Float64Array(bands);
  const faceMean = new Array<number>(6).fill(0);
  for (let f = 0; f < 6; f++) {
    renderer.readRenderTargetPixels(target, 0, 0, N, N, buf, f);
    let fs = 0;
    for (let r = 0; r < N; r++) {
      // tc from the buffer's own row order; sc across. See the sign check.
      const tc = ((r + 0.5) / N) * 2 - 1;
      for (let c = 0; c < N; c++) {
        const sc = ((c + 0.5) / N) * 2 - 1;
        let x = 0, y = 0, z = 0;
        switch (f) {
          case 0: x = 1; y = -tc; z = -sc; break;
          case 1: x = -1; y = -tc; z = sc; break;
          case 2: x = sc; y = 1; z = tc; break;
          case 3: x = sc; y = -1; z = -tc; break;
          case 4: x = sc; y = -tc; z = 1; break;
          default: x = -sc; y = -tc; z = -1; break;
        }
        const o = (r * N + c) * 4;
        const lum = 0.2126 * decode(buf[o] as number) + 0.7152 * decode(buf[o + 1] as number)
          + 0.0722 * decode(buf[o + 2] as number);
        if (!Number.isFinite(lum)) continue;
        fs += lum;
        const el = Math.asin(y / Math.hypot(x, y, z)) * (180 / Math.PI);
        let b = Math.floor(((el + 90) / 180) * bands);
        if (b < 0) b = 0; else if (b >= bands) b = bands - 1;
        sum[b] = (sum[b] as number) + lum;
        cnt[b] = (cnt[b] as number) + 1;
      }
    }
    faceMean[f] = +(fs / (N * N)).toFixed(5);
  }
  const step = 180 / bands;
  const profile: CubeElevationBand[] = [];
  for (let b = 0; b < bands; b++) {
    profile.push({
      elev: +(-90 + (b + 0.5) * step).toFixed(1),
      lum: cnt[b] ? +((sum[b] as number) / (cnt[b] as number)).toFixed(5) : 0,
    });
  }
  const top = (profile[bands - 1] as CubeElevationBand).lum;
  const bot = (profile[0] as CubeElevationBand).lum;
  const up = faceMean[2] as number;
  const down = faceMean[3] as number;
  return {
    size: N,
    bands,
    faceUp: up,
    faceDown: down,
    faceMean,
    // Both must hold, or the t axis is inverted and the profile is mirrored.
    signCheck: Math.abs(top - up) < Math.abs(top - down)
      && Math.abs(bot - down) < Math.abs(bot - up),
    // ...and it can only hold if anything landed in the two bands it reads.
    polarBandsPopulated: (cnt[0] as number) > 0 && (cnt[bands - 1] as number) > 0,
    profile,
  };
}
