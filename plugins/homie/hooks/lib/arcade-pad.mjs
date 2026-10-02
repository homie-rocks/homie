/**
 * The arcade's game pad: a one-line region of the pane that, once clicked, takes the arrow keys (a pane's buttons
 * cannot: Claude Code keeps Tab and the arrows for moving between controls), WASD, space and Enter, and posts each
 * press to the Homie mod, which hands it to the game's browser. Runs on Claude Code's drawing thread, with no mods
 * API and no network: it can only draw and post.
 */
const MAP = {
  up: 'up', down: 'down', left: 'left', right: 'right', w: 'up', a: 'left', s: 'down', d: 'right',
  ' ': 'space', space: 'space', return: 'enter', enter: 'enter', e: 'e', q: 'q', x: 'x', z: 'z',
};

export default function ArcadePad(props, surface) {
  const { Box, Text } = surface.elements;
  if (surface.state === undefined) {
    surface.setState({ presses: 0, last: '' });
    surface.onKey((ev) => {
      const key = MAP[String(ev.key).toLowerCase()];
      if (!key) return;
      surface.post({ key });
      surface.setState({ presses: (surface.state?.presses ?? 0) + 1, last: key });
    });
    surface.onPointer((ev) => { if (ev.type === 'down') surface.post({ focus: true }); });
  }
  const s = surface.state ?? { presses: 0, last: '' };
  const live = s.presses > 0;
  const arrow = { up: '↑', down: '↓', left: '←', right: '→', space: '␣', enter: '⏎' }[s.last] ?? s.last;
  return Box({
    flexDirection: 'row',
    children: [
      Text({ color: live ? 'green' : 'yellow', bold: true, children: [live ? `● playing  ${arrow}   ` : '▶ Click here to play   '] }),
      Text({ dimColor: true, children: [`←↑↓→ or WASD to move · space acts${props && props.hint ? ` · ${props.hint}` : ''} · Esc gives the keys back to Claude`] }),
    ],
  });
}
