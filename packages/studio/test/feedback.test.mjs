/**
 * Tell Homie (0.28.0): a note to the people who make Homie goes ONLY after the person's yes, and only as they saw it.
 * The note's rules (lib/feedback.mjs), the local MCP's homie_feedback against a stand-in directory that records every
 * note it is sent, and the card in a browser: Send sends exactly the shown note once; Don't send sends nothing.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_KINDS, cleanNote, draftId, feedbackUrl, noteBlock, redactNote, sendNote } from '../lib/feedback.mjs';
import { RULES } from '../lib/redact.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { cardHost, mcpServer } from './card-host.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const SKILLS = join(PKG, '..', '..', 'plugins', 'homie', 'skills');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-feedback-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A stand-in Homie directory: it takes notes at /api/feedback/tell and keeps every one it was sent. */
async function directory({ answer = null } = {}) {
  const notes = [];
  const http = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/api/feedback/tell') { res.writeHead(404); res.end(); return; }
      notes.push({ headers: req.headers, body: JSON.parse(body) });
      const [status, json] = answer ?? [201, { ok: true, reference: `0f0e0d0c-${String(notes.length).padStart(4, '0')}-4000-8000-000000000000` }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${http.address().port}`, notes, close: () => new Promise((r) => http.close(r)) };
}

/** A studio folder pinned to a version (package.json), whose studio.json names a directory. */
function studio(name, { pin = '0.26.0', directoryUrl = 'https://homie.rocks' } = {}) {
  const root = join(scratch, 'studios', name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'studio.json'), JSON.stringify({ name, slug: name, homie: { studio: pin, directory: directoryUrl }, cloudflare: {} }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, private: true, devDependencies: { '@homie-rocks/studio': pin } }));
  return root;
}

async function server(args, clientName = 'claude-code') {
  const s = mcpServer(process.execPath, [CLI, 'mcp', '--no-install', '--skills', SKILLS, ...args], { cwd: scratch, env: { HOME: join(scratch, 'home'), HOMIE_MCP_WAIT_MS: '15000' } });
  await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1' } });
  s.call = async (name, a = {}) => (await s.request('tools/call', { name, arguments: a })).result;
  return s;
}

/*
 * Made-up values a note must never carry, built at run time: the repository's leak audit reads this file, and a home
 * folder, an address, a token or a workers.dev host written out here would read as a leak.
 */
const HOME = ['', 'Users', 'somebody'].join('/');
const WIN_HOME = ['C:', 'Users', 'Somebody'].join('\\');
const TILDE = (rest) => `${'~'}/${rest}`;
const MAIL = (user) => [user, 'example.org'].join('@');
const WORKERS = (sub) => `${sub}.somebody.${'workers'}.dev`;
const GH_TOKEN = `${'gh'}p_${'a'.repeat(40)}`;

const SAYS = 'I pressed deploy and it asked me to choose a workers.dev subdomain. I had no idea what that is, or whether it costs money, so I stopped.';

test('the rules: the kinds, plain words, keys, paths, emails, addresses and code taken out, and the same twice', async () => {
  assert.deepEqual([...FEEDBACK_KINDS], ['stuck', 'confusing', 'idea', 'praise', 'bug']);
  const dirty = [
    `Deploy said https://${WORKERS('owls')}/ and CLOUDFLARE_API_TOKEN=abc123def456ghi789jkl0 in ${HOME}/Studios/owls`,
    `my friend ${MAIL('bob')} sent ${GH_TOKEN} from 192.168.1.20 (not 127.0.0.1)`,
    'the office link https://owls.example/_studio/office?key=hsk_' + 'a'.repeat(48),
    `${WIN_HOME}\\Studios and a hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`,
    '```', 'const secret = 1', '```', 'It is 0.26.0 at http://127.0.0.1:8787/owl-rush/play',
  ].join('\n');
  const r = cleanNote({ kind: 'confusing', text: dirty, step: `studio-setup: deploy in ${HOME}`, studioVersion: 'v0.26.0', app: 'claude-code', offered: true });
  assert.equal(r.ok, true);
  const t = r.note.text;
  for (const gone of ['somebody', 'abc123def456', MAIL('bob'), GH_TOKEN.slice(0, 4), '192.168.1.20', 'hsk_', '9f86d081', 'const secret', 'Somebody']) assert.ok(!t.includes(gone), `${gone} is gone: ${t}`);
  for (const kept of [`https://owls.[account].${'workers'}.dev/`, TILDE('Studios/owls'), '127.0.0.1', '0.26.0', 'http://127.0.0.1:8787/owl-rush/play', '[code left out by Homie]', '[a private link hidden by Homie]']) assert.ok(t.includes(kept), `${kept} stays: ${t}`);
  assert.equal(r.note.step, 'studio-setup: deploy in ~');
  assert.equal(r.note.studioVersion, '0.26.0');
  for (const what of ['code', 'a secret', 'a GitHub token', 'a private link', 'a workers.dev account name', 'a home folder', 'an email address', 'a network address', 'a long code']) assert.ok(r.taken.includes(what), `said: ${what}`);
  // Cleaning a clean note changes nothing, and its draft id is the same: a send re-cleans and must match the draft.
  const again = cleanNote({ ...r.note, text: r.note.text, step: r.note.step });
  assert.equal(again.note.text, t);
  assert.deepEqual(again.taken, []);
  assert.equal(await draftId(again.note), await draftId(r.note));
  assert.match(await draftId(r.note), /^fd_[a-f0-9]{24}$/);
  assert.notEqual(await draftId({ ...r.note, kind: 'bug' }), await draftId(r.note));
  // Every key the mod hides is hidden in a note too (the same rules, lib/redact.mjs).
  assert.ok(RULES.length >= 15);
  assert.ok(redactNote('a key sk-ant-api03-' + 'x'.repeat(40)).text.includes('[Anthropic key hidden by Homie]'));
  // What a note may not be.
  assert.match(cleanNote({ kind: 'rant', text: 'x' }).why, /kind is one of/);
  assert.match(cleanNote({ kind: 'idea', text: '   ' }).why, /empty/);
  assert.match(cleanNote({ kind: 'idea', text: 'x'.repeat(1501).replace(/x{40}/g, 'word word word word word word word word ') }).why, /under 1,500/);
  assert.match(cleanNote({ kind: 'idea', text: Array.from({ length: 31 }, () => 'a line').join('\n') }).why, /more than 30 lines/);
  assert.match(cleanNote({ kind: 'idea', text: 'hi', email: 'not-an-address' }).why, /whole email address/);
  assert.equal(cleanNote({ kind: 'idea', text: 'hi', email: MAIL('me') }).note.email, MAIL('me'));
  assert.equal(cleanNote({ kind: 'idea', text: 'hi', app: 'something' }).note.app, 'other');
  assert.match(noteBlock(r.note, r.taken), /Kind: Confusing[\s\S]*Sent with it: the step \(studio-setup: deploy in ~\) · studio 0\.26\.0 · Claude Code · that Claude offered it\. No reply address\.[\s\S]*Homie took out:/);
  assert.equal(feedbackUrl('https://homie.rocks/'), 'https://homie.rocks/api/feedback/tell');
});

test('one set of rules: the Homie plugin\'s mod and Codex hooks carry the same feedback.mjs and redact.mjs, byte for byte', () => {
  for (const f of ['feedback.mjs', 'redact.mjs']) {
    assert.equal(readFileSync(join(PKG, '..', '..', 'plugins', 'homie', 'hooks', 'lib', f), 'utf8'), readFileSync(join(PKG, 'lib', f), 'utf8'), `plugins/homie/hooks/lib/${f} is packages/studio/lib/${f}`);
  }
});

test('sendNote: one POST of exactly the note, what the directory answered, and nothing retried', async () => {
  const d = await directory();
  try {
    const { note } = cleanNote({ kind: 'idea', text: 'A dark mode for the codex page.', step: 'plan', studioVersion: '0.27.0', pluginVersion: '0.28.0', app: 'codex', email: MAIL('me') });
    const r = await sendNote(note, { directory: d.url, source: 'plugin', consent: 'chat' });
    assert.equal(r.ok, true);
    assert.equal(d.notes.length, 1);
    assert.deepEqual(d.notes[0].body, { kind: 'idea', text: 'A dark mode for the codex page.', source: 'plugin', consent: 'chat', offered: false, app: 'codex', step: 'plan', studioVersion: '0.27.0', pluginVersion: '0.28.0', email: MAIL('me') });
    assert.equal(d.notes[0].headers['content-type'], 'application/json');
  } finally { await d.close(); }
  const busy = await directory({ answer: [429, { ok: false, error: 'rate', message: 'Too many notes from this network today. Please try again tomorrow.' }] });
  try {
    const { note } = cleanNote({ kind: 'bug', text: 'x happened' });
    const r = await sendNote(note, { directory: busy.url });
    assert.equal(r.ok, false);
    assert.equal(r.status, 429);
    assert.match(r.why, /tomorrow/);
    assert.equal(busy.notes.length, 1);
  } finally { await busy.close(); }
  const r = await sendNote(cleanNote({ kind: 'bug', text: 'y' }).note, { directory: 'http://127.0.0.1:9' });
  assert.equal(r.ok, false);
  assert.match(r.why, /could not be reached[\s\S]*Nothing was sent/);
});

test('homie_feedback: a draft sends nothing; only the drafted note goes, once, after a send that names it', async () => {
  const d = await directory();
  const root = studio('night-owls', { pin: '0.26.0', directoryUrl: d.url });
  const s = await server(['--studios', join(scratch, 'studios')]);
  try {
    const list = (await s.request('tools/list', {})).result.tools;
    const tool = list.find((t) => t.name === 'homie_feedback');
    assert.ok(tool, 'the tool is listed');
    assert.equal(tool._meta.ui.resourceUri, 'ui://homie-studio/feedback');
    assert.match(tool.description, /ONLY with the person's yes/);
    assert.match(tool.description, /at most once a session/);
    assert.deepEqual(tool.inputSchema.properties.kind.enum, ['stuck', 'confusing', 'idea', 'praise', 'bug']);
    const card = (await s.request('resources/read', { uri: 'ui://homie-studio/feedback' })).result.contents[0];
    assert.equal(card.mimeType, 'text/html;profile=mcp-app');
    assert.match(card.text, /Tell Homie/);
    assert.match((await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } })).result.instructions, /OFFER, once a session/);

    const draft = await s.call('homie_feedback', { kind: 'confusing', text: `${SAYS} (in ${HOME}/Studios/night-owls)`, step: 'studio-setup: put it online', offered: true, studio: 'night-owls' });
    assert.ok(!draft.isError, draft.content[0].text);
    const sc = draft.structuredContent;
    assert.equal(sc.kind, 'feedback');
    assert.equal(sc.state, 'draft');
    assert.match(sc.draft, /^fd_[a-f0-9]{24}$/);
    assert.equal(sc.note.studioVersion, '0.26.0', 'the studio\'s own pin');
    assert.equal(sc.note.pluginVersion, JSON.parse(readFileSync(join(SKILLS, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version);
    assert.equal(sc.note.app, 'claude-code');
    assert.ok(sc.note.text.includes(TILDE('Studios/night-owls')) && !sc.note.text.includes('somebody'));
    assert.deepEqual(sc.taken, ['a home folder']);
    assert.match(draft.content[0].text, /^Nothing has been sent\. Show the person this note exactly as it is/);
    assert.ok(draft.content[0].text.includes(sc.note.text.split('\n')[0]), 'the chat text carries the exact words');
    assert.match(draft.content[0].text, /Send it only after they say yes in their own words/);
    assert.equal(d.notes.length, 0, 'a draft sends nothing');

    // A send must name the draft, and be the same note.
    assert.match((await s.call('homie_feedback', { action: 'send', kind: 'confusing', text: SAYS })).content[0].text, /names the draft the person saw/);
    const changed = await s.call('homie_feedback', { action: 'send', draft: sc.draft, kind: 'confusing', text: `${sc.note.text} And another thing.`, step: sc.note.step, offered: true });
    assert.equal(changed.isError, true);
    assert.equal(changed.structuredContent.state, 'changed');
    assert.match(changed.content[0].text, /not the note the person was shown/);
    assert.equal(d.notes.length, 0, 'a changed note is never sent');

    const sent = await s.call('homie_feedback', { action: 'send', draft: sc.draft, kind: sc.note.kind, text: sc.note.text, step: sc.note.step, offered: true });
    assert.ok(!sent.isError, sent.content[0].text);
    assert.equal(sent.structuredContent.state, 'sent');
    assert.match(sent.structuredContent.reference, /^0f0e0d0c-/);
    assert.match(sent.content[0].text, /Do not offer another note in this session/);
    assert.equal(d.notes.length, 1);
    assert.deepEqual(d.notes[0].body, { kind: 'confusing', text: sc.note.text, source: 'plugin', consent: 'chat', offered: true, app: 'claude-code', step: 'studio-setup: put it online', studioVersion: '0.26.0', pluginVersion: sc.note.pluginVersion });

    // Once a session: the offered note was answered, so another offer is refused; the person asking is not.
    const offer = await s.call('homie_feedback', { kind: 'idea', text: 'Another thought.', offered: true });
    assert.equal(offer.isError, true);
    assert.match(offer.content[0].text, /at most once a session/);
    const asked = await s.call('homie_feedback', { kind: 'praise', text: 'The setup card was lovely.', offered: false });
    assert.equal(asked.structuredContent.state, 'draft');
    // A draft id alone sends that draft.
    const byId = await s.call('homie_feedback', { action: 'send', draft: asked.structuredContent.draft });
    assert.equal(byId.structuredContent.state, 'sent');
    assert.equal(d.notes.length, 2);
    assert.equal(d.notes[1].body.offered, false);
    // The same draft is not sent twice from here.
    assert.equal((await s.call('homie_feedback', { action: 'send', draft: asked.structuredContent.draft })).isError, true);
    assert.equal(d.notes.length, 2);
    assert.ok(root);
  } finally { await s.close(); await d.close(); }
});

test('homie_feedback: a send after the app started a new server (a resumed session) still sends the drafted note, and only that', async () => {
  // Found end to end: `claude -p --resume` starts a new MCP server for every turn, so the draft and the yes are in two
  // processes. The draft's id (a hash of the whole note) ties them, not either process's memory.
  const d = await directory();
  studio('kites', { directoryUrl: d.url });
  const args = ['--studios', join(scratch, 'studios'), '--homie', d.url];
  const first = await server(args);
  let draft;
  try { draft = await first.call('homie_feedback', { kind: 'confusing', text: SAYS, step: 'studio-setup: put it online', offered: true, studio: 'kites' }); } finally { await first.close(); }
  const sc = draft.structuredContent;
  assert.match(sc.next, /^Nothing has been sent\. Show the person this note exactly as it is/, 'what to do next rides in the data too');
  const second = await server(args);
  try {
    // Its id alone names nothing this process knows: the words must come with it.
    assert.equal((await second.call('homie_feedback', { action: 'send', draft: sc.draft, studio: 'kites' })).isError, true);
    assert.equal((await second.call('homie_feedback', { action: 'send', draft: sc.draft, kind: 'confusing', text: `${SAYS} More.`, step: sc.note.step, offered: true, studio: 'kites' })).structuredContent.state, 'changed');
    assert.equal(d.notes.length, 0);
    const sent = await second.call('homie_feedback', { action: 'send', draft: sc.draft, kind: 'confusing', text: sc.note.text, step: sc.note.step, offered: true, by: 'chat', studio: 'kites' });
    assert.equal(sent.structuredContent.state, 'sent', sent.content[0].text);
    assert.equal(d.notes.length, 1);
    assert.equal(d.notes[0].body.text, SAYS);
  } finally { await second.close(); await d.close(); }
});

test('homie_feedback: no is final for the session, and nothing is sent', async () => {
  const d = await directory();
  studio('paper-boats', { directoryUrl: d.url });
  const s = await server(['--studios', join(scratch, 'studios'), '--homie', d.url], 'codex-mcp-client');
  try {
    const draft = await s.call('homie_feedback', { kind: 'stuck', text: 'The check kept failing on the phone seat and I could not tell why.', offered: true, studio: 'paper-boats' });
    assert.equal(draft.structuredContent.note.app, 'codex');
    const no = await s.call('homie_feedback', { action: 'decline', draft: draft.structuredContent.draft });
    assert.ok(!no.isError);
    assert.equal(no.structuredContent.state, 'declined');
    assert.match(no.content[0].text, /nothing left this computer[\s\S]*do not offer to send a note again/);
    // The declined draft cannot be sent, and a new offer is refused.
    assert.equal((await s.call('homie_feedback', { action: 'send', draft: draft.structuredContent.draft })).isError, true);
    const again = await s.call('homie_feedback', { kind: 'stuck', text: 'Still stuck on the phone seat.', offered: true });
    assert.match(again.content[0].text, /said no to a note earlier in this session/);
    assert.equal(d.notes.length, 0, 'nothing was sent');
  } finally { await s.close(); await d.close(); }
});

test('the Tell Homie card in a browser: Send sends the shown note once; Edit rewords it; Don\'t send sends nothing', { skip: !findChrome() && 'no Chrome on this machine' }, async () => {
  const d = await directory();
  studio('lanterns', { directoryUrl: d.url });
  const s = await server(['--studios', join(scratch, 'studios'), '--homie', d.url]);
  let host;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    const draft = await s.call('homie_feedback', { kind: 'confusing', text: SAYS, step: 'publish', offered: true, studio: 'lanterns' });
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/feedback', result: draft, viewport: { width: 390, height: 844, deviceScaleFactor: 1 } });
    const shown = await host.text();
    assert.match(shown, /Not sent yet/);
    assert.ok(shown.includes(SAYS), 'the card shows the exact words');
    assert.match(shown, /Nothing is sent until you press Send/);
    assert.equal(d.notes.length, 0);
    // Edit: the person's own words, drafted again through the same rules.
    await host.press(/^Edit$/);
    await host.settle(300);
    await host.card.evaluate(() => { const a = document.querySelector('textarea'); a.value = 'I did not know what a workers.dev subdomain was. A line saying it is free would have helped.'; a.dispatchEvent(new Event('input')); });
    await host.press(/^Idea$/);
    await host.press(/^Use this$/);
    await host.settle(900);
    assert.match(await host.text(), /A line saying it is free would have helped/);
    assert.equal(d.notes.length, 0, 'an edit sends nothing');
    assert.ok((await host.told()).some((t) => /reworded the note/.test(t)));
    await host.press(/^Send$/);
    await host.settle(1200);
    assert.match(await host.text(), /Sent to Homie\. Thank you\./);
    assert.equal(d.notes.length, 1);
    assert.equal(d.notes[0].body.kind, 'idea');
    assert.equal(d.notes[0].body.consent, 'card');
    assert.equal(d.notes[0].body.text, 'I did not know what a workers.dev subdomain was. A line saying it is free would have helped.');
    assert.ok((await host.told()).some((t) => /pressed Send on the Tell Homie card/.test(t)));
    assert.deepEqual(host.errors, []);
    await host.close(); host = null;

    // Don't send: nothing goes, and the model is told not to offer again.
    const other = await s.call('homie_feedback', { kind: 'stuck', text: 'The playtest never finished on the phone.', offered: false, studio: 'lanterns' });
    host = await cardHost({ puppeteer, chrome: findChrome(), args: chromeArgs(), server: s, uri: 'ui://homie-studio/feedback', result: other });
    await host.press(/Don.t send/);
    await host.settle(900);
    assert.match(await host.text(), /Not sent[\s\S]*Nothing left this computer/);
    assert.equal(d.notes.length, 1, 'nothing more was sent');
    assert.ok((await host.told()).some((t) => /Don.t send/.test(t)));
    assert.deepEqual(host.errors, []);
  } finally { if (host) await host.close(); await s.close(); await d.close(); }
});

test('the studio version a note carries is the studio\'s pin, else this toolkit', async () => {
  const d = await directory();
  const s = await server(['--studios', join(scratch, 'nowhere'), '--homie', d.url], 'claude-ai');
  try {
    const draft = await s.call('homie_feedback', { kind: 'praise', text: 'The first game ran on my phone in a minute.' });
    assert.equal(draft.structuredContent.note.studioVersion, STUDIO_VERSION);
    assert.equal(draft.structuredContent.note.app, 'claude-desktop');
    assert.equal(draft.structuredContent.to, new URL(d.url).host);
  } finally { await s.close(); await d.close(); }
});
