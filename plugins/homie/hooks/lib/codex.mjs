/**
 * A Game Codex (`games/<id>/CODEX.md`, the plan skill and @homie-rocks/studio lib/codex.mjs) at a glance, for the
 * Studio pane: its title and pitch, which sections have something in them, the open questions, the milestones and
 * the newest lines under Latest.
 */

const SECTIONS = [
  ['concept', 'Concept', /^(concept|the game|pitch|overview|core loop)\b/i],
  ['world', 'World', /^(world|setting|story|lore|zones?|maps?|levels?)\b/i],
  ['characters', 'Characters', /^(characters|cast|heroes|classes|creatures|monsters|enemies|units|pieces)\b/i],
  ['art', 'Art direction', /^(art|look|style|visual)/i],
  ['controls', 'Controls', /^(controls|devices|input)\b/i],
  ['rooms', 'Rooms and players', /^(rooms|players|multiplayer|netplay)\b/i],
  ['sound', 'Music and sound', /^(music|sound|audio)\b/i],
  ['milestones', 'Milestones', /^(milestones?|plan|roadmap|scope|steps)\b/i],
  ['questions', 'Open questions', /^(open questions|questions|undecided|to decide)\b/i],
];

const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;

/** { title, pitch, sections: [{ key, title, filled }], missing, questions, milestones: [{ done, text }], latest } */
export function summarizeCodex(source) {
  let text = String(source ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  let meta = {};
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const l of fm[1].split('\n')) { const m = /^([A-Za-z][\w-]*):\s*(.+)$/.exec(l); if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
    text = text.slice(fm[0].length);
  }
  let title = null;
  const pitch = [];
  const sections = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h1 = !fence && /^#\s+(.+?)\s*#*\s*$/.exec(line);
    const h2 = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && title === null && !sections.length) { title = h1[1]; continue; }
    if (h2) { sections.push({ title: h2[1].trim(), body: [] }); continue; }
    if (sections.length) sections[sections.length - 1].body.push(line);
    else pitch.push(line);
  }
  for (const s of sections) {
    s.key = SECTIONS.find(([, , re]) => re.test(s.title))?.[0] ?? (/^latest|^decisions|^changelog|^news/i.test(s.title) ? 'latest' : null);
    s.filled = Boolean(s.body.join('\n').trim());
  }
  const has = (key) => sections.some((s) => s.key === key && s.filled);
  const questions = sections.filter((s) => s.key === 'questions').flatMap((s) => s.body.map((l) => item.exec(l)?.[1]).filter(Boolean));
  const milestones = sections.filter((s) => s.key === 'milestones').flatMap((s) => s.body.map((l) => /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)/.exec(l)).filter(Boolean).map((m) => ({ done: m[1] !== ' ', text: m[2] })));
  const latest = sections.filter((s) => s.key === 'latest').flatMap((s) => s.body.map((l) => item.exec(l)?.[1]).filter(Boolean)).slice(0, 3);
  const firstPara = pitch.join('\n').trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    title: title ?? meta.name ?? meta.title ?? null,
    pitch: firstPara.slice(0, 400),
    sections: sections.map((s) => ({ key: s.key, title: s.title, filled: s.filled })),
    missing: SECTIONS.filter(([key]) => key !== 'questions' && !has(key)).map(([, t]) => t),
    questions: questions.slice(0, 6),
    openQuestions: questions.length,
    milestones,
    latest,
  };
}
