/**
 * THE PERSON'S OWN AI (@homie-rocks/studio 0.24.4): Cloudflare's Clef decision model on this computer, through Ollama.
 * The same typed questions the studio's Workers AI answers, at /v1/systemone, free and offline:
 *
 *   homie-studio dev        finds it and hands it to the local Worker (HOMIE_LOCAL_AI), so AI guides, room chat's review
 *                           and a game's own decisions (net.decide) need no Cloudflare while building
 *   agents sit --brain local / the MCP's agent_sit { brain: "local" }
 *                           a guide's seat that thinks on this computer every few seconds, with no AI turn per decision
 *   homie-studio doctor     says what is there, and what one sentence gets the rest
 *
 * It never downloads a model. `ollama pull clef-flash` is about 11 GB (clef, the 27B, about 18 GB): the person says yes
 * first, every time (the studio skill asks and names the size). It needs Ollama 0.35.1 or later (the first with Clef).
 */

export const OLLAMA_BASE = 'http://127.0.0.1:11434';
export const OLLAMA_MIN = '0.35.1';
/** The models Homie uses, smallest first, and what each costs the disk (ollama.com/library, 2026-10-02). */
export const LOCAL_MODELS = Object.freeze([
  Object.freeze({ name: 'clef-flash', size: 'about 11 GB', params: '9B' }),
  Object.freeze({ name: 'clef', size: 'about 18 GB', params: '27B' }),
]);

const newer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
};

/** Only a loopback address: Homie never sends a game's state to another machine's Ollama. */
export const loopbackBase = (raw) => {
  const s = String(raw ?? '').trim().replace(/\/+$/, '');
  return /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(s) ? s : null;
};

/**
 * Is Clef on this computer? `{ ok, base, model, version }`, or `{ ok: false, why, say, version?, base }` with why one of
 * no-ollama, old-ollama, no-model. `HOMIE_OLLAMA` names another loopback port. Two quick local requests, nothing else.
 */
export async function detectLocalAi({ env = process.env, fetchFn = globalThis.fetch, ms = 1500 } = {}) {
  const base = loopbackBase(env.HOMIE_OLLAMA) ?? OLLAMA_BASE;
  const get = async (path) => {
    const res = await fetchFn(`${base}${path}`, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  };
  let version = null;
  try { version = String((await get('/api/version'))?.version ?? ''); } catch {
    return { ok: false, base, why: 'no-ollama', say: `Ollama is not running on this computer (${base}). With it and clef-flash, AI guides, chat review and game decisions run here for free while building; without it they play from the game's script under dev.` };
  }
  if (!newer(version, OLLAMA_MIN)) return { ok: false, base, version, why: 'old-ollama', say: `Ollama ${version} is here; Clef needs ${OLLAMA_MIN} or later. Updating Ollama is the person's to do (its own app updates itself, or ollama.com/download).` };
  let names = [];
  try { names = ((await get('/api/tags'))?.models ?? []).map((m) => String(m?.name ?? m?.model ?? '')).filter(Boolean); } catch { names = []; }
  for (const want of LOCAL_MODELS) {
    const hit = names.find((n) => n === want.name || n.startsWith(`${want.name}:`));
    if (hit) return { ok: true, base, version, model: hit };
  }
  const flash = LOCAL_MODELS[0];
  return {
    ok: false, base, version, why: 'no-model', models: names.length,
    say: `Ollama ${version} is here without Clef. Downloading it is the person's choice: ask first. \`ollama pull ${flash.name}\` downloads ${flash.size} (the ${flash.params} model; ${LOCAL_MODELS[1].name} is ${LOCAL_MODELS[1].size}). Then run dev again.`,
  };
}

/** The Worker variables that hand a found model to `wrangler dev` (`--var` pairs), or none. */
export const localAiVars = (found) => (found?.ok ? ['--var', `HOMIE_LOCAL_AI:${found.base}`, '--var', `HOMIE_LOCAL_AI_MODEL:${found.model}`] : []);
