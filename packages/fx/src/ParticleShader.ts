/**
 * ============================================================================
 *  ParticleShader — the one program behind every particle in both racers.
 * ============================================================================
 *
 *  `DragParticles` already owns the ring, the write path and the whole public
 *  emit API. What it deliberately does NOT own is the pair of shaders, because
 *  when that seam was drawn the two games' shaders were not the same text.
 *
 *  MEASURED, 2026-08-20, on the two racing games' particle modules:
 *
 *    · the FRAGMENT shader is 193 lines and BYTE-IDENTICAL in both games —
 *      `diff` reports nothing at all;
 *    · the VERTEX shader diverges in exactly three places, and every one of
 *      them is a VALUE rather than a behaviour:
 *
 *        1. the reference frame of the stretch mode. The space racer subtracts
 *           the camera's own world velocity before measuring the smear; the
 *           kart racer does not, which is the same thing as subtracting zero.
 *        2. the stretch tuning — the kart racer elongates by 0.055 per m/s to
 *           a ceiling of 4.0x, the space racer by 0.075 to 3.0x and then adds
 *           an exposure-length smear above a 70 m/s knee. The kart racer has no
 *           exposure term, which is the same thing as a shutter of zero
 *           seconds.
 *        3. the tumble facet, which shades ONE atlas tile — the space racer's
 *           Spall chip at index 10 — as a flat plate rather than as a ball of
 *           vapour. The kart racer's atlas has eight tiles and no chip, which
 *           is the same thing as naming a tile index the atlas does not
 *           contain.
 *
 *  So all three are uniforms here and both games get the identical program.
 *  Read `particleTuning()` for the values each game supplies and why.
 *
 *  WHAT IS NOT HERE, and it is a decision rather than an oversight. A
 *  base-building game on the moon has a particle pool of the same lineage —
 *  1,184 lines, 79 substantive lines of it matching the kart racer's — and it
 *  does NOT use this shader, because THERE IS NO AIR ON THE MOON. It
 *  integrates a perfect parabola with no drag term at all, because a drag term
 *  is a model of a fluid that does not exist there, and `drag` is deliberately
 *  not even expressible on its EmitParams. Its fragment shader diverges in 197
 *  lines besides — a mip bias on the incandescent layer, earthshine as the
 *  whole night fill, a different bloom gate. Sharing this with it would put
 *  Earth physics back into a game whose art direction names drifting dust as
 *  an automatic fail. Two simulations that share a shape are still two
 *  simulations.
 *
 *  `three` is never imported here. This module is two strings and a table of
 *  numbers; the uniform OBJECTS are built by the game's `Layer`, which already
 *  has three in hand. That keeps the vendor out of the one file a game is most
 *  likely to read.
 * ============================================================================
 */

/**
 * THE VERTEX SHADER.
 *
 * Motion is the closed-form solution of  v' = -k v + g  (linear drag under
 * constant gravity), which gives believable terminal velocity for smoke and
 * debris alike from a single `exp()` — no per-frame integration, no drift.
 *
 * A particle is written ONCE at spawn into the ring's interleaved instance
 * attributes; from then on this integrates its motion analytically, so the CPU
 * cost of a live particle is exactly zero and nothing is allocated after boot.
 */
export const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
uniform vec2  uAtlasTiles;
/** max fraction of the viewport HEIGHT a single sprite may cover */
uniform float uSizeCap;
/** x: fully faded at this view depth, y: fully opaque from here out */
uniform vec2  uNearFade;
/** world velocity of the camera, m/s — the streak mode's reference frame */
uniform vec3  uCamVel;
/**
 * x: elongation per m/s of RELATIVE speed, y: the multiple it saturates at.
 * See the note on PMode.Stretch below for why both are the game's to set and
 * why neither survives a change of top speed.
 */
uniform vec2  uStretch;
/**
 * The exposure smear that takes over above the stretch ceiling.
 * x: the knee in m/s, y: the shutter in seconds, z: the ceiling in metres.
 * A shutter of zero switches the whole term off, exactly.
 */
uniform vec3  uSmear;
/**
 * Atlas index of the one tile that is a FLAT tumbling facet rather than a ball
 * of vapour, or a negative number in a game whose atlas has no such tile.
 */
uniform float uFacetTile;
/**
 * Direction TOWARD the key light. Declared in BOTH stages on purpose: the
 * fragment shader only has it under LIT, and the tumble-facet term below has
 * to run on the additive layer too. Both layers are constructed with this
 * uniform in their map, so the binding exists either way.
 */
uniform vec3  uSunDir;
/** live per-racer drift colour; see EmitParams.channel */
uniform vec3  uTierCol[TIER_SLOTS];

attribute vec4 aStart;  // xyz spawn point, w birth time
attribute vec4 aVel;    // xyz initial velocity, w lifetime
attribute vec4 aDyn;    // x gravity, y drag, z spin, w mode
attribute vec4 aSize;   // x size0, y size1, z stretch, w fadeIn
attribute vec4 aColA;   // rgb at birth, a alpha at birth
attribute vec4 aColB;   // rgb at death, a alpha at death
attribute vec4 aMisc;   // x tile, y seed, z groundY, w softness
attribute vec4 aGrnd;   // xyz ground normal, w camera bias in metres

varying vec4 vColor;
varying vec2 vUv;
varying vec2 vSprite;
varying vec3 vWorld;
varying float vViewZ;
/** xyz ground-plane normal, w = -dot(normal, pointOnPlane) */
varying vec4 vPlane;
varying float vSoft;
varying float vNear;
varying float vHot;
varying float vAge;
varying float vErode;

void main() {
  float age = uTime - aStart.w;
  float life = max(aVel.w, 1e-4);
  float u = age / life;

  // Dead / unborn instances collapse outside the clip volume: they cost a
  // vertex shader invocation and nothing else. This is what lets the ring
  // buffer stay a fixed-size, allocation-free draw.
  if (age < 0.0 || u >= 1.0) {
    vColor = vec4(0.0); vUv = vec2(0.0); vSprite = vec2(0.0);
    vWorld = vec3(0.0); vViewZ = 1.0; vPlane = vec4(0.0, 1.0, 0.0, 0.0);
    vSoft = 0.0; vNear = 0.0;
    vHot = 0.0; vAge = 0.0; vErode = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vAge = u;
  // Only the billowy Smoke tile carries interior density in its RGB, so it is
  // the only one the erosion dissolve in the fragment shader can key off.
  vErode = abs(aMisc.x - 2.0) < 0.5 ? 1.0 : 0.0;

  // Tiles that represent *incandescent* matter (spark cores and velocity
  // streaks) get a white-hot centre in the fragment shader. A spark that is
  // uniformly tier-blue from core to fringe is the single loudest tell that a
  // particle is a UI sprite composited over the scene rather than a piece of
  // burning metal — real sparks clip to white in the middle and only carry
  // their colour in the falloff.
  vHot = (abs(aMisc.x - 1.0) < 0.5 || abs(aMisc.x - 5.0) < 0.5) ? 1.0 : 0.0;

  // Closed-form v' = -k v + g. One exp() buys terminal velocity for free.
  float k = max(aDyn.y, 1e-3);
  float decay = exp(-k * age);
  vec3 g = vec3(0.0, aDyn.x, 0.0);
  vec3 gk = g / k;
  vec3 wp = aStart.xyz + (aVel.xyz + gk) * (1.0 - decay) / k - gk * age;

  // The ground plane this particle must not cut through, captured at spawn from
  // ctx.track.probe. Encoded as a plane equation so the fragment shader gets a
  // true signed distance and the fade follows the banking of the road.
  vec3 gN = aGrnd.xyz;
  float gl2 = dot(gN, gN);
  gN = gl2 > 1e-6 ? gN * inversesqrt(gl2) : vec3(0.0, 1.0, 0.0);
  vPlane = vec4(gN, -dot(gN, vec3(aStart.x, aMisc.z, aStart.z)));

  // Camera-facing bias. Applied to the particle CENTRE, before billboarding, so
  // the whole quad shifts rigidly and the bias cannot swim across the sprite.
  // Clamped to a fraction of the distance to the eye so a particle spawned on
  // top of the lens is not shoved through it.
  vec3 toCam = cameraPosition - wp;
  float toCamLen = length(toCam);
  if (aGrnd.w > 0.0 && toCamLen > 1e-4) {
    wp += (toCam / toCamLen) * min(aGrnd.w, toCamLen * 0.35);
  }

  float sz = mix(aSize.x, aSize.y, u);
  float alpha = mix(aColA.a, aColB.a, u) * smoothstep(0.0, max(aSize.w, 1e-4), u);

  // aMisc.y packs TWO things: the integer part is the live colour channel
  // (0 = none), the fraction is the per-particle random phase. Splitting them
  // costs one floor() and buys a shower that re-hues the instant its drift is
  // promoted, instead of one that is always a tier behind.
  float chan = floor(aMisc.y);
  float seed = aMisc.y - chan;
  vec3 tint = vec3(1.0);
  if (chan > 0.5) tint = uTierCol[int(min(chan, float(TIER_SLOTS))) - 1];
  vColor = vec4(mix(aColA.rgb, aColB.rgb, u) * tint, alpha);

  float ang = aDyn.z * age + seed * 6.2831853;
  float sa = sin(ang), ca = cos(ang);

  // --- TUMBLE FACET, uFacetTile ONLY -------------------------------------
  //
  // A chip of torn plate is a FLAT object, and the one thing that says so is
  // that it goes dark and then flashes as it turns through the key. The
  // fragment shader's lit path reconstructs a hemisphere normal off the sprite
  // disc, which is right for a ball of vapour and wrong for a chip: it is
  // essentially constant across a billboard, so every chip in a burst carries
  // the same value on every face for its whole life and the shed hull reads as
  // sprite confetti. That is a playtest note on a wreck scene, and it
  // is fair.
  //
  // The facet normal is built here rather than in the fragment because it is
  // constant over the quad — a flat plate has ONE normal — so it costs a few
  // ALU per instance and no varying at all. abs() because a chip is lit from
  // whichever side faces the key, and the narrow power term is the specular
  // glint off a polished torn edge: that glint is the flash. The whole
  // expression averages to ~1.0 over a tumble, so on the lit layer it modulates
  // the fragment's own key-and-fill rather than double-exposing it, and on the
  // additive layer it is the only shading those chips get.
  //
  // A GAME WITHOUT SUCH A TILE PASSES A NEGATIVE INDEX and this never fires:
  // a tile index is written into the instance buffer as a non-negative number,
  // so the comparison cannot be satisfied. That is a value, not a flag — the
  // question "which of my tiles is a flat plate" has an answer in every game,
  // and in the kart game the answer is "none of them".
  if (abs(aMisc.x - uFacetTile) < 0.5) {
    float tw = ang * 0.71 + seed * 5.13;
    vec3 fn = normalize(vec3(ca * 0.92, sin(tw) * 0.78 + 0.14, sa * 0.92));
    float ndl = abs(dot(fn, uSunDir));
    vColor.rgb *= 0.34 + 0.98 * ndl + 2.30 * pow(ndl, 22.0);
  }

  // Camera basis pulled straight out of the view matrix — no extra uniforms.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  // --- screen-space size clamp -------------------------------------------
  // A sprite emitted toward a chase camera walks into the near plane and its
  // projected size runs away; two of them then cover the frame. Cap the
  // projected height instead of trusting the world-space size, which costs one
  // divide and makes every emitter safe at any camera distance. Ground-aligned
  // quads are exempt: they lie on the floor, perspective already reads them
  // correctly, and clamping them would shrink ground glows as you approach.
  float centreZ = max(-(viewMatrix * vec4(wp, 1.0)).z, 1e-3);
  float szCap = uSizeCap * centreZ / max(projectionMatrix[1][1], 1e-4);
  float szB = min(sz, szCap);

  float mode = aDyn.w;
  vec3 vert;
  if (mode < 0.5) {
    vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca) * szB;
    vert = wp + camRight * q.x + camUp * q.y;
  } else if (mode < 1.5) {
    // Ground-aligned: lies flat in XZ, spun about world up.
    vec3 q = vec3(position.x * ca - position.y * sa, 0.0, position.x * sa + position.y * ca) * sz;
    vert = wp + q;
  } else {
    // A STREAK IS MOTION BLUR, AND MOTION BLUR IS RELATIVE TO THE CAMERA.
    //
    // This used to stretch by the particle's WORLD speed, which was correct at
    // the kart game's 30 m/s and is catastrophic at 142. Every emitter in
    // the space racer hands its particles 0.60-0.75 of the emitting ship's
    // velocity so the shower stays with the machine that made it, and the
    // stretch term saturates its own cap at 73 m/s — so at racing speed EVERY
    // spark in the game was drawn at maximum elongation, permanently, whatever
    // it was actually doing. That is the fan of hard white slivers radiating
    // from the vanishing point in the reviewed Spall and Muster frames: not
    // gravity, not a radial blur, just a scalar that stopped meaning anything
    // above a third of top speed.
    //
    // Physically a grain travelling with the pack at 124 m/s, photographed from
    // a camera travelling at 124 m/s, does not streak at all — it is stationary
    // in the film plane. What streaks is the part of its velocity the camera
    // does NOT share. Subtracting uCamVel gives exactly that, costs one vec3
    // subtract, and makes the length of every streak in the game a true
    // statement about the shot instead of a constant.
    //
    // DIRECTION COMES FROM THE RELATIVE VECTOR TOO, for the same reason the
    // length does. A grain that is stationary with respect to the rig does not
    // smear in any direction, and orienting off its WORLD velocity would point
    // every spark in the game at the vanishing point on every frame — which is
    // the fan's characteristic shape. In the common case (a chase camera moving
    // with the machine that threw it) the relative vector IS the ejection
    // velocity, so a spark still points along the way it left the corner.
    //
    // A GAME THAT LEAVES uCamVel AT ZERO gets the world frame back, exactly:
    // subtracting a zero vector is the identity, bit for bit, at every speed.
    vec3 vel = (aVel.xyz + gk) * decay - gk;
    vec3 relV = mat3(viewMatrix) * (vel - uCamVel);
    vec2 d = relV.xy;
    float dl = length(d);
    float rl = length(relV);
    // Screen-space projection of the velocity, 0..1. When the particle travels
    // (anti)parallel to the view axis the stretch direction is undefined: the
    // quad snaps to an arbitrary orientation and an asymmetric tile like the
    // flame tongue then reads as a hard triangular shard. Blend back to a plain
    // billboard before that happens rather than at the degenerate point.
    float project = rl > 1e-4 ? dl / rl : 0.0;
    // Engage earlier than the degenerate point but still well clear of it. At
    // the old 0.30 threshold a spark thrown sideways out of a rear wheel and
    // viewed from a chase camera sat *below* the knee for most of its life, so
    // nothing streaked and the sparks read as evenly-spaced confetti.
    float blend = smoothstep(0.16, 0.44, project);

    vec2 axB = vec2(-sa, ca);                       // billboard up, with roll
    vec2 axS = dl > 1e-4 ? d / dl : axB;
    axS *= dot(axS, axB) < 0.0 ? -1.0 : 1.0;        // keep the mix off the pole
    vec2 ax = normalize(mix(axB, axS, blend));
    vec2 ay = vec2(-ax.y, ax.x);
    // THE ELONGATION IS A MULTIPLE OF THE SPRITE, AND IT SATURATES.
    //
    // Both numbers are the game's, because both are fitted to a top speed and
    // neither survives a change of one: 0.055 to a 4.0x ceiling was fitted at
    // 30 m/s, and the same pair at 142 m/s is a permanent maximum. See
    // particleTuning() below for what each game passes and what it was fitted
    // to. NO BACKTICKS ANYWHERE INSIDE THIS TEMPLATE LITERAL, and that is not
    // a style note: one in a comment here closes the literal mid-document, the
    // module stops parsing. That has happened once already.
    float len = szB * (1.0 + aSize.z * min(rl * uStretch.x, uStretch.y) * blend);
    // ...AND ABOVE THAT CEILING THE SMEAR IS AN EXPOSURE, NOT A MULTIPLE OF THE
    // SPRITE.
    //
    // The line above saturates. A game whose top speed is several times the
    // saturation point therefore delivers one identical streak across its whole
    // upper range — the same failure, at the other end, as the world-speed
    // version it replaced: a cue that stops varying above a third of top speed
    // is not a speed cue. A playtest of the space racer read the result on two
    // tracks as "the scattered white specks are round unstreaked
    // points; at 150 m/s a near-field particle should be a long straight line."
    //
    // What a real smear is has nothing to do with how big the grain is drawn:
    // it is velocity times exposure. So this ADDS the honest smear for whatever
    // relative speed runs past the knee, and everything below the knee is
    // bit-identical to what shipped.
    //
    // THE KNEE IS A FILL DECISION, not a visual one. Doubling the length of a
    // few dozen quads is free; doubling it on six hundred is a tenth of a frame
    // of additive overdraw, and the knee exists to refuse that trade — it is
    // set above the relative speed of the dense continuous showers and below
    // the speed at which the rig passes static debris.
    //
    // A SHUTTER OF ZERO SECONDS SWITCHES THE WHOLE TERM OFF, exactly: the
    // product is +0.0, min() of that with a positive ceiling is +0.0, and
    // adding +0.0 to a non-negative length is the identity in IEEE 754.
    len += min(max(rl - uSmear.x, 0.0) * uSmear.y, uSmear.z) * blend;
    len = min(len, szCap * 2.2);
    vec2 q = ax * (position.y * len) + ay * (position.x * szB);
    vert = wp + camRight * q.x + camUp * q.y;
  }

  vec4 mv = viewMatrix * vec4(vert, 1.0);
  vViewZ = -mv.z;
  vWorld = vert;
  vSoft = aMisc.w;
  vSprite = position.xy * 2.0;
  // Lens fade. Nothing should be legible in the first metre in front of the
  // near plane: at that range a sprite is a texture-filling smear, not an
  // effect. Driven off the particle centre so the fade cannot swim across a
  // single quad.
  vNear = smoothstep(uNearFade.x, uNearFade.y, centreZ);

  float col = mod(aMisc.x, uAtlasTiles.x);
  float row = floor(aMisc.x / uAtlasTiles.x);
  vUv = (uv + vec2(col, row)) / uAtlasTiles;

  gl_Position = projectionMatrix * mv;
}
`;

/**
 * THE FRAGMENT SHADER.
 *
 * Byte-identical in both racers and moved verbatim, comments and all. Nothing
 * in it was a value that needed lifting, which is why there is not one uniform
 * here that the two games disagreed about.
 *
 * The prose inside it names one racer's tarmac and the other's grade in the
 * same breath because both games' reviews drove the same two constants to the
 * same place. Comments travel with their constants; a cleanup that deletes one
 * because it names the other game's road is deleting the reasoning for a number
 * that is still load-bearing here.
 */
export const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGain;
/**
 * MIP BIAS ON THE INCANDESCENT LAYER ONLY. Negative sharpens; 0.0 is off.
 *
 * The problem is the Core tile. Its whole identity is a pinpoint, and a
 * four-pixel sprite off a 256-pixel tile samples around mip 6, where that
 * pinpoint has been box-filtered into the halo around it — so the sprite keeps
 * its AREA and loses the thing that made it a spark. Everything downstream then
 * behaves correctly on a value that is already wrong: the chroma-preserving
 * shoulder below has almost nothing to preserve, and the sprite arrives at the
 * bloom gate under it. That is the other half of "the sparks read as dust
 * motes", and the half a shoulder constant cannot reach.
 *
 * IT IS A VALUE AND NOT A SWITCH because the right bias depends on the tile
 * resolution and on how far away the game's own sprites get, and because the
 * ceiling on it is a per-game art call: a bias steep enough to fully restore
 * the core is undersampling, and aliasing crawl on thin bright geometry is on
 * every one of these games' automatic-fail lists. 0.0 is the identity — the
 * same LOD the unbiased sample would have taken.
 *
 * The lit layer never gets it. Smoke and regolith carry their form in low
 * frequencies; sharpening them buys nothing and costs the crawl.
 */
uniform float uMipBias;
/**
 * Per-fragment additive shoulder. Additive effects must ADD to a scene, not
 * replace it: without a bound, ten overlapping spark cores authored at 3x a
 * saturated primary put 30 units of radiance through one pixel and the tone
 * mapper has nothing left to do but return white. rgb / (1 + rgb * uClip)
 * is a Reinhard shoulder applied to the *emission*, so a lone core still
 * clears the bloom threshold and a pile of them asymptotes just above it
 * instead of running away. Cheap, monotonic, and it never dims a single
 * particle enough to notice.
 *
 * 0.13, down from 0.19. The claim above — that a lone core still clears the
 * bloom threshold — stopped being true when the two numbers moved past each
 * other. At 0.19 the shoulder asymptotes at 1/0.19 = 5.26 and, more to the
 * point, it takes a spark authored at 2.35 down to 1.61 before it ever reaches
 * the framebuffer, so a drift spark composited onto shadowed tarmac landed at
 * a luminance of about 1.2 against PostFX's 1.55 gate: no bloom, ever, on any
 * spark in the game. That is the whole of "the sparks read as dust motes" —
 * a spark IS its glow. At 0.13 the same core arrives at 1.79, clears the gate,
 * and the asymptote is still a hard 7.7, so ten overlapping cores cannot run
 * away and the boost + tier-3 + tunnel-exit stack still cannot white out.
 */
uniform float uClip;
#ifdef LIT
uniform vec3 uSunDir;      // direction TOWARD the sun
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uBounceColor;
#endif
#ifdef SOFT_DEPTH
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uCamPlanes;   // near, far
#endif

varying vec4 vColor;
varying vec2 vUv;
varying vec2 vSprite;
varying vec3 vWorld;
varying float vViewZ;
varying vec4 vPlane;
varying float vSoft;
varying float vNear;
varying float vHot;
varying float vAge;
varying float vErode;

void main() {
#ifdef ADDITIVE
  vec4 tex = texture2D(uAtlas, vUv, uMipBias);
#else
  vec4 tex = texture2D(uAtlas, vUv);
#endif
  float a = tex.a * vColor.a * vNear;

  // EROSION. A puff that fades as one disc is a decal fading out; a real one
  // breaks up — the thin parts of it disappear first and the silhouette rots
  // inwards. The Smoke tile already carries its interior density in RGB, so a
  // threshold on that density rising over the particle's life dissolves the
  // sparse regions and leaves the dense core last, for one smoothstep.
  if (vErode > 0.5) {
    float dens = tex.r;
    a *= smoothstep(0.62 * vAge, 0.62 * vAge + 0.34, dens);
  }
  if (a < 0.004) discard;

  vec3 rgb = tex.rgb * vColor.rgb;

#ifdef ADDITIVE
  // Hot core. The sprite mask doubles as "how deep into the spark are we", so
  // cubing it gives a tight centre and a wide fringe. Pulling the weak channels
  // up to the strongest one desaturates the core toward white without touching
  // its energy. Off for every tile except the spark core and the streak (vHot),
  // so glow halos still carry flat tier colour.
  //
  // Cubed, not squared, and 0.45 rather than 0.85. Squared-times-0.85
  // reached 0.6 desaturation by 40% of the sprite radius, and because the
  // stretched streak tile holds a high mask value all the way down its spine,
  // an *entire tier-2 spark* arrived at the tone mapper as neutral white. The
  // drift review is unambiguous: the sparks read as fireflies with no hue in
  // them at all. A cubed mask confines the whitening to the genuine pinpoint
  // and leaves the streak body carrying #ff9d2e.
  float mx = max(max(rgb.r, rgb.g), rgb.b);
  float hotMask = tex.a * tex.a * tex.a;
  rgb = mix(rgb, vec3(mx), vHot * hotMask * 0.45);
#endif

#ifdef LIT
  // Reconstruct a hemisphere normal from the sprite disc so the puff shades
  // like a ball of vapour rather than a flat decal.
  vec3 n;
  n.xy = vSprite;
  float r2 = dot(n.xy, n.xy);
  n.z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  vec3 N = normalize(n * mat3(viewMatrix)); // orthonormal => transpose == inverse

  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, uSunDir);
  // Wrapped diffuse: vapour is translucent, it does not terminate at N.L = 0.
  float wrapD = clamp((ndl + 0.62) / 1.62, 0.0, 1.0);
  // Forward scattering when the sun is on the far side of the puff. This is
  // the golden-hour money shot for tyre smoke on the cliff traverse. Two lobes:
  // a broad Henyey-Greenstein-ish haze plus a tight glow right on the sun
  // vector, so a puff between the camera and a 14-degree sun goes genuinely hot
  // rather than one shade lighter.
  float sv = clamp(-dot(uSunDir, V), 0.0, 1.0);
  float fwd = 0.55 * pow(sv, 2.0) + 1.25 * pow(sv, 7.0);
  // Silhouette rim: the edge of a billboarded puff is where the sight line
  // passes through the least vapour, so it is where backlight leaks through.
  //
  // Driven by the VIEW-to-SUN angle as well as by N.L. A plume standing between
  // the camera and a 14-degree sun is the golden-hour hero moment the look asks for
  // and the previous form threw it away: it keyed the rim off the sprite's
  // reconstructed normal alone, which for a billboard facing the camera is
  // essentially constant across the whole cloud, so every puff got the same
  // flat amount of edge whatever the sun was doing behind it.
  float rim = pow(clamp(dot(vSprite, vSprite), 0.0, 1.0), 1.6)
            * clamp(0.35 - ndl, 0.0, 1.0) * (0.30 + 1.30 * sv);
  vec3 amb = mix(uBounceColor, uSkyColor, N.y * 0.5 + 0.5);
  // KEY AND FILL, NOT KEY PLUS AMBIENT.
  //
  // The previous form was amb * 0.62 + sun * (...), i.e. a constant ambient
  // floor with the key added on top. Two things follow from that and both of
  // them are visible in the pack/wide review frames: the sum on the lit side
  // lands above 1.0 for a puff whose base colour is already near 0.8, so the
  // sun side clips and loses all its internal form; and the shadow side never
  // falls below the flat achromatic floor, so there is no cool lobe for the
  // warm one to read against. A puff with no value ratio across it is a
  // cotton-wool decal, which is exactly the note.
  //
  // Fill is now *complementary* to the key: it is strongest where the key is
  // absent. That gives a genuine two-lobe split — roughly 2.5x brighter and
  // distinctly warm on the sun side, cool sky-blue in the shadow — with the lit
  // side landing just under clip so the billow keeps its density variation.
  // The look: the smoke must catch the sun, and shadows lean cool.
  vec3 key = uSunColor * (wrapD * 0.95 + fwd * 1.05 + rim * 1.90);
  vec3 fill = amb * (0.30 + 0.34 * (1.0 - wrapD));
  rgb *= key + fill;

  // TRANSMISSION. This is the half of backlighting that brightness alone cannot
  // fake. Vapour with the sun behind it does not just get lighter, it gets
  // *thinner* — you start to see the sky through it — and a puff authored at a
  // fixed alpha instead stays an opaque lump that happens to be a paler grey.
  // Against a golden-hour sky at 0.9 display that lump is DARKER than its
  // background, which is exactly the "unlit grey-brown column" note. Backing the
  // coverage off where the forward-scatter lobe is strong lets the sky through
  // at the silhouette and turns the plume into a glow instead of a smudge.
  a *= mix(1.0, 0.55, clamp(fwd * 0.85, 0.0, 1.0));
#endif

  float soft = 1.0;
  if (vSoft > 0.0) {
#ifdef SOFT_DEPTH
    float d = texture2D(uDepth, gl_FragCoord.xy * uInvRes).x;
    float nz = uCamPlanes.x, fz = uCamPlanes.y;
    float sceneZ = (2.0 * nz * fz) / (fz + nz - (d * 2.0 - 1.0) * (fz - nz));
    soft *= clamp((sceneZ - vViewZ) / vSoft, 0.0, 1.0);
#endif
    // Ground-plane fade. Cheap, always on, and on its own it already removes
    // the hard intersection line where a billboard sinks into the tarmac. The
    // plane carries the surface normal from ctx.track.probe, so this stays
    // correct through 20 degrees of banking and over the cliff camber.
    float h = dot(vPlane.xyz, vWorld) + vPlane.w;
    soft *= smoothstep(-0.30 * vSoft, vSoft * 0.85, h);
  }
  a *= soft;
  if (a < 0.004) discard;

  rgb *= uGain;
#ifdef ADDITIVE
  // CHROMA-PRESERVING SHOULDER — and the word chroma is the whole point.
  //
  // The previous form applied the Reinhard shoulder PER CHANNEL. Per-channel
  // compression squeezes the biggest channel hardest, so as a saturated colour
  // gets brighter its channels converge: #ff9d2e at 8x arrives as (3.0, 2.5,
  // 1.3) — visibly desaturated — and by the time three sprites have stacked it
  // is neutral. That is the mechanism behind "the plume clips to flat pure
  // white", "the core has no colour in it" and "the sparks read as fireflies
  // with no hue": the shoulder that exists to stop a white-out was itself
  // manufacturing the white.
  //
  // Compressing the MAX CHANNEL and scaling all three by the same factor is the
  // same monotonic curve with the same 1/uClip asymptote and the same cost, but
  // the ratio between the channels is untouched, so a boost core saturates to
  // an incandescent orange and a tier-3 drift saturates to violet. Where white
  // is wanted it is authored (see the vHot core term above), not inherited from
  // an accident of the tone curve.
  float mxc = max(max(rgb.r, rgb.g), rgb.b);
  rgb *= mxc > 1e-4 ? 1.0 / (1.0 + mxc * uClip) : 1.0;
#endif
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The four numbers-and-a-vector that are the game's, not the shader's.
 *
 * Every one is a length, a speed or an index, and not one of them is a mode.
 * A game that supplies the identity values (`{}`) gets the world-frame,
 * no-exposure, no-facet program bit for bit — which is what the kart racer is.
 */
export interface ParticleTuning {
  /**
   * Elongation per m/s of relative speed, and the multiple it saturates at.
   * Fitted to a top speed and does NOT survive a change of one: the kart
   * racer's `[0.055, 4.0]` was fitted at 30 m/s and saturates at 73 m/s, which
   * is why the space racer re-fitted it to `[0.075, 3.0]` when top speed went
   * to 142.
   */
  stretch?: readonly [number, number];
  /**
   * The exposure smear above the stretch ceiling: knee in m/s, shutter in
   * seconds, ceiling in metres. Default shutter is zero, which is off, exactly.
   */
  smear?: readonly [number, number, number];
  /**
   * Atlas index of the one tile that is a flat tumbling facet. Default -1,
   * which no tile index can equal.
   */
  facetTile?: number;
  /**
   * LOD bias for the additive layer's atlas sample. Negative sharpens.
   * Default 0, which is the same LOD an unbiased sample takes.
   *
   * See the note on `uMipBias` in the fragment shader for what it is for and
   * for the ceiling on it: too steep is undersampling, and crawl on thin bright
   * geometry is an automatic fail in every one of these games.
   */
  mipBias?: number;
}

/** The identity tuning, spelled out so a game can see what it is opting out of. */
export const PARTICLE_TUNING_IDENTITY: Required<ParticleTuning> = {
  stretch: [0.055, 4.0],
  smear: [70, 0, 0.9],
  facetTile: -1,
  mipBias: 0,
};

/**
 * The plain numbers behind `uStretch`, `uSmear` and `uFacetTile`, resolved
 * against the identity above.
 *
 * This returns NUMBERS rather than three.js uniform objects on purpose: the
 * vendor is a peer dependency of this package and the game's `Layer` already
 * holds it, so building `new THREE.Vector2(...)` there costs the game one line
 * and costs this file its independence from three entirely.
 */
export function particleTuning(t: ParticleTuning = {}): {
  stretch: readonly [number, number];
  smear: readonly [number, number, number];
  facetTile: number;
  mipBias: number;
} {
  return {
    stretch: t.stretch ?? PARTICLE_TUNING_IDENTITY.stretch,
    smear: t.smear ?? PARTICLE_TUNING_IDENTITY.smear,
    facetTile: t.facetTile ?? PARTICLE_TUNING_IDENTITY.facetTile,
    mipBias: t.mipBias ?? PARTICLE_TUNING_IDENTITY.mipBias,
  };
}
