/**
 * ============================================================================
 *  @homie-rocks/arcade/Surface.ts — the page a guest's phone becomes.
 * ============================================================================
 *
 *  One pure function: a role in, a self-contained HTML document out. No DOM is
 *  touched here and nothing is fetched, because this runs in the GAME's tab —
 *  the screen's — and the document it produces is handed to the host via
 *  `phone.show`, which serves it from that seat's own origin.
 *
 *  ## THE ONE THING THAT REACHES A PACKAGE IS `/answer`, AND IT COST AN HOUR
 *
 *  MEASURED 2026-08-21 in a Homie host's phone surface:
 *
 *    · `/press` pushes onto a poll queue, logs, and wakes the host's agent. It
 *      does **not** call the surface's `onInput`.
 *    · `/answer` is the only route that calls it, and `onInput` is the closure
 *      the host's party bridge turns into `{ t: 'answer', seat, id, value }`
 *      on the package stream.
 *
 *  So the documented, ergonomic, first-byte-available path — `data-press="x"`
 *  and `homie.press(id)`, which the injected stub wires up before any module
 *  loads — **is a dead end for a package.** A controller built on it produces
 *  a log line and an agent wake and the game never hears a thing. It looks
 *  completely fine from the phone: the button depresses, the beacon returns
 *  204. That is why every control below posts `/answer` and none of them
 *  carries a `data-press` attribute.
 *
 *  ## WHICH MEANS EVERY VALUE IS A STRING, CAPPED AT 512 BYTES
 *
 *  `/answer` reads `typeof body.value === 'string' ? body.value.slice(0, 512)`.
 *  A stick is therefore sent as "x,y" and parsed back by `Table.ts`. That is
 *  not an encoding somebody preferred; it is the only encoding the seam
 *  accepts, and inventing a JSON payload here would have been silently
 *  truncated to a string nobody parses.
 *
 *  ## NO BACKTICKS ANYWHERE INSIDE THE TEMPLATE LITERALS BELOW
 *
 *  A party-game runtime once shipped a CSS comment containing a backticked
 *  identifier — the comment style used everywhere else — which CLOSED the
 *  template literal mid-document. The module stopped having exports at all,
 *  no phone in any game could render a card, and `node --check` did not even
 *  agree it was broken. Prose about this file's own code goes in THIS header,
 *  where it is outside every literal. Inside them: no backticks, and no `${`
 *  that is not a real substitution.
 *
 *  ## WHAT THIS PAGE DOES NOT DO
 *
 *  It does not style itself off a host palette, does not animate, and does
 *  not show a roster. The host's pad bridge draws that line — *"the author
 *  writes the page; this is the set of verbs it can use"* — and a controller
 *  that painted a look would be the platform choosing a game's art direction
 *  for it. Every colour below is a CSS custom property the caller supplies.
 *  The intent was NO fallback, exactly as `@homie-rocks/input/ControlsSheet`
 *  does: a token a game forgets renders visibly broken rather than quietly
 *  inheriting another game's livery. The note above the stylesheet says why
 *  the package ships a default for each anyway.
 * ============================================================================
 */

import type { RoleSpec } from './Roles.ts';

/**
 * How often a moving stick posts, milliseconds.
 *
 * 50 ms — twenty a second. NOT a frame rate and deliberately not 16: this is
 * one HTTP POST per sample per phone, and at 32 phones 60 Hz would be 1,920
 * requests a second at the host before anybody has done anything
 * interesting. Twenty a second is inside the ~100 ms a person notices on a
 * steering input and is what the value is INTERPOLATED from — `Pad` holds the
 * last value rather than springing back, so the frames between two samples
 * read the stick that is actually being held.
 *
 * A transport number, not an art-direction one, which is why it is a constant
 * here rather than a required field on a game's spec. The rule about required
 * fields is about values a game would want DIFFERENT; two games wanting
 * different packet rates on the same LAN is a symptom, not a feature.
 */
export const SAMPLE_MS = 50;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The controller document for one role.
 *
 * `title` is what the guest reads at the top — the role's label, or whatever
 * the table decided to call a person who is waiting. It is escaped, because a
 * label can carry a guest-typed name, and everything a guest types is data to
 * display, never instructions.
 */
export function controllerPage(role: RoleSpec, title: string): string {
  const systemIds = new Set(['start', 'ready', 'pause', 'menu', 'again']);
  const system = role.controls.filter(c => c.kind === 'button' && systemIds.has(c.id));
  const game = role.controls.filter(c => !system.includes(c));
  const sticks = game.filter(c => c.kind === 'stick').length;
  const buttons = game.filter(c => c.kind === 'button').length;
  const controls = game.map(renderControl).join('\n      ');
  const empty = role.controls.length === 0
    ? '<p class="hm-wait">Nothing to do yet. Hold on to this.</p>'
    : '';

  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">',
    '<title>' + esc(title) + '</title>',
    '<style>' + STYLE + '</style>',
    '<main class="hm-pad">',
    '  <h1 class="hm-role">' + esc(title) + '</h1>',
    '  <div class="hm-system">' + system.map(renderControl).join('') + '</div>',
    '  <div class="hm-controls" data-sticks="' + sticks + '" data-actions="' + buttons + '" style="--hm-pad-rows:' + Math.max(1, buttons) + ';--hm-pad-landscape-rows:' + Math.max(1, Math.ceil(buttons / 2)) + '">',
    '      ' + controls,
    '  </div>',
    '  ' + empty,
    '</main>',
    '<script>' + script() + '</script>',
    '',
  ].join('\n');
}

function renderControl(c: RoleSpec['controls'][number]): string {
  const id = esc(c.id);
  const label = esc(c.label);
  if (c.kind === 'stick') {
    return '<div class="hm-stick" data-hm-stick="' + id + '"><span class="hm-cap">'
      + label + '</span><i class="hm-knob"></i></div>';
  }
  if (c.kind === 'slider') {
    return '<label class="hm-slider"><span class="hm-cap">' + label
      + '</span><input type="range" min="-1" max="1" step="0.01" value="0" data-hm-slider="'
      + id + '"></label>';
  }
  return '<button class="hm-button" type="button" data-hm-button="' + id + '">' + label + '</button>';
}

/*
 * The stylesheet. Read the header before editing: no backticks in here, ever.
 *
 * Every colour is a --hm-pad-*, AND THE PACKAGE NOW SHIPS A DEFAULT FOR EACH.
 * A game still overrides any of them by setting the variable; that is what a
 * custom property is for and the override costs one line.
 *
 * ## Why, when this file deliberately shipped none
 *
 * The header above says the intent: a token a game forgets should render
 * VISIBLY BROKEN rather than quietly inherit another game's livery. That is a
 * real argument and it is the required-field rule — no optionals, no
 * defaults.
 *
 * IT IS RIGHT FOR TYPESCRIPT AND WRONG FOR CSS, and the difference is what
 * shipped. A required TypeScript field a game forgets does not compile. An
 * undefined custom property does not fail at all: background: var(--hm-pad-bg)
 * with nothing defining it is invalid at computed-value time, so it falls back
 * to the property's INITIAL value -- transparent -- and color falls back to
 * black. Nothing throws, nothing warns, no typechecker can see it.
 *
 * So all five shipped undefined, NO GAME EVER DEFINED ONE, and every phone
 * controller in all eight games rendered black-on-white with the layout and
 * fonts perfect, because those declarations contain no var(). It was found by
 * looking at a real phone.
 *
 * "Visibly broken" only works as a signal if somebody looks at a phone before
 * it ships. Nobody did, in eight games, because every gate asserted OUTCOMES
 * about presses rather than pixels -- correct markup, correct document, origin
 * served it, CSP allowed it, every probe green. A screenshot from a real phone
 * is what found it: anything under a thumb has to be checked on a real device.
 *
 * The intent is kept and given the gate it was missing: a livery probe FAILS
 * on any var() this file uses without a definition, and REPORTS which games
 * have not set a livery of their own. A list somebody can act on, instead of a
 * broken page in a guest's hand.
 *
 * The 48-point minimum on anything a thumb lands on is NOT the caller's and has
 * no variable: an accessibility floor the phone surface already enforces on its
 * own controls, and a game is not entitled to a smaller one.
 */
const STYLE = [
  ":root{--hm-pad-bg:#050a10;--hm-pad-ink:#f4efe6;--hm-pad-well:#111e29;--hm-pad-edge:#344754;--hm-pad-knob:#67e8cf}",
  "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}",
  "html,body{margin:0;height:100%;overscroll-behavior:none;touch-action:none;background:var(--hm-pad-bg);color:var(--hm-pad-ink);font:600 16px/1.2 system-ui,-apple-system,sans-serif}",
  ".hm-pad{height:100%;display:flex;flex-direction:column;gap:14px;padding:calc(76px + env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) calc(22px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));background:radial-gradient(ellipse at 15% 0%,#67e8cf16,transparent 60%),radial-gradient(ellipse at 90% 100%,#5d7cc418,transparent 65%)}",
  ".hm-role{margin:0;font-size:14px;line-height:1.4;letter-spacing:.04em;font-weight:650;flex:none;color:var(--hm-pad-ink)}",
  ".hm-system{display:flex;gap:10px;flex-wrap:wrap;flex:none}",
  ".hm-system:empty{display:none}",
  ".hm-system .hm-button{flex:1;min-height:48px;border-radius:14px;padding:10px 14px;font-size:14px;background:var(--hm-pad-ink);color:var(--hm-pad-bg);box-shadow:0 3px 0 #0008,inset 0 1px 0 #ffffff80}",
  ".hm-controls{flex:1;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(48px,1fr);gap:14px;align-items:stretch}",
  ".hm-controls[data-sticks=\"1\"]>.hm-stick{grid-column:1;grid-row:1 / span var(--hm-pad-rows,1)}",
  ".hm-controls[data-sticks=\"1\"]>.hm-button{grid-column:2}",
  ".hm-controls[data-sticks=\"2\"]{grid-template-rows:minmax(120px,1.5fr);grid-auto-rows:minmax(48px,1fr)}",
  ".hm-stick{position:relative;min-width:0;min-height:120px;border-radius:30px;border:1px solid var(--hm-pad-edge);touch-action:none;overflow:hidden;background:radial-gradient(circle at center,transparent 29%,#ffffff12 30%,transparent 31%,transparent 43%,#ffffff0b 44%,transparent 45%),linear-gradient(145deg,#ffffff09,transparent 65%),var(--hm-pad-well);box-shadow:inset 0 10px 24px #0005,0 1px 0 #ffffff24}",
  ".hm-stick::after{content:\"\";position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:#ffffff30;pointer-events:none}",
  ".hm-knob{position:absolute;z-index:1;left:50%;top:50%;width:68px;height:68px;margin:-34px;border-radius:50%;background:radial-gradient(circle at 35% 25%,#ffffff60,transparent 65%),var(--hm-pad-knob);border:1px solid #ffffff70;box-shadow:0 6px 0 #0008,0 13px 22px #0007,inset 0 2px 0 #ffffff70;pointer-events:none}",
  ".hm-cap{position:absolute;left:16px;top:14px;font-size:12px;line-height:1.3;letter-spacing:.07em;text-transform:uppercase;opacity:.8;pointer-events:none;max-width:calc(100% - 32px)}",
  ".hm-button{min-width:0;min-height:48px;border:1px solid var(--hm-pad-edge);border-radius:24px;padding:14px 10px;background:linear-gradient(145deg,#ffffff14,transparent 65%),var(--hm-pad-well);color:var(--hm-pad-ink);font:750 18px/1.2 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere;box-shadow:0 5px 0 #0008,0 10px 18px #0005,inset 0 1px 0 #ffffff35;touch-action:none;transition:transform 60ms,box-shadow 60ms,background 60ms}",
  ".hm-controls>.hm-button:first-of-type{border-color:color-mix(in srgb,var(--hm-pad-knob) 65%,var(--hm-pad-edge));background:linear-gradient(145deg,#ffffff15,transparent 65%),color-mix(in srgb,var(--hm-pad-knob) 18%,var(--hm-pad-well))}",
  ".hm-button[data-hm-down=\"1\"]{transform:translateY(4px);box-shadow:0 1px 0 #0008,inset 0 2px 6px #0004;background:var(--hm-pad-knob);color:var(--hm-pad-bg)}",
  ".hm-button:focus-visible,.hm-slider input:focus-visible{outline:3px solid var(--hm-pad-knob);outline-offset:3px}",
  ".hm-slider{position:relative;grid-column:1 / -1;min-height:76px;padding:32px 16px 4px;border-radius:20px;background:var(--hm-pad-well);border:1px solid var(--hm-pad-edge);box-shadow:inset 0 3px 9px #0004}",
  ".hm-slider input{width:100%;min-height:40px;accent-color:var(--hm-pad-knob)}",
  ".hm-wait{margin:auto;opacity:.75;text-align:center;line-height:1.5}",
  "@media(orientation:landscape) and (max-height:600px){.hm-pad{padding-top:calc(68px + env(safe-area-inset-top));padding-bottom:calc(12px + env(safe-area-inset-bottom));gap:8px}.hm-role{font-size:12px}.hm-system{position:absolute;right:max(18px,env(safe-area-inset-right));top:calc(65px + env(safe-area-inset-top))}.hm-system .hm-button{min-height:44px;padding:8px 14px;font-size:13px}.hm-controls{gap:10px;grid-template-columns:repeat(4,minmax(0,1fr))}.hm-controls[data-sticks=\"1\"]{grid-template-columns:minmax(160px,1.6fr) repeat(2,minmax(0,1fr))}.hm-controls[data-sticks=\"1\"]>.hm-stick{grid-row:1 / span var(--hm-pad-landscape-rows,1)}.hm-controls[data-sticks=\"1\"]>.hm-button{grid-column:auto}.hm-controls[data-sticks=\"2\"]{grid-template-rows:repeat(var(--hm-pad-landscape-rows,1),minmax(48px,1fr))}.hm-controls[data-sticks=\"2\"]>.hm-stick{grid-row:1 / span var(--hm-pad-landscape-rows,1)}.hm-controls[data-sticks=\"2\"]>.hm-stick:nth-child(2){grid-column:4}.hm-controls[data-sticks=\"2\"]>.hm-button{grid-column:auto}.hm-stick{min-height:100px}.hm-button{font-size:16px;border-radius:20px;padding:8px}.hm-cap{font-size:11px}}",
  "@media(max-width:360px){.hm-pad{gap:10px;padding-inline:12px}.hm-controls{gap:10px}.hm-button{font-size:15px;padding:8px}.hm-knob{width:58px;height:58px;margin:-29px}.hm-cap{left:12px;top:12px;font-size:11px}.hm-system .hm-button{font-size:13px}}",
  "@media(orientation:landscape) and (max-height:600px){.hm-pad:has(.hm-system:not(:empty)) .hm-role{min-height:44px;padding-right:45%;display:flex;align-items:center}.hm-controls:has(.hm-slider){grid-template-rows:repeat(var(--hm-pad-landscape-rows,1),minmax(48px,1fr)) 66px}.hm-controls>.hm-slider{grid-row:-2 / -1;min-height:66px;padding-top:24px}.hm-slider .hm-cap{top:8px}}",
  "@media(orientation:portrait){.hm-controls{max-height:520px;margin-top:auto}.hm-controls:not(:has(.hm-stick)):not(:has(.hm-slider)){max-height:420px}}",
  ".hm-hint{flex:none;margin:0;color:var(--hm-pad-ink);opacity:.78;font-size:12px;line-height:1.5;text-align:center}",
  ".hm-role{font-size:18px;letter-spacing:-.02em;font-weight:750}",
  ".hm-controls{position:relative;padding:18px;border:1px solid var(--hm-pad-edge);border-radius:38px;background:linear-gradient(145deg,#ffffff06,transparent 60%),#08121a;box-shadow:inset 0 1px 0 #ffffff16,0 14px 36px #0003;align-items:center}",
  ".hm-controls>.hm-button{justify-self:center;align-self:center;width:min(100%,112px);height:112px;max-height:100%;min-height:48px;border-radius:50%;padding:12px 8px;font-size:16px;aspect-ratio:1;background:radial-gradient(circle at 35% 15%,#ffffff22,transparent 70%),var(--hm-pad-well);border:2px solid var(--hm-pad-edge);box-shadow:0 7px 0 #03080d,0 10px 20px #0008,inset 0 2px 0 #ffffff35}",
  ".hm-controls>.hm-button:first-of-type{border-color:var(--hm-pad-knob);background:radial-gradient(circle at 35% 15%,#ffffff35,transparent 70%),color-mix(in srgb,var(--hm-pad-knob) 22%,var(--hm-pad-well))}",
  ".hm-stick{height:100%;min-height:110px;border:0;border-radius:24px;background:none;box-shadow:none;overflow:visible}",
  ".hm-stick::before{content:\"\";position:absolute;width:min(150px,100%);aspect-ratio:1;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;border:2px solid var(--hm-pad-edge);background:repeating-radial-gradient(circle at center,#ffffff05 0 3px,transparent 4px 7px),#0b1720;box-shadow:inset 0 7px 20px #0009,0 1px 0 #ffffff20;pointer-events:none}",
  ".hm-stick .hm-cap{left:0;top:calc(50% + 92px);width:100%;max-width:none;text-align:center;font-size:11px;letter-spacing:.12em;color:var(--hm-pad-ink)}",
  ".hm-knob{width:76px;height:76px;margin:-38px;background:radial-gradient(circle at 40% 28%,#ffffff20,transparent 70%),#263c47;border:2px solid var(--hm-pad-knob);box-shadow:0 7px 0 #02070b,0 13px 20px #000a,inset 0 2px 0 #ffffff30}",
  "@media(orientation:portrait){.hm-controls{max-height:none;margin-top:0;grid-auto-rows:minmax(48px,1fr)}.hm-controls:not(:has(.hm-stick)):not(:has(.hm-slider)){max-height:none}.hm-controls[data-sticks=\"1\"]>.hm-button{height:min(100%,112px)}.hm-controls[data-sticks=\"2\"]{grid-template-rows:minmax(160px,1.5fr)}.hm-controls[data-sticks=\"2\"] .hm-stick .hm-cap{top:calc(50% + 74px)}.hm-controls[data-sticks=\"2\"] .hm-stick::before{width:min(132px,100%)}.hm-controls[data-sticks=\"2\"]>.hm-button{height:min(100%,96px);width:min(100%,96px)}}",
  "@media(orientation:landscape) and (max-height:600px){.hm-role{font-size:14px}.hm-controls{padding:12px 18px;border-radius:30px;gap:10px}.hm-controls>.hm-button{width:min(100%,98px);height:100%;max-height:98px;min-height:44px;border-radius:24px;font-size:14px;padding:6px;aspect-ratio:auto}.hm-stick::before{width:min(132px,90%)}.hm-stick .hm-cap{top:calc(50% + 74px);font-size:10px}.hm-knob{width:66px;height:66px;margin:-33px}.hm-controls:has(.hm-slider) .hm-stick::before{width:100px}.hm-controls:has(.hm-slider) .hm-stick .hm-cap{top:auto;bottom:0}}",
  "@media(max-width:360px){.hm-controls{padding:12px;gap:10px;border-radius:30px}.hm-controls>.hm-button{width:min(100%,88px);max-height:88px;font-size:14px}.hm-stick::before{width:min(120px,100%)}.hm-knob{width:62px;height:62px;margin:-31px}.hm-stick .hm-cap{top:calc(50% + 76px)}}",
  "@media(orientation:portrait){.hm-controls[data-sticks=\"1\"][data-actions=\"3\"]{grid-template-rows:repeat(3,minmax(48px,112px));align-content:center}.hm-controls[data-sticks=\"1\"][data-actions=\"2\"]{grid-template-rows:repeat(2,minmax(48px,112px));align-content:center}.hm-controls[data-sticks=\"1\"]>.hm-button:not(:first-of-type){width:min(100%,94px);height:min(100%,94px)}}",
  ".hm-controls:not(:has(.hm-stick,.hm-button,.hm-slider)){display:none}",
  "@media(prefers-reduced-motion:reduce){.hm-button{transition:none}}",
].join('');

/*
 * The page's own script.
 *
 * Written as a plain string with no backticks and no module syntax, because it
 * is inlined into a document that `phone.show` serves from a seat origin — and
 * that origin's CSP is the host's, not ours. It uses only fetch with
 * keepalive, which is the one send that survives the page being backgrounded
 * mid-gesture: sendBeacon cannot set a content type the /answer parser reads
 * without a Blob dance, and this is the same shape the injected stub already
 * falls back to.
 *
 * IT DOES NOT RETRY. A dropped stick sample is superseded by the next one 50 ms
 * later, and a dropped button is the one case where a retry would be wrong:
 * re-sending a press that the host already took is a double hit on a drum.
 */
function script(): string {
  return [
    '(function(){',
    'var last={},releases=[];',
    'function post(id,v){',
    '  if(last[id]===v)return; last[id]=v;',
    '  if(window.homie&&typeof window.homie.answer==="function"){window.homie.answer(id,v);return;}',
    '  try{fetch("answer",{method:"POST",keepalive:true,',
    '    headers:{"content-type":"application/json"},',
    '    body:JSON.stringify({id:id,value:v})});}catch(e){}',
    '}',
    'var sticks=[].slice.call(document.querySelectorAll("[data-hm-stick]"));',
    'sticks.forEach(function(el){',
    '  var id=el.getAttribute("data-hm-stick"),knob=el.querySelector(".hm-knob");',
    '  var ptr=-1,ox=0,oy=0,x=0,y=0,dirty=false;',
    '  function set(nx,ny){x=nx;y=ny;dirty=true;',
    '    knob.style.transform="translate("+(x*46).toFixed(1)+"px,"+(y*46).toFixed(1)+"px)";}',
    '  el.addEventListener("pointerdown",function(e){',
    '    if(ptr>=0)return; ptr=e.pointerId; ox=e.clientX; oy=e.clientY;',
    '    el.setPointerCapture(ptr); e.preventDefault();},{passive:false});',
    '  el.addEventListener("pointermove",function(e){',
    '    if(e.pointerId!==ptr)return;',
    '    var r=el.getBoundingClientRect(),rad=Math.max(40,Math.min(r.width,r.height)*0.42);',
    '    var dx=(e.clientX-ox)/rad,dy=(e.clientY-oy)/rad,m=Math.hypot(dx,dy);',
    '    if(m>1){dx/=m;dy/=m;ox=e.clientX-dx*rad;oy=e.clientY-dy*rad;}',
    '    set(dx,dy); e.preventDefault();},{passive:false});',
    '  function up(e){if(e.pointerId!==ptr)return; ptr=-1; set(0,0);',
    '    post(id,"0,0");}',
    '  releases.push(function(){ptr=-1;set(0,0);post(id,"0,0");});',
    '  el.addEventListener("pointerup",up); el.addEventListener("pointercancel",up);',
    '  setInterval(function(){if(!dirty)return; dirty=false;',
    '    post(id,x.toFixed(3)+","+y.toFixed(3));}, ' + String(SAMPLE_MS) + ');',
    '});',
    'var buttons=[].slice.call(document.querySelectorAll("[data-hm-button]"));',
    'buttons.forEach(function(el){',
    '  var id=el.getAttribute("data-hm-button");',
    '  function down(e){el.setAttribute("data-hm-down","1");post(id,"down");e.preventDefault();}',
    '  function up(e){el.removeAttribute("data-hm-down");post(id,"up");e.preventDefault();}',
    '  el.addEventListener("pointerdown",down,{passive:false});',
    '  el.addEventListener("pointerup",up,{passive:false});',
    '  el.addEventListener("pointercancel",up,{passive:false});',
    '  el.addEventListener("pointerleave",up,{passive:false});',
    '  el.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!e.repeat)down(e);}});',
    '  el.addEventListener("keyup",function(e){if(e.key==="Enter"||e.key===" ")up(e);});',
    '  function release(){if(el.hasAttribute("data-hm-down")){el.removeAttribute("data-hm-down");post(id,"up");}}',
    '  releases.push(release);el.addEventListener("blur",release);',
    '});',
    'var sliders=[].slice.call(document.querySelectorAll("[data-hm-slider]"));',
    'sliders.forEach(function(el){',
    '  var id=el.getAttribute("data-hm-slider");',
    '  el.addEventListener("input",function(){post(id,String(el.value));});',
    '});',
    'function releaseAll(){releases.forEach(function(release){release();});}',
    'addEventListener("blur",releaseAll);addEventListener("pagehide",releaseAll);',
    'document.addEventListener("visibilitychange",function(){if(document.hidden)releaseAll();});',
    '})();',
  ].join('\n');
}
