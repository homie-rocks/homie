import {WatchSockets} from './watch-sockets.mjs';
import { catalogue } from './catalogue.mjs';
import { RULES_WIRING_MESSAGE } from './rules-wiring.mjs';
import { characterStore, characterRequest } from './characters.mjs';
import { NetRoom, WATCH_POLICIES, departure, errorLine } from './room.mjs';
import { hostedGame, hostedBuild, compiledFor, prepareHost, startHost } from './hosted.mjs';
import { roomStore, restoreDelay, LOOSE_SAVE } from './room-store.mjs';
import { pooledRoom } from './servers.mjs';
import { BRAIN_BUDGET, HouseAgents, decodeFacts } from './agents.mjs';
import { CLEF, DECIDE, clefRun, costOf, localAiOf, picksOf, talks } from './brain.mjs';
import { reviewChat } from './chat.mjs';
import { chatDay } from './chat-store.mjs';
import { forgetLines, historyOf, keepLines, keptLine } from './lounge-store.mjs';
import { acceptMultiplex, diagnosticsOf, gatePlayers, nextGate } from './gate.mjs';
import { worldSource } from './world-wire.mjs';
import { seatCount, perAddress } from './seats.mjs';
import { count, counter, isQa, today } from './stats.mjs';
import { holders, regateArgs, verifyControl } from './office.mjs';

const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

import {ROOM_ALARM_MS,ROOM_PAUSE_MS,roomEndAt} from './room-lifecycle.mjs';

export class Table {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.watchSockets = new WatchSockets(ctx);
    this.env = env;
    this.room = null;
    this.timer = null;
    this.saved = null;
    this.game = null;
    this.code = null;
    this.recorded = 0;
    this.lastReport = -1;
    /** This room was counted as opened (worker/stats.mjs `room`); cleared when its seats are all forgotten. */
    this.openCounted = false;
    /** The owner's holds, banner and closed door (they outlive an empty room), and the controls already used. */
    this.officeSaved = null;
    this.seen = new Map();
    /** Revision 7: the game's vocabulary (agents.json, read once from the build), and the room's house guides. */
    this.vocabRead = null;
    this.house = null;
    /** The AI brains' day (worker/agents.mjs): what the studio allows a day and has used, and what is not counted yet. */
    this.brainDay = null;
    this.brainCap = { neurons: BRAIN_BUDGET.neurons, micros: BRAIN_BUDGET.usd * 1e6 };
    this.brainUsed = { neurons: 0, micros: 0 };
    this.brainPending = { calls: {}, neurons: 0, micros: 0 };
    this.brainReadAt = 0;
    /** Room chat's review (section 19): the studio's day (budget and use, read at most once a minute) and what is not counted yet. */
    this.chatCap = null;
    this.chatUsed = 0;
    this.chatReadAt = 0;
    this.chatPend = { neurons: 0, ok: 0, held: 0, error: 0 };
    this.chatSent = { chatLines: 0, chatReacts: 0, held: {} };
    /**
     * Revision 10 (NETPLAY.md section 29): the host runtime of a server-hosted room (rules/host.ts), and when this
     * room next needs the object's one alarm (the house guides and the day's counters share it).
     */
    this.hostRt = null;
    this.characterGrants = new Map();
    this.accountTokens = {};
    this.inputTransit = [];
    this.relayed = false;
    this.gateHeld = new Map();
    this.gatePromised = new Map();
    this.roomAlarmAt = 0;
    this.durable = null;
    this.roomSave = null;
    this.endedRoom = null;
    this.pausedAt = null;
    ctx.blockConcurrencyWhile(async () => {
      // Only a confirmed missing alarm permits the save-age fallback. A read failure is not evidence of absence.
      this.recoveredAlarmAt = Infinity;
      try { this.recoveredAlarmAt = (await ctx.storage.getAlarm?.()) ?? null; }
      catch (error) { this.storageProblem(error); }
      this.saved = (await ctx.storage.get('net')) ?? null;
      if (this.saved?.retired === true) this.cleanupPending = true;
      this.recorded = (await ctx.storage.get('recorded')) ?? 0;
      this.officeSaved = (await ctx.storage.get('office')) ?? null;
      // A big match room's last unconfirmed checkpoint (worker/room-store.mjs), read once as the object wakes.
      try { this.looseSave = (await ctx.storage.list?.({ prefix: LOOSE_SAVE })) ?? null; }
      catch (error) { this.looseSave = null; this.storageProblem(error); }
      await this.watchSockets.restore((request, transport) => this.connect(request, transport));
    });
  }

  roomFor(game, code, max) {
    if (this.room) return this.room;
    const storage = this.ctx.storage;
    this.game = game;
    this.code = code;
    this.room = new NetRoom({
      code,
      maxPlayers: max,
      perIp: perAddress(max),
      store: {
        save: (o) => {
          if (this.hostRt && !this.relayFrame) this.saveRoom(this.hostRt.save());
          else if (this.hostRt) {
            // All admissions in one relay turn share a checkpoint. The microtask
            // runs before the relay's timer flush, retaining the storage output gate.
            if (!this.admissionSaveQueued) {
              this.admissionSaveQueued = true;
              const host = this.hostRt;
              queueMicrotask(() => {
                this.admissionSaveQueued = false;
                if (this.hostRt === host) { try { this.saveRoom(host.save()); } catch (error) { this.storageProblem(error); } }
              });
            }
          } else if (!hostedGame(game)) storage.put('net', o).catch(() => {});
        },
        clear: () => { this.clearRoom(); },
      },
      // The room's lifecycle, one line each with its time and room (worker/room.mjs `log`): a hello, a leave, an
      // election, a build change, and `failed` (a room operation that threw). A departure and a failure seconds apart
      // are told apart by these. HOMIE_ROOM_LOG=0 keeps only the failures.
      log: (line) => this.say(line),
    });
    this.room.gateFacts = () => [...(this.gateMetrics?.values() ?? [])];
    if (this.saved && !hostedGame(game)) this.room.restore(this.saved);
    if (this.officeSaved) this.room.restoreOffice(this.officeSaved);
    this.vocabRead = this.readVocab(game).catch(() => false);
    // Room chat (section 19): typed text the floor let through waits for the studio's own Workers AI.
    this.room.review = (text, opts) => this.reviewChat(text, opts);
    // Kept chat (0.29.0): a room whose rules keep `history` writes what was said to D1 and deletes what is taken down,
    // one after another (a line removed the moment it went out is never written after its delete).
    this.room.onPublished = (rec) => this.keptQueue(() => keepLines(this.env, this.game, this.code, [rec]));
    this.room.onUnsaid = (ids) => this.keptQueue(() => forgetLines(this.env, this.game, this.code, ids));
    // A game's own decisions (section 20): the host's typed questions, for a game whose game.json opts in.
    this.room.decider = (state, questions, opts) => this.decide(state, questions, opts);
    // A server-hosted room that forgets everything (nobody came back, or the owner closed it) ends its host runtime.
    this.room.onForget = () => { if (this.hostRt) this.finishRoom('forgotten'); };
    if (this.isPersistent()) this.room.forgetMs = Infinity;
    return this.room;
  }

  /* ------------------------------------------------------------ the server as host (NETPLAY.md section 29) */

  /**
   * A room of a server-hosted game gets its host runtime before its first socket is attached, so no browser is ever
   * elected. `hosted`: the Worker's word that this game's settings say `host: server`. Rules that are missing from
   * this build, or do not fit the contract, do not start: the room refuses joins and says why.
   */
  isPersistent() { return this.persistentStored === true || hostedBuild(this.game)?.settings?.lifetime === 'persistent'; }

  ensureHost(room, hosted) {
    if (this.hostRt || !this.game) return;
    if (!hostedGame(this.game)) {
      if (hosted) room.failServerHost(RULES_WIRING_MESSAGE);
      return;
    }
    let restoring = false;
    let pauseWriteFailed = false;
    try {
      const build = hostedBuild(this.game);
      const persistent = this.isPersistent();
      try { this.durable ??= this.openStore(); } catch (error) { if (persistent) throw error; this.storageProblem(error); }
      let saved = this.cleanupPending ? null : this.readRoom();
      restoring = Boolean(saved);
      if (this.persistentStored && build.settings.lifetime !== 'persistent') throw new Error('This room holds a lasting world. Keep room.lifetime persistent; its save is retained.');
      let boot = { epoch: 0, count: 0 };
      try { boot = this.durable?.boots() ?? boot; } catch (error) { if (saved) throw error; this.storageProblem(error); }
      if (!Number.isSafeInteger(boot.epoch) || boot.epoch < 0 || !Number.isInteger(boot.count) || boot.count < 0) {
        const error = new Error('saved boot counter is invalid');
        if (saved) throw error;
        this.storageProblem(error); this.clearRoom(); boot = { epoch: 0, count: 0 };
      }
      if (saved && saved.buildHash !== build.build) boot.count = 0;
      // A restore's provisional pause is not a recorded departure. A stored alarm,
      // even one now due, has not yet confirmed expiry. The alarm handler owns that decision.
      const restorePause = saved?.pauseFromRestore === true && Date.now() >= saved.pausedAt + ROOM_PAUSE_MS && this.recoveredAlarmAt !== null ? null : saved?.pausedAt;
      const restoredEnd = saved ? roomEndAt({ people: 0, pausedAt: restorePause, restoredAt: Date.now(), savedAt: saved.at, alarmAt: this.recoveredAlarmAt }) : Infinity;
      const expired = Date.now() >= restoredEnd;
      if (saved && persistent && saved.stateHash !== build.stateHash) throw new Error('This lasting world needs its previous state schema. Restore the compatible build; the saved world has been retained.');
      if (saved && !persistent && (saved.stateHash !== build.stateHash || boot.count >= 2 || expired)) {
        const why = saved.stateHash !== build.stateHash ? 'state-changed' : boot.count >= 2 ? 'restore loop' : 'nobody-returned';
        const tokens = new Set((saved.net.seats ?? []).map((s) => s[1]));
        this.finishRoom(why);
        room.forget(); room.ended = null;
        // Only a holder returning to the old match is rematched. A new visitor uses this name immediately.
        if (!expired && pooledRoom(this.code)) room.endedMatch = { why, ver: build.build, tokens, until: Date.now() + ROOM_PAUSE_MS };
        this.room = room; saved = null; restoring = false; boot = { epoch: 0, count: 0 };
      }
      this.roomSave = saved;
      this.accountTokens = saved?.accountTokens ?? {};
      if (saved) {
        // The seat map and the world came from one transaction. No unrelated net write can take a body from its token.
        room.seats.clear(); room.state.clear(); room.stateBytes = 0;
        room.restore({ ...saved.net, savedAt: Date.now(), durable: true });
        this.pausedAt = persistent ? Date.now() : restoredEnd - ROOM_PAUSE_MS;
        this.pauseFromRestore = saved.pauseFromRestore = saved.pausedAt === null || saved.pauseFromRestore === true;
        saved.pausedAt = this.pausedAt;
        // A failed pause write must never be mistaken for an invalid host save.
        try { this.durable.write(saved); } catch (error) { if (persistent) throw error; pauseWriteFailed = true; this.storageProblem(error); }
      }
      const epoch = saved ? Math.max(saved.host.core.epoch, boot.epoch) + 1 : undefined;
      if (saved) this.durable.boot({ epoch, count: boot.count });
      this.hostCreatedAt = Date.now();
      let ticks = 0;
      this.hostRt = startHost(this.game, {
        ...(saved ? { restore: new TextEncoder().encode((saved.hostText ?? JSON.stringify(saved.host))), restoreEpoch: epoch, startDelayMs: boot.count === 1 ? restoreDelay(`${this.game}/${this.code}`) : 0 } : {}),
        record: (owner,key,value) => this.queueRoundRecord(owner,key,value),
        store: { save: (bytes, commitment) => this.saveRoom(bytes, commitment, true) },
        // A room behind Gates needs no snapshot as text: nothing is encoded that nobody is sent (room.mjs, hostSnap).
        snapshotText: () => !this.relayed,
        ...(build.settings.characters ? { characterFor: (peer) => {
          const account = room.clients.get(peer.id)?.player;
          return account ? this.characterGrants.get(account) ?? null : null;
        } } : {}),
        onTick: () => {
          if (!saved) return;
          ticks += 1;
          if (ticks === 1) this.pendingBoot = { epoch, count: saved.buildHash !== build.build ? 0 : boot.count + 1 };
          if (ticks === 10 * build.settings.tickHz) this.pendingBoot = { epoch, count: 0 };
          if (this.pendingBoot && Date.now() >= (this.bootRetryAt ?? 0)) { try { this.durable.boot(this.pendingBoot); this.pendingBoot = null; this.bootFailures = 0; } catch (error) { this.bootRetryAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(this.bootFailures ?? 0, 6)); this.bootFailures = (this.bootFailures ?? 0) + 1; this.storageProblem(error); } }
        },
        send: (m, text) => room.hostFrame(m, text),
        log: (line) => { if (line.ev === 'persist-failed') this.storageProblem(new Error(line.error)); else this.say(line); },
        onPause: () => { this.pauseFromRestore = false; this.pausedAt ??= Date.now(); this.armRoom(this.pausedAt + ROOM_PAUSE_MS); },
        onResume: () => { this.pauseFromRestore = false; this.pausedAt = null; if (this.hostRt) { try { this.saveRoom(this.hostRt.save()); } catch { /* retry already scheduled */ } } this.armRoom(Date.now() + ROOM_ALARM_MS); },
        onEnd: (why) => this.endHosted(why),
      });
      room.setServerHost(this.hostRt);
      room.gameVer = build.build;
      room.setCurrent(build.build);
      if (pauseWriteFailed) { try { this.saveRoom(this.hostRt.save()); } catch { /* the save retry retains the original absence */ } }
      if (saved) {
        room.hostFrame({ t: 'state', k: 'shared', d: this.hostRt.core.shared() });
        room.hostFrame({ t: 'snap', from: null, e: epoch, k: this.hostRt.tick, st: Date.now(), d: this.hostRt.core.snapshot(), c: [] });
      }
      this.armRoom(roomEndAt({ people: 0, pausedAt: this.pausedAt, createdAt: this.hostCreatedAt }));
    } catch (error) {
      this.hostRt?.stop(); this.hostRt = null;
      if (restoring && !this.isPersistent()) {
        this.storageProblem(error);
        room.forget(); this.clearRoom();
        this.skipSave = true;
        this.ensureHost(room, hosted);
        return;
      }
      room.failServerHost(`This game's rules could not start: ${String(error?.message ?? error).slice(0, 160)}`);
    }
  }

  /** This object's room store, with the unconfirmed checkpoint it woke to (if any). */
  openStore(persistent = this.isPersistent()) {
    const loose = this.looseSave; this.looseSave = null;
    return roomStore(this.ctx.storage, { persistent, loose, onProblem: (error) => this.storageProblem(error) });
  }

  /** `periodic`: the rules host's own checkpoint of a tick, as against a save an admission or a pause asked for. */
  saveRoom(bytes, commitment, periodic = false) {
    if (this.persistentFailed) throw new Error('Lasting world stopped; restart from its committed save');
    const now = Date.now();
    if (now < (this.saveRetryAt ?? 0)) throw this.saveError ?? new Error('room save retry is waiting');
    try {
      this.durable ??= this.openStore();
      const build = hostedBuild(this.game);
      const host = new TextDecoder().decode(bytes);
      const net = this.room.saved();
      if (build.settings.characters) for (const client of this.room.clients.values()) {
        if (client.player && client.seat !== null && client.token) this.accountTokens[client.player] = client.token;
      }
      if (build.settings.characters) {
        const tokens = new Set((net.seats ?? []).map(seat => seat[1]));
        for (const [account, token] of Object.entries(this.accountTokens)) if (!tokens.has(token)) delete this.accountTokens[account];
      }
      const saved = { ...(build.settings.characters ? { accountTokens: { ...this.accountTokens } } : {}), v: 1, game: this.game, room: this.code, at: now, pauseFromRestore: this.hostRt?.paused === true && this.pauseFromRestore === true, pausedAt: this.hostRt?.paused ? this.pausedAt ?? now : null, stateHash: build.stateHash, buildHash: build.build, host, net };
      const clearing = this.cleanupPending;
      if (clearing) this.durable.clear();
      if (this.isPersistent()) {
        const c = compiledFor(this.game);
        commitment ??= { force: false, seconds: c.settings.durability.movementSeconds, tickHz: c.settings.tickHz,
          fields: { kinds: c.kinds.map(k => k.fields.flatMap(([,f],i) => f.durable ? [i] : [])), shared: c.shared.flatMap(([,f],i) => f.durable ? [i] : []) } };
        this.durable.commit(saved, commitment);
      } else if (this.relayed && periodic && !clearing) {
        // A room behind Gates: its once-a-second checkpoint holds none of its frames (worker/room-store.mjs). A save
        // an admission asks for is still confirmed before the welcome that names the seat can leave.
        this.durable.write(saved, { unconfirmed: true });
      } else this.durable.write(saved);
      if (clearing) { this.cleanupGeneration = (this.cleanupGeneration ?? 0) + 1; this.queueNetCleanup(false); }
      this.roomSave = saved;
      if (build.settings.characters) this.ctx.waitUntil(this.flushCharacters().catch(error => this.storageProblem(error)));
      this.cleanupPending = false; clearTimeout(this.cleanupRetry); this.cleanupRetry = null;
      this.saveFailures = 0; this.saveRetryAt = 0; this.saveError = null;
      clearTimeout(this.saveRetry); this.saveRetry = null;
      this.storageHealth = { ok: !this.pendingBoot };
    } catch (error) {
      this.saveError = error;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.saveFailures ?? 0, 6));
      this.saveFailures = (this.saveFailures ?? 0) + 1; this.saveRetryAt = now + delay;
      this.storageProblem(error);
      if (this.isPersistent()) this.endHosted('storage-failed');
      if (!this.isPersistent() && !this.saveRetry) {
        this.saveRetry = setTimeout(() => {
          this.saveRetry = null;
          if (this.hostRt) { try { this.saveRoom(this.hostRt.save()); } catch { /* saveRoom scheduled the next attempt */ } }
        }, delay);
        this.saveRetry?.unref?.();
      }
      throw error;
    }
  }

  storageProblem(error) {
    this.storageHealth = { ok: false, message: String(error?.message ?? error).slice(0, 160), since: this.storageHealth?.ok === false ? this.storageHealth.since : Date.now() };
    if (Date.now() < (this.storageLogAt ?? 0)) return;
    this.storageLogAt = Date.now() + 1000;
    this.say({ ev: 'persist-failed', build: hostedBuild(this.game)?.build, error: this.storageHealth.message });
  }

  readRoom(validateHost = false, alreadyRead) {
    if (this.skipSave) { this.skipSave = false; return null; }
    try {
      const boot = this.durable?.boots();
      this.persistentStored = boot?.persistent === true;
      if (boot?.retired === true) { this.clearRoom(); return null; }
      const saved = alreadyRead ?? this.durable?.read();
      if (!saved) return null;
      if (saved.v !== 1 || typeof saved.game !== 'string' || typeof saved.room !== 'string' ||
          this.game && saved.game !== this.game || this.code && saved.room !== this.code ||
          !Number.isFinite(saved.at) || saved.at < 0 || saved.at > Date.now() + 5000 || saved.pausedAt !== null && (!Number.isFinite(saved.pausedAt) || saved.pausedAt < 0 || saved.pausedAt > Date.now() + 5000) ||
          saved.pauseFromRestore !== undefined && typeof saved.pauseFromRestore !== 'boolean' ||
          saved.host?.v !== 1 || !saved.net || typeof saved.stateHash !== 'string' || typeof saved.buildHash !== 'string') throw new Error('save envelope does not fit this room');
      saved.at = Math.min(saved.at, Date.now());
      if (saved.pausedAt !== null) saved.pausedAt = Math.min(saved.pausedAt, Date.now());
      if (hostedGame(saved.game) && saved.stateHash !== hostedBuild(saved.game).stateHash) return saved;
      this.game ??= saved.game; this.code ??= saved.room;
      const seats = saved.net.seats;
      const cap = hostedBuild(saved.game)?.seats ?? 32;
      if (saved.net.v !== 1 || saved.net.room !== saved.room || !Array.isArray(seats) || seats.length > cap ||
          new Set(seats.map((s) => s?.[0])).size !== seats.length || new Set(seats.map((s) => s?.[1])).size !== seats.length ||
          seats.some((s) => !Array.isArray(s) || !Number.isInteger(s[0]) || s[0] < 0 || s[0] >= cap || typeof s[1] !== 'string' || s[1].length > 128 || typeof s[2] !== 'string' || s[2].length > 40 || s[4] !== null && (!Number.isSafeInteger(s[4]) || s[4] < 0) || s[5] !== null && !Number.isFinite(s[5]))) throw new Error('saved seats do not fit this room');
      if (validateHost && hostedGame(saved.game) && saved.stateHash === hostedBuild(saved.game).stateHash) {
        const probe = startHost(saved.game, { restore: new TextEncoder().encode(saved.hostText ?? JSON.stringify(saved.host)), send() {} });
        probe.stop();
      } else if (!hostedGame(saved.game)) throw new Error('saved game is not in this build');
      return saved;
    } catch (error) { this.storageProblem(error); if (this.isPersistent()) throw error; this.clearRoom(); return null; }
  }

  clearRoom() {
    if (this.isPersistent()) throw new Error('A lasting world cannot be cleared by match cleanup');
    this.cleanupGeneration = (this.cleanupGeneration ?? 0) + 1;
    this.roomSave = null; this.saved = null; this.pendingBoot = null;
    try { this.durable?.retire(); this.durable?.clear(); this.cleanupPending = false; clearTimeout(this.cleanupRetry); this.cleanupRetry = null; }
    catch (error) { this.retryCleanup(error); }
    this.queueNetCleanup(this.cleanupPending);
  }

  queueNetCleanup(retired) {
    // The key-value record can preserve retirement when SQL writes, not just deletes, are unavailable.
    // Serialize it with a later successful save so an older failure cannot retire the new match.
    const generation = this.cleanupGeneration;
    this.netCleanup = (this.netCleanup ?? Promise.resolve()).then(() => {
      if (generation !== this.cleanupGeneration) return;
      return retired ? this.ctx.storage.put('net', { retired: true }) : this.ctx.storage.delete('net');
    }).then(() => {
      if (generation !== this.cleanupGeneration) return;
      this.netCleanupFailed = false;
      clearTimeout(this.netCleanupRetry); this.netCleanupRetry = null;
      if (!this.cleanupPending) this.cleanupFailures = 0;
    }).catch((error) => {
      if (generation !== this.cleanupGeneration) return;
      if (retired) { this.retryCleanup(error); return; }
      // Removing an old key marker is not permission to delete a newer SQL match.
      this.netCleanupFailed = true; this.storageProblem(error);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.cleanupFailures ?? 0, 6));
      this.cleanupFailures = (this.cleanupFailures ?? 0) + 1;
      this.armRoom(Date.now() + delay);
      if (!this.netCleanupRetry) {
        this.netCleanupRetry = setTimeout(() => { this.netCleanupRetry = null; if (generation === this.cleanupGeneration) this.queueNetCleanup(false); }, delay);
        this.netCleanupRetry?.unref?.();
      }
    });
    this.ctx.waitUntil(this.netCleanup);
  }

  retryCleanup(error) {
    this.cleanupPending = true; this.storageProblem(error);
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.cleanupFailures ?? 0, 6));
    this.cleanupFailures = (this.cleanupFailures ?? 0) + 1;
    this.armRoom(Date.now() + delay);
    // An alarm write can fail as well. Keep the end pending for this object's lifetime.
    if (!this.cleanupRetry) {
      this.cleanupRetry = setTimeout(() => { this.cleanupRetry = null; if (this.cleanupPending) this.clearRoom(); }, delay);
      this.cleanupRetry?.unref?.();
    }
  }

  finishRoom(why) {
    if (this.isPersistent()) { this.hostRt?.stop(); this.room?.failServerHost(`Lasting world paused: ${why}. Its committed save is retained.`); return; }
    this.hostRt?.stop(); this.hostRt = null;
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.saveRetry); this.saveRetry = null; this.saveRetryAt = 0;
    this.clearRoom();
    const room = this.room;
    if (room) {
      this.officeSaved = room.officeSaved();
      room.ended = { why, ver: hostedBuild(this.game)?.build ?? null };
      for (const w of room.watchers) { try { w.close(1000, 'room-over'); } catch { /* gone */ } }
      room.watchers.clear();
    }
    this.tellLobby({ ended: true });
    this.say({ ev: 'host-over', why, build: hostedBuild(this.game)?.build, ...(why === 'restore loop' ? { message: 'This room shares its isolate and may not be the cause.' } : {}) });
    this.room = null; this.endedRoom = null; this.pausedAt = null;
  }

  /** The room wants the alarm at `at` (ms): set it unless an earlier one is already waiting. */
  armRoom(at) {
    if (this.isPersistent()) return;
    this.roomAlarmAt = at;
    this.alarmWrite = (this.alarmWrite ?? Promise.resolve()).then(async () => {
      const cur = await this.ctx.storage.getAlarm();
      if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
      this.alarmFailures = 0;
    }).catch((error) => {
      this.storageProblem(error);
      if (this.alarmRetry) return;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.alarmFailures ?? 0, 6));
      this.alarmFailures = (this.alarmFailures ?? 0) + 1;
      this.alarmRetry = setTimeout(() => { this.alarmRetry = null; this.armRoom(this.roomAlarmAt); }, delay);
      this.alarmRetry?.unref?.();
    });
    this.ctx.waitUntil(this.alarmWrite);
  }

  /**
   * The rules failed again and again (rules/host.ts: the budget on every tick for two seconds, or slow ticks for
   * five): the room ends. Its players are told, their seats are freed, and the next visitor starts a fresh room.
   */
  endHosted(why) {
    if (this.isPersistent()) {
      this.persistentFailed = true;
      // The host's own stop would checkpoint a healthy world; this one is refused by `persistentFailed`, and the committed save stands.
      try { this.hostRt?.stop(); } catch { /* stopped all the same */ }
      clearTimeout(this.saveRetry); this.saveRetry = null;
      this.room?.failServerHost(`Lasting world paused: ${why}. Its committed save is retained.`);
      return;
    }
    const room = this.room;
    if (!room) return;
    this.finishRoom(why);
    this.hostRt = null;
    for (const c of [...room.clients.values()]) {
      if (c.helloed) room.error(c, 'room-over', 'This room ended. Joining a fresh room.', { rematch: true, ver: room.ended.ver });
      room.clients.delete(c.id);
      try { c.conn.close(1011, 'room-over'); } catch { /* gone */ }
    }
    room.emptySince = Date.now();
    room.forget();
    this.report();
  }

  /**
   * The room's part of the alarm (section 4.5 of the design). A room nobody came back to within a minute of its
   * pause ends: the relay forgets it and its stored seats go (`office` and `recorded` stay). A room in play keeps an
   * alarm ahead of it, so one that Cloudflare restarted and nobody returned to is still ended. After a restart there
   * is no room in memory: stored seats of a server-hosted room that nobody reconnected to are deleted.
   */
  async roomAlarm() {
    try { await this.runRoomAlarm(); this.roomAlarmFailures = 0; }
    catch (error) {
      this.storageProblem(error);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.roomAlarmFailures ?? 0, 6));
      this.roomAlarmFailures = (this.roomAlarmFailures ?? 0) + 1;
      this.armRoom(Date.now() + delay);
    }
  }

  async runRoomAlarm() {
    if (this.netCleanupFailed) this.queueNetCleanup(false);
    if (this.cleanupPending) this.clearRoom();
    const now = Date.now();
    const room = this.room;
    if (!room || !this.hostRt) {
      if (this.ctx.storage.sql?.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'save'").toArray().length) {
        this.durable ??= this.openStore(false);
        let saved = this.cleanupPending ? null : this.readRoom();
        if (saved) {
          const generation = this.cleanupGeneration;
          const preparing = prepareHost(saved.game);
          if (preparing) {
            await preparing;
            // A join or office action can arrive while the optional engine loads.
            // Re-read that lifecycle instead of writing the pre-await checkpoint.
            if (this.room !== room || this.hostRt || this.cleanupGeneration !== generation) return this.runRoomAlarm();
          }
          saved = this.readRoom(true, saved);
        }
        if (saved) {
          this.game = saved.game; this.code = saved.room;
          if (this.isPersistent()) return;
          if (saved.stateHash !== hostedBuild(saved.game)?.stateHash) { this.finishRoom('state-changed'); return; }
          // No saved pause means people were present. The first cold wake starts the absence period.
          if (saved.pausedAt === null) {
            this.pausedAt ??= now; saved.pausedAt = this.pausedAt; this.durable.write(saved);
          }
          const endAt = roomEndAt({ people: 0, pausedAt: saved.pausedAt, createdAt: now });
          if (now < endAt) { this.armRoom(endAt); return; }
          this.finishRoom('nobody-returned');
        }
      }
      if (this.saved?.hosted === 'server') { const was = this.saved.room ?? null; this.saved = null; await this.ctx.storage.delete('net').catch(() => {}); this.say({ ev: 'host-over', why: 'nobody-returned', room: was }); }
      return;
    }
    if (!this.hostRt) return;
    if (this.isPersistent()) { await this.flushCharacters(); return; }
    const endAt = roomEndAt({ people: this.hostRt.people, pausedAt: this.pausedAt, createdAt: this.hostCreatedAt });
    if (endAt === Infinity) { if (now >= this.roomAlarmAt - 1000) this.armRoom(now + ROOM_ALARM_MS); else this.armRoom(this.roomAlarmAt); return; }
    if (now < endAt) { this.armRoom(endAt); return; }
    // Nobody returned: neither watchers nor AI seats keep the paused room.
    this.finishRoom('nobody-returned');
    for (const c of [...room.clients.values()]) { if (c.helloed) room.error(c, 'room-over', 'Everyone left, so this room ended.', { rematch: true }); room.clients.delete(c.id); try { c.conn.close(1000, 'room-over'); } catch { /* gone */ } }
    room.forget();
    this.report();
  }

  /**
   * One log line of this room: `{ at, ev, game, room, … }`. Never a seat token, a ticket, a browser key or an address;
   * a failure goes to the error stream, everything else to the log (and not at all with HOMIE_ROOM_LOG=0).
   */
  say(line) {
    if(line?.ev==='hello'&&line.seat!==null&&this.ctx.storage.sql){const c=this.room?.clients.get(line.id),owner='p'+this.room?.seats.get(line.seat)?.occ;if(c?.player){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS round_players(owner TEXT PRIMARY KEY,player TEXT)');this.ctx.storage.sql.exec('INSERT OR REPLACE INTO round_players VALUES(?,?)',owner,c.player);}}
    if(line?.ev==='hello'&&!line.resumed&&line.seat!==null) this.queueFunctionEvent('player.joined',{game:this.game,room:line.room,player:this.room?.clients.get(line.id)?.conn?.player??null,seat:line.seat});
    const bad = line?.ev === 'failed' || line?.ev === 'socket-error' || line?.ev === 'tick-failed' || line?.ev === 'persist-failed';
    if (!bad && this.env.HOMIE_ROOM_LOG === '0') return;
    try { console[bad ? 'error' : 'log'](JSON.stringify({ at: new Date().toISOString(), ...line, game: this.game ?? null, room: line?.room ?? this.code ?? null })); } catch { /* no console */ }
  }

  queueRoundRecord(owner,key,value) {
    const sql=this.ctx.storage.sql;if(!sql||!this.env.DB)return;
    sql.exec('CREATE TABLE IF NOT EXISTS round_players(owner TEXT PRIMARY KEY,player TEXT)');
    const client=[...this.room.clients.values()].find(c=>c.seat!==null&&'p'+this.room.seats.get(c.seat)?.occ===owner);
    const player=client?.player??sql.exec('SELECT player FROM round_players WHERE owner=?',owner).toArray()[0]?.player;
    if(!player){
      // Never dropped in silence (0.46.5): the log says so, and the person is told on their own screen.
      try{console.error(JSON.stringify({at:new Date().toISOString(),ev:'record-unsaved',why:'no-player',game:this.game??null,room:this.code??null,key,id:value?.id??null}));}catch{}
      if(client)this.room.error(client,'unsaved','This round was not saved to your history. Reload the page to keep the next one.');
      return;
    }
    sql.exec('CREATE TABLE IF NOT EXISTS round_outbox(id TEXT PRIMARY KEY,player TEXT,key TEXT,value TEXT)');
    sql.exec('INSERT OR IGNORE INTO round_outbox VALUES(?,?,?,?)',player+':'+key+':'+value.id,player,key,JSON.stringify(value));
    this.ctx.waitUntil(this.flushRoundRecords());
  }
  async flushRoundRecords(){
    const sql=this.ctx.storage.sql;if(!sql||!this.env.DB)return;
    if(!sql.exec("SELECT name FROM sqlite_master WHERE name='round_outbox'").toArray().length)return;
    const {appendServerRecord}=await import('./saves.mjs');
    for(const row of sql.exec('SELECT * FROM round_outbox LIMIT 100').toArray()){
      try{await appendServerRecord(this.env,row.player,this.game,row.key,JSON.parse(row.value));sql.exec('DELETE FROM round_outbox WHERE id=?',row.id);}
      catch(error){this.say({ev:'record-retry',error:String(error)});this.armRoom(Date.now()+60000);return;}
    }
  }
  queueFunctionEvent(type,data) {
    if(!this.env.DB || this.env.HOMIE_PREVIEW==='1' || !this.ctx.storage.sql) return;
    this.ctx.waitUntil((async()=>{
      if(!await (await import('./functions.mjs')).hasFunctionType(type,this.env))return;
      const sql=this.ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS function_outbox(id TEXT PRIMARY KEY,type TEXT,data TEXT,at INTEGER)');
      sql.exec('INSERT INTO function_outbox VALUES(?,?,?,?)',crypto.randomUUID(),type,JSON.stringify(data),Date.now());
      this.armRoom(Date.now()+60000);
      await this.flushFunctionEvents();
    })());
  }

  async flushFunctionEvents() {
    const sql=this.ctx.storage.sql;
    if(!sql || !this.env.DB)return;
    if(!sql.exec("SELECT name FROM sqlite_master WHERE name='function_outbox'").toArray().length)return;
    const {emitEvent}=await import('./functions.mjs');
    for(const row of sql.exec('SELECT * FROM function_outbox LIMIT 100').toArray()) {
      try {await emitEvent(this.env,row.type,JSON.parse(row.data),{id:row.id,at:row.at});sql.exec('DELETE FROM function_outbox WHERE id=?',row.id);}
      catch {this.armRoom(Date.now()+60000);await this.alarmWrite;return;}
    }
    const cat=await catalogue(this.env,'https://studio.invalid');
    await (await import('./functions.mjs')).runFunctions(this.env,cat,cat.studio?.url??'https://studio.invalid');
  }

  /**
   * A socket's `error` event. The runtime raises one when the other end simply went away ("Network connection lost":
   * a closed tab, a phone that slept, a browser the test harness shut): that is a departure, and the room handles it
   * as one. Anything else is a failed socket, logged as such. Both lines carry the room, the client and its role.
   */
  socketError(kind, event, facts = {}) {
    const error = event?.error ?? event?.message ?? event;
    const gone = departure(error) || !error || typeof error === 'object' && !error.message;
    this.say({ ev: gone ? 'socket-gone' : 'socket-error', kind, ...facts, error: errorLine(error) });
  }

  /** Kept chat's writes, in order, each finished before the next (D1 calls from one room never pass each other). */
  keptQueue(fn) {
    if (!this.env.DB) return;
    this.kept = (this.kept ?? Promise.resolve()).then(fn).catch((error) => { try { console.log(JSON.stringify({ ev: 'chat-history-failed', room: this.code, error: String(error?.message ?? error).slice(0, 200) })); } catch { /* no console */ } });
    this.ctx.waitUntil(this.kept);
  }

  /** A room that keeps history puts what it kept back in its window before its first page opens (once per opening). */
  async hydrateHistory(room) {
    const days = room.chatRules().history;
    if (!(days > 0) || room.hydrated || !this.env.DB) return;
    room.hydrated = true;
    try { await this.kept; room.hydrate(await historyOf(this.env, this.game, this.code, { days })); } catch { /* the window alone (before migration 0009) */ }
  }

  /** Whether this game asked for decisions (game.json "decide": true, in the built catalogue), read once a minute. */
  async decideOn() {
    if (this.decideRead && Date.now() - this.decideRead.at < 60_000) return this.decideRead.on;
    let on = false;
    try {
      const res = this.env.ASSETS ? await this.env.ASSETS.fetch(new Request('https://assets.local/games.json')) : null;
      const cat = res?.ok ? await res.json() : null;
      const g = (cat?.games ?? []).find((x) => x.id === this.game);
      on = Boolean(g && (g.decide === true || (g.decide && typeof g.decide === 'object' && g.decide.on !== false)));
    } catch { on = false; }
    this.decideRead = { at: Date.now(), on };
    return on;
  }

  /**
   * One of a game's own decisions (worker/brain.mjs checkDecide, picksOf): Clef on the studio's Workers AI (model
   * HOMIE_DECIDE_MODEL, else clef-flash), or the person's own Ollama under `homie-studio dev`, within the AI brains' day
   * (the same budget the guides spend: decisions and guides are one day of neurons). Not opted in, no AI, over budget, too
   * slow or failed: `{ ok: false, why }`, and the host's floor answers.
   */
  async decide(state, questions) {
    if (!(await this.decideOn())) return { ok: false, why: 'off' };
    const local = this.env.AI ? null : localAiOf(this.env);
    if (!this.env.AI && !local) return { ok: false, why: 'no-ai' };
    if (this.env.AI) {
      if (!this.brainDay || Date.now() - this.brainReadAt > 60_000) await this.readBrainDay().catch(() => {});
      if (this.brainCap.neurons - this.brainUsed.neurons <= 0) return { ok: false, why: 'budget' };
    }
    const model = CLEF.models[this.env.HOMIE_DECIDE_MODEL] ? this.env.HOMIE_DECIDE_MODEL : '@cf/cloudflare/clef-flash';
    const t0 = Date.now();
    try {
      const r = await clefRun(this.env, { state, questions, model, ms: DECIDE.ms, local });
      const ms = Date.now() - t0;
      const usage = r.usage ?? { input_tokens: Math.ceil(JSON.stringify({ state, questions }).length / 4) + 400, output_tokens: 0 };
      const cost = costOf({ provider: r.engine === 'local' ? 'local' : 'workers-ai', model: r.model, usage });
      this.brainSpend({ neurons: cost.neurons, micros: 0, provider: r.engine === 'local' ? 'decide-local' : 'decide' });
      this.flushSoon();
      const { picks, p } = picksOf(r.answers, questions);
      return { ok: true, by: r.engine === 'local' ? 'local' : 'ai', picks, p, ms, neurons: cost.neurons };
    } catch (error) {
      return { ok: false, why: /took over/.test(String(error?.message ?? error)) ? 'slow' : 'error' };
    }
  }

  /** The day's counters go to D1 on an alarm: set one a minute out when none is set (a house guide's alarm also flushes). */
  flushSoon() {
    this.ctx.waitUntil((async () => { if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 60_000); })().catch(() => {}));
  }

  /**
   * One typed chat message, reviewed by the studio's decision model (worker/chat.mjs reviewChat) within the day's
   * budget for the whole studio. No binding (`homie-studio dev` without --remote-ai), no budget left, or an error: the
   * floor alone has decided (`by` says which), and the message goes out.
   */
  async reviewChat(text, { links = 'block' } = {}) {
    // Under `homie-studio dev` with no binding, the person's own Ollama reviews (free, so no budget).
    if (!this.env.AI) {
      if (!localAiOf(this.env)) return { ok: true, by: 'none' };
      try { const v = await reviewChat(this.env, text, { links }); return { ok: v.ok, by: 'local', why: v.why, ms: v.ms, p: v.p }; } catch { return { ok: true, by: 'error' }; }
    }
    if (this.chatCap === null || Date.now() - this.chatReadAt > 60_000) await this.readChatDay().catch(() => {});
    if (this.chatUsed >= (this.chatCap ?? 0)) return { ok: true, by: 'budget' };
    try {
      const v = await reviewChat(this.env, text, { links });
      this.chatUsed += v.neurons;
      this.chatPend.neurons += v.neurons;
      this.chatPend[v.ok ? 'ok' : 'held'] += 1;
      return { ok: v.ok, by: 'ai', why: v.why, ms: v.ms, p: v.p };
    } catch (error) {
      this.chatPend.error += 1;
      try { console.log(JSON.stringify({ ev: 'chat-review-failed', room: this.code, error: String(error?.message ?? error).slice(0, 200) })); } catch { /* no console */ }
      return { ok: true, by: 'error' };
    }
  }

  async readChatDay() {
    const day = await chatDay(this.env, today());
    this.chatCap = day.budget.neurons;
    this.chatUsed = day.used.neurons + this.chatPend.neurons;
    this.chatReadAt = Date.now();
  }

  /** Chat's counts into D1 (stats_daily): lines, reactions, held by why, reviews and neurons. Never a message or a sender. */
  async flushChat() {
    const s = this.room?.stats;
    if (!s || !this.env.DB) return;
    const game = this.game ?? '';
    const rows = [];
    for (const [k, metric] of [['chatLines', 'chat-lines'], ['chatReacts', 'chat-reacts']]) {
      const d = (s[k] ?? 0) - (this.chatSent[k] ?? 0);
      if (d > 0) { rows.push(counter(this.env, { metric, subject: game, n: d })); this.chatSent[k] = s[k]; }
    }
    for (const [why, n] of Object.entries(s.chatHeld ?? {})) {
      const d = n - (this.chatSent.held[why] ?? 0);
      if (d > 0) { rows.push(counter(this.env, { metric: 'chat-held', subject: game, source: why, n: d })); this.chatSent.held[why] = n; }
    }
    const p = this.chatPend;
    for (const k of ['ok', 'held', 'error']) if (p[k]) rows.push(counter(this.env, { metric: 'chat-reviews', subject: game, source: k, n: p[k] }));
    const neurons = Math.floor(p.neurons);
    if (neurons) rows.push(counter(this.env, { metric: 'chat-neurons', subject: game, n: neurons }));
    this.chatPend = { neurons: p.neurons - neurons, ok: 0, held: 0, error: 0 };
    const list = rows.filter(Boolean);
    if (list.length) await this.env.DB.batch(list).catch(() => {});
  }

  /** The game's agents.json from the build (the only words an AI in this room may say), once. */
  async readVocab(game) {
    if (!this.env.ASSETS || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(game ?? ''))) return false;
    const res = await this.env.ASSETS.fetch(new Request(`https://assets.local/games/${game}/agents.json`));
    if (!res.ok) return false;
    const ok = this.room.setVocabulary(await res.json());
    if (ok) this.syncHouse();
    return ok;
  }

  /**
   * The room's house guides (worker/agents.mjs): seated while the server's AI may talk, the game has a vocabulary and a
   * person is playing; stood up otherwise. Called on the 1 s beat and whenever the policy changes. No brain runs here:
   * decisions run on the alarm.
   */
  syncHouse() {
    const room = this.room;
    if (!room) return;
    if (!this.house) {
      if (!talks(room.policy) || !room.vocab || !(room.policy.guides > 0)) return;
      this.house = new HouseAgents({
        room, env: this.env,
        // The room's own alarm (a paused server-hosted room ends on it) is never pushed back by a guide's.
        setAlarm: (at) => { this.ctx.storage.setAlarm(this.roomAlarmAt > Date.now() ? Math.min(at, this.roomAlarmAt) : at).catch(() => {}); },
        budget: { left: (kind) => this.brainCap[kind] - this.brainUsed[kind], spend: (c) => this.brainSpend(c) },
        log: (line) => { try { console.log(JSON.stringify(line)); } catch { /* no console */ } },
      });
      this.ctx.waitUntil(this.readBrainDay().catch(() => {}));
    }
    this.house.sync();
  }

  /** What the studio allows its AI brains a day (meta `brain_budget`) and has used today (stats_daily), all games. */
  async readBrainDay() {
    const db = this.env.DB;
    if (!db) return;
    const day = today();
    try {
      const b = JSON.parse((await db.prepare("SELECT value FROM meta WHERE key = 'brain_budget'").first())?.value ?? 'null');
      if (b && Number.isFinite(Number(b.neurons))) this.brainCap.neurons = Math.max(0, Number(b.neurons));
      if (b && Number.isFinite(Number(b.usd))) this.brainCap.micros = Math.max(0, Number(b.usd)) * 1e6;
    } catch { /* the defaults */ }
    try {
      const { results } = await db.prepare("SELECT metric, SUM(n) AS n FROM stats_daily WHERE day = ?1 AND metric IN ('brain-neurons', 'brain-microdollars') GROUP BY metric").bind(day).all();
      const used = { neurons: 0, micros: 0 };
      for (const r of results ?? []) used[r.metric === 'brain-neurons' ? 'neurons' : 'micros'] = Number(r.n) || 0;
      // What this room spent and has not written yet is added on top.
      this.brainUsed = { neurons: used.neurons + this.brainPending.neurons, micros: used.micros + this.brainPending.micros };
    } catch { /* before migration 0002: nothing used */ }
    this.brainDay = day;
    this.brainReadAt = Date.now();
  }

  brainSpend(c) {
    if (this.brainDay && this.brainDay !== today()) { this.brainUsed = { neurons: 0, micros: 0 }; this.brainDay = today(); }
    this.brainUsed.neurons += c.neurons ?? 0;
    this.brainUsed.micros += c.micros ?? 0;
    this.brainPending.neurons += c.neurons ?? 0;
    this.brainPending.micros += c.micros ?? 0;
    const k = c.provider ?? 'script';
    this.brainPending.calls[k] = (this.brainPending.calls[k] ?? 0) + 1;
  }

  /**
   * The day's brain counters into D1 (stats_daily: brain-calls by provider, brain-neurons, brain-microdollars), and the
   * day's budget and usage read again (an owner's new budget, other rooms' use): at most once a minute, on the alarm.
   */
  async flushBrain(force = false) {
    const p = this.brainPending;
    if (!this.env.DB || (!force && Date.now() - this.brainReadAt < 60_000)) return;
    if (!Object.keys(p.calls).length && p.neurons < 1 && p.micros < 1) { await this.readBrainDay(); return; }
    const neurons = Math.floor(p.neurons);
    const micros = Math.floor(p.micros);
    const rows = [
      ...Object.entries(p.calls).map(([source, n]) => counter(this.env, { metric: 'brain-calls', subject: this.game ?? '', source, n })),
      neurons ? counter(this.env, { metric: 'brain-neurons', subject: this.game ?? '', n: neurons }) : null,
      micros ? counter(this.env, { metric: 'brain-microdollars', subject: this.game ?? '', n: micros }) : null,
    ].filter(Boolean);
    this.brainPending = { calls: {}, neurons: p.neurons - neurons, micros: p.micros - micros };
    if (rows.length) await this.env.DB.batch(rows).catch(() => {});
    await this.readBrainDay();
  }

  /** The alarm: the house guides' brains decide (worker/agents.mjs), then the day's usage is written. */
  async alarm() {
    if (this.room && !this.room.clients.size) { this.room.tick(); this.room.tellWatchers(); this.report(); }
    await this.flushRoundRecords();
    await this.flushFunctionEvents();
    // A brain that throws never takes the room with it: the alarm is not retried, the guides answer from the floor.
    try { if (this.house) await this.house.onAlarm(); } catch (error) { try { console.log(JSON.stringify({ ev: 'brain-alarm-failed', room: this.code, error: String(error?.stack ?? error).slice(0, 400) })); } catch { /* no console */ } }
    try { await this.flushBrain(); } catch { /* counted next time */ }
    try { await this.roomAlarm(); } catch (error) { this.say({ ev: 'failed', op: 'room-alarm', error: errorLine(error) }); }
  }

  async flushCharacters() {
    if (this.characterFlush) { await this.characterFlush; return; }
    const saved = this.roomSave;
    if (!saved) return;
    const host = typeof saved.host === 'string' ? JSON.parse(saved.host) : saved.host;
    const returns = (host.characters ?? []).filter(c => c.returning);
    if (!returns.length) return;
    this.characterFlush = (async () => {
      for (const item of returns) {
        await characterRequest(this.env, item.account, { op: 'return', game: this.game, holder: this.code, lease: item.lease, character: item.character });
        this.hostRt?.characterReturned(item.account, item.lease);
        if (this.characterGrants.get(item.account)?.lease === item.lease) this.characterGrants.delete(item.account);
      }
    })();
    try { await this.characterFlush; } finally { this.characterFlush = null; }
  }

  // Network awaits may interleave another join or recall. Serialize each account
  // within this room so a delayed acquisition cannot revive a returned lease.
  async withCharacter(account, operation) {
    this.characterOperations ??= new Map();
    const previous = this.characterOperations.get(account) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.characterOperations.set(account, current);
    try { return await current; }
    finally { if (this.characterOperations.get(account) === current) this.characterOperations.delete(account); }
  }

  acquireCharacter(account) { return this.withCharacter(account, () => this.acquireCharacterOnce(account)); }

  async acquireCharacterOnce(account) {
    for (const c of [...this.room.clients.values()]) if (c.player === account && c.helloed) this.room.kick(c, 'character-moved', 4001);
    await this.flushCharacters();
    const body = { op: 'acquire', game: this.game, holder: this.code, schema: hostedBuild(this.game).stateHash };
    let grant = await characterRequest(this.env, account, body);
    if (grant.error === 'character-held') {
      const old = this.env.TABLE.get(this.env.TABLE.idFromName(`${this.game}/${grant.holder}`));
      const url = `https://room/__recall?game=${encodeURIComponent(this.game)}&room=${encodeURIComponent(grant.holder)}`;
      const response = await old.fetch(url, { method: 'POST', body: JSON.stringify({ account }) });
      if (!response.ok) throw new Error('Finishing your last session; its room is unavailable');
      grant = await characterRequest(this.env, account, body);
    }
    if (!grant.ok) throw new Error(grant.error);
    const held = { account, lease: grant.lease, seat: -1, character: grant.character };
    this.characterGrants.set(account, held);
    this.hostRt.reserveCharacter(held);
    this.saveRoom(this.hostRt.save());
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/__character') {
      const body = await request.json();
      this.characters ??= characterStore(this.ctx.storage);
      if (body.op === 'acquire') return json(this.characters.acquire(body.game, body.holder, body.schema));
      if (body.op === 'return') return json(this.characters.return(body.game, body.holder, body.lease, body.character));
      return json({ ok: false }, 400);
    }
    const path = new URL(request.url).pathname;
    if (path === '/__gate') {
      // The door asks which Gate takes the next player (worker/gate.mjs, nextGate): the lowest with room, counting
      // players sent to a Gate in the last ten seconds who have not reached it yet.
      const gates = Number(new URL(request.url).searchParams.get('gates')) || 1, now = Date.now(), promised = new Map();
      for (const [index, due] of this.gatePromised) { const live = due.filter((at) => at > now); if (live.length) { this.gatePromised.set(index, live); promised.set(index, live.length); } else this.gatePromised.delete(index); }
      const gate = nextGate(gates, this.gateHeld, promised, gatePlayers(this.env));
      if (!this.gatePromised.has(gate)) this.gatePromised.set(gate, []);
      this.gatePromised.get(gate).push(now + 10_000);
      return json({ gate });
    }
    if (path === '/__multiplex') {
      this.relayed = true;
      const index = Number(new URL(request.url).searchParams.get('gate'));
      // One encoding of each world for every Gate link (worker/world-wire.mjs).
      return acceptMultiplex(request, (req, socket) => this.connect(req, socket), { source: (this.worldSource ??= worldSource()), onCount: (n) => {
        // A player arrived: a promise to that Gate is kept. The Gate's count is what the next join is placed by.
        if (n > (this.gateHeld.get(index) ?? 0)) this.gatePromised.get(index)?.shift();
        if (n > 0) this.gateHeld.set(index, n); else this.gateHeld.delete(index);
      } });
    }
    return this.connect(request);
  }

  async connect(request, transport = null) {
    const url = new URL(request.url);
    const game = url.searchParams.get('game');
    const code = url.searchParams.get('room');
    const max = seatCount(url.searchParams.get('max'));
    if (url.pathname === '/__restart') {
      if (this.env.HOMIE_PREVIEW !== '1' || request.method !== 'POST') return new Response('not found', { status: 404 });
      // No last-chance save: this measures exactly what a real abrupt restart can lose.
      setTimeout(() => this.ctx.abort('Preview forced restart'), 25);
      return json({ ok: true });
    }
    const room = this.roomFor(game, code, max);
    if (url.pathname === '/__recall') {
      const { account } = await request.json();
      return this.withCharacter(account, async () => {
        const preparing = prepareHost(game);
        if (preparing) await preparing;
        this.ensureHost(room, true);
        if (!this.hostRt || this.persistentFailed || room.hostFailed) return json({ ok: false }, 503);
        await this.flushCharacters();
        if (!this.hostRt.characters.has(account)) {
          const grant = await characterRequest(this.env, account, { op: 'acquire', game, holder: code, schema: hostedBuild(game).stateHash });
          if (!grant.ok) return json({ ok: true });
          this.hostRt.reserveCharacter({ account, lease: grant.lease, seat: -1, character: grant.character });
        }
        this.hostRt.releaseCharacter(account);
        for (const c of [...room.clients.values()]) if (c.player === account) room.kick(c, 'character-moved', 4001);
        await this.flushCharacters();
        return json({ ok: true });
      });
    }
    // The back office (worker/office.mjs), from the studio's Worker only: the room as its owner sees it, and the
    // owner's signed controls, which this room verifies before it applies one (NETPLAY.md section 15).
    if (url.pathname === '/__facts') return json({ ...room.officeFacts(), gates: [...(this.gateMetrics?.values() ?? [])], durability: this.storageHealth ?? { ok: true }, ...(this.house ? { brains: this.house.facts() } : {}) });
    // A chat line as the room keeps it (section 19), for a report: the Worker files the room's own copy, never a reporter's.
    if (url.pathname === '/__chat') {
      const id = url.searchParams.get('id');
      // A line older than the window is in the room's kept history, when it keeps one (0.29.0).
      const r = room.chatLog.find((x) => x.id === id) ?? (room.chatRules().history > 0 ? await keptLine(this.env, this.game, this.code, id) : null);
      return json({ ok: Boolean(r), line: r ? { id: r.id, kind: r.kind, text: r.text ?? null, glyph: r.glyph ?? null, name: r.name, seat: r.seat, at: r.at, by: r.by, player: r.from?.player ?? null, owner: Boolean(r.owner), mod: Boolean(r.mod) } : null });
    }
    if (url.pathname === '/__mcp-event') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why || ctl.op !== 'mcp-event' || !/^external:[a-z][a-z0-9_-]{0,40}$/.test(ctl.args?.event ?? '')) return json({ ok: false, error: 'refused' }, 403);
      if (!room.live().length) return json({ ok: false, error: 'room empty; use records for lasting changes' }, 409);
      const event = { t: 'ev', from: null, k: ctl.args.event, d: ctl.args.data, external: true };
      if (room.server) room.toServer(event);
      for (const client of room.live()) room.send(client, event);
      return json({ ok: true });
    }
    if (url.pathname === '/__mcp') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why || ctl.op !== 'mcp-seat') return json({ ok: false, error: 'refused' }, 403);
      const result = await (await import('./mcp-room.mjs')).roomSeat(this, room, ctl);
      return json(result, result.ok ? 200 : 403);
    }
    if (url.pathname === '/__office') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why) return json({ ok: false, error: 'refused', why }, 403);
      // A Lounge card waits for the studio's review (0.29.0); every other control answers at once.
      const res = await room.control(ctl.op, ctl.args && typeof ctl.args === 'object' ? ctl.args : {});
      // AI talk turned off (a policy) or a guide kicked: the house guides follow at once.
      if (this.house) this.house.sync();
      await this.ctx.storage.put('office', room.officeSaved()).catch(() => {});
      if (ctl.op === 'close' && res.ok) this.tellLobby({ closed: ctl.args?.reopen ? 0 : res.until });
      this.report();
      return json(res);
    }
    room.rules = url.searchParams.get('rules') === '1';
    room.perIp = perAddress(max, room.rules);
    // Any tick rate a game may declare (1 to 60): the relay's allowances are the page's, from the same table.
    const hz = Number(url.searchParams.get('hz'));
    room.tickHz = Number.isInteger(hz) && hz >= 1 && hz <= 60 ? hz : 20;
    // The owner's room size: a room already open takes it from the next visitor on.
    if (room.seatCap !== max || room.rules && room.maxPlayers !== max) room.setSeats(max, perAddress(max, room.rules));
    // Revision 9: the game's own stall time and the build that is live now, the Worker's word with every socket.
    const said = url.searchParams.has('cur');
    if (said) { room.setStall(url.searchParams.get('stall')); room.setCurrent(url.searchParams.get('cur') || null); }
    // Restore before applying the Worker's current policy: a save must not replace a newer policy.
    const preparing = prepareHost(game);
    if (preparing) await preparing;
    this.ensureHost(room, url.searchParams.get('host') === 'server');
    // The room's policy (section 17), composed by the Worker for every socket: a newer one than the room's applies.
    const pol = decodeFacts(url.searchParams.get('pol'));
    // The room's chat rules ride beside it (they may be longer than a policy): section 19.
    const chatRules = decodeFacts(url.searchParams.get('chat'), 16384);
    if (pol && chatRules && typeof chatRules === 'object') pol.chat = chatRules;
    if (pol) room.setPolicy(pol);
    if (this.house) this.house.sync();
    const agent = decodeFacts(url.searchParams.get('ag'));
    // Kept chat (0.29.0): the room's history is back in its window before this page hears it.
    await this.hydrateHistory(room);
    const account = holders(url.searchParams.get('via')).find(p => p.startsWith('p-'))?.slice(2) ?? null;
    if (hostedBuild(game)?.settings.characters && url.pathname !== '/__watch') {
      if (!account || url.searchParams.get('acct') !== '1') return new Response('Sign in to keep your character', { status: 401 });
      try { await this.acquireCharacter(account); }
      catch (error) { return new Response(String(error.message), { status: 409 }); }
    }
    const [client, accepted] = transport ? [null, transport] : Object.values(new WebSocketPair());
    const hibernating = !transport && url.pathname === '/__watch' && this.ctx.acceptWebSocket;
    const server = hibernating ? await this.watchSockets.accept(accepted, request) : accepted;
    if (!hibernating) server.accept();
    const via = url.searchParams.get('via');
    const conn = {
      ip: request.headers.get('cf-connecting-ip'),
      // The browser's room key (what a kick holds out), and who the play page's ticket named (o, i-<invite>, p-<player>).
      browser: url.searchParams.get('b') || null,
      via: via || null,
      player: holders(via).find((p) => p.startsWith('p-'))?.slice(2) ?? null,
      // A socket opened through the game's watch door, and what the game lets watchers see (section 16).
      watch: url.searchParams.get('w') === '1',
      // An AI with a pass the Worker verified (section 17): its pass, role, hands and name. Only the Worker sets it.
      ...(agent && typeof agent === 'object' && url.pathname === '/__net' ? { agent } : {}),
      // A badge the player's account owns (the shop): the Worker looked it up; a hello cannot set one.
      ...(url.pathname === '/__net' && /^[\p{L}\p{N} .'&+-]{1,16}$/u.test(url.searchParams.get('bd') ?? '') ? { badge: url.searchParams.get('bd') } : {}),
      watchPolicy: WATCH_POLICIES.includes(url.searchParams.get('wp')) ? url.searchParams.get('wp') : 'follow',
      // House QA and `homie-studio check` mark their browsers; their rooms, rounds and peaks are not the studio's numbers.
      qa: isQa(request),
      // The build this socket's page was served with (section 23), from the socket's own address: only when the
      // Worker speaks of builds at all (`cur`), so a relay behind an older Worker reads the hello's own.
      ...(said && url.pathname === '/__net' ? { ver: url.searchParams.get('gv') || null } : {}),
      // Room chat (section 19), the Worker's word: a signed-in account (a passkey), a member of this server, a page of
      // another site (homie.rocks's room page) watching from elsewhere.
      acct: url.searchParams.get('acct') === '1',
      member: url.searchParams.get('mem') === '1',
      hub: url.pathname === '/__watch' && url.searchParams.get('hub') === '1',
      // The Lounge (0.29.0): the signed-in account's name and a moderator's mark, the Worker's word on a watch socket.
      ...(url.pathname === '/__watch' && url.searchParams.get('nm') ? { name: String(url.searchParams.get('nm')).slice(0, 40) } : {}),
      ...(url.pathname === '/__watch' && url.searchParams.get('mod') === '1' ? { mod: true } : {}),
      send: (text) => { try { server.send(text); } catch { /* closed */ } },
      close: (c, r) => { try { server.close(c, r); } catch { /* closed */ } },
      buffered: () => server.buffered?.() ?? 0,
      ...(server.snapshotGroup ? { snapshotGroup: server.snapshotGroup, subscribe: seat => server.subscribe(seat) } : {}),
      ...(server.snapshot ? { snapshot: (...args) => server.snapshot(...args), transportFacts: server.transportFacts } : {}),
    };
    if (url.pathname === '/__watch') {
      // Watching shells are cheap (outgoing is free) but not free: a room holds at most 256, and 24 from one address
      // (room chat, 0.23.0: another site's page can open one too).
      const same = conn.ip ? [...room.watchers].filter((x) => x.ip === conn.ip).length : 0;
      if (room.watchers.size >= 256 || same >= 24) { try { server.close(1013, 'too many watching'); } catch { /* gone */ } return transport ? null : new Response(null, { status: 101, webSocket: client }); }
      const w = room.watch(conn);
      // The play page's vote card speaks on this socket (section 17); nothing else it says is read.
      server.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') return;
        try { w.onMessage(e.data); } catch (error) { this.say({ ev: 'failed', op: 'watch-message', error: errorLine(error) }); }
      });
      server.addEventListener('close', () => w.onClose());
      server.addEventListener('error', (e) => { this.socketError('watch', e); w.onClose(); });
    } else {
      const h = room.attach(conn);
      // A room is OPENED when the first seat is taken in an empty one (a room restored after a deploy keeps its
      // seats, so it is not counted twice). One counter write per room.
      const fresh = room.seats.size === 0;
      server.addEventListener('message', (e) => {
        this.relayFrame = Boolean(server.snapshot);
        try {
        let text = typeof e.data === 'string' ? e.data : '';
        if (hostedBuild(game)?.settings.characters && account) {
          try { const message = JSON.parse(text); if (message.t === 'hello') { delete message.token; if (this.accountTokens[account]) message.token = this.accountTokens[account]; text = JSON.stringify(message); } } catch { /* normal parser diagnoses it */ }
        }
        if (Number.isFinite(e.receivedAt)) this.inputTransit.push(Math.max(0, Date.now() - e.receivedAt));
        h.onMessage(text, this.relayFrame ? e.receivedAt : undefined);
        if (hostedBuild(game)?.settings.characters && account) { const joined = room.clients.get(h.id); if (joined?.token) this.accountTokens[account] = joined.token; }
        } finally { this.relayFrame = false; }
        // A newcomer: the Lobby hears of the room at once, so the owner's office (and a launch change) never misses it.
        if (typeof e.data === 'string' && e.data.startsWith('{"t":"hello"')) this.scheduleReport();
        if (fresh && !this.openCounted && room.seats.size > 0) {
          this.openCounted = true;
          if (conn.qa) return;
          this.ctx.waitUntil(count(this.env, null, { metric: 'room', subject: this.game ?? '', source: /^pub-\d+$/.test(this.code ?? '') ? 'public' : 'named' }));
        }
      });
      // An AI's time in a seat, counted once as it leaves (stats `agent-minutes`; never for house QA).
      const left = (via) => {
        const c = room.clients.get(h.id);
        if (c?.agent && c.helloed && c.seat !== null && !conn.qa) {
          const minutes = Math.round((Date.now() - c.joinedAt) / 60_000);
          if (minutes > 0) this.ctx.waitUntil(count(this.env, null, { metric: 'agent-minutes', subject: this.game ?? '', source: c.agent.role, n: minutes }).catch(() => {}));
        }
        // The room says the departure itself (its `leave` line: who, which seat, host or not, how many are left).
        h.onClose(via);
        try { this.scheduleReport(); } catch (error) { this.say({ ev: 'failed', op: 'report', error: errorLine(error) }); }
      };
      server.addEventListener('close', () => left('close'));
      // A lost network arrives here, not as a close: said as what it is, with the client it was, then handled as the
      // departure it is. (An error with a listener is never the runtime's "Uncaught".)
      server.addEventListener('error', (e) => {
        const c = room.clients.get(h.id);
        this.socketError('net', e, { id: h.id, seat: c?.seat ?? null, role: c && c.helloed ? room.roleOf(c) : null });
        left('error');
      });
    }
    this.start();
    return transport ? null : new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) { this.watchSockets.message(socket, message); }
  // Compatibility date >= 2026-04-07 replies to Close frames automatically.
  async webSocketClose(socket) { await this.watchSockets.close(socket); }
  async webSocketError(socket, error) { await this.watchSockets.close(socket, error); }

  start() {
    if (this.timer) return;
    let n = 0;
    this.timer = setInterval(() => {
      const room = this.room;
      if (!room) return;
      // A beat that throws is one failed beat, said with its room; the next one still runs.
      try { room.tick(); } catch (error) { this.say({ ev: 'tick-failed', clients: room.clients.size, error: errorLine(error) }); }
      // A room that just opened reads its game's launch state once: a change made in the moment it opened (before the
      // Lobby knew of it) still reaches it, after the current round as always.
      if (room.openedAt && this.launchReadFor !== room.openedAt) { this.launchReadFor = room.openedAt; this.ctx.waitUntil(this.rereadLaunch().catch(() => {})); }
      // A launch change the room applied by itself (after its round): its stored state says so too.
      if (room.officeDirty) { room.officeDirty = false; this.ctx.storage.put('office', room.officeSaved()).catch(() => {}); }
      n += 1;
      if (n % 4 === 0) { this.publishDiagnostics(); room.tellWatchers(); this.report(); this.recordRound(); this.syncHouse(); }
      // Room chat's counts, once a minute (section 19).
      if (n % 240 === 0) this.ctx.waitUntil(this.flushChat().catch(() => {}));
      // A server-hosted room in play keeps its alarm ahead of it (re-armed every five minutes of play).
      if (n % 1200 === 0 && this.hostRt?.running) this.armRoom(Date.now() + ROOM_ALARM_MS);
      if (room.seats.size === 0 && room.clients.size === 0) this.openCounted = false;
      if (room.clients.size === 0 && !this.hostRt?.running) { this.armRoom(Date.now() + 120_000); clearInterval(this.timer); this.timer = null; this.report(); this.ctx.waitUntil(this.flushChat().catch(() => {})); if (this.house) { this.ctx.waitUntil(this.flushBrain(true).catch(() => {})); this.house = null; } }
    }, 250);
  }

  /**
   * The game's launch state, read once when the room opens (one D1 read): a private or invite-only game whose room
   * holds anyone the state leaves out re-gates after the current round. Never in a Preview (no launch states there).
   */
  async rereadLaunch() {
    const room = this.room;
    if (!room || !this.game || !this.env.DB || this.env.HOMIE_PREVIEW === '1' || room.regate) return null;
    let launch = null;
    try { launch = (await this.env.DB.prepare('SELECT launch FROM office_games WHERE game = ?1').bind(this.game).first())?.launch ?? null; } catch { return null; }
    const args = regateArgs(launch);
    if (!args.allow) return null;
    const res = room.control('regate', args);
    if (res.ok && res.leaving) await this.ctx.storage.put('office', room.officeSaved()).catch(() => {});
    return res;
  }

  /** Tell the Lobby this room closed (until when; 0 when it opened again), so it sends nobody here meanwhile. */
  tellLobby(extra) {
    if(extra.closed || extra.ended) this.queueFunctionEvent('room.closed',{game:this.game,room:this.code,...extra});
    if (!this.game || !this.code) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.lastReport = -1;
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players: 0, people: 0, ...extra }) }).catch(() => {}));
  }

  /**
   * A big room's diagnostics leave it once a second for the object that answers readers (worker/gate.mjs,
   * `diagnosticsFetch`): nothing per player, one post outstanding at most, never awaited by a tick or an admission.
   * A room that every player reaches directly (one Gate's worth of seats) answers for itself and posts nothing.
   */
  publishDiagnostics() {
    const transit = this.inputTransit.sort((a, b) => a - b); this.inputTransit = [];
    if (!this.env.GATE || !this.relayed || this.diagnosticsPending || !this.room) return;
    const facts = this.room.diagnosticFacts(), now = Date.now(), last = this.diagnosticsLast;
    const at = (p) => transit.length ? transit[Math.min(transit.length - 1, Math.floor(transit.length * p))] : null;
    const tick = facts.ticks?.tick ?? null;
    this.diagnosticsLast = { now, tick };
    this.diagnosticsPending = true;
    const body = JSON.stringify({
      ...facts,
      // Ticks the rules ran per second of this object's clock since the last post.
      tickRate: last && tick !== null && last.tick !== null && now > last.now ? Math.round((tick - last.tick) / (now - last.now) * 100000) / 100 : null,
      // A Gate's stamp on a player's message to this object handling it, ms.
      inputTransitMs: { n: transit.length, p50: at(0.5), p95: at(0.95), max: transit.at(-1) ?? null },
      durability: this.storageHealth ?? { ok: true },
      // Checkpoints written without holding the room's frames for them (worker/room-store.mjs), so far.
      save: { unconfirmed: this.durable?.unconfirmedWrites ?? 0 },
    });
    const work = diagnosticsOf(this.env, this.game, this.code).fetch('https://diagnostics/__diagnostics', { method: 'POST', body })
      .then((r) => r.body?.cancel?.())
      .catch((error) => { this.say({ ev: 'diagnostics-publish-failed', error: errorLine(error) }); })
      .finally(() => { this.diagnosticsPending = false; });
    this.ctx.waitUntil(work);
  }

  scheduleReport() {
    if (this.reportQueued) return;
    this.reportQueued = true;
    queueMicrotask(() => { this.reportQueued = false; this.report(); });
  }

  /** Tell the Lobby how many players this room has, when it changes. */
  report() {
    const room = this.room;
    if (!room || !this.game || this.endedRoom) return;
    const counts = room.facts().counts;
    // Players are people (an agent never counts as one, DESIGN D9); agents and AI bodies are reported apart.
    const players = counts.players;
    // AIs with a pass (a house guide makes way for one, so the Lobby counts only these when it seats an AI).
    let agents = 0;
    for (const c of room.clients.values()) if (c.helloed && c.agent && c.seat !== null && !c.conn?.loopback) agents += 1;
    const ai = counts.ai ?? 0;
    // People for the stats: seated sockets that are not house QA (players is what the Lobby matches strangers by).
    let people = 0;
    for (const c of room.clients.values()) if (c.helloed && c.seat !== null && !c.agent && !c.conn?.qa) people += 1;
    // On a change, and once a minute while anybody is here (so the Lobby's "playing now" forgets a room that died).
    if (players === this.lastReport && people === this.lastPeople && agents === this.lastAgents && ai === this.lastAi && (!players || Date.now() - (this.lastReportAt ?? 0) < 60_000)) return;
    this.lastReport = players;
    this.lastPeople = people;
    this.lastAgents = agents;
    this.lastAi = ai;
    this.lastReportAt = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    // The build this room runs (section 23): the Lobby sends a visitor only to a room of the live build.
    const ver = room.gameVer === undefined ? undefined : room.gameVer ?? '';
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players, people, agents, ai, host: room.server ? 'server' : 'browser', ...(ver !== undefined ? { ver } : {}) }) }).catch(() => {}));
  }

  /** A round the host called over becomes one D1 row (once per round number). */
  recordRound() {
    const r = this.room?.lastRound;
    if (!r || r.phase !== 'over' || !Number.isFinite(r.n) || r.n <= this.recorded || !this.env.DB) return;
    this.recorded = r.n;
    this.ctx.storage.put('recorded', r.n).catch(() => {});
    const results = Array.isArray(r.results) ? r.results : [];
    // An AI's row is never a person's (the relay labelled it `agent`): rounds count agents as AI.
    const humans = results.filter((row) => row && !row.bot && !row.agent).length;
    // A round played only by house QA (every seated socket is marked) is kept in `rounds`, not in the stats.
    const qaOnly = [...this.room.clients.values()].filter((c) => c.helloed && c.seat !== null && !c.agent).every((c) => c.conn?.qa);
    const db = this.env.DB;
    const insert = db.prepare('INSERT OR IGNORE INTO rounds (game, room, n, humans, bots, results, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(this.game, this.code, r.n, humans, results.length - humans, JSON.stringify(results), new Date().toISOString());
    // The round and the people in it, on the studio's daily counters (worker/stats.mjs). One batch, per round.
    const counters = qaOnly ? [] : [counter(this.env, { metric: 'round', subject: this.game ?? '', source: humans ? 'people' : 'bots' }), humans ? counter(this.env, { metric: 'humans', subject: this.game ?? '', n: humans }) : null].filter(Boolean);
    this.ctx.waitUntil(db.batch([insert, ...counters]).catch(() => insert.run().catch(() => {})));
  }
}
