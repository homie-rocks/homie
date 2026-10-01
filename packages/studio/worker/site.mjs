/**
 * The studio site's pages, in the studio's own look (site/SITE.md): the same sections as homie.rocks
 * (Home, Games, Music, Videos, Rooms, Posts, each shown only when the studio has something in it), an epic
 * landing for every game (a full-bleed hero from the game's own footage or art, the pitch, a big Play button
 * into a public room, phone / computer / TV, live rooms, how to play, credits, and "Make a game like this"),
 * posts with Atom and JSON feeds, and a "Made with Homie" footer. Plain HTML from the Worker; every word a
 * studio or a player wrote is escaped; the one script is /_homie/site.js.
 *
 * What a studio puts in site/ wins: a whole page (site/pages), a partial (site/partials), its tokens
 * (site/theme.json) and CSS (site/theme.css). The build gathers them into games.json and site/dist/_site/.
 */
import { qrSvg } from './qr.mjs';
import { STUDIO_VERSION_TAG } from './version.mjs';
import { licenseLabel, licenseOf, remixRow } from './license.mjs';

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/* ------------------------------------------------------------------ headers */

/**
 * Every generated page: never framed by another site (x-frame-options, and frame-ancestors for browsers that
 * read only CSP), scripts only from this site, and `no-transform` so an edge in front of a custom domain never
 * injects anything into it (a zone's Web Analytics beacon posts to a /cdn-cgi/rum a Worker does not serve).
 */
export const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
export const pageHeaders = (extra = {}) => ({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-frame-options': 'DENY',
  'content-security-policy': PAGE_CSP,
  'x-content-type-options': 'nosniff',
  // An origin, never a path: what another studio's stats need to count a visitor this site sent them.
  'referrer-policy': 'strict-origin-when-cross-origin',
  ...extra,
});

/* ------------------------------------------------------------------ icons */

const I = {
  games: '<rect x="2.5" y="6.5" width="19" height="11" rx="4"/><path d="M7 12h3M8.5 10.5v3"/><circle cx="16" cy="11" r="1"/><circle cx="18" cy="13.5" r="1"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  videos: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
  rooms: '<path d="M3 10.5L12 4l9 6.5"/><path d="M5.5 9.5V19h13V9.5"/><path d="M10 19v-4.5h4V19"/>',
  posts: '<path d="M5 4.5h10l4 4v11H5z"/><path d="M8.5 11h7M8.5 14.5h7M8.5 7.5h4"/>',
  tv: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.5h3"/>',
  computer: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M1.5 19.5h21"/>',
  feed: '<path d="M5 5a14 14 0 0 1 14 14"/><path d="M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  home: '<path d="M4 11.5 12 5l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name] ?? ''}</svg>`;
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8Z" fill="currentColor"/></svg>';
/** Homie's mark, for the "Made with Homie" footer. */
const HOMIE_MARK = '<svg class="homie" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 11.2 12 4.5l8.5 6.7V20a.5.5 0 0 1-.5.5h-5v-5.5h-6v5.5H4a.5.5 0 0 1-.5-.5Z" fill="currentColor"/></svg>';

/* ------------------------------------------------------------------ the look */

const BASE_CSS = `
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:400 17px/1.55 var(--text);-webkit-font-smoothing:antialiased;overflow-x:hidden;min-height:100vh;display:flex;flex-direction:column}
main{flex:1}
a{color:inherit}
img,video{display:block;max-width:100%}
[hidden]{display:none!important}
.ico{width:18px;height:18px;flex:none}
.skip{position:absolute;left:-9999px;top:12px;z-index:40;padding:10px 14px;border-radius:10px;background:var(--fg);color:var(--bg)}
.skip:focus{left:12px}
.kicker{margin:0 0 12px;font:600 12px/1.5 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--glow-ink)}
:focus-visible{outline:3px solid var(--fg);outline-offset:3px}
@media (max-width:559px){.k-opt{display:none}}

/* ---- the top line: the studio, and its sections ---- */
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 18px;
  padding:calc(env(safe-area-inset-top,0px) + 12px) max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px),calc((100vw - 1180px) / 2)) 12px max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px),calc((100vw - 1180px) / 2));
  background:color-mix(in srgb,var(--bg) 80%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);border-bottom:1px solid var(--line)}
.has-hero .top{position:absolute;inset:0 0 auto;background:linear-gradient(to bottom,color-mix(in srgb,var(--bg) 55%,transparent),transparent);border-bottom-color:transparent;-webkit-backdrop-filter:none;backdrop-filter:none}
.mark{display:inline-flex;align-items:center;gap:10px;min-height:40px;font:800 14px/1 var(--display);letter-spacing:var(--mark-track,.3em);text-transform:var(--mark-case,uppercase);text-decoration:none;color:var(--fg)}
.mark i{width:10px;height:10px;border-radius:3px;background:var(--hot);box-shadow:0 0 14px var(--hot)}
.mark img{height:30px;width:auto}
.nav{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.nav::-webkit-scrollbar{display:none}
.nav a{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 13px;border-radius:999px;font:600 14px/1 var(--text);text-decoration:none;color:var(--soft);white-space:nowrap;border:1px solid transparent}
.nav a:hover{color:var(--fg);background:color-mix(in srgb,var(--fg) 7%,transparent)}
.nav a[aria-current]{color:var(--fg);background:color-mix(in srgb,var(--fg) 11%,transparent);border-color:var(--line)}
.has-hero .nav a{background:color-mix(in srgb,var(--bg) 42%,transparent);border-color:var(--line);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.nav .ico{width:17px;height:17px}
@media (max-width:719px){
  .nav{order:3;flex:1 0 100%;margin:0 calc(var(--gutter) * -1);padding:0 var(--gutter)}
  .nav a{min-height:36px;padding:0 11px;font-size:13px}
}

/* ---- the hero: the game, moving ---- */
.hero{position:relative;isolation:isolate;display:flex;align-items:flex-end;min-height:100vh;min-height:100svh;overflow:hidden;padding-top:calc(env(safe-area-inset-top,0px) + var(--top-h))}
.hero.home{min-height:min(92vh,900px);min-height:min(92svh,900px)}
.hero-media{position:absolute;inset:0;z-index:-2;overflow:hidden;background:
  radial-gradient(60% 50% at 70% 30%,color-mix(in srgb,var(--glow) 26%,transparent),transparent 70%),
  radial-gradient(55% 45% at 25% 70%,color-mix(in srgb,var(--hot) 24%,transparent),transparent 70%),var(--bg)}
.hero-media img,.hero-media video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:var(--focus,50% 50%)}
/* The studio's own colour over the picture, so a bright cover still carries the words (game.json landing.hero.tint, 0 to 80). */
.hero-media::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:color-mix(in srgb,var(--bg) var(--tint,16%),transparent)}
.hero-media.drift::before{background:color-mix(in srgb,var(--bg) var(--tint,40%),transparent)}
.hero-media.drift img{filter:saturate(1.08) contrast(1.04)}
.hero-media video{opacity:0;transition:opacity .9s ease}
.hero-media.is-playing video{opacity:1}
.hero-media.drift img{transform-origin:var(--focus,50% 50%);animation:drift 26s ease-in-out infinite alternate;will-change:transform}
.hero-media.drift::after,.hero-media.bare::after{content:"";position:absolute;inset:-25%;z-index:2;pointer-events:none;mix-blend-mode:screen;opacity:.75;
  background:radial-gradient(34% 26% at 30% 40%,color-mix(in srgb,var(--glow) 30%,transparent),transparent 70%),radial-gradient(30% 24% at 72% 62%,color-mix(in srgb,var(--hot) 26%,transparent),transparent 70%);
  animation:sweep 17s ease-in-out infinite alternate}
.hero-media .word{position:absolute;right:-.06em;bottom:-.18em;font:800 clamp(140px,34vw,460px)/.8 var(--display);letter-spacing:-.06em;color:color-mix(in srgb,var(--fg) 5%,transparent);white-space:nowrap;user-select:none}
@keyframes drift{from{transform:scale(1.05) translate3d(-1.4%,.9%,0)}to{transform:scale(1.17) translate3d(1.4%,-.9%,0)}}
@keyframes sweep{from{transform:translate3d(-7%,-4%,0) rotate(-2deg)}to{transform:translate3d(7%,4%,0) rotate(2deg)}}
.hero-grain{position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.hero-shade{position:absolute;inset:0;z-index:-1;pointer-events:none;background:
  linear-gradient(to top,var(--bg) 0%,color-mix(in srgb,var(--bg) 88%,transparent) 20%,color-mix(in srgb,var(--bg) 40%,transparent) 46%,transparent 68%),
  linear-gradient(to bottom,color-mix(in srgb,var(--bg) 70%,transparent) 0%,transparent 22%)}
.hero-copy{width:100%;max-width:780px;padding:0 max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px)) calc(env(safe-area-inset-bottom,0px) + clamp(26px,5.5vh,72px)) max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px),calc((100vw - 1180px) / 2))}
.title{margin:0;font:800 clamp(54px,15vw,72px)/.9 var(--display);letter-spacing:-.035em;overflow-wrap:anywhere;text-wrap:balance;
  text-shadow:0 0 38px color-mix(in srgb,var(--hot) 50%,transparent),0 2px 0 color-mix(in srgb,var(--bg) 60%,transparent)}
.title.t-long{font-size:clamp(44px,12vw,64px)}
.title.t-xlong{font-size:clamp(38px,10vw,54px)}
.remix-of{margin:12px 0 0;font:600 14px/1.4 var(--text);color:var(--soft)}
.remix-of a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.line{margin:14px 0 22px;max-width:36ch;font:500 17px/1.45 var(--text);color:var(--soft);text-wrap:pretty}
.play{display:flex;width:100%;align-items:center;justify-content:center;gap:12px;min-height:62px;padding:0 30px;border-radius:18px;
  background:var(--hot);color:var(--hot-ink);text-decoration:none;font:800 20px/1 var(--display);letter-spacing:-.01em;
  box-shadow:0 12px 44px color-mix(in srgb,var(--hot) 55%,transparent),inset 0 -3px 0 color-mix(in srgb,var(--bg) 22%,transparent);
  transition:transform .15s ease,box-shadow .25s ease}
.play svg{width:20px;height:20px;flex:none}
.play:hover{transform:translateY(-2px);box-shadow:0 16px 60px color-mix(in srgb,var(--hot) 72%,transparent),inset 0 -3px 0 color-mix(in srgb,var(--bg) 22%,transparent)}
.play:active{transform:translateY(1px)}
.live{display:flex;align-items:center;gap:10px;margin:16px 0 0;font:600 14px/1.35 var(--text);color:var(--soft)}
.live-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--glow);box-shadow:0 0 12px var(--glow)}
.live:not([data-n="0"])[data-n] .live-dot,.dot-on{background:#43ff9e;box-shadow:0 0 0 0 rgba(67,255,158,.6);animation:pulse 1.8s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 10px rgba(67,255,158,0)}100%{box-shadow:0 0 0 0 rgba(67,255,158,0)}}
.also{display:inline-flex;align-items:center;gap:8px;margin-top:14px;font:600 14px/1 var(--text);color:var(--dim);text-decoration:none;min-height:36px}
.also:hover{color:var(--fg)}
.also+.also{margin-left:18px}
@media (min-aspect-ratio:3/4){.hero-media picture.tall-only{display:none}}
@media (min-width:760px){
  .hero-shade{background:
    linear-gradient(to top,var(--bg) 0%,color-mix(in srgb,var(--bg) 70%,transparent) 18%,transparent 52%),
    linear-gradient(to right,color-mix(in srgb,var(--bg) 82%,transparent) 0%,color-mix(in srgb,var(--bg) 35%,transparent) 42%,transparent 66%),
    linear-gradient(to bottom,color-mix(in srgb,var(--bg) 70%,transparent) 0%,transparent 18%)}
  .hero-copy{max-width:none}
  .hero-copy>*{max-width:min(64rem,94vw)}
  .title{font-size:clamp(76px,8.6vw,140px)}
  .title.t-long{font-size:clamp(64px,6.6vw,108px)}
  .title.t-xlong{font-size:clamp(54px,5.2vw,86px)}
  .line{font-size:clamp(18px,1.55vw,22px);margin:18px 0 30px;max-width:40ch}
  .play{display:inline-flex;width:auto;min-height:66px;padding:0 40px;font-size:22px}
  .row{display:flex;align-items:center;flex-wrap:wrap;gap:12px 26px}
  .row .live{margin:0}
  .also{margin-top:18px}
}
@media (max-height:540px) and (min-aspect-ratio:4/3){
  .hero{padding-top:calc(env(safe-area-inset-top,0px) + 62px)}
  .hero-copy{max-width:min(46rem,100%);padding-bottom:calc(env(safe-area-inset-bottom,0px) + 18px)}
  .kicker{margin-bottom:6px;font-size:11px}
  .title,.title.t-long,.title.t-xlong{font-size:clamp(40px,12vh,60px)}
  .line{margin:8px 0 14px;max-width:48ch;font-size:16px;line-height:1.4}
  .play{display:inline-flex;width:auto;min-height:54px;padding:0 30px;font-size:19px;border-radius:16px}
  .row{display:flex;align-items:center;flex-wrap:wrap;gap:10px 22px}
  .row .live{margin:0}
  .hero-copy>.also{display:none}
}

/* ---- bands below the fold ---- */
.band{position:relative;padding:clamp(56px,9vw,120px) max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px)) clamp(56px,9vw,120px) max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px));border-top:1px solid var(--line)}
.band.tight{padding-top:clamp(40px,6vw,72px);padding-bottom:clamp(40px,6vw,72px)}
.band-in{max-width:1180px;margin:0 auto}
.band h2,.h2{margin:0;font:800 clamp(32px,5.2vw,64px)/.98 var(--display);letter-spacing:-.03em;max-width:18ch;text-wrap:balance}
.band h2.small-h{font-size:clamp(26px,3.4vw,40px)}
.lead{margin:18px 0 0;max-width:52ch;font-size:clamp(17px,1.5vw,20px);color:var(--soft);text-wrap:pretty}
.glowband{background:radial-gradient(90% 70% at 85% 10%,color-mix(in srgb,var(--glow) 12%,transparent),transparent 60%),var(--bg)}
.hotband{background:radial-gradient(80% 70% at 10% 90%,color-mix(in srgb,var(--hot) 13%,transparent),transparent 60%),var(--bg)}
.split{display:grid;gap:clamp(32px,5vw,72px);align-items:center}
@media (min-width:900px){.split{grid-template-columns:1.05fr .95fr}}
.split>*,.way>*{min-width:0}
.head-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 24px;flex-wrap:wrap}
.more{display:inline-flex;align-items:center;gap:8px;font:700 15px/1 var(--text);text-decoration:none;color:var(--soft);min-height:40px}
.more:hover{color:var(--fg)}
.small{margin:18px 0 0;font-size:14px;color:var(--dim)}
.small a{color:var(--soft)}
.addr{font-family:var(--mono);font-size:.95em;color:var(--fg);overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:50px;padding:0 24px;border-radius:14px;font:800 17px/1 var(--display);text-decoration:none;
  background:var(--hot);color:var(--hot-ink);border:0;cursor:pointer;box-shadow:0 8px 28px color-mix(in srgb,var(--hot) 35%,transparent);transition:transform .15s ease}
.btn:hover{transform:translateY(-1px)}
.btn svg{width:18px;height:18px}
.ghost{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:50px;padding:0 22px;border-radius:14px;
  font:700 16px/1 var(--display);text-decoration:none;color:var(--fg);border:1px solid color-mix(in srgb,var(--fg) 30%,transparent);background:transparent;cursor:pointer}
.ghost:hover{border-color:var(--fg);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.ghost svg{width:18px;height:18px}
.keys{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}

/* phone / computer / TV */
.ways{list-style:none;margin:30px 0 0;padding:0;display:grid;gap:14px}
.way{display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start;padding:18px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);color:var(--soft)}
.way .n{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;color:var(--hot-ink);background:var(--hot)}
.way:nth-child(2) .n{background:var(--glow);color:var(--bg)}
.way:nth-child(3) .n{background:var(--fg);color:var(--bg)}
.way .n svg{width:22px;height:22px}
.way h3{margin:2px 0 4px;font:800 19px/1.2 var(--display);color:var(--fg)}
.way p{margin:0}
.way ol{margin:8px 0 0;padding-left:20px}
.way li{margin:3px 0}
.way strong{color:var(--fg)}
.way .scan{display:flex;gap:16px;align-items:center;margin-top:12px}
.qr{flex:none;width:112px;height:112px;padding:6px;border-radius:12px;background:#fff;box-shadow:0 10px 30px color-mix(in srgb,var(--hot) 25%,transparent)}
.qr svg{width:100%;height:100%;display:block}
[data-hand="phone"] .desk-only,[data-hand="desk"] .phone-only{display:none}
.tvart{position:relative;margin:0;padding-bottom:9%}
.tvart .screen{position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;border:10px solid #0b0c10;background:var(--panel);
  box-shadow:0 0 0 1px var(--line),0 30px 80px color-mix(in srgb,var(--glow) 18%,transparent)}
.tvart .screen img{width:100%;height:100%;object-fit:cover}
.tvart .screen .qr{position:absolute;right:5%;top:8%;width:17%;height:auto;aspect-ratio:1;padding:4px;box-shadow:none;border-radius:6px}
.tvart .phone{position:absolute;bottom:0;width:16%;aspect-ratio:9/19;border-radius:14px;background:#0b0c10;border:3px solid #1c1f28;
  box-shadow:0 12px 30px rgba(0,0,0,.55),0 0 22px color-mix(in srgb,var(--hot) 35%,transparent)}
.tvart .phone::after{content:"";position:absolute;inset:14% 12%;border-radius:50%;
  background:radial-gradient(circle at 50% 50%,var(--hot) 0 18%,transparent 19%),radial-gradient(circle,color-mix(in srgb,var(--fg) 12%,transparent) 0 60%,transparent 61%)}
.tvart .p1{left:14%;transform:rotate(-8deg)}
.tvart .p2{left:36%;transform:rotate(6deg)}

/* live rooms */
.rooms{list-style:none;margin:26px 0 0;padding:0;display:grid;gap:10px}
.room{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding:12px 14px;border-radius:calc(var(--r) - 4px);background:var(--panel);border:1px solid var(--line)}
.room .thumb{width:76px;aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:color-mix(in srgb,var(--hot) 20%,var(--panel))}
.room .thumb img{width:100%;height:100%;object-fit:cover}
.room b{display:block;font:800 17px/1.2 var(--display)}
.room span{color:var(--dim);font-size:14px}
.pips{display:flex;gap:3px;flex-wrap:wrap;margin-top:7px}
.pips i{width:8px;height:8px;border-radius:50%;background:color-mix(in srgb,var(--fg) 18%,transparent)}
.pips i.on{background:#43ff9e;box-shadow:0 0 8px rgba(67,255,158,.55)}
.join{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;background:var(--hot);color:var(--hot-ink);font:800 15px/1 var(--display);text-decoration:none}
.room-acts{display:flex;gap:8px;align-items:center}
.watchb{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--fg) 24%,transparent);color:var(--fg);font:700 15px/1 var(--display);text-decoration:none}
.watchb:hover{border-color:var(--fg);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.watchb svg{width:18px;height:18px;flex:none}
@media (max-width:379px){.watchb span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.watchb{padding:0 12px}}
.quiet{margin:22px 0 0;padding:18px 20px;border-radius:var(--r);border:1px dashed color-mix(in srgb,var(--fg) 22%,transparent);color:var(--soft)}
.stat{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.stat span{padding:8px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font:600 14px/1.2 var(--text);color:var(--soft)}
.stat b{color:var(--fg)}
@media (max-width:479px){.room{grid-template-columns:1fr auto}.room .thumb{display:none}}

/* how to play, facts, credits */
.facts{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 0;padding:0;list-style:none}
.facts li{padding:9px 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font:600 14px/1.2 var(--text);color:var(--soft)}
.howto{margin:22px 0 0;padding-left:22px;color:var(--soft)}
.howto li{margin:6px 0}
.media-card{display:block;border-radius:var(--r);overflow:hidden;background:var(--panel);border:1px solid var(--line);text-decoration:none}
.media-card .art{position:relative;aspect-ratio:16/9;background:color-mix(in srgb,var(--hot) 16%,var(--panel))}
.media-card .art img{width:100%;height:100%;object-fit:cover}
.media-card .art .big{position:absolute;inset:0;margin:auto;width:74px;height:74px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--bg) 55%,transparent);border:1px solid color-mix(in srgb,var(--fg) 40%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.media-card .art .big svg{width:26px;height:26px;margin-left:4px}
.media-card .cap{padding:14px 18px}
.media-card .cap b{display:block;font:800 19px/1.2 var(--display)}
.media-card .cap span{color:var(--dim);font-size:14px}
.credits{display:grid;gap:18px;margin-top:30px}
@media (min-width:760px){.credits{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.credit{overflow-wrap:anywhere;padding:20px 22px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);color:var(--soft);font-size:15px}
.credit h3{margin:0 0 10px;font:600 12px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--glow-ink)}
.credit p{margin:0 0 8px}
.credit ul{margin:0;padding-left:18px}
.credit li{margin:4px 0}
.credit strong{color:var(--fg)}
.credit a{color:var(--fg)}

/* make a game like this */
.make{position:relative;overflow:hidden;border-radius:calc(var(--r) + 8px);padding:clamp(26px,4vw,48px);border:1px solid color-mix(in srgb,var(--hot) 55%,transparent);
  background:radial-gradient(70% 90% at 100% 0%,color-mix(in srgb,var(--hot) 20%,transparent),transparent 60%),radial-gradient(60% 80% at 0% 100%,color-mix(in srgb,var(--glow) 14%,transparent),transparent 60%),var(--panel);
  box-shadow:0 20px 70px color-mix(in srgb,var(--hot) 16%,transparent)}
.make h2{max-width:16ch}
.say{display:grid;gap:10px;margin:24px 0 0;padding:0;list-style:none;counter-reset:say}
.say li{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 10px 10px 16px;border-radius:12px;background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--line)}
.say code{font:500 14px/1.45 var(--mono);color:var(--fg);overflow-wrap:anywhere}
.say .label{display:block;font:600 11px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:3px}
.copy{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--soft);font:600 13px/1 var(--text);cursor:pointer}
.copy:hover{color:var(--fg);border-color:color-mix(in srgb,var(--fg) 35%,transparent)}
.copy svg{width:15px;height:15px}

/* pages without a hero */
.head{position:relative;overflow:hidden;padding:clamp(44px,8vw,110px) max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px),calc((100vw - 1180px) / 2)) clamp(22px,3vw,36px) max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px),calc((100vw - 1180px) / 2))}
.head::before{content:"";position:absolute;inset:-40% -10% auto;height:140%;z-index:-1;pointer-events:none;
  background:radial-gradient(40% 50% at 80% 30%,color-mix(in srgb,var(--glow) 16%,transparent),transparent 70%),radial-gradient(35% 45% at 15% 60%,color-mix(in srgb,var(--hot) 14%,transparent),transparent 70%)}
.head{isolation:isolate}
.head h1{margin:0;font:800 clamp(48px,10vw,120px)/.9 var(--display);letter-spacing:-.04em;text-wrap:balance}
.head .lead{margin-top:16px}
.head .feeds{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.head .feeds a{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--soft);font:600 13px/1 var(--text)}
.wrap{max-width:calc(1180px + 2 * var(--gutter));margin:0 auto;padding:0 max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px)) clamp(56px,8vw,110px) max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px))}

/* game cards */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:20px;margin-top:28px}
.gcard{position:relative;display:flex;flex-direction:column;border-radius:var(--r);overflow:hidden;background:var(--panel);border:1px solid var(--line);transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease}
.gcard:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--hot) 50%,transparent);box-shadow:0 18px 50px color-mix(in srgb,var(--hot) 18%,transparent)}
.gcard .art{position:relative;display:block;aspect-ratio:16/10;overflow:hidden;
  background:radial-gradient(70% 80% at 80% 20%,color-mix(in srgb,var(--glow) 28%,transparent),transparent 70%),radial-gradient(60% 70% at 15% 85%,color-mix(in srgb,var(--hot) 30%,transparent),transparent 70%),var(--panel)}
.gcard .art img{width:100%;height:100%;object-fit:cover;transition:transform .7s cubic-bezier(.2,.7,.2,1)}
.gcard:hover .art img{transform:scale(1.06)}
.gcard .art .word{position:absolute;left:16px;bottom:10px;right:16px;font:800 clamp(30px,4vw,44px)/.95 var(--display);letter-spacing:-.03em;color:var(--fg);text-shadow:0 0 30px color-mix(in srgb,var(--hot) 60%,transparent)}
.badge{position:absolute;left:12px;top:12px;display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.62);color:#b8ffd6;font:700 12px/1.2 var(--text);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.badge i{width:7px;height:7px;border-radius:50%;background:#43ff9e}
.gcard .body{display:flex;flex-direction:column;gap:8px;flex:1;padding:18px 20px 20px}
.gcard h3{margin:0;font:800 24px/1.08 var(--display);letter-spacing:-.02em}
.gcard h3 a{text-decoration:none}
.gcard p{margin:0;color:var(--soft)}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--dim);font-size:13px}
.acts{display:flex;gap:10px;margin-top:auto;padding-top:10px}
.acts .btn,.acts .ghost{min-height:46px;font-size:16px;flex:1}
.cards.feature{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}

/* posts */
.plist{list-style:none;margin:28px 0 0;padding:0;display:grid;gap:14px}
.pitem>a{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;padding:20px 22px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);text-decoration:none;transition:border-color .2s ease,transform .2s ease}
.pitem>a:hover{border-color:color-mix(in srgb,var(--hot) 45%,transparent);transform:translateY(-2px)}
.pitem time,.post-meta{font:600 12px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--glow-ink)}
.pitem h3{margin:6px 0 6px;font:800 clamp(22px,2.6vw,30px)/1.1 var(--display);letter-spacing:-.02em}
.pitem p{margin:0;color:var(--soft)}
.pitem img{width:168px;aspect-ratio:16/10;object-fit:cover;border-radius:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.chips span{padding:5px 10px;border-radius:999px;border:1px solid var(--line);font:600 12px/1.2 var(--text);color:var(--soft)}
@media (max-width:599px){.pitem>a{grid-template-columns:1fr}.pitem img{width:100%;order:-1}}
.cards.posts{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}
.pcard{display:flex;flex-direction:column;gap:8px;padding:20px 22px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);text-decoration:none;transition:border-color .2s ease,transform .2s ease}
.pcard:hover{border-color:color-mix(in srgb,var(--hot) 45%,transparent);transform:translateY(-2px)}
.pcard img{width:calc(100% + 44px);max-width:none;margin:-20px -22px 8px;aspect-ratio:16/9;object-fit:cover}
.pcard h3{margin:0;font:800 22px/1.12 var(--display);letter-spacing:-.02em}
.pcard p{margin:0;color:var(--soft);font-size:15px}
.article{max-width:760px;margin:0 auto}
.article h1{margin:10px 0 0;font:800 clamp(40px,7vw,84px)/.95 var(--display);letter-spacing:-.035em;text-wrap:balance}
.article .dek{margin:18px 0 0;font-size:clamp(18px,1.8vw,22px);color:var(--soft)}
.article .cover{margin:30px 0 0;border-radius:var(--r);overflow:hidden;border:1px solid var(--line)}
.prose{margin-top:34px;font-size:clamp(17px,1.35vw,19px);line-height:1.7;color:color-mix(in srgb,var(--fg) 90%,transparent)}
.prose h2,.prose h3,.prose h4{color:var(--fg);font-family:var(--display);letter-spacing:-.02em;line-height:1.12;margin:1.6em 0 .5em}
.prose h2{font-size:clamp(26px,3vw,36px)}
.prose h3{font-size:clamp(21px,2.2vw,26px)}
.prose a{color:var(--hot);text-underline-offset:3px}
.prose img{border-radius:12px}
.prose figure{margin:1.6em 0}
.prose figcaption{margin-top:8px;font-size:14px;color:var(--dim)}
.prose blockquote{margin:1.4em 0;padding:.2em 0 .2em 1.1em;border-left:3px solid var(--hot);color:var(--soft)}
.prose pre{padding:14px 16px;border-radius:12px;background:var(--panel);border:1px solid var(--line);overflow-x:auto;font:14px/1.55 var(--mono)}
.prose code{font-family:var(--mono);font-size:.9em}
.prose hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.linked{display:grid;gap:14px;margin:40px 0 0;grid-template-columns:1fr}
@media (min-width:640px){.linked .gcard{flex-direction:row}.linked .gcard .art{width:44%;flex:none;aspect-ratio:auto;min-height:220px}.linked .media-card{display:grid;grid-template-columns:44% 1fr;align-items:center}}

/* songs and videos */
.player{margin:8px 0 20px}
.player audio{width:100%}
.player video{width:100%;max-height:78vh;border-radius:var(--r);background:#000;display:block}
.player video.vertical{max-width:420px;margin:0 auto}
.mfacts{color:var(--dim);font-size:14px;display:flex;gap:16px;flex-wrap:wrap;margin:0 0 18px}
.rights{color:var(--dim);font-size:13px;border-top:1px solid var(--line);padding-top:14px;margin-top:24px;max-width:70ch}
.lyrics{white-space:pre-wrap;font-size:17px;line-height:1.6;max-width:60ch}
.files{list-style:none;padding:0;margin:0;display:grid;gap:8px;max-width:560px}
.files a{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;text-decoration:none}
.files span{color:var(--dim);font-size:13px}
.songhead{display:grid;gap:clamp(24px,4vw,48px);align-items:end}
@media (min-width:760px){.songhead.has-cover{grid-template-columns:minmax(0,1fr) min(340px,34%)}}
.songhead .cover{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r);box-shadow:0 24px 70px color-mix(in srgb,var(--hot) 25%,transparent)}
.sec{margin:44px 0 12px;font:600 12px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
.licence{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;font:13px/1.55 var(--mono);color:var(--soft);overflow-x:auto}

/* the footer, and "Made with Homie" */
.foot{padding:34px max(var(--gutter),calc(env(safe-area-inset-right,0px) + 12px)) calc(env(safe-area-inset-bottom,0px) + 34px) max(var(--gutter),calc(env(safe-area-inset-left,0px) + 12px));border-top:1px solid var(--line);color:var(--dim);font-size:14px}
.foot-in{max-width:1180px;margin:0 auto;display:flex;flex-wrap:wrap;gap:14px 28px;align-items:center;justify-content:space-between}
.foot-links{display:flex;flex-wrap:wrap;gap:6px 20px}
.foot-links a{text-decoration:none;color:var(--dim)}
.foot-links a:hover{color:var(--fg)}
.made{display:inline-flex;align-items:center;gap:9px;min-height:40px;padding:0 14px 0 11px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--soft);font:600 14px/1 var(--text);transition:border-color .2s ease,color .2s ease}
.made:hover{color:var(--fg);border-color:color-mix(in srgb,var(--hot) 55%,transparent)}
.made .homie{width:18px;height:18px;color:var(--hot)}
.made b{color:var(--fg);font-weight:800}

/* motion */
.js .reveal{opacity:0;transform:translateY(22px);transition:opacity .8s ease,transform .8s cubic-bezier(.2,.7,.2,1)}
.js .reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  .play,.live-dot,.dot-on,.gcard,.gcard .art img,.pitem>a,.pcard{transition:none;animation:none}
  .hero-media.drift img,.hero-media.drift::after,.hero-media.bare::after{animation:none}
  .js .reveal{opacity:1;transform:none;transition:none}
}
`;

/* ------------------------------------------------------------------ the script (served at /_homie/site.js) */

export const SITE_JS = String.raw`(function(){
'use strict';
var d=document,root=d.documentElement,body=d.body;
var mq=function(q){try{return matchMedia(q).matches}catch(e){return false}};
var still=mq('(prefers-reduced-motion: reduce)')||!!(navigator.connection&&navigator.connection.saveData);
// Things already on screen are shown at once; the rest rise into view as they scroll in.
var rev=[].slice.call(d.querySelectorAll('.reveal'));
var vh=innerHeight||800;
rev.forEach(function(e){if(still||e.getBoundingClientRect().top<vh)e.classList.add('in')});
root.classList.add('js');
if(!still&&'IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -6% 0px'});rev.forEach(function(e){if(!e.classList.contains('in'))io.observe(e)})}
else rev.forEach(function(e){e.classList.add('in')});
addEventListener('beforeprint',function(){rev.forEach(function(e){e.classList.add('in')})});
// The hero's footage fades in once it plays; reduced motion or data saver keeps the still.
[].forEach.call(d.querySelectorAll('[data-hero-media]'),function(m){var v=m.querySelector('video');if(!v)return;
  if(still){v.removeAttribute('autoplay');try{v.pause()}catch(e){}v.remove();m.classList.remove('drift');return}
  v.addEventListener('playing',function(){m.classList.add('is-playing');m.classList.remove('drift')},{once:true});
  var p=v.play&&v.play();if(p&&p.catch)p.catch(function(){})});
if(still)[].forEach.call(d.querySelectorAll('.drift'),function(m){m.classList.remove('drift')});
// On a touch screen the play page seats a phone (?hand=phone); a computer keeps its keys.
var desk=function(){return mq('(hover: hover) and (pointer: fine)')};
var hand=function(){body.setAttribute('data-hand',desk()?'desk':'phone');
  [].forEach.call(d.querySelectorAll('[data-play]'),function(a){var h=a.getAttribute('data-href')||a.getAttribute('href');a.setAttribute('data-href',h);
    a.setAttribute('href',desk()?h:h+(h.indexOf('?')<0?'?':'&')+'hand=phone')})};
hand();addEventListener('resize',hand);
// A song's or video's page: its one stats beacon when the player first starts (worker/stats.mjs), and the 9:16 cut
// on a portrait phone.
[].forEach.call(d.querySelectorAll('[data-beat]'),function(box){var m=box.querySelector('audio,video');if(!m)return;
  var v=box.getAttribute('data-vertical');if(v&&m.tagName==='VIDEO'&&mq('(orientation: portrait) and (max-width: 700px)')){m.src=v;m.classList.add('vertical')}
  if(!navigator.sendBeacon)return;m.addEventListener('play',function(){try{navigator.sendBeacon('/api/stats/beat',box.getAttribute('data-beat'))}catch(e){}},{once:true})});
// Copy a line to the clipboard.
d.addEventListener('click',function(ev){var b=ev.target&&ev.target.closest&&ev.target.closest('[data-copy]');if(!b)return;
  var t=b.getAttribute('data-copy'),w=b.querySelector('[data-copy-word]')||b,old=w.textContent;
  var done=function(){w.textContent='Copied';setTimeout(function(){w.textContent=old},1600)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done,function(){})});
// Live: the line under Play and the rooms list follow the site's own room counts.
var el=function(tag,cls,text){var e=d.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
var EYE='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
var roomRow=function(r){var li=el('li','room');var th=el('span','thumb');if(r.cover){var im=el('img');im.src=r.cover;im.alt='';im.loading='lazy';th.appendChild(im)}li.appendChild(th);
  var mid=el('div');mid.appendChild(el('b',null,(r.name?r.name+' · ':'')+r.label));mid.appendChild(el('span',null,r.players+' of '+r.max+' seats taken · bots hold the rest'));
  var pips=el('div','pips');for(var i=0;i<Math.min(r.max,32);i++)pips.appendChild(el('i',i<r.players?'on':''));mid.appendChild(pips);li.appendChild(mid);
  var acts=el('div','room-acts');
  if(r.watch){var w=el('a','watchb');w.href=r.watch;w.setAttribute('aria-label','Watch '+(r.name?r.name+' · ':'')+r.label);w.innerHTML=EYE;w.appendChild(el('span',null,'Watch'));acts.appendChild(w)}
  var a=el('a','join','Join');a.href=r.play;a.setAttribute('data-play','');acts.appendChild(a);li.appendChild(acts);return li};
var paintRooms=function(list,rooms){if(!list)return;var quiet=d.querySelector('[data-rooms-quiet]');list.textContent='';
  rooms.forEach(function(r){list.appendChild(roomRow(r))});list.hidden=!rooms.length;if(quiet)quiet.hidden=!!rooms.length;hand()};
var live=d.querySelector('[data-live]'),list=d.querySelector('[data-rooms]');
var src=(live&&live.getAttribute('data-live'))||(list&&list.getAttribute('data-src'));
if(src){
  var words=live&&live.querySelector('[data-live-words]');
  var one=live&&live.getAttribute('data-one')||'player',many=live&&live.getAttribute('data-many')||'players';
  var idle=live&&(live.getAttribute('data-idle')||(words&&words.textContent));
  var ask=function(){if(d.hidden)return;fetch(src,{credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(b){
    if(!b||b.ok!==true)return;var n=Number(b.playing)||0;
    if(live){live.setAttribute('data-n',String(n));if(words)words.textContent=n<=0?idle:(n===1?'1 '+one+' playing right now':n+' '+many+' playing right now')}
    if(list&&Array.isArray(b.rooms))paintRooms(list,b.rooms)}).catch(function(){})};
  var go=function(){setInterval(ask,15000);d.addEventListener('visibilitychange',ask)};
  if(d.prerendering===true)d.addEventListener('prerenderingchange',function(){ask();go()},{once:true});else go();
}
})();`;

/* ------------------------------------------------------------------ the shell */

const TOKEN_DEFAULTS = { bg: '#0b0c12', fg: '#f1f3f9', accent: '#ffcf5a', glow: '#7dffb0' };
/**
 * A game landing's own scheme (game.json `landing.scheme`), for a game whose picture is the other way round from
 * the studio's look: a white or cream arena (a light hero) under a dark studio's tint turns grey, so a light
 * landing draws the whole page light, its hero tinted and shaded with the light background and its words dark.
 * `landing.theme` colours still win over these.
 */
export const SCHEME_TOKENS = {
  light: { bg: '#f7f6f1', fg: '#15161d', panel: 'color-mix(in srgb,var(--fg) 5%,var(--bg))' },
  dark: { bg: '#0b0c12', fg: '#f1f3f9', panel: 'color-mix(in srgb,var(--fg) 5%,var(--bg))' },
};

/**
 * The studio's tokens as CSS custom properties (site/theme.json, checked at build), plus its fonts. `over` is a
 * page's own (a game landing's `landing.theme`, and its `scheme`). `--glow-ink` is the glow as small text: the
 * glow itself on a dark page, and a darker mix of it on a light one (a pale glow on white cannot be read).
 */
function tokensCss(theme = {}, over = null) {
  const t = { ...TOKEN_DEFAULTS, ...theme, ...(over ?? {}) };
  const scheme = (over?.scheme ?? theme.scheme) === 'light' ? 'light' : 'dark';
  const fonts = (theme.fonts ?? []).map((f) => `@font-face{font-family:"${f.family}";src:url("${f.src}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`).join('');
  const display = theme.display ?? 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const text = theme.text ?? 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const mono = theme.mono ?? 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  return `${fonts}:root{--bg:${t.bg};--fg:${t.fg};--hot:${t.accent};--glow:${t.glow};--hot-ink:${t.accentInk ?? t.bg};
--glow-ink:${scheme === 'light' ? 'color-mix(in srgb,var(--glow) 45%,var(--fg))' : 'var(--glow)'};
--soft:color-mix(in srgb,var(--fg) 80%,transparent);--dim:color-mix(in srgb,var(--fg) 62%,transparent);--line:color-mix(in srgb,var(--fg) 14%,transparent);
--panel:${t.panel ?? 'color-mix(in srgb,var(--fg) 5%,var(--bg))'};--display:${display};--text:${text};--mono:${mono};--r:${Number.isFinite(t.radius) ? t.radius : 18}px;
--gutter:clamp(18px,5vw,72px);--top-h:72px;color-scheme:${scheme}${theme.uppercase === false ? ';--mark-case:none;--mark-track:.02em' : ''}}
@media (max-width:719px){:root{--top-h:112px}}`;
}

/** A landing's `over` tokens: its scheme's (light or dark, when it differs from the studio's), then its own colours. */
function landingTokens(cat, L) {
  const studio = cat.studio?.theme?.scheme === 'light' ? 'light' : 'dark';
  const want = L.scheme === 'light' || L.scheme === 'dark' ? L.scheme : null;
  if (!want || want === studio) return L.theme ?? null;
  return { ...SCHEME_TOKENS[want], ...(L.theme ?? {}), scheme: want };
}

const studioName = (cat) => cat.studio?.name ?? 'Studio';

/** Which sections this studio has: a section with nothing in it has no tab (and its page answers 404). */
export function sectionsOf(cat) {
  const games = (cat.games ?? []).length > 0;
  return [
    games && { key: 'games', href: '/games/', label: 'Games' },
    (cat.songs ?? []).length > 0 && { key: 'music', href: '/music/', label: 'Music' },
    (cat.videos ?? []).length > 0 && { key: 'videos', href: '/videos/', label: 'Videos' },
    games && { key: 'rooms', href: '/rooms/', label: 'Rooms' },
    (cat.posts ?? []).length > 0 && { key: 'posts', href: '/posts/', label: 'Posts' },
  ].filter(Boolean);
}

/** A partial from site/partials, with {{studio.name}}, {{game.name}}, {{game.id}}, {{game.play}} and {{year}} filled in (escaped). */
export function partial(cat, name, vars = {}) {
  const text = cat.site?.partials?.[name];
  if (typeof text !== 'string') return null;
  const values = { 'studio.name': studioName(cat), year: String(new Date().getUTCFullYear()), ...vars };
  return text.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, k) => (k in values ? esc(values[k]) : m));
}

function markHtml(cat) {
  const t = cat.studio?.theme ?? {};
  const name = studioName(cat);
  if (t.mark) return `<a class="mark" href="/"><img src="${esc(t.mark)}" alt="${esc(name)}"></a>`;
  return `<a class="mark" href="/"><i aria-hidden="true"></i><span>${esc(t.wordmark ?? name)}</span></a>`;
}

export function header(cat, active = null) {
  const custom = partial(cat, 'header');
  if (custom !== null) return custom;
  const tabs = sectionsOf(cat).map((s) => `<a href="${s.href}"${s.key === active ? ' aria-current="page"' : ''}>${icon(s.key)}<span>${esc(s.label)}</span></a>`).join('');
  return `<header class="top" data-top>${markHtml(cat)}${tabs ? `<nav class="nav" aria-label="${esc(studioName(cat))}">${tabs}</nav>` : ''}</header>`;
}

/** The footer: the studio, its sections, and "Made with Homie" (site/partials/footer.html replaces it; site/theme.css restyles it). */
export function footer(cat) {
  const custom = partial(cat, 'footer');
  if (custom !== null) return custom;
  const links = sectionsOf(cat).map((s) => `<a href="${s.href}">${esc(s.label)}</a>`);
  if ((cat.posts ?? []).length) links.push('<a href="/posts/feed.xml">Feed</a>');
  return `<footer class="foot"><div class="foot-in">
  ${markHtml(cat)}
  <nav class="foot-links" aria-label="Sections">${links.join('')}</nav>
  <a class="made" href="https://homie.rocks/studio/" data-made-with-homie>${HOMIE_MARK}<span>Made with <b>Homie</b></span></a>
</div></footer>`;
}

const ogTags = (props) => Object.entries(props).filter(([, v]) => v).map(([k, v]) => `<meta ${k.startsWith('twitter:') ? 'name' : 'property'}="${esc(k)}" content="${esc(v)}">`).join('\n');

/**
 * A whole generated page. `hero` pages draw the top line over the hero; `style` is the game's own accent on its
 * landing (game.json landing.theme).
 */
export function layout(cat, { title, description = '', origin = '', path = '/', image = null, type = 'website', active = null, page = 'page', hero = false, head = '', main, over = null, status = 200, extraHeaders = {} }) {
  const theme = cat.studio?.theme ?? {};
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  const icon = theme.icon ? `<link rel="icon" href="${esc(theme.icon)}">` : `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="3" fill="${(over?.accent ?? theme.accent ?? TOKEN_DEFAULTS.accent)}"/></svg>`)}">`;
  const feeds = (cat.posts ?? []).length ? `<link rel="alternate" type="application/atom+xml" href="/posts/feed.xml" title="${esc(studioName(cat))}: posts"><link rel="alternate" type="application/feed+json" href="/posts/feed.json" title="${esc(studioName(cat))}: posts">` : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${origin ? `<link rel="canonical" href="${esc(`${origin}${path}`)}">` : ''}
<meta name="theme-color" content="${esc(over?.bg ?? theme.bg ?? TOKEN_DEFAULTS.bg)}">
${ogTags({ 'og:title': title, 'og:description': description, 'og:type': type, 'og:url': origin ? `${origin}${path}` : null, 'og:image': abs(image ?? theme.social ?? null), 'og:site_name': studioName(cat), 'twitter:card': image || theme.social ? 'summary_large_image' : 'summary' })}
${icon}${feeds}${head}
<style>${tokensCss(theme, over)}${BASE_CSS}${cat.site?.css ?? ''}</style>
${partial(cat, 'head') ?? ''}
</head>
<body class="${hero ? 'has-hero' : ''}" data-page="${esc(page)}" data-scheme="${(over?.scheme ?? theme.scheme) === 'light' ? 'light' : 'dark'}">
<a class="skip" href="#main">Skip to content</a>
${header(cat, active)}
<main id="main">
${main}
</main>
${footer(cat)}
<script src="/_homie/site.js?v=${STUDIO_VERSION_TAG}" defer></script>
</body>
</html>`;
  return new Response(html, { status, headers: pageHeaders(extraHeaders) });
}

/**
 * A whole page from site/pages, served as it is, in the site's frame rules (never framed, no-transform). Four
 * markers let it borrow the generated parts: <!-- homie:style --> (the tokens and the stylesheet),
 * <!-- homie:header -->, <!-- homie:footer --> ("Made with Homie") and <!-- homie:script -->.
 */
export function customPage(cat, html, { active = null } = {}) {
  const out = String(html)
    .replace(/<!--\s*homie:style\s*-->/g, () => `<style>${tokensCss(cat.studio?.theme ?? {})}${BASE_CSS}${cat.site?.css ?? ''}</style>`)
    .replace(/<!--\s*homie:header\s*-->/g, () => header(cat, active))
    .replace(/<!--\s*homie:footer\s*-->/g, () => footer(cat))
    .replace(/<!--\s*homie:script\s*-->/g, () => `<script src="/_homie/site.js?v=${STUDIO_VERSION_TAG}" defer></script>`);
  // The studio's own page may carry its own scripts, so only the frame and sniffing rules apply.
  return new Response(out, { headers: pageHeaders({ 'content-security-policy': "frame-ancestors 'none'" }) });
}

/* ------------------------------------------------------------------ pieces */

const minutes = (s) => (Number.isFinite(s) && s > 0 ? (s % 60 ? `${s}\u00a0s rounds` : `${s / 60}\u2011minute rounds`) : null);
const playersText = (g) => (g.players?.max ? (g.players.max === 1 ? 'one player' : `1–${g.players.max} players`) : 'multiplayer');
const titleClass = (name) => { const n = String(name ?? '').length; return n > 22 ? 't-xlong' : n > 12 ? 't-long' : ''; };
/**
 * A game's picture on every card (Home, Games, Rooms, a post), a room's row and the directory's manifest: the
 * landing's hero still (hero/wide.jpg or game.json landing.hero.image, the picture the landing leads with), else
 * a trailer's poster, else the game's cover. An old game.json cover never outranks the landing's own still.
 */
export const gameCover = (g) => g.landing?.hero?.wideImage ?? g.landing?.hero?.tallImage ?? g.landing?.cover ?? (g.cover ? `/games/${g.id}/${g.cover}` : null);
const coverOf = gameCover;

/** Hero media: the game's footage (wide and tall, AV1 first), else its art with slow motion, else the studio's colours. */
function heroMedia(h = {}, { alt = '', word = '' } = {}) {
  const vars = [h.focus ? `--focus:${esc(h.focus)}` : '', Number.isFinite(h.tint) ? `--tint:${h.tint}%` : ''].filter(Boolean).join(';');
  const focus = vars ? ` style="${vars}"` : '';
  const still = h.wideImage || h.tallImage;
  const picture = still ? `<picture>${h.wideImage && h.tallImage ? `<source media="(min-aspect-ratio: 3/4)" srcset="${esc(h.wideImage)}">` : ''}<img src="${esc(h.tallImage ?? h.wideImage)}" alt="" fetchpriority="high" decoding="async"></picture>` : '';
  const sources = [
    h.wideAv1 && h.wide ? `<source media="(min-aspect-ratio: 3/4)" src="${esc(h.wideAv1)}" type="video/mp4; codecs=&quot;av01.0.08M.08&quot;">` : '',
    h.wide && h.tall ? `<source media="(min-aspect-ratio: 3/4)" src="${esc(h.wide)}" type="video/mp4">` : '',
    h.tallAv1 && h.tall ? `<source src="${esc(h.tallAv1)}" type="video/mp4; codecs=&quot;av01.0.08M.08&quot;">` : '',
    h.tall ? `<source src="${esc(h.tall)}" type="video/mp4">` : (h.wide ? `<source src="${esc(h.wide)}" type="video/mp4">` : ''),
  ].join('');
  const video = sources ? `<video autoplay muted loop playsinline preload="metadata" disablepictureinpicture disableremoteplayback${alt ? ` aria-label="${esc(alt)}"` : ' aria-hidden="true"'}>${sources}</video>` : '';
  const cls = video ? '' : still ? ' drift' : ' bare';
  return `<div class="hero-media${cls}" data-hero-media${focus}>${picture}${video}${!still && !video && word ? `<span class="word" aria-hidden="true">${esc(word)}</span>` : ''}</div><div class="hero-grain" aria-hidden="true"></div><div class="hero-shade" aria-hidden="true"></div>`;
}

function liveLine(g, playing, { idle } = {}) {
  const w = g.landing?.words ?? {};
  const one = w.one ?? 'player';
  const many = w.many ?? 'players';
  const words = playing > 0 ? (playing === 1 ? `1 ${one} playing right now` : `${playing} ${many} playing right now`) : idle;
  return `<p class="live" data-live="/${esc(g.id)}/live" data-n="${playing}" data-one="${esc(one)}" data-many="${esc(many)}" data-idle="${esc(idle)}" aria-live="polite"><span class="live-dot" aria-hidden="true"></span><span data-live-words>${esc(words)}</span></p>`;
}

function gameCard(g, playing = 0) {
  const cover = coverOf(g);
  return `<article class="gcard reveal">
  <a class="art" href="/${esc(g.id)}/" aria-label="${esc(g.name)}">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : `<span class="word">${esc(g.name)}</span>`}${playing ? `<span class="badge"><i></i>${esc(playing)} playing now</span>` : ''}</a>
  <div class="body">
    <h3><a href="/${esc(g.id)}/">${esc(g.name)}</a></h3>
    <p>${esc(g.landing?.pitch ?? g.blurb)}</p>
    <div class="meta"><span>${esc(playersText(g))}</span>${minutes(g.roundSeconds) ? `<span>${esc(minutes(g.roundSeconds))}</span>` : ''}<span>phone, computer or TV</span></div>
    <div class="acts"><a class="btn" href="/${esc(g.id)}/play" data-play>${PLAY_ICON}Play</a><a class="ghost" href="/${esc(g.id)}/">About</a></div>
  </div>
</article>`;
}

/**
 * What a game lets its watchers see (game.json "watch", NETPLAY.md section 16): `follow` (any player's view; the
 * default), `overview` (the whole room only: a game with hidden hands or roles), or `off` (no watch door at all).
 */
export function watchOf(g) {
  const w = g?.watch;
  if (w === false || w === 'off') return 'off';
  if (w === 'overview') return 'overview';
  return 'follow';
}

/** A room as the live list draws it (the same fields /api/rooms and /<game>/live give the script). */
export function roomView(g, r, max) {
  const n = Number(String(r.name ?? r.room ?? '').replace(/^pub-/, '')) || null;
  const room = r.name ?? r.room;
  return {
    game: g.id, name: g.name, label: n ? `Room ${n}` : 'A room', room, players: r.players, max, cover: coverOf(g), play: `/${g.id}/play?room=${encodeURIComponent(room)}`,
    // Watch this room from any player's view (section 16); a game that cannot be watched has no link.
    watch: watchOf(g) === 'off' ? null : `/${g.id}/watch?room=${encodeURIComponent(room)}`,
  };
}

function roomRows(rows, { names = true } = {}) {
  return rows.map((r) => `<li class="room"><span class="thumb">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : ''}</span><div><b>${names ? `${esc(r.name)} · ` : ''}${esc(r.label)}</b><span>${esc(r.players)} of ${esc(r.max)} seats taken · bots hold the rest</span><div class="pips">${Array.from({ length: Math.min(r.max, 32) }, (_, i) => `<i${i < r.players ? ' class="on"' : ''}></i>`).join('')}</div></div><div class="room-acts">${r.watch ? `<a class="watchb" href="${esc(r.watch)}" aria-label="Watch ${names ? `${esc(r.name)} · ` : ''}${esc(r.label)}">${icon('eye', 'ico')}<span>Watch</span></a>` : ''}<a class="join" href="${esc(r.play)}" data-play>Join</a></div></li>`).join('');
}

const fmtDay = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };

function postCard(p) {
  return `<a class="pcard reveal" href="/posts/${esc(p.slug)}/">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ''}<time datetime="${esc(p.date)}" class="post-meta">${esc(fmtDay(p.date))}</time><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p></a>`;
}

const KIND_WORD = { song: 'Song', score: 'Score', loop: 'Loop', stem: 'Stem', sfx: 'Sound', trailer: 'Trailer', 'music-video': 'Music video', cutscene: 'Cutscene', clip: 'Clip' };
const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const fileOf = (e, role) => (e.files ?? []).find((f) => f.role === role) ?? null;

/**
 * A song's cover (a video's poster), wherever it is drawn (its page, a card, the directory's manifest): its own
 * file, else the manifest's default (music/manifest.json `cover`, videos/manifest.json `poster`, which the build
 * gives every entry without one), else the landing still of the game it was made for (`for.game`), else the
 * studio's share picture (site/theme.json `social`). Null when there is none of these.
 */
export function mediaArt(e, kind, cat = null) {
  const own = fileOf(e, kind === 'music' ? 'cover' : 'poster');
  if (own?.url) return own.url;
  const game = e.for?.game ? (cat?.games ?? []).find((g) => g.id === e.for.game) : null;
  return (game ? gameCover(game) : null) ?? cat?.studio?.theme?.social ?? null;
}

function mediaCard(e, kind, cat = null) {
  const art = mediaArt(e, kind, cat);
  return `<a class="media-card reveal" href="/${kind}/${esc(e.slug)}/"><span class="art">${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}<span class="big">${PLAY_ICON}</span></span><span class="cap"><b>${esc(e.title)}</b><span>${esc(KIND_WORD[e.kind] ?? (kind === 'music' ? 'Music' : 'Video'))}${e.duration ? ` · ${esc(fmtTime(e.duration))}` : ''}</span></span></a>`;
}

/* ------------------------------------------------------------------ Home */

/** The studio's featured game: studio.json `site.featured`, else the first with its own footage, else the first with art. */
export function featuredOf(cat) {
  const games = cat.games ?? [];
  const want = cat.studio?.site?.featured;
  return games.find((g) => g.id === want) ?? games.find((g) => g.landing?.hero?.wide || g.landing?.hero?.tall) ?? games.find((g) => coverOf(g)) ?? games[0] ?? null;
}

export function homePage(cat, { origin = '', rooms = [], live = {} } = {}) {
  const name = studioName(cat);
  const games = cat.games ?? [];
  const posts = (cat.posts ?? []).slice(0, 3);
  const songs = cat.songs ?? [];
  const videos = cat.videos ?? [];
  const f = featuredOf(cat);
  const tagline = cat.studio?.tagline ?? '';
  let hero;
  let soon = '';
  if (f) {
    const playing = live[f.id] ?? 0;
    hero = `<section class="hero home" aria-labelledby="hero-title">
  ${heroMedia(f.landing?.hero, { alt: f.landing?.hero?.alt })}
  <div class="hero-copy">
    <p class="kicker">${esc(name)}<span class="k-opt"> · ${esc(tagline || 'featured game')}</span></p>
    <h1 class="title ${titleClass(f.name)}" id="hero-title">${esc(f.name)}</h1>
    <p class="line">${esc(f.landing?.pitch ?? f.blurb)}</p>
    <div class="row"><a class="play" href="/${esc(f.id)}/play" data-play>${PLAY_ICON}<span>Play now — free</span></a>${liveLine(f, playing, { idle: 'Bots hold every empty seat · press Play and you are in a round' })}</div>
    <a class="also" href="/${esc(f.id)}/">${icon('arrow')}<span>About ${esc(f.name)}</span></a>${games.length > 1 ? `<a class="also" href="/games/">${icon('games')}<span>All ${games.length} games</span></a>` : ''}
  </div>
</section>`;
  } else if (!videos.length && !songs.length) {
    // A new studio with nothing published yet: its own Home, its name, "First game coming soon", and what is on the
    // way (a studio is never given a starter game it did not ask for). Its posts show below as soon as it has any.
    hero = `<section class="hero home soon" aria-labelledby="hero-title">
  ${heroMedia({}, { word: name })}
  <div class="hero-copy">
    <p class="kicker">${esc(tagline || 'A Homie studio')}</p>
    <h1 class="title ${titleClass(name)}" id="hero-title">${esc(name)}</h1>
    <p class="line">First game coming soon.</p>
    <p class="live"><span class="live-dot" aria-hidden="true"></span><span>${posts.length ? 'In the making · the latest news is below' : 'In the making'}</span></p>
  </div>
</section>`;
    const next = [
      ['Games', 'The first game', 'It opens here with a Play button: a live public room on a phone, a computer or a TV, with bots in the empty seats.'],
      ['Posts', 'News and drops', 'The studio\'s posts land on this page, with feeds to follow.'],
      ['Music and videos', 'Songs and trailers', 'Scores, songs and trailers get pages of their own.'],
    ];
    soon = `<section class="band glowband" aria-labelledby="soon-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">On the way</p><h2 class="small-h" id="soon-title">${esc(`Coming to ${name}`)}</h2></div></div>
  <div class="cards">${next.map(([k, t, d]) => `<div class="pcard reveal" data-soon><p class="post-meta">${esc(k)}</p><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
</div></section>`;
  } else {
    const lead = videos[0] ?? songs[0] ?? null;
    const art = lead ? mediaArt(lead, videos[0] ? 'videos' : 'music', cat) : null;
    hero = `<section class="hero home" aria-labelledby="hero-title">
  ${heroMedia(art ? { wideImage: art } : {}, { word: name })}
  <div class="hero-copy">
    <p class="kicker">${esc(tagline || (songs.length ? 'Music' : videos.length ? 'Videos' : 'A Homie studio'))}</p>
    <h1 class="title ${titleClass(name)}" id="hero-title">${esc(name)}</h1>
    ${lead ? `<p class="line">${esc(lead.title)}${lead.blurb ? ` — ${esc(lead.blurb)}` : ''}</p><div class="row"><a class="play" href="/${videos[0] ? 'videos' : 'music'}/${esc(lead.slug)}/">${PLAY_ICON}<span>${videos[0] ? 'Watch' : 'Listen'}</span></a></div>` : `<p class="line">${esc(tagline || 'Nothing published yet.')}</p>`}
  </div>
</section>`;
  }
  const roomsBand = games.length ? `<section class="band tight glowband" aria-labelledby="live-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">Live now</p><h2 class="small-h" id="live-title">${rooms.length ? `${esc(rooms.reduce((n, r) => n + r.players, 0))} playing across ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}` : 'Rooms open the moment you press Play'}</h2></div><a class="more" href="/rooms/">All rooms ${icon('arrow')}</a></div>
  <ol class="rooms" data-rooms data-src="/api/rooms"${rooms.length ? '' : ' hidden'}>${roomRows(rooms.slice(0, 6))}</ol>
  <p class="quiet" data-rooms-quiet${rooms.length ? ' hidden' : ''}>Nobody is in a room right now. Press Play on any game: you start at once with bots in the empty seats, and the next person who presses Play joins you.</p>
</div></section>` : '';
  const gamesBand = games.length ? `<section class="band" aria-labelledby="games-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">Games</p><h2 id="games-title">${esc(games.length === 1 ? `One game, live now` : `${games.length} games, live now`)}</h2></div>${games.length > 3 ? `<a class="more" href="/games/">All games ${icon('arrow')}</a>` : ''}</div>
  <div class="cards">${games.slice(0, 6).map((g) => gameCard(g, live[g.id] ?? 0)).join('')}</div>
</div></section>` : '';
  const postsBand = posts.length ? `<section class="band hotband" aria-labelledby="posts-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">Posts</p><h2 id="posts-title">From the studio</h2></div><a class="more" href="/posts/">All posts ${icon('arrow')}</a></div>
  <div class="cards posts">${posts.map(postCard).join('')}</div>
</div></section>` : '';
  const mediaBand = (list, kind, title) => (list.length ? `<section class="band" aria-labelledby="${kind}-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">${kind === 'music' ? 'Music' : 'Videos'}</p><h2 id="${kind}-title">${esc(title)}</h2></div><a class="more" href="/${kind}/">All ${kind === 'music' ? 'music' : 'videos'} ${icon('arrow')}</a></div>
  <div class="cards">${list.slice(0, 3).map((e) => mediaCard(e, kind, cat)).join('')}</div>
</div></section>` : '');
  const extra = partial(cat, 'home');
  return layout(cat, {
    title: tagline ? `${name} — ${tagline}` : name,
    description: tagline || (f ? `${name}: ${games.map((g) => g.name).join(', ')}. Free in your browser, on a phone, a computer or a TV.` : soon ? `${name}: first game coming soon.` : name),
    origin, path: '/', image: f ? (f.landing?.hero?.wideImage ?? coverOf(f)) : null, page: 'home', hero: true,
    head: f?.landing?.hero?.wideImage ? `<link rel="preload" as="image" href="${esc(f.landing.hero.tallImage ?? f.landing.hero.wideImage)}">` : '',
    main: `${hero}${extra ? `<section class="band">${extra}</section>` : ''}${roomsBand}${gamesBand}${postsBand}${soon}${mediaBand(videos, 'videos', 'Trailers and clips')}${mediaBand(songs, 'music', 'Songs and scores')}`,
  });
}

/* ------------------------------------------------------------------ Games, Rooms, Posts */

function pageHead(kicker, title, lead, extra = '') {
  return `<header class="head"><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}${extra}</header>`;
}

export function gamesPage(cat, { origin = '', live = {} } = {}) {
  const games = cat.games ?? [];
  const name = studioName(cat);
  return layout(cat, {
    title: `Games · ${name}`, description: `Every game from ${name}: press Play and you are in a live room.`, origin, path: '/games/', page: 'games', active: 'games',
    main: `${pageHead(name, 'Games', `${games.length === 1 ? 'One game' : `${games.length} games`}. Press Play on a phone, a computer or a TV browser and you are in a live public room with whoever is playing; bots hold the empty seats.`)}
<div class="wrap"><div class="cards">${games.map((g) => gameCard(g, live[g.id] ?? 0)).join('')}</div></div>`,
  });
}

export function roomsPage(cat, { origin = '', rooms = [] } = {}) {
  const name = studioName(cat);
  const games = cat.games ?? [];
  const total = rooms.reduce((n, r) => n + r.players, 0);
  return layout(cat, {
    title: `Rooms · ${name}`, description: `Public rooms playing now across ${name}'s games. Join one.`, origin, path: '/rooms/', page: 'rooms', active: 'rooms',
    main: `${pageHead('Live now', 'Rooms', rooms.length ? `${total} ${total === 1 ? 'person' : 'people'} playing in ${rooms.length} public ${rooms.length === 1 ? 'room' : 'rooms'} right now. Join one, or press Play on any game.` : `Public rooms across ${name}'s games, as they happen.`)}
<div class="wrap">
  <ol class="rooms" data-rooms data-src="/api/rooms"${rooms.length ? '' : ' hidden'}>${roomRows(rooms)}</ol>
  <div class="quiet" data-rooms-quiet${rooms.length ? ' hidden' : ''}>Nobody is in a room right now. Press Play on any game below: you start at once with bots in the empty seats, and whoever presses Play next lands in your room.</div>
  <p class="sec">Start one</p>
  <div class="cards">${games.map((g) => gameCard(g, 0)).join('')}</div>
</div>`,
  });
}

export function postsPage(cat, { origin = '' } = {}) {
  const posts = cat.posts ?? [];
  const name = studioName(cat);
  const gameName = (id) => (cat.games ?? []).find((g) => g.id === id)?.name;
  const items = posts.map((p) => `<li class="pitem reveal"><a href="/posts/${esc(p.slug)}/"><div><time datetime="${esc(p.date)}">${esc(fmtDay(p.date))}</time><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>${p.links?.game && gameName(p.links.game) ? `<div class="chips"><span>${esc(gameName(p.links.game))}</span></div>` : ''}</div>${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ''}</a></li>`).join('');
  return layout(cat, {
    title: `Posts · ${name}`, description: `News and drops from ${name}.`, origin, path: '/posts/', page: 'posts', active: 'posts',
    main: `${pageHead(name, 'Posts', 'News, drops and notes from the studio.', `<div class="feeds"><a href="/posts/feed.xml">${icon('feed')}Atom feed</a><a href="/posts/feed.json">${icon('feed')}JSON feed</a></div>`)}
<div class="wrap"><ol class="plist">${items}</ol></div>`,
  });
}

export function postPage(cat, p, { origin = '' } = {}) {
  const name = studioName(cat);
  const g = p.links?.game ? (cat.games ?? []).find((x) => x.id === p.links.game) : null;
  const song = p.links?.song ? (cat.songs ?? []).find((x) => x.slug === p.links.song) : null;
  const video = p.links?.video ? (cat.videos ?? []).find((x) => x.slug === p.links.video) : null;
  const others = (cat.posts ?? []).filter((x) => x.slug !== p.slug).slice(0, 2);
  const extra = partial(cat, 'post', { 'post.title': p.title, 'post.slug': p.slug });
  const linked = [g ? gameCard(g) : '', video ? mediaCard(video, 'videos', cat) : '', song ? mediaCard(song, 'music', cat) : ''].filter(Boolean).join('');
  return layout(cat, {
    title: `${p.title} · ${name}`, description: p.summary, origin, path: `/posts/${p.slug}/`, image: p.image ?? (g ? coverOf(g) : null), type: 'article', page: 'post', active: 'posts',
    head: `<meta property="article:published_time" content="${esc(p.date)}">${p.updated ? `<meta property="article:modified_time" content="${esc(p.updated)}">` : ''}`,
    main: `<div class="wrap" style="padding-top:clamp(36px,7vw,90px)"><article class="article">
  <p class="post-meta"><time datetime="${esc(p.date)}">${esc(fmtDay(p.date))}</time>${p.author ? ` · ${esc(p.author)}` : ''}</p>
  <h1>${esc(p.title)}</h1>
  ${p.summary ? `<p class="dek">${esc(p.summary)}</p>` : ''}
  ${p.image ? `<div class="cover"><img src="${esc(p.image)}" alt="" decoding="async"></div>` : ''}
  <div class="prose">${p.html ?? ''}</div>
  ${linked ? `<div class="linked cards">${linked}</div>` : ''}
  ${extra ?? ''}
</article>
${others.length ? `<p class="sec" style="max-width:760px;margin-left:auto;margin-right:auto">More from ${esc(name)}</p><div class="cards posts" style="max-width:760px;margin:0 auto">${others.map(postCard).join('')}</div>` : ''}
</div>`,
  });
}

/* ------------------------------------------------------------------ feeds */

const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const absHtml = (html, origin) => String(html ?? '').replace(/(href|src)="\/(?!\/)/g, `$1="${origin}/`);

/** Atom 1.0: every post, newest first, with its full HTML (links made absolute). */
export function atomFeed(cat, posts, origin) {
  const name = studioName(cat);
  const updated = posts.reduce((m, p) => ((p.updated ?? p.date) > m ? (p.updated ?? p.date) : m), posts[0]?.date ?? new Date(0).toISOString());
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(name)}</title>
  <subtitle>${xml(cat.studio?.tagline ?? `News and drops from ${name}`)}</subtitle>
  <id>${xml(`${origin}/posts/`)}</id>
  <link rel="alternate" type="text/html" href="${xml(`${origin}/posts/`)}"/>
  <link rel="self" type="application/atom+xml" href="${xml(`${origin}/posts/feed.xml`)}"/>
  <updated>${xml(updated)}</updated>
  <author><name>${xml(name)}</name><uri>${xml(`${origin}/`)}</uri></author>
  <generator uri="https://homie.rocks/studio/">Homie</generator>
${posts.map((p) => `  <entry>
    <title>${xml(p.title)}</title>
    <id>${xml(`${origin}/posts/${p.slug}/`)}</id>
    <link rel="alternate" type="text/html" href="${xml(`${origin}/posts/${p.slug}/`)}"/>
    <published>${xml(p.date)}</published>
    <updated>${xml(p.updated ?? p.date)}</updated>
    ${p.author ? `<author><name>${xml(p.author)}</name></author>` : ''}
    <summary>${xml(p.summary)}</summary>
    <content type="html">${xml(absHtml(p.html, origin))}</content>
  </entry>`).join('\n')}
</feed>
`;
  return new Response(body, { headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
}

/**
 * JSON Feed 1.1. Each item also carries `_homie.record`: the post as a record (title, text, createdAt, links to a
 * game, song or video by id) in the shape it takes when studios publish posts to atproto later.
 */
export function jsonFeed(cat, posts, origin) {
  const name = studioName(cat);
  const body = {
    version: 'https://jsonfeed.org/version/1.1',
    title: name,
    home_page_url: `${origin}/`,
    feed_url: `${origin}/posts/feed.json`,
    ...(cat.studio?.tagline ? { description: cat.studio.tagline } : {}),
    authors: [{ name, url: `${origin}/` }],
    language: 'en',
    items: posts.map((p) => ({
      id: `${origin}/posts/${p.slug}/`,
      url: `${origin}/posts/${p.slug}/`,
      title: p.title,
      summary: p.summary,
      content_html: absHtml(p.html, origin),
      date_published: p.date,
      ...(p.updated ? { date_modified: p.updated } : {}),
      ...(p.image ? { image: p.image.startsWith('/') ? `${origin}${p.image}` : p.image } : {}),
      ...(p.author ? { authors: [{ name: p.author }] } : {}),
      _homie: {
        links: Object.fromEntries(Object.entries(p.links ?? {}).map(([k, id]) => [k, { id, url: `${origin}${k === 'game' ? `/${id}/` : k === 'song' ? `/music/${id}/` : `/videos/${id}/`}` }])),
        record: p.record ?? null,
      },
    })),
  };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, { headers: { 'content-type': 'application/feed+json; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
}

/* ------------------------------------------------------------------ a game's landing */

/**
 * The landing every game gets: a full-bleed hero from its own footage or art, the pitch, a big Play button into a
 * public room, phone / computer / TV (with the join code), live rooms, how to play, credits, and "Make a game like
 * this". A studio's site/pages/<id>/index.html replaces it; site/partials/game.html and game-<id>.html add a band.
 */
export function gameLanding(cat, g, { origin = '', rooms = [], playing = 0, week = null, remix = true } = {}) {
  const name = studioName(cat);
  const L = g.landing ?? {};
  // A remix says what it is a remix of, linked, under its name and in its credits (game.json `remixOf`).
  const lineage = remixRow(g.remixOf);
  const ofWhat = lineage ? `${lineage.page ? `<a href="${esc(lineage.page)}" rel="noopener">${esc(lineage.name)}</a>` : `<strong>${esc(lineage.name)}</strong>`}${lineage.studio ? ` by ${esc(lineage.studio)}` : ''}` : '';
  // Open to remix: the source is in the build, the owner's switch is on, and the licence they picked allows it.
  const license = licenseOf(g.license);
  const remixable = Boolean(L.source) && remix !== false && license.kind !== 'no-remix';
  const h = L.hero ?? {};
  const host = origin.replace(/^https?:\/\//, '');
  const playUrl = `${origin}/${g.id}/play`;
  let qr = '';
  try { qr = qrSvg(playUrl, { title: `Play ${g.name} on your phone` }); } catch { qr = ''; }
  const tvOn = L.tv !== false;
  const max = g.players?.max ?? 8;
  const words = L.words ?? {};
  const many = words.many ?? 'players';
  const kicker = L.kicker ?? `Free in your browser · <span class="k-opt">phone, computer or TV · </span>no download`;
  const kickerHtml = L.kicker ? esc(L.kicker) : kicker;
  const trailer = L.trailer ? (cat.videos ?? []).find((v) => v.slug === L.trailer) : null;
  const song = (L.music ?? []).map((s) => (cat.songs ?? []).find((m) => m.slug === s)).find(Boolean) ?? null;
  const hero = `<section class="hero" aria-labelledby="game-title">
  ${heroMedia(h, { alt: h.alt })}
  <div class="hero-copy">
    <p class="kicker">${kickerHtml}</p>
    <h1 class="title ${titleClass(g.name)}" id="game-title">${esc(g.name)}</h1>
    ${lineage ? `<p class="remix-of">Remix of ${ofWhat}</p>` : ''}
    <p class="line">${esc(L.pitch ?? g.blurb)}</p>
    <div class="row">
      <a class="play" href="/${esc(g.id)}/play" data-play>${PLAY_ICON}<span>Play now — free</span></a>
      ${liveLine(g, playing, { idle: `Bots hold every empty seat · one tap and you are in` })}
    </div>
    ${tvOn ? `<a class="also" href="#anywhere">${icon('tv')}<span>Or put it on the big screen</span></a>` : ''}${playing > 0 && rooms.length && watchOf(g) !== 'off' ? `<a class="also" href="/${esc(g.id)}/watch">${icon('eye')}<span>Watch a live room</span></a>` : ''}${trailer ? `<a class="also" href="/videos/${esc(trailer.slug)}/">${icon('videos')}<span>Watch the trailer</span></a>` : ''}${g.saves ? `<a class="also" href="/account/?next=${encodeURIComponent(`/${g.id}/play`)}" data-account>${icon('spark')}<span>Your progress follows you: sign in</span></a>` : ''}
  </div>
</section>`;

  const ways = `<section class="band glowband" id="anywhere" aria-labelledby="anywhere-title"><div class="band-in split">
  <div class="reveal">
    <p class="kicker">Phone · computer${tvOn ? ' · TV' : ''}</p>
    <h2 id="anywhere-title">${tvOn ? 'Play it on anything. Put it on the TV.' : 'Play it on your phone or your computer.'}</h2>
    <p class="lead">Nothing to download and nothing to install: ${esc(g.name)} runs in the browser you already have, and everyone who presses Play meets in the same public room.</p>
    <ol class="ways">
      <li class="way"><span class="n">${icon('phone')}</span><div><h3>On your phone</h3><p>${esc(L.controls?.phone ?? 'Touch controls appear under your thumbs; the middle of the screen stays clear.')}</p>
        <div class="scan desk-only">${qr ? `<span class="qr" role="img" aria-label="A code for your phone’s camera: ${esc(host)}/${esc(g.id)}/play">${qr}</span>` : ''}<p>Point your phone’s camera at the code, or open <span class="addr">${esc(host)}/${esc(g.id)}/play</span>.</p></div>
        <p class="phone-only" style="margin-top:8px"><strong>You are on it:</strong> press Play above.</p></div></li>
      <li class="way"><span class="n">${icon('computer')}</span><div><h3>On your computer</h3><p>${esc(L.controls?.computer ?? 'Keys and mouse, in any modern browser; the game shows you which keys.')}</p></div></li>
      ${tvOn ? `<li class="way"><span class="n">${icon('tv')}</span><div><h3>On the TV</h3><ol><li>Open <span class="addr">${esc(host)}/${esc(g.id)}/tv</span> in the TV’s browser, or on a laptop plugged into it.</li><li>Scan the code it shows with your phone’s camera.</li><li>Play on your phone. Everyone on the couch joins the same way, up to ${esc(max)} ${esc(many)}, and the TV shows the whole room.</li></ol>${L.controls?.tv ? `<p style="margin-top:8px">${esc(L.controls.tv)}</p>` : ''}</div></li>` : ''}
    </ol>
    <div class="keys">${tvOn ? `<a class="ghost" href="/${esc(g.id)}/tv">${icon('tv')}<span>Open the big-screen view</span></a>` : ''}<a class="ghost desk-only" href="/${esc(g.id)}/play" data-play>${icon('computer')}<span>Play in this browser</span></a></div>
  </div>
  ${tvOn ? `<figure class="tvart reveal" aria-hidden="true"><div class="screen">${h.wideImage || L.cover ? `<img src="${esc(h.wideImage ?? L.cover)}" alt="" loading="lazy" decoding="async">` : ''}${qr ? `<span class="qr">${qr}</span>` : ''}</div><span class="phone p1"></span><span class="phone p2"></span></figure>` : ''}
</div></section>`;

  const liveBand = `<section class="band tight" aria-labelledby="rooms-title"><div class="band-in">
  <div class="head-row reveal"><div><p class="kicker">Live rooms</p><h2 class="small-h" id="rooms-title">${rooms.length ? `${esc(playing)} ${playing === 1 ? esc(words.one ?? 'player') : esc(many)} in ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} right now` : 'Rooms open the moment you press Play'}</h2></div><a class="more" href="/rooms/">Every room ${icon('arrow')}</a></div>
  <ol class="rooms" data-rooms data-src="/${esc(g.id)}/live"${rooms.length ? '' : ' hidden'}>${roomRows(rooms, { names: false })}</ol>
  <p class="quiet" data-rooms-quiet${rooms.length ? ' hidden' : ''}>No one is in a room this minute. Press Play and you start at once, with bots in the empty seats; whoever presses Play next takes a bot’s place in your room.</p>
  ${week ? `<div class="stat"><span>Played this week: <b>${esc(week.plays)}</b> ${week.plays === 1 ? 'time' : 'times'}</span><span><b>${esc(week.rounds)}</b> ${week.rounds === 1 ? 'round' : 'rounds'} with people</span>${week.peak ? `<span>Most at once today: <b>${esc(week.peak)}</b></span>` : ''}</div>` : ''}
</div></section>`;

  const facts = ['free, in the browser', 'bots fill empty seats', 'join any time: take a bot’s place', 'rounds restart on their own', ...(tvOn ? ['phones as controllers on a TV'] : [])];
  const side = trailer ? mediaCard(trailer, 'videos', cat) : song ? mediaCard(song, 'music', cat) : (L.cover ? `<figure class="media-card reveal" style="margin:0"><span class="art"><img src="${esc(L.cover)}" alt="${esc(g.name)}, a moment of play" loading="lazy"></span><figcaption class="cap"><b>${esc(g.name)}</b><span>${esc(playersText(g))}${minutes(g.roundSeconds) ? ` · ${esc(minutes(g.roundSeconds))}` : ''}</span></figcaption></figure>` : '');
  const howBand = `<section class="band hotband" aria-labelledby="how-title"><div class="band-in split">
  <div class="reveal">
    <p class="kicker">How to play</p>
    <h2 class="small-h" id="how-title">${esc(L.headline ?? `${g.players?.max > 1 ? `Up to ${g.players.max} players` : 'One player'}${minutes(g.roundSeconds) ? `, ${minutes(g.roundSeconds)}` : ''}.`)}</h2>
    ${L.about ? `<p class="lead">${esc(L.about)}</p>` : ''}
    ${(L.how ?? []).length ? `<ul class="howto">${L.how.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <ul class="facts">${facts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>
  ${side ? `<div>${side}${trailer && song ? `<div style="margin-top:14px">${mediaCard(song, 'music', cat)}</div>` : ''}</div>` : ''}
</div></section>`;

  const C = L.credits ?? {};
  const o = C.original;
  const creditCards = [
    `<div class="credit"><h3>Made by</h3><p><strong><a href="/">${esc(name)}</a></strong>${cat.studio?.tagline ? ` · ${esc(cat.studio.tagline)}` : ''}</p>${(C.people ?? []).length ? `<ul>${C.people.map((c) => `<li>${c.role ? `${esc(c.role)}: ` : ''}${c.url ? `<a href="${esc(c.url)}" rel="noopener">${esc(c.name)}</a>` : `<strong>${esc(c.name)}</strong>`}</li>`).join('')}</ul>` : ''}</div>`,
    lineage ? `<div class="credit"><h3>Remix of</h3><p>${ofWhat}.</p>${lineage.page ? `<p><a href="${esc(lineage.page)}" rel="noopener">${esc(lineage.page.replace(/^https:\/\//, ''))}</a></p>` : ''}</div>` : '',
    o && !o.house ? `<div class="credit"><h3>Based on</h3><p><strong>${esc(o.title)}</strong>${o.author ? ` by <strong>${esc(o.author)}</strong>` : ''}${o.year ? ` (${esc(o.year)})` : ''}${o.licence ? `, ${esc(o.licence)} licence` : ''}.</p>${o.url ? `<p><a href="${esc(o.url)}" rel="noopener">${esc(o.url.replace(/^https:\/\//, ''))}</a></p>` : ''}<p>Made multiplayer with Homie: public rooms, bots, join-in-progress, a new host when one leaves, touch controls and the big screen.</p></div>` : '',
    (C.parts ?? []).length ? `<div class="credit"><h3>Also inside</h3><ul>${C.parts.map((p) => `<li>${esc(p.what)}${p.author ? `: ${esc(p.author)}` : ''}${p.url ? ` (<a href="${esc(p.url)}" rel="noopener">source</a>)` : ''}${p.licence ? `, ${p.licenceUrl ? `<a href="${esc(p.licenceUrl)}" rel="noopener">${esc(p.licence)}</a>` : esc(p.licence)}` : ''}</li>`).join('')}</ul></div>` : '',
    `<div class="credit"><h3>Built with</h3><p>Homie’s open engine: <a href="https://github.com/homie-rocks/homie" rel="noopener">@homie-rocks/studio</a> (rooms, netplay, the big screen), Apache-2.0.</p>${L.source ? `<p>Its source: ${esc(licenseLabel(license))}.</p>` : ''}${C.texts ? `<p><a href="/${esc(g.id)}/credits">Licences and full credits</a></p>` : ''}</div>`,
  ].filter(Boolean).join('');
  const creditsBand = `<section class="band tight" aria-labelledby="credits-title"><div class="band-in"><p class="kicker reveal">Credits</p><h2 class="small-h reveal" id="credits-title">Who made ${esc(g.name)}</h2><div class="credits reveal">${creditCards}</div></div></section>`;

  const source = `${origin}/games/${g.id}/source.json`;
  const say = remixable
    ? `Remix ${g.name} from ${source} into a game of my own in my Homie studio`
    : `Make a multiplayer game like ${g.name} in my Homie studio`;
  const makeHref = remixable ? `https://homie.rocks/studio/?remix=${encodeURIComponent(source)}` : 'https://homie.rocks/studio/';
  const makeBand = `<section class="band" aria-labelledby="make-title"><div class="band-in"><div class="make reveal">
  <p class="kicker">${remixable ? 'Open to remix' : 'Your turn'}</p>
  <h2 id="make-title">Make a game like this</h2>
  <p class="lead">${remixable ? `${esc(g.name)}’s source is shared. Homie is a plugin for Claude Code and Codex: your AI copies this game into a studio of your own, makes it yours, and puts it online with public rooms like these, on your own free Cloudflare account.` : `Homie is a plugin for Claude Code and Codex: your AI sets up a studio of your own and makes a multiplayer game like ${esc(g.name)}, with public rooms like these, on your own free Cloudflare account.`}</p>
  <ol class="say">
    <li><div><span class="label">1 · In Claude Code</span><code>/plugin marketplace add homie-rocks/homie</code></div><button class="copy" type="button" data-copy="/plugin marketplace add homie-rocks/homie">${icon('copy')}<span data-copy-word>Copy</span></button></li>
    <li><div><span class="label">2</span><code>/plugin install homie@homie</code></div><button class="copy" type="button" data-copy="/plugin install homie@homie">${icon('copy')}<span data-copy-word>Copy</span></button></li>
    <li><div><span class="label">3 · Then say</span><code>${esc(say)}</code></div><button class="copy" type="button" data-copy="${esc(say)}">${icon('copy')}<span data-copy-word>Copy</span></button></li>
  </ol>
  <div class="keys"><a class="btn" href="${esc(makeHref)}">${icon('spark')}<span>Make a game like this</span></a>${remixable ? `<a class="ghost" href="/games/${esc(g.id)}/source.json">See the source</a>` : ''}</div>
</div></div></section>`;

  // A partial that is its own <section> stands as it is; anything else sits in one of the page's bands.
  const band = (html) => (!html ? '' : /^\s*<section\b/i.test(html) ? html : `<section class="band tight"><div class="band-in">${html}</div></section>`);
  const vars = { 'game.name': g.name, 'game.id': g.id, 'game.play': `/${g.id}/play` };
  const ld = { '@context': 'https://schema.org', '@type': 'VideoGame', name: g.name, description: L.pitch ?? g.blurb ?? '', url: `${origin}/${g.id}/`, playMode: 'MultiPlayer', gamePlatform: ['Web browser', 'Phone', 'TV'], applicationCategory: 'Game', ...(h.wideImage ? { image: `${origin}${h.wideImage}` } : {}), author: { '@type': 'Organization', name, url: `${origin}/` }, offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' } };
  return layout(cat, {
    title: `${g.name} — play free in your browser`,
    description: `${g.name}: ${L.pitch ?? g.blurb ?? ''} Free in your browser, nothing to download; a TV or laptop browser can be the big screen, with phones as controllers.`.replace(/\s+/g, ' ').trim(),
    origin, path: `/${g.id}/`, image: h.wideImage ?? L.cover ?? null, page: 'landing', hero: true, active: 'games', over: landingTokens(cat, L),
    head: `${h.tallImage || h.wideImage ? `<link rel="preload" as="image" href="${esc(h.tallImage ?? h.wideImage)}"${h.tallImage && h.wideImage ? ' media="(max-aspect-ratio: 3/4)"' : ''}>${h.tallImage && h.wideImage ? `<link rel="preload" as="image" href="${esc(h.wideImage)}" media="(min-aspect-ratio: 3/4)">` : ''}` : ''}<script type="application/ld+json">${jsonScript(ld)}</script>`,
    main: `${hero}${ways}${liveBand}${howBand}${band(partial(cat, 'game', vars))}${band(partial(cat, `game-${g.id}`, vars))}${creditsBand}${makeBand}`,
  });
}

/** /<game>/credits: the licence texts the game ships with (CREDITS.md and every licence file credits.json names). */
export function creditsPage(cat, g, texts, { origin = '' } = {}) {
  const name = studioName(cat);
  const lineage = remixRow(g.remixOf);
  const of = lineage ? `<p class="sec">Remix of</p><p>${lineage.page ? `<a href="${esc(lineage.page)}" rel="noopener">${esc(lineage.name)}</a>` : esc(lineage.name)}${lineage.studio ? ` by ${esc(lineage.studio)}` : ''}</p>` : '';
  return layout(cat, {
    title: `Credits · ${g.name} · ${name}`, description: `Credits and licences for ${g.name}.`, origin, path: `/${g.id}/credits`, page: 'credits', active: 'games',
    main: `${pageHead(g.name, 'Credits and licences', null, `<div class="keys"><a class="ghost" href="/${esc(g.id)}/">${icon('arrow')}<span>Back to ${esc(g.name)}</span></a></div>`)}
<div class="wrap">${of}${texts.map(({ file, text }) => `<p class="sec">${esc(file)}</p><pre class="licence">${esc(text)}</pre>`).join('')}</div>`,
  });
}

/* ------------------------------------------------------------------ music and videos */

function rightsLine(e) {
  const bits = [];
  if (e.credits) bits.push(esc(e.credits));
  const r = e.rights;
  if (r && typeof r === 'object') {
    if (r.commercial === true) bits.push(`Licensed for commercial use${r.plan ? ` (made on the provider's ${esc(r.plan)} plan)` : ''}.`);
    else if (r.commercial === false) bits.push(`Not licensed for commercial use${r.plan ? ` (made on the provider's ${esc(r.plan)} plan)` : ''}.`);
    if (r.attribution) bits.push(esc(r.attribution));
  }
  if (e.honesty) bits.push(esc(e.honesty));
  return bits.length ? `<p class="rights">${bits.join(' ')}</p>` : '';
}

/** The page's one stats beacon: when its player first starts, one POST to /api/stats/beat (worker/stats.mjs). */
const beaconAttr = (kind, slug) => ` data-beat="${esc(JSON.stringify({ k: kind, s: slug }))}"`;

/** /music/ and /videos/: every published entry of one kind (the site answers 404 when there is none). */
export function mediaIndexPage(cat, kind, { origin = '' } = {}) {
  const name = studioName(cat);
  const list = (kind === 'music' ? cat.songs : cat.videos) ?? [];
  const title = kind === 'music' ? 'Music' : 'Videos';
  return layout(cat, {
    title: `${title} · ${name}`, description: `${title} from ${name}.`, origin, path: `/${kind}/`, page: kind, active: kind,
    main: `${pageHead(name, title, kind === 'music' ? 'Songs, scores and loops from the studio.' : 'Trailers, music videos and clips from the studio.')}
<div class="wrap"><div class="cards">${list.map((e) => mediaCard(e, kind, cat)).join('')}</div></div>`,
  });
}

export function songPage(cat, e, origin = '') {
  const name = studioName(cat);
  const audio = fileOf(e, 'audio');
  const coverUrl = mediaArt(e, 'music', cat);
  const cover = coverUrl ? { url: coverUrl } : null;
  const extras = (e.files ?? []).filter((f) => f.role === 'loop' || f.role === 'stem');
  const game = e.for?.game && (cat.games ?? []).find((g) => g.id === e.for.game);
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  return layout(cat, {
    title: `${e.title} · ${name}`, description: e.blurb ?? '', origin, path: `/music/${e.slug}/`, image: cover?.url ?? null, type: 'music.song', page: 'song', active: 'music',
    head: ogTags({ 'og:audio': abs(audio.url) }),
    main: `<div class="wrap" style="padding-top:clamp(36px,7vw,90px)">
  <section class="songhead${cover ? ' has-cover' : ''}">
    <div>
      <p class="kicker">${esc(KIND_WORD[e.kind] ?? 'Music')}</p>
      <h1 class="title ${titleClass(e.title)}">${esc(e.title)}</h1>
      ${e.blurb ? `<p class="lead">${esc(e.blurb)}</p>` : ''}
      <div class="player"${beaconAttr('song', e.slug)}><audio controls preload="metadata" src="${esc(audio.url)}"></audio></div>
      <div class="mfacts">${[KIND_WORD[e.kind], e.duration ? fmtTime(e.duration) : null, e.bpm ? `${e.bpm} BPM` : null, e.key].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${game ? `<a href="/${esc(game.id)}/">${esc(game.name)}</a>` : ''}</div>
    </div>
    ${cover ? `<img class="cover" src="${esc(cover.url)}" alt="">` : ''}
  </section>
  ${e.lyrics ? `<p class="sec">Words</p><div class="lyrics">${esc(e.lyrics)}</div>` : ''}
  ${extras.length ? `<p class="sec">Loops and stems</p><ul class="files">${extras.map((f) => `<li><a href="${esc(f.url)}" download><b>${esc(f.name ?? (f.role === 'loop' ? 'Loop' : 'Stem'))}</b><span>${esc([f.role, f.bars ? `${f.bars} bars` : null, f.bytes ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : null].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>` : ''}
  ${game ? `<div class="keys"><a class="btn" href="/${esc(game.id)}/play" data-play>${PLAY_ICON}<span>Play ${esc(game.name)}</span></a></div>` : ''}
  ${rightsLine(e)}
</div>`,
  });
}

export function videoPage(cat, e, origin = '') {
  const name = studioName(cat);
  const video = fileOf(e, 'video');
  const vertical = fileOf(e, 'vertical');
  const posterUrl = mediaArt(e, 'videos', cat);
  const poster = posterUrl ? { url: posterUrl } : null;
  const captions = fileOf(e, 'captions');
  const game = e.for?.game && (cat.games ?? []).find((g) => g.id === e.for.game);
  const song = e.for?.song && (cat.songs ?? []).find((m) => m.slug === e.for.song);
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  return layout(cat, {
    title: `${e.title} · ${name}`, description: e.blurb ?? '', origin, path: `/videos/${e.slug}/`, image: poster?.url ?? null, type: 'video.other', page: 'video', active: 'videos',
    head: ogTags({ 'og:video': abs(video.url) }),
    main: `<div class="wrap" style="padding-top:clamp(28px,5vw,64px)">
  <div class="player"${beaconAttr('video', e.slug)}${vertical ? ` data-vertical="${esc(vertical.url)}"` : ''}><video data-main controls playsinline preload="metadata" src="${esc(video.url)}"${poster ? ` poster="${esc(poster.url)}"` : ''}>${captions ? `<track kind="captions" src="${esc(captions.url)}" srclang="en" label="English">` : ''}</video></div>
  <p class="kicker">${esc(KIND_WORD[e.kind] ?? 'Video')}${e.duration ? ` · ${esc(fmtTime(e.duration))}` : ''}</p>
  <h1 class="title ${titleClass(e.title)}" style="text-shadow:none">${esc(e.title)}</h1>
  ${e.blurb ? `<p class="lead">${esc(e.blurb)}</p>` : ''}
  <div class="mfacts" style="margin-top:14px">${song ? `<a href="/music/${esc(song.slug)}/">${esc(song.title)}</a>` : ''}</div>
  <div class="keys">${game ? `<a class="btn" href="/${esc(game.id)}/play" data-play>${PLAY_ICON}<span>Play ${esc(game.name)}</span></a>` : ''}${vertical ? `<a class="ghost" href="${esc(vertical.url)}">Vertical cut</a>` : ''}</div>
  ${rightsLine(e)}
</div>`,
  });
}

export function notFoundPage(why, cat = null) {
  const c = cat ?? { studio: { name: 'Studio' }, games: [], songs: [], videos: [], posts: [] };
  return layout(c, {
    title: 'Not found', page: 'missing', status: 404,
    main: `${pageHead('404', 'Not here', why, `<div class="keys"><a class="btn" href="/">${icon('home')}<span>Home</span></a>${(c.games ?? []).length ? `<a class="ghost" href="/games/">${icon('games')}<span>Games</span></a>` : ''}</div>`)}`,
  });
}
