/**
 * ============================================================================
 *  The on-screen pad's stylesheet — the parts both racers hold identically.
 * ============================================================================
 *  Every line below was lifted VERBATIM out of the touch-controls module that
 *  the kart racer and the space racer — which are forks of each other — held
 *  byte for byte the same in two places: 329 of the 393 lines of that file's
 *  `CSS` constant, in five runs. The comments came with it, because they are
 *  the asset. Nothing here was rewritten, reformatted or improved; a chunk that
 *  needed improving would be a separate change with a before and an after.
 *
 *  WHAT DID NOT COME, AND WHY. The two pieces that stayed in the games are the
 *  ones where they genuinely disagree, and the disagreement is real design:
 *  the kart racer's DRIFT is a round button with a conic charge halo swept
 *  through the upper semicircle, the space racer's air brakes are tall capsules
 *  with a bottom-up column fill, and the three flare keyframes differ with
 *  them. Those are not one thing wearing two skins — they are two different
 *  controls — so they are not parameterised, they are simply not here.
 *
 *  THE SEAMS ARE LOAD-BEARING, AND THIS IS THE ONLY THING TO GET RIGHT WHEN
 *  ADDING TO THIS FILE. Every chunk OPENS with a newline and CLOSES flush
 *  against its last line, so a game concatenating them reproduces exactly the
 *  document it used to hold. One newline more or fewer at a seam is not
 *  cosmetic in a stylesheet — a rule that lands inside the previous rule's
 *  block silently takes a whole layer of the pad with it, and nothing in a
 *  screenshot of a menu looks any different.
 *  A browser probe mounts the pad in a real browser and compares the mounted
 *  sheet BYTE FOR BYTE for exactly that reason.
 *
 *  ONE MORE THING THIS FILE CANNOT TELL YOU, and it must be said here rather
 *  than only in the probe: none of this has been verified under a thumb. CDP
 *  touch events bypass the browser's gesture arbitration, so a green harness
 *  and a dead button feel identical from a terminal. Anything touch-related is
 *  UNVERIFIED until a person holds a phone.
 * ============================================================================
 */

/**
 * The pad itself: the fixed layer, the `env()` probe that carries the safe-area
 * insets into JS, the stick zone, base, knob and ghost, the coach line, the
 * two steering pads, the top chips, the cluster container, the left-handed
 * mirror and the button base treatment.
 *
 * Both games place different BUTTONS in that cluster; the cluster, the stick
 * and everything around them are one thing written once.
 */
/**
 * THE FRAME'S MARKUP, beside the frame's stylesheet.
 *
 * The rosette, its ghost and the two steer pads are the pad ITSELF, and the
 * eleven lines below were byte-identical in both racers. `TC_FRAME_CSS`
 * immediately after this styles exactly these elements; having the package own
 * their paint while each game owns their ELEMENTS is the split that lets a
 * renamed class pass a typecheck and silently drop a whole layer of the pad —
 * which is the failure the browser probe exists for, and which nothing else
 * can see.
 *
 * WHAT IS NOT IN HERE, and the boundary is the point. The top rail's chip row
 * differs by a chip, the action cluster is entirely each game's, and the rotate
 * card names the game. A shared string that stopped mid-element — an opened
 * `div` in the package and its close in the game — would be the same "one byte
 * of difference drops a layer" trap wearing a shared name, so this ends on a
 * closed element and the caller concatenates from a fresh line.
 *
 * THE SEAMS ARE LOAD-BEARING: this opens with a newline and ends flush against
 * its last line, exactly as the CSS chunks do, so a caller writing
 * `TC_FRAME_MARKUP + \`\n<div …` reproduces the blank line that was always
 * between the two blocks.
 */
export const TC_FRAME_MARKUP = `
<div class="tc-safeprobe"></div>

<div class="tc-stick-zone">
  <div class="tc-stick-base"></div>
  <div class="tc-stick-knob"></div>
  <div class="tc-ghost"><i></i><b></b></div>
</div>

<div class="tc-pads">
  <div class="tc-btn tc-pad tc-pad-l" data-btn="left"><span>&#9664;</span></div>
  <div class="tc-btn tc-pad tc-pad-r" data-btn="right"><span>&#9654;</span></div>
</div>
`;

export const TC_FRAME_CSS = `
.tc-root {
  position: fixed; inset: 0; z-index: 20;
  pointer-events: none; touch-action: none;
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
  font: 700 3.1vmin/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.06em;
}

/* env() cannot be read from JS. This carries the four insets as padding so
   getComputedStyle reports them resolved; it is 0x0 and never painted. */
.tc-safeprobe {
  position: absolute; left: 0; top: 0; width: 0; height: 0; visibility: hidden;
  padding-top: env(safe-area-inset-top, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
}

/* The stick zone is a hit area only; the visuals are positioned absolutely
   from JS at the thumb, so this stays empty until a touch lands. */
.tc-stick-zone {
  position: absolute;
  top: env(safe-area-inset-top, 0px);
  bottom: env(safe-area-inset-bottom, 0px);
  left: env(safe-area-inset-left, 0px);
  right: 50%;
}
html[data-touch-hand="left"] .tc-stick-zone {
  left: 50%;
  right: env(safe-area-inset-right, 0px);
}
.tc-stick-base, .tc-stick-knob {
  position: fixed; top: 0; left: 0; border-radius: 50%;
  opacity: 0; transition: opacity 120ms ease;
  will-change: transform, opacity;
}
.tc-stick-base {
  --rim: .42;
  background: radial-gradient(circle at 50% 45%, rgba(255,255,255,.10), rgba(8,14,26,.30) 70%);
  border: 2px solid rgba(255,255,255,var(--rim));
  box-shadow: 0 4px 22px rgba(0,0,0,.45), inset 0 0 20px rgba(255,255,255,.07);
}
.tc-stick-knob {
  background: radial-gradient(circle at 40% 35%, #fff, #ffd98a 55%, #f0a93c 100%);
  border: 2px solid rgba(255,255,255,.85);
  box-shadow: 0 6px 18px rgba(0,0,0,.5), 0 0 22px rgba(255,190,90,.55);
}
.tc-stick-zone.live .tc-stick-base { opacity: .78; }
.tc-stick-zone.live .tc-stick-knob { opacity: 1; }
/* The fixed scheme draws its rosette at rest, which is the entire difference a
   player can see between it and the floating one. */
.tc-stick-zone.rosette .tc-stick-base { opacity: .34; }
.tc-stick-zone.rosette .tc-stick-knob { opacity: .55; }
.tc-stick-zone.rosette.live .tc-stick-base { opacity: .78; }
.tc-stick-zone.rosette.live .tc-stick-knob { opacity: 1; }

/* FIRST RUN ONLY. A breathing ghost at the canonical thumb rest point, so a
   player who has never seen this game has visual evidence a steering control
   exists before they have touched anything. No words. Vanishes permanently on
   the first touch anywhere. */
.tc-ghost {
  position: fixed; left: 0; top: 0; opacity: 0; pointer-events: none;
  width: var(--ghost-d, 110px); height: var(--ghost-d, 110px);
  transition: opacity .35s ease;
}
.tc-ghost.on { opacity: 1; animation: tc-breathe 2.4s ease-in-out infinite; }
.tc-ghost i, .tc-ghost b {
  position: absolute; border-radius: 50%; left: 50%; top: 50%;
}
.tc-ghost i {
  width: 100%; height: 100%; transform: translate(-50%, -50%);
  border: 2px dashed rgba(255,255,255,.42);
}
.tc-ghost b {
  width: 42%; height: 42%;
  background: radial-gradient(circle at 40% 35%, rgba(255,255,255,.9), rgba(240,169,60,.75));
  animation: tc-sweep 2.4s ease-in-out infinite;
}
@keyframes tc-breathe { 0%,100% { opacity: .40; } 50% { opacity: .85; } }
@keyframes tc-sweep {
  0%,100% { transform: translate(-140%, -50%); }
  50%     { transform: translate(40%, -50%); }
}

/* Two words, maximum, printed on the control they refer to. */
.tc-coach {
  position: fixed; left: 0; top: 0; opacity: 0; pointer-events: none;
  padding: .55em .9em; border-radius: 999px; white-space: nowrap;
  font-size: clamp(13px, 2.6vmin, 20px); letter-spacing: .16em;
  color: #10202f; background: linear-gradient(180deg, #ffe6a8, #f2b445);
  box-shadow: 0 4px 16px rgba(0,0,0,.5);
  transition: opacity .2s ease;
}
.tc-coach.on { opacity: .96; animation: tc-breathe 1.6s ease-in-out infinite; }

/* The two steering pads of the button scheme.
   ANCHORING LIVES IN THE BASE RULE and only display is toggled. When the
   position was inside the scheme rule instead, the live-preview rule at the
   foot of this file — two attribute selectors, so higher specificity — revealed
   an UNPOSITIONED pads box at 0,0 across the top-left of the controls screen
   for every other scheme. Found by looking at a screenshot, which is the one
   class of defect a screenshot is good for. */
.tc-pads {
  display: none; position: absolute; align-items: flex-end;
  left: calc(env(safe-area-inset-left, 0px) + 24px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
}
html[data-touch-hand="left"] .tc-pads {
  left: auto; right: calc(env(safe-area-inset-right, 0px) + 24px);
}
html[data-touch-scheme="buttons"] .tc-pads { display: flex; }
/* Specificity, deliberately: the generic .tc-btn rule below sets
   position: absolute and comes later in this sheet, which stacked both pads at
   the same auto position — two buttons, one visible, and the left one dead. */
.tc-pads .tc-pad { position: relative; display: grid; }
.tc-pads .tc-pad span { font-size: clamp(20px, 3.6vmin, 34px); }
.tc-pad-r { margin-left: var(--pad-gap, 12px); }


.tc-top {
  position: absolute; display: flex; gap: 10px; align-items: center;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  left: calc(env(safe-area-inset-left, 0px) + 26vmin);
}
/* The top rail deliberately does NOT mirror. See the matching note in ui.css:
   the HUD keeps its race timer top-right in both modes, so a mirrored chip rail
   lands on top of it. Mirror what the thumbs touch, not what they read. */
.tc-chip {
  pointer-events: auto; padding: 0 14px;
  display: grid; place-items: center;
  border-radius: 999px; color: #cfd8e6;
  background: rgba(10,16,28,.55); border: 1.5px solid rgba(255,255,255,.20);
  backdrop-filter: blur(6px); font-size: clamp(12px, 2.2vmin, 17px);
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
.tc-chip.on {
  color: #10202f; text-shadow: none;
  background: linear-gradient(180deg, #ffe6a8, #f2b445);
  border-color: rgba(255,255,255,.6);
}
.tc-pause { letter-spacing: .14em; }

.tc-cluster {
  position: absolute;
  right: calc(env(safe-area-inset-right, 0px) + 24px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
}
html[data-touch-hand="left"] .tc-cluster {
  right: auto;
  left: calc(env(safe-area-inset-left, 0px) + 24px);
  transform: scaleX(-1);
}
/* Mirroring the BOX flips the glyphs with it, so the labels are un-flipped
   again. This is the whole left-handed implementation: one transform on one
   container, and not one sign anywhere. */
html[data-touch-hand="left"] .tc-btn > span,
html[data-touch-hand="left"] .tc-btn > svg { transform: scaleX(-1); }

.tc-btn {
  position: absolute; pointer-events: auto;
  display: grid; place-items: center; border-radius: 50%;
  color: #f4f7fb; text-align: center;
  background: radial-gradient(circle at 50% 38%, rgba(255,255,255,.16), rgba(9,15,27,.52) 72%);
  border: 2px solid rgba(255,255,255,.34);
  box-shadow: 0 5px 18px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter: blur(5px);
  text-shadow: 0 1px 3px rgba(0,0,0,.75);
  /* 90ms was long enough that a fast tap released before the press state had
     finished animating in, so a stab at DRIFT looked like it had missed even
     when it had not. Feedback on a control must not lag the control. */
  transition: transform 55ms ease, box-shadow 55ms ease, background 55ms ease;
}
.tc-btn span { font-size: clamp(10px, 2.2vmin, 17px); }
.tc-btn svg { width: 52%; height: 52%; }
.tc-btn.down { transform: scale(.92); }
html[data-touch-hand="left"] .tc-btn.down { transform: scale(.92); }
`;

/**
 * The charge-tier flare TRIGGER — the opacity rule, the reason there is one
 * keyframe NAME per tier, and the three `animation:` declarations.
 *
 * The keyframe BODIES stay in the games and that split is the point: what the
 * flare does to a round halo and to a clipped capsule fill is different, and
 * why re-matching an attribute selector does not restart an animation is the
 * same lesson in both. The comment is the expensive half.
 */
export const TC_TIER_FLARE_CSS = `
html[data-drift-tier] .tc-halo,
html[data-drift-tier] .tc-halo-rungs { opacity: 1; }
/* The flare starts AT PEAK on frame zero — the lesson that a cue must
   land on the trigger frame, not two frames later.

   ONE KEYFRAME NAME PER TIER, AND THAT IS THE WHOLE POINT. This block used to
   be three selectors sharing 'animation: tc-flare', with a comment claiming
   "re-matching the attribute selector restarts the animation". It does not.
   Changing data-drift-tier from "1" to "2" changes which SELECTOR matches, but
   the computed animation-name is identical, so the browser treats it as the
   same still-running (or already-finished) animation and never restarts it —
   'getAnimations()' comes back empty at tiers 2 and 3. The flare fired exactly
   once per drift, on the null -> 1 edge, and tier 3 — the one worth the most
   speed and the one you most need to feel without looking — was silent.
   Nothing caught it because the rung COUNT still moves, so the ladder stayed
   readable and only the punctuation was missing.

   Distinct names restart it, because animation-name actually changed. Having
   paid for three keyframes, they escalate rather than repeat: tier 3 is the
   payout, so it flares brightest and widest. */
html[data-drift-tier="1"] .tc-halo { animation: tc-flare1 .44s ease-out; }
html[data-drift-tier="2"] .tc-halo { animation: tc-flare2 .44s ease-out; }
html[data-drift-tier="3"] .tc-halo { animation: tc-flare3 .52s ease-out; }`;

/**
 * The game's own HUD, reflowed for thumbs: the speedometer anchored to the
 * cluster, the "left is readouts, right is controls" rule that followed from
 * play, and the short-viewport media queries.
 *
 * It reaches into `.kr-*` selectors, which both games still use — the space
 * racer is a fork and kept the prefix — so this is one stylesheet acting on one set
 * of class names, not a package guessing at a game's markup.
 */
export const TC_HUD_REFLOW_CSS = `

/* ---- HUD reflow for thumbs ----------------------------------------------- */
html[data-touch] .kr-speed {
  right: 47vmin;
  transform: scale(.82);   /* transform-origin is already 100% 100% */
}

/* ---- LEFT IS READOUTS, RIGHT IS CONTROLS -----------------------------------
   The rule above anchors the speedometer to the action cluster rather than to
   an edge, and on a phone that is not a corner: 47vmin of a 390px-tall
   landscape screen is 183px, which on an 844px-wide panel puts the dial at
   about 70% across — floating in open space between the cluster and the middle
   of the frame, directly in the sightline down the road. Reported from play as
   "the speedometer is basically in the middle of the screen", and it is.

   Rather than nudge it, the bottom rail gets a rule: every glanceable readout
   lives on the LEFT, every control on the RIGHT. So the dial goes next to the
   item box on the left rail, the right half belongs entirely to the thumb, and
   the centre of the screen — the part you actually drive by looking at — is
   left empty.

   Only on a genuinely short viewport. A tablet in landscape has the height for
   the original layout and the corners are much further apart. */
@media (max-height: 520px) {
  /* RECONCILED with the controls layout, which landed after this block.
     Two things about it are not cosmetic:

     1. Set the TOKEN, not 'transform'. ui.css now carries
        'html[data-touch] .kr .kr-speed { transform: scale(var(--speed-s)) }',
        which is (0,3,1); this rule was (0,2,1), so its 'scale(.74)' was dead
        on arrival and the dial silently stayed at .82. Writing --speed-s is
        also the only version that survives the mini-turbo tier pop, which
        animates 'transform' and beats any author rule — see the token's
        comment in ui.css.
     2. Write the corner per HAND. ui.css's left-handed rule is (0,4,1) and
        would win 'right' while this one kept 'left', leaving both set on an
        element that has a width — which resolves to 'left' in LTR and parks
        the dial under the mirrored cluster.

     The corner itself changed too: the item plate used to live bottom-left and
     this rule sat the dial flush beside it. The controls round moved that
     plate into the TOP rail (measured 100% occluded by the thumb once
     auto-drift holds DRIFT for the whole lap), so the bottom-left corner is
     free and the dial simply takes it. */
  html[data-touch] .kr .kr-speed {
    --speed-s: .74;
    left: 0;
    right: auto;
    transform-origin: 0 100%;
  }
  /* Left-handed mirrors the rail rule, not just the widget: the cluster is on
     the left, so the readouts go right. */
  html[data-touch][data-touch-hand="left"] .kr .kr-speed {
    left: auto;
    right: 0;
    transform-origin: 100% 100%;
  }
  /* The rail is clamp(84px, 14.5vmin, 208px), and at 390px of height 14.5vmin
     is 56px — so it pins to its 84px FLOOR and eats 22% of the screen height
     for two readouts. Same clamp-floor problem as the menus.
     (No backticks anywhere in this stylesheet: it is a template literal.) */
  html[data-touch] .kr { --rail: 68px; --rail-top: 46px; }

  /* The position plate is the largest single object left, and it sits at
     left-centre — across the road, at eye height. Its width is
     clamp(176px, 24vmin, 348px), and 24vmin here is 94px, so it pins to the
     176px floor: a fifth of the screen width for a placing and one rival's
     gap. Scaled rather than re-laid-out, because the plate is deliberately a
     FIXED width (see ui.css) so the delta changing between "+1.08" and
     "+12.48" cannot make it resize sixty times a second, and re-deriving that
     width per breakpoint would just be the same decision made twice.
     The existing translateY(-50%) has to survive: it is what centres it. */
  html[data-touch] .kr-pos {
    transform: translateY(-50%) scale(.68);
    transform-origin: 0 50%;
  }
  /* The plate itself moves to the right edge in left-handed mode (ui.css), so
     the origin it shrinks toward has to move with it or it scales away from
     its own anchored edge and leaves a growing gap. */
  html[data-touch][data-touch-hand="left"] .kr .kr-pos {
    transform-origin: 100% 50%;
  }
}
/* DEAD RULE REMOVED. This block repositioned '.kr-board', the
   eight-row standings tower that used to sit right-centre. A later change deleted
   that element, so this selector had matched nothing since. */
`;

/** The portrait card. Portrait is unplayable at this HUD density in both games. */
export const TC_ROTATE_CARD_CSS = `
/* Portrait is unplayable at this HUD density; say so rather than shipping a
   squashed frame the player has to guess at. */
.tc-rotate { display: none; }
@media (orientation: portrait) {
  .tc-rotate {
    display: grid; place-items: center; position: absolute; inset: 0;
    background: rgba(5,8,16,.92); color: #f0f4fa; pointer-events: auto;
    text-align: center; font-size: 4.2vmin; line-height: 1.55; padding: 8vmin;
  }
  .tc-rotate b { font-size: 5.4vmin; letter-spacing: .04em; }
  .tc-stick-zone, .tc-cluster, .tc-top, .tc-pads, .tc-coach { display: none; }
}
`;

/**
 * The pad must not shadow a menu — and must come back for the
 * controls screen's live preview. The steering source only, never the action
 * cluster, so a preview cannot fire an item or open the pause menu by mis-tap.
 */
export const TC_MENU_HIDE_CSS = `
/* ---- DEFECT: the pad must not shadow a menu ---------------------------
   .tc-root is z-index 20 over #ui's 10, and NOTHING used to hide it. Menus'
   tap-anywhere-confirm listener is on .kr — a subtree the event never enters,
   because .tc-root is a SIBLING on document.body — so roughly 29% of the
   bottom-right quadrant of every blocking screen silently swallowed "TAP TO
   START", and the rightmost roster card on the select screen sat under DRIFT.
   This is the same class as the pause menu that permanently ended your race.

   Hidden three ways deliberately. display:none is what the touch test
   asserts and is what actually removes the boxes from hit testing;
   visibility and pointer-events on the root cover anything added to this
   layer later that forgets to join the list.
   (No backticks in this comment: the whole stylesheet is a template literal.) */
html[data-menu] .tc-root { visibility: hidden; pointer-events: none; }
html[data-menu] .tc-stick-zone,
html[data-menu] .tc-cluster,
html[data-menu] .tc-pads,
html[data-menu] .tc-coach,
html[data-menu] .tc-top { display: none; }

/* ...except while the controls screen is asking the player to TRY a scheme.
   The steering source only — never the action cluster, so a live preview
   cannot fire an item or open the pause menu by mis-tap. Two attribute
   selectors, so this wins over the single-attribute rules above. */
html[data-menu][data-touch-preview] .tc-root { visibility: visible; }
html[data-menu][data-touch-preview][data-touch-scheme="floating"] .tc-stick-zone,
html[data-menu][data-touch-preview][data-touch-scheme="fixed"] .tc-stick-zone { display: block; }
html[data-menu][data-touch-preview][data-touch-scheme="buttons"] .tc-pads { display: flex; }`;
