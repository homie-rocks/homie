/*
 * A small room HUD for a port that has none of its own: the round clock
 * (top-left chip), the top scores (top-right, four rows at most), and the
 * results card between rounds. Everything is text on small translucent chips;
 * nothing opaque sits in the middle of the screen during play; names are set
 * with textContent (people type them). A big screen (a spectator) gets the
 * same board without any "you"; a watcher following a player (NETPLAY.md
 * section 16) sees that player's row and result marked the way "you" is.
 *
 * A game with its own HUD should draw the same facts itself (clock from
 * room.clock(), results from room.results()) instead.
 */
import type { BodyBase, Room } from './room';

export interface HudOptions {
  /** What a point is called on the board ("gems", "tiles"). */
  unit?: string;
  /** A short controls line shown for the first seconds ("Drag to move · tap to jump"). */
  hint?: { phone: string; desk: string };
  /** Accent colour for "you". */
  accent?: string;
}

const CSS = `
.hp-hud{position:fixed;z-index:2147482000;pointer-events:none;font:600 14px/1.25 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef1f8;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.hp-chip{background:rgba(6,9,18,.55);border-radius:10px;padding:5px 9px;backdrop-filter:blur(4px)}
.hp-clock{left:calc(10px + env(safe-area-inset-left));top:calc(10px + env(safe-area-inset-top))}
.hp-board{right:calc(10px + env(safe-area-inset-right));top:calc(10px + env(safe-area-inset-top));text-align:right;min-width:92px}
.hp-board div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw}
.hp-board .me{color:var(--hp-accent,#ffd166)}
.hp-board .bot{opacity:.62}
.hp-results{left:50%;top:50%;transform:translate(-50%,-50%);min-width:220px;max-width:min(360px,86vw);padding:14px 16px;border-radius:14px;background:rgba(6,9,18,.82)}
.hp-results h2{margin:0 0 8px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--hp-accent,#ffd166)}
.hp-results ol{margin:0;padding-left:20px}
.hp-hint{left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);opacity:.85;transition:opacity .8s}
@media (max-width:540px){.hp-hud{font-size:13px}}
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHud<B extends BodyBase>(room: Room<B, any, any>, opts: HudOptions = {}): { destroy(): void } {
  if (typeof document === 'undefined') return { destroy() {} };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const mk = (cls: string): HTMLDivElement => { const d = document.createElement('div'); d.className = `hp-hud ${cls}`; return d; };
  const clock = mk('hp-chip hp-clock');
  const board = mk('hp-chip hp-board');
  const results = mk('hp-results');
  results.style.display = 'none';
  const hint = mk('hp-chip hp-hint');
  if (opts.accent) document.documentElement.style.setProperty('--hp-accent', opts.accent);
  const phone = Math.min(innerWidth, innerHeight) <= 540;
  const spectator = (): boolean => !room.net.offline && room.net.seat === null;
  if (opts.hint && !spectator()) hint.textContent = phone ? opts.hint.phone : opts.hint.desk; else hint.style.display = 'none';
  const mount = (): void => { document.body.append(clock, board, results, hint); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  const bornAt = performance.now();
  let lastResults = '';

  const paint = (): void => {
    const c = room.clock();
    clock.textContent = c.phase === 'none' ? 'Joining…' : c.phase === 'live' ? `Round ${c.n} · ${Math.floor(c.secondsLeft / 60)}:${String(c.secondsLeft % 60).padStart(2, '0')}` : `Next round in ${c.secondsLeft}`;
    // A watcher's followed player is marked as "you" is (net.watchedSeat says it without claiming the camera follows).
    const me = room.net.watching ? room.net.watchedSeat : room.mySeat();
    const watchingSeat = room.net.watching && me !== null;
    const rows = room.view().slice().sort((a, b) => b.score - a.score || Number(a.bot) - Number(b.bot)).slice(0, phone ? 4 : 5);
    board.textContent = '';
    for (const b of rows) {
      const d = document.createElement('div');
      const mine = (watchingSeat || !spectator()) && me !== null && b.seat === me && !b.bot;
      d.className = mine ? 'me' : b.bot ? 'bot' : '';
      d.textContent = `${mine && !watchingSeat ? 'You' : b.name}${b.bot ? ' · bot' : ''}  ${b.score}`;
      board.append(d);
    }
    const r = room.round;
    if (r && r.phase === 'over' && r.results) {
      const key = `${r.n}:${r.endsAt}:${me}`;
      if (key !== lastResults) {
        lastResults = key;
        results.textContent = '';
        const h = document.createElement('h2'); h.textContent = `Round ${r.n}`;
        const ol = document.createElement('ol');
        for (const row of r.results.slice(0, 6)) {
          const li = document.createElement('li');
          const mine = (watchingSeat || !spectator()) && me !== null && row.seat === me && !row.bot;
          li.textContent = `${mine && !watchingSeat ? 'You' : row.name}${row.bot ? ' (bot)' : ''} — ${row.score}${opts.unit ? ` ${opts.unit}` : ''}`;
          if (mine) li.style.color = 'var(--hp-accent,#ffd166)';
          ol.append(li);
        }
        results.append(h, ol);
      }
      results.style.display = 'block';
    } else results.style.display = 'none';
    if (hint.style.display !== 'none' && performance.now() - bornAt > 9000) hint.style.opacity = '0';
  };
  const timer = setInterval(paint, 200);
  paint();
  return { destroy() { clearInterval(timer); clock.remove(); board.remove(); results.remove(); hint.remove(); style.remove(); } };
}
