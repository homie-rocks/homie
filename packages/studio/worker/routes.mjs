/** Extracted from the studio runtime; behavior is unchanged. */
import {recordsPage} from './records-page.mjs';
import {RULES_WIRING_MESSAGE} from './rules-wiring.mjs';
import {appAccess,appRecordsRoute} from './app-records.mjs';
import {openPath} from './app-format.mjs';
import {playerEnabled} from './embed.mjs';
import {departure,errorLine,versionOf} from './room.mjs';
import {hostedGame} from './hosted.mjs';
import {isAppOrigin} from './standalone.mjs';
import {ROOM_ID,badRoomPage,embedPreview,noWatchPage,playPage,shellKey,shellStandIn,watchPage} from './pages.mjs';
import {PUBLIC_SERVER,SERVER_ID,homeOf,memberOf,noteMember,policyOf,pooledRoom,roomServer,serverAccess,serverPassOf,serverView,serversOf,setMembership} from './servers.mjs';
import {agentFacts,aiName,encodeFacts,passById,passRefusal,sitRoute} from './agents.mjs';
import {REACTIONS} from './chat.mjs';
import {REPORT_REASONS,chatOf,chatRowsOf,fileReport} from './chat-store.mjs';
import {isLoungePath,loungeRoutes} from './lounge.mjs';
import {doorPage,serverPage,serversPage} from './site.mjs';
import {isLocalOrigin,qrSvg} from './qr.mjs';
import {gateFor} from './gate.mjs';
import {SITE_JS,atomFeed,creditsPage,customPage,gameCover,gameLanding,gamesPage,homeLd,homePage,jsonFeed,landingLd,mediaIndexPage,notFoundPage,postPage,postsPage,roomsPage,sectionsOf,songPage,videoPage,watchOf} from './site.mjs';
import {cookieValues,countVisit,onlyOf,ownerAllowed,playedByGame,playedThisWeek,rangeOf,readStats} from './stats.mjs';
import {ownerRoutes} from './stats-page.mjs';
import {playerRoutes,players as playerAccounts} from './players.mjs';
import {appRoleSession,appAssetTicket,accessOf,accountSub,gatePage,holders,isOwner,joinHolders,launchOf,officeRoutes,publicCatalogue,redeemInvite,sameOrigin,seatsFor,settingsOf,ticketAllows,ticketFor,ticketSub} from './office.mjs';
import {STUDIO_BUILD} from './build-id.mjs';
import {STUDIO_VERSION_TAG} from './version.mjs';
import {roomBadge,shopOf,shopRoutes} from './shop.mjs';
import {DISCOVERY_FILES,discoveryResponse,llmsTxt,robotsTxt,sitemapXml} from './discover.mjs';
import {ldScript,studioNode} from './schema.mjs';
import {licenseOf} from './license.mjs';
import {isPartsPath,partsRoutes,withPartsBand} from './parts.mjs';
import {GAME_ID,POST_SLUG,BROWSER_KEY,sellingShop,availableShellShop,postsOf,claimOf,named,roomsOf,liveCounts,MEDIA_SLUG,assetWithRange,mediaObject,ASSET_CACHE,heldInR2,mediaRow,chatWho,reportAllowed,notAHomie,gameDocument,gameAsset,shareDaily,mediaBeat,serverLive,weekOf,fallback} from './runtime-support.mjs';
import {json} from './responses.mjs';
import {catalogue} from './catalogue.mjs';
import {directoryOf,studioTools} from './tool-registry.mjs';

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean);
  const read = request.method === 'GET' || request.method === 'HEAD';
  let catP = null;
  let pubP = null;
  // Every game (for a game's own pages and the owner's), and the public ones (every list, the rooms, the manifest).
  const getAll = () => (catP ??= catalogue(env, url.origin).then((cat) => named(cat, env)));
  const getCat = () => (pubP ??= Promise.all([getAll(), settingsOf(env)]).then(([cat, settings]) => publicCatalogue(cat, settings, env)));

  // Keep tool transports and discovery on the alias; redirect browser pages only.
  if (read && url.hostname.endsWith('.workers.dev') && env.HOMIE_PREVIEW !== '1'
      && request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
      && !/\/(?:api|__[a-z]+)(?:\/|$)/.test(path)
      && !/^\/(?:\.well-known(?:\/|$)|api(?:\/|$)|mcp(?:\/|$)|oauth(?:\/|$)|hooks(?:\/|$)|_studio(?:\/|$))/.test(path)) {
    const canonical = (await getAll()).studio?.canonical;
    if (canonical && canonical !== url.origin) return Response.redirect(canonical + url.pathname + url.search, 308);
  }

  if (path === '/_studio/office/functions') return (await import('./functions.mjs')).functionsRoute(request,env,await getAll());

  if (path === '/mcp' || path === '/mcp/auth' || path.startsWith('/hooks/tools/') || path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-') || path === '/_studio/office/connections') {
    const { remoteMcp } = await import('./mcp.mjs');
    return remoteMcp(request, env, ctx, { catalogueOf: getAll, definitions: await studioTools() });
  }

  // "Connect this chat" (the template's first-run band): the directory's setup page, for this site's address.
  if (path === '/_studio/connect' && read) {
    const directory = directoryOf(await getCat());
    if (!directory || env.HOMIE_PREVIEW === '1') return json({ ok: false, error: 'no-directory', message: 'This studio is not connected to a directory.' }, 404);
    return Response.redirect(`${directory}/studio/setup/connect?site=${encodeURIComponent(url.origin)}`, 302);
  }
  if (path.startsWith('/_studio/')) return (await officeRoutes(request, env, url, { catalogueOf: getAll })) ?? ownerRoutes(request, env, url, { catalogueOf: getAll });
  if (path === '/__homie' || path.startsWith('/__homie/')) return notAHomie(request);
  // The shop (0.24.0) before player accounts: /api/player/owns is the shop's.
  {
    const shopped = await shopRoutes(request, env, ctx, url, { catalogueOf: getAll });
    if (shopped) return shopped;
  }
  if (path.startsWith('/api/player/') || path === '/account' || path === '/account/' || path === '/_homie/account.js') return playerRoutes(request, env, ctx, url, { catalogueOf: getCat });
  // The Lounge (0.29.0, chat/LOUNGE.md): the studio's own community room, when studio.json turns it on.
  if (isLoungePath(path)) {
    const lounged = await loungeRoutes(request, env, ctx, url, { catalogueOf: getCat, roomsOf });
    if (lounged) return lounged;
  }
  if (path === '/_homie/site.js') return new Response(SITE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': url.searchParams.get('v') === STUDIO_VERSION_TAG ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  if (path === '/api/stats/beat' && request.method === 'POST') return mediaBeat(request, env, ctx, url);
  if (path === '/api/stats') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);
    if (!(await ownerAllowed(request, env, { kinds: ['read', 'office'] }))) {
      return json({ ok: false, error: 'owner-only', message: 'The studio\'s numbers are for its owner. In the studio folder: `npx --no-install homie-studio stats` prints them; `npx --no-install homie-studio stats key` gives a read key for the Homie MCP tool studio_stats.' }, 401, { 'www-authenticate': 'Bearer' });
    }
    const cat = await getAll();
    const studios = new Set(String(url.searchParams.get('studios') ?? '').split(',').filter((h) => /^[a-z0-9.-]{3,80}$/.test(h)).slice(0, 500));
    try {
      return json({ ok: true, site: url.origin, ...(await readStats(env, cat, { range: rangeOf(url.searchParams), only: onlyOf(url.searchParams), studios })) });
    } catch (error) {
      return json({ ok: false, error: 'no-stats', message: `The counters are not in this studio's D1 yet: \`npm run deploy\` applies migration 0002_studio_stats.sql. (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  // GAME PARTS: /.well-known/homie-parts.json, /parts/<id>/<version>/… and the studio's own parts pages.
  if (isPartsPath(path)) {
    const shared = await partsRoutes(request, env, url, { catalogueOf: getCat });
    if (shared) return shared;
  }
  if (path === '/.well-known/homie-studio.json') {
    const cat = await getCat();
    const canonical = cat.studio?.canonical;
    if (canonical && env.HOMIE_PREVIEW !== '1' && url.protocol === 'https:') {
      const address = new URL(canonical); url.protocol = address.protocol; url.host = address.host;
    }
    const sharing = Boolean(cat.studio?.stats?.share);
    const [played, byGame] = sharing ? await Promise.all([playedThisWeek(env), playedByGame(env)]) : [null, null];
    // studio.json `"rooms": { "share": false }` keeps the rooms off the hub: a manifest that names no `rooms` shares none.
    const shareRooms = cat.studio?.rooms?.share !== false;
    return json({
      v: 1,
      kind: 'homie-studio',
      toolkit: STUDIO_BUILD,
      name: cat.studio?.name ?? env.STUDIO_NAME ?? 'Studio',
      slug: cat.studio?.slug ?? null,
      ...(cat.studio?.tagline ? { tagline: cat.studio.tagline } : {}),
      site: url.origin,
      studio: cat.studio?.version ?? null,
      claim: await claimOf(env, cat, url),
      // What is deployed: the commit, when, and the marks of the newest changes (a merged pull request is live when
      // its mark is here). A Preview says it is one.
      ...(cat.studio?.build ? { build: { commit: cat.studio.build.commit ?? null, branch: cat.studio.build.branch ?? null, at: cat.studio.build.at ?? null, changes: (cat.studio.build.changes ?? []).slice(0, 50), ...(env.HOMIE_PREVIEW === '1' ? { preview: true } : {}) } } : {}),
      // Only the public games (a private or invite-only game leaves the directory the next time it reads this).
      games: await Promise.all((cat.games ?? []).filter((g) => g.kind !== 'app').map(async (g) => {
        // The card picture is the landing's hero still (what the landing leads with), else the game's cover.
        const cover = gameCover(g);
        // The licence the game names for itself (an SPDX id), when it names one (worker/license.mjs). Nothing here
        // offers the game to be taken whole: `remix`, `source` and `remixOf` left this manifest with remix.
        const license = licenseOf(g.license);
        return {
          id: g.id, name: g.name, blurb: g.blurb ?? '', players: g.players ?? null, roundSeconds: g.roundSeconds ?? null,
          page: `${url.origin}/${g.id}/`, play: `${url.origin}/${g.id}/play`, cover: cover ? (cover.startsWith('/') ? `${url.origin}${cover}` : cover) : null,
          ...(license ? { license } : {}),
          // Which build of the game is live: its digest (what `homie-studio build` printed for it, and what
          // site/dist/_site/build.json says) and the bundle its page loads. "Is the live game the one I built?" is
          // this against that, with no file to fetch and no edge cache to wait out.
          ...(g.built?.hash ? { build: { hash: g.built.hash, ...(g.built.bundle ? { bundle: `${url.origin}/games/${g.id}/${g.built.bundle}` } : {}) } } : {}),
          // Shared only with `stats.share`: this game's own Play presses and rounds with people, this week.
          ...(byGame ? { played: byGame[g.id] ?? { days: 7, plays: 0, rounds: 0 } } : {}),
        };
      })),
      ...((cat.games ?? []).some((g) => g.kind === 'app') ? { apps: cat.games.filter((g) => g.kind === 'app').map((g) => ({ id: g.id, kind: 'app', name: g.name, blurb: g.blurb, page: `${url.origin}/${g.id}/`, open: `${url.origin}/${g.id}/open`, wall: `${url.origin}/${g.id}/tv`, surfaces: Object.keys(g.surfaces ?? {}), ...(g.built ? { build: g.built } : {}) })) } : {}),
      songs: (cat.songs ?? []).map((e) => mediaRow(e, url.origin, 'music', cat)),
      videos: (cat.videos ?? []).map((e) => mediaRow(e, url.origin, 'videos', cat)),
      // The studio's posts, for the hub (the full text is in /posts/feed.json).
      posts: (cat.posts ?? []).slice(0, 20).map((p) => ({ slug: p.slug, title: p.title, date: p.date, summary: p.summary, page: `${url.origin}/posts/${p.slug}/`, image: p.image ? (p.image.startsWith('/') ? `${url.origin}${p.image}` : p.image) : null, links: p.links ?? {} })),
      ...(shareRooms ? { rooms: `${url.origin}/api/rooms` } : {}),
      // The studio's Lounge (0.29.0), for a directory that shows lounges: its page and its public facts.
      ...(cat.studio?.lounge ? { lounge: { name: cat.studio.lounge.name, page: `${url.origin}/lounge/`, now: `${url.origin}/lounge/api/now` } } : {}),
      // Shared only when studio.json says `stats.share`: two numbers for the whole studio, for the hub.
      ...(played ? { played } : {}),
      // The shop: whether it sells and its till, never a key or a sale.
      ...(shopOf(cat)?.open ? { shop: { open: true, till: shopOf(cat).till, currency: shopOf(cat).currency, page: `${url.origin}/shop/` } } : {}),
    }, 200, { 'access-control-allow-origin': '*' });
  }
  if (path === '/api/games') {
    const cat = await getCat();
    return json({ studio: cat.studio, games: (cat.games ?? []).map(g => g.room?.host === 'server' && !hostedGame(g.id) ? { ...g, rulesError: RULES_WIRING_MESSAGE } : g), live: await liveCounts(env, cat.games ?? []) });
  }
  if (path === '/api/rooms') {
    const cat = await getCat();
    const { rooms } = await roomsOf(env, cat.games ?? []);
    // Short-lived and cacheable: the hub reads every studio's rooms at most every 45 s, and a room's count is a
    // few seconds stale at worst. (The site's own pages ask with cache: 'no-store'.)
    return json({ ok: true, playing: rooms.reduce((n, r) => n + r.players, 0), rooms }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=15' });
  }
  if (path.startsWith('/media/')) {
    if (!env.MEDIA) return new Response('this studio keeps no media in R2 yet', { status: 404 });
    const key = decodeURIComponent(path.slice('/media/'.length));
    // A player's large saves live under players/ in the same bucket: never served here (saves/SAVES.md).
    if (!key || key.includes('..') || (key.startsWith('players/') || key.startsWith('paid-parts/'))) return new Response('not found', { status: 404 });
    return mediaObject(request, env, key);
  }
  if (path === '/posts/feed.xml' || path === '/posts/feed.json') {
    const cat = await getCat();
    if (!(cat.posts ?? []).length) return notFoundPage('This studio has no posts yet.', cat);
    const posts = await postsOf(env, url.origin);
    return path.endsWith('.xml') ? atomFeed(cat, posts, url.origin) : jsonFeed(cat, posts, url.origin);
  }

  // REMIX WAS RETIRED: no game's source is served whole. An older toolkit's `game remix`, the directory's copy of a
  // studio, or a link somebody kept may still ask for one, so the address answers 410 (gone, on purpose, for good)
  // with where to go instead: /parts/, the pieces of games this studio chose to share. The same answer for every
  // id, whether or not such a game exists, and before the site's files are looked at: a source.json an older build
  // left in the deployed folder is never reachable.
  if (/^\/games\/[a-z0-9][a-z0-9-]{0,39}\/source\.json$/.test(path)) return json({ retired: 'remix', see: '/parts/' }, 410, { 'access-control-allow-origin': '*' });

  // Search engines and AI agents (0.27.0, worker/discover.mjs): robots.txt, sitemap.xml, llms.txt and llms-full.txt,
  // made from the public catalogue (a private or invite-only game is in none of them); a file of the studio's own in
  // site/public wins.
  if (read && DISCOVERY_FILES.includes(path)) {
    const own = await env.ASSETS.fetch(new Request(`${url.origin}${path}`));
    if (own.ok) return own;
    const cat = await getCat();
    const method = request.method;
    if (path === '/robots.txt') return discoveryResponse(robotsTxt(cat, url.origin, { preview: env.HOMIE_PREVIEW === '1' || env.HOMIE_CONCEPT === '1' }), 'text/plain', { method });
    const all = await getAll();
    if (path === '/sitemap.xml') return discoveryResponse(sitemapXml(cat, url.origin, { all }), 'application/xml', { method });
    const full = path === '/llms-full.txt';
    return discoveryResponse(llmsTxt(cat, url.origin, { directory: directoryOf(cat), full, posts: full ? await postsOf(env, url.origin) : null, all }), 'text/plain', { method });
  }

  // A page the studio made itself (site/pages) wins at its address.
  if (read && (path.endsWith('/') || !path.includes('.'))) {
    const cat = await getCat();
    const pages = cat.site?.pages ?? [];
    const want = path.endsWith('/') ? path : `${path}/`;
    if (pages.includes(want)) {
      if (want !== path) return Response.redirect(`${url.origin}${want}${url.search}`, 301);
      const res = await env.ASSETS.fetch(new Request(`${url.origin}/_site/pages${want}index.html`));
      if (res.ok) {
        const top = parts[0] ?? '';
        const game = (cat.games ?? []).find((g) => g.id === top);
        await countVisit(request, env, ctx, parts.length === 0 ? 'home' : game && parts.length === 1 ? game.id : parts.join('/').slice(0, 80));
        const active = game ? 'games' : sectionsOf(cat).some((s) => s.key === top) ? top : null;
        const html = await res.text();
        // <!-- homie:schema -->: the structured data the generated page here would carry (Home's, a landing's), else the
        // studio's own Organization (an About page).
        const schema = !/<!--\s*homie:schema\s*-->/.test(html) ? ''
          : want === '/' ? ldScript(homeLd(cat, url.origin))
            : game && parts.length === 1 ? ldScript(landingLd(cat, game, url.origin, { shop: await sellingShop(env, cat) }))
              : ldScript([studioNode(cat, url.origin, { full: true })]);
        return customPage(cat, html, { active, schema, origin: url.origin, playerGame: game && parts.length === 1 ? game : null });
      }
    }
  }

  if (parts[0] === 'music' || parts[0] === 'videos') {
    const kind = parts[0];
    const cat = await getCat();
    const list = (kind === 'music' ? cat.songs : cat.videos) ?? [];
    // A studio with no songs has no Music: the tab is gone and the page is not found (the same for videos).
    if (!list.length) return notFoundPage(kind === 'music' ? 'This studio has no music yet.' : 'This studio has no videos yet.', cat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${kind}/`, 301);
    if (parts.length === 1) { await countVisit(request, env, ctx, kind); return mediaIndexPage(cat, kind, { origin: url.origin }); }
    const slug = parts[1];
    const entry = MEDIA_SLUG.test(slug) ? list.find((e) => e.slug === slug) : null;
    if (parts.length === 2) {
      if (!entry) return notFoundPage(`No ${kind === 'music' ? 'song' : 'video'} called "${slug}" here.`, cat);
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${kind}/${slug}/`, 301);
      await countVisit(request, env, ctx, `${kind}/${slug}`);
      return kind === 'music' ? songPage(cat, entry, url.origin) : videoPage(cat, entry, url.origin);
    }
    if (parts.some((p) => p === '..')) return notFoundPage('Nothing here.', cat);
    const file = await assetWithRange(request, env, url);
    if (file.status === 404) {
      // Not in the site's files: a song's or video's file that lives in the studio's R2 (media move), same address.
      const held = await heldInR2(env, getCat, path);
      if (held) return mediaObject(request, env, held.r2, { cache: ASSET_CACHE, type: held.type ?? null });
      return notFoundPage('Nothing here.', cat);
    }
    return file;
  }
  if (path === '/' || path === '/index.html') {
    const cat = await getCat();
    await countVisit(request, env, ctx, 'home');
    shareDaily(cat, url, ctx);
    const { rooms, live } = await roomsOf(env, cat.games ?? []);
    return homePage(cat, { origin: url.origin, rooms, live });
  }
  if (['games', 'apps', 'rooms', 'posts'].includes(parts[0]) && parts.length === 1) {
    const cat = await getCat();
    const has = sectionsOf(cat).some((s) => s.key === parts[0]);
    if (!has) return notFoundPage(parts[0] === 'posts' ? 'This studio has no posts yet.' : 'This studio has no games yet.', cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${parts[0]}/`, 301);
    await countVisit(request, env, ctx, parts[0]);
    if (parts[0] === 'posts') return postsPage(cat, { origin: url.origin });
    const { rooms, live } = await roomsOf(env, cat.games ?? []);
    return ['games', 'apps'].includes(parts[0]) ? gamesPage(cat, { origin: url.origin, live, kind: parts[0] === 'apps' ? 'app' : 'game' }) : roomsPage(cat, { origin: url.origin, rooms });
  }
  if (parts[0] === 'posts' && parts.length === 2 && POST_SLUG.test(parts[1])) {
    const cat = await getCat();
    const posts = (cat.posts ?? []).length ? await postsOf(env, url.origin) : [];
    const post = posts.find((p) => p.slug === parts[1]);
    if (!post) return notFoundPage(`No post called "${parts[1]}" here.`, cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/posts/${post.slug}/`, 301);
    await countVisit(request, env, ctx, `posts/${post.slug}`);
    return postPage(cat, post, { origin: url.origin });
  }

  if(parts[0]==='games' && parts.length>2) {
    const all=await getAll(),app=(all.games??[]).find(g=>g.id===parts[1]&&g.kind==='app');
    if(app && launchOf(app,await settingsOf(env,{fresh:true}),env)!=='public')return json({ok:false,error:'not-found'},404);
  }
  const game = parts[0];
  if (game && GAME_ID.test(game)) {
    const all = await getAll();
    const meta = (all.games ?? []).find((g) => g.id === game);
    if (!meta) return fallback(request, env, url, getCat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/`, 301);
    let sub = parts.slice(1).join('/');
    // Game bundles were already public assets; only the document carries access context.
    // Apps retain their session/role checks even for individual asset files.
    if(read&&meta.kind!=='app'&&sub.startsWith('__game/')&&!['__game/','__game/index.html'].includes(sub))return gameAsset(request,env,url,game,sub.slice('__game/'.length));
    const cat = await getCat();
    if (meta.kind === 'app' && /^open(?:\/(embed|preview))?$/.test(sub)) sub = sub.replace(/^open/, 'play');
    if (sub === '__restart') {
      if (env.HOMIE_PREVIEW !== '1' || request.method !== 'POST' || !hostedGame(game)) return new Response('not found', { status: 404 });
      const room = url.searchParams.get('room') ?? '';
      if (!ROOM_ID.test(room)) return new Response('invalid room', { status: 400 });
      return env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`)).fetch(`https://table/__restart?game=${game}&room=${room}`, { method: 'POST' });
    }
    // Read now, not from a Worker instance's 5 s cache: a game the owner just made private shuts at once everywhere.
    const settings = await settingsOf(env, { fresh: true });
    // The owner's launch state and room size (worker/office.mjs): a private or invite-only game lets in only those
    // with access, and the owner may have made its rooms smaller than the game's own seats.
    const launch = launchOf(meta, settings, env);
    const max = seatsFor(meta, settings);
    if (meta.kind === 'app') {
      const asset=/^__assets\/([^/]+)\/(.+)$/.exec(sub);
      if(asset) {
        if(!(await appAssetTicket(env,game,asset[1],{request,meta,launch})))return json({ok:false,error:'not-found'},404);
        const response=asset[2]==='index.html'?await gameDocument(request,env,url,game,meta,cat):await gameAsset(request,env,url,game,asset[2]);
        response.headers.set('cache-control','private, no-store');
        response.headers.set('referrer-policy','no-referrer');
        return response;
      }
      const frameTicket = ['__game','__game/','__game/index.html','__net','__watch'].includes(sub) && await ticketAllows(env, await ticketSub(env,game,url.searchParams.get('t')), launch);
      if (launch !== 'public' && !frameTicket && !(await accessOf(request, env, game, launch)).ok && (await (await import('./local-test.mjs')).localSession(request,env))?.app!==game) return json({ ok: false, error: 'not-found' }, 404);
      if(launch==='public') {
        const web=await (await import('./app-web.mjs')).appWeb(request,env,meta,url,sub,()=>gameDocument(request,env,url,game,meta,cat));
        if(web)return web;
      }
      const apiSession=async response=>{
        const access=await appAccess(request,env,meta,url);
        return access.ok?appRoleSession(response,request,env,meta,launch):response;
      };
      if(sub==='api/app/live') {
        if(request.method!=='GET')return new Response('GET required',{status:405});
        const {appHub}=await import('./app-streams.mjs');
        return apiSession(await appHub(env,meta.id).fetch('https://app/__app_records',{method:'POST',body:JSON.stringify({op:'open',meta,url:request.url,headers:Object.fromEntries(request.headers),collections:url.searchParams.getAll('collection')})}));
      }
      if(sub==='api/app/tools')return apiSession(await (await import('./app-tools.mjs')).appToolsRoute(request,env,meta,url,cat,await studioTools()));
      const api = await appRecordsRoute(request, env, meta, url, sub);
      if (api) return sub.startsWith('api/app/records/')?apiSession(api):api;
      if (['play', 'tv', 'watch'].includes(sub)) {
        let a;
        try { a = await appAccess(request, env, meta, url); } catch { return json({ ok: false, error: 'app roles unavailable; apply studio migrations' }, 503); }
        if (!a.ok) {
          if (a.status === 401) return Response.redirect(`${url.origin}/account/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
          return json({ ok: false, error: a.error }, a.status);
        }
        if(!meta.room)return appRoleSession(recordsPage(meta,url,cat,await availableShellShop(env,cat,game),Boolean(await (await import('./local-test.mjs')).localSession(request,env)),launch!=='public'?await appAssetTicket(env,game,undefined,{request,meta,launch}):null),request,env,meta,launch);
      }
    }
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName(game));
    if (sub === 'invite') return redeemInvite(request, env, url, cat, meta, settings);

    // SERVERS (worker/servers.mjs, NETPLAY.md section 17): which server a request is for — its path (/s/<id>/), its
    // room (s-<id>-<n>; pub-N and any named room are the public server's), or for a bare Play the signed-in player's
    // home server, else public. Every door follows the game's launch state first, as it always did.
    const servers = await serversOf(env, meta);
    const serverById = (id) => servers.find((x) => x.id === id) ?? null;
    const pathServer = /^s\/([a-z0-9][a-z0-9-]{1,19})(?:\/(play|tv|home))?\/?$/.exec(sub);
    if (/^s(?:\/|$)/.test(sub) && !pathServer) return notFoundPage(`Nothing here in ${meta.name}.`, cat);
    if (pathServer && (!serverById(pathServer[1]) || pathServer[1] === 'public' || serverById(pathServer[1]).state === 'archived')) return notFoundPage(`${meta.name} has no server called "${pathServer[1]}".`, cat);
    if (pathServer && !pathServer[2] && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/s/${pathServer[1]}/${url.search}`, 301);
    const policyFor = (srv, named = false) => policyOf(srv, { seats: max, named });
    const humanSeats = (pol) => Math.max(1, max - (pol.aiSeats + pol.guides));
    const askedRoom = url.searchParams.get('room');
    if (pathServer) sub = pathServer[2] === 'play' ? 'play' : pathServer[2] === 'tv' ? 'tv' : pathServer[2] === 'home' ? 's-home' : 's-page';

    const doorSubs = ['', 'live', 'credits', 'tv', 'play', 'watch', 'api/lobby', 'api/watch', 'servers', 'api/servers', 's-page', 's-home'];
    const door = launch !== 'public' && doorSubs.includes(sub) ? await accessOf(request, env, game, launch) : { ok: true, sub: null, owner: false };
    const shut = () => gatePage(cat, meta, launch, { code: url.searchParams.get('invite') ?? '' });
    /** A page's own door to a server: who this browser is (owner, invited, signed in) and whether it may come in. */
    const pageDoor = async (srv, { watching = false } = {}) => {
      const owner = door.owner || (launch === 'public' && await isOwner(request, env));
      const acct = await accountSub(request, env);
      const sPass = srv && srv.door === 'invite' && !owner ? await serverPassOf(request, env, game, srv.id, cookieValues) : null;
      const list = [owner ? 'o' : null, door.sub, sPass ? `i-${sPass.invite}` : null, acct].filter(Boolean).flatMap(holders);
      const access = srv ? await serverAccess(env, { game, server: srv, holders: list, watching }) : { ok: true };
      return { ...access, owner, acct, holder: joinHolders(door.sub ?? (owner ? 'o' : null), sPass ? `i-${sPass.invite}` : null, acct) };
    };
    /** The public server is hidden (closed by its owner): Play shows the other servers instead, and named rooms are off. */
    const publicHidden = () => (serverById('public') ?? PUBLIC_SERVER).state !== 'open';

    if (sub === '') {
      if (!door.ok) return shut();
      await countVisit(request, env, ctx, game);
      shareDaily(cat, url, ctx);
      const { rooms, live } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      const band = servers.some((x) => x.id !== 'public' && x.listed && x.state === 'open') ? await serverLive(env, meta, servers, url.origin, lobby) : null;
      // GAME PARTS: the landing's "Parts from this game" band (shared parts only).
      return withPartsBand(gameLanding(cat, meta, { origin: url.origin, rooms, playing: live[game] ?? 0, week, servers: band, listed: launch === 'public', shop: launch === 'public' ? await sellingShop(env, cat) : null }), env, url, meta);
    }
    if (sub === 'live') {
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const { rooms, live } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      // The same shape the house brands' landings read (counted, playing, waiting, road), plus the rooms.
      return json({ ok: true, game, counted: true, playing: live[game] ?? 0, waiting: 0, max, rooms, road: { seats: 'any', start: 'now', room: launch === 'public' ? 'public' : launch, big: true }, ...(week ? { week } : {}) }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'credits') {
      if (!door.ok) return shut();
      let texts = [];
      try { const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/_landing/credits.json`)); if (res.ok) texts = (await res.json()).texts ?? []; } catch { texts = []; }
      if (!texts.length) return notFoundPage(`${meta.name} has no licence texts to show; its credits are on its page.`, cat);
      return creditsPage(cat, meta, texts, { origin: url.origin });
    }
    if (sub === 'servers') {
      if (!door.ok) return shut();
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/servers/`, 301);
      await countVisit(request, env, ctx, `${game}/servers`);
      return serversPage(cat, meta, { origin: url.origin, servers: await serverLive(env, meta, servers, url.origin, lobby), hidden: publicHidden() });
    }
    if (sub === 'api/servers') {
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const list = (await serverLive(env, meta, servers, url.origin, lobby)).filter((x) => x.id === 'public' || (x.listed && x.state === 'open'));
      return json({ ok: true, game, servers: list }, 200, { 'cache-control': 'public, max-age=15' });
    }
    if (sub === 's-page') {
      if (!door.ok) return shut();
      const srv = serverById(pathServer[1]);
      const d = await pageDoor(srv);
      const pid = d.acct?.startsWith('p-') ? d.acct.slice(2) : null;
      const member = pid ? await memberOf(env, game, srv.id, pid) : null;
      await countVisit(request, env, ctx, `${game}/s/${srv.id}`);
      const [row] = await serverLive(env, meta, [srv], url.origin, lobby);
      const { rooms } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      return serverPage(cat, meta, row, { origin: url.origin, rooms: rooms.filter((r) => r.server?.id === srv.id), door: d, member, signedIn: Boolean(pid) });
    }
    if (sub === 's-home') {
      // Join this server, leave it, or make it home: the signed-in player's own choice (a same-origin JSON POST).
      if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin' }, 403);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const srv = serverById(pathServer[1]);
      const acct = await accountSub(request, env);
      if (!acct?.startsWith('p-')) return json({ ok: false, error: 'sign-in', message: 'Sign in to the studio first (your account page).' }, 401);
      let body = {};
      try { body = JSON.parse((await request.text()) || '{}'); } catch { return json({ ok: false, error: 'json' }, 400); }
      const d = await pageDoor(srv);
      if (body.join !== false && !d.ok) return json({ ok: false, error: d.why, message: 'This server\'s door does not let you in.' }, 403);
      try { return json(await setMembership(env, game, srv.id, acct.slice(2), { join: body.join !== false, home: body.home === true })); } catch { return json({ ok: false, error: 'not-migrated', message: 'This studio\'s database has no servers yet (migration 0006).' }, 503); }
    }
    if (sub === 'play/preview' && env.HOMIE_EMBED_PREVIEW === '1' && isLocalOrigin(url.origin)) return embedPreview(cat, meta, url.origin);
    if (sub === 'tv' || sub === 'play' || sub === 'play/embed') {
      const embed = sub === 'play/embed';
      if (embed && (!playerEnabled(cat, meta) || launch !== 'public')) return notFoundPage(meta.kind === 'app' ? 'This app does not open inside a post. Open its studio page.' : 'This game does not play inside a post. Open its studio page to play.', cat);
      const screen = !embed && (sub === 'tv' || url.searchParams.get('screen') === '1');
      const asked = embed ? null : askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { screen });
      if (!door.ok) return shut();
      // Which server: the path's, the room's, else (Play) the player's home server, else public.
      let srv = pathServer ? serverById(pathServer[1]) : asked !== null ? serverById(roomServer(asked)) : null;
      if (asked !== null && !srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const named = asked !== null && !pooledRoom(asked);
      if (!srv) {
        const acct = embed ? null : await accountSub(request, env);
        const home = acct?.startsWith('p-') ? await homeOf(env, game, acct.slice(2)) : null;
        const h = home ? serverById(home) : null;
        srv = h && h.state === 'open' ? h : serverById('public') ?? PUBLIC_SERVER;
      }
      const d = await pageDoor(srv);
      if (meta.room?.characters && !screen && !embed && (!d.acct || !(await chatWho(env, game, srv, d.acct)).acct)) return Response.redirect(`${url.origin}/account/?next=${encodeURIComponent(url.pathname + url.search)}`, 303);
      // The owner hid the public server: Play shows the servers to pick from, and a named room is off (owner aside).
      if (srv.id === 'public' && publicHidden() && !d.owner) {
        if (named) return doorPage(cat, meta, srv, { why: 'closed' });
        return serversPage(cat, meta, { origin: url.origin, servers: await serverLive(env, meta, servers, url.origin, lobby), hidden: true, pick: true });
      }
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, days: d.days, origin: url.origin, next: `${url.pathname}${url.search}`, code: url.searchParams.get('invite') ?? '' });
      let recordsGuest=null;
      if(meta.room?.records&&!embed&&!screen&&!d.acct&&env.DB){
        const made=await playerAccounts.recordsGuest(request,env,url);if(made.error)return made.error;
        recordsGuest=made.session;d.acct='p-'+recordsGuest.player.id;d.holder=joinHolders(d.holder,d.acct);
      }
      if (d.acct?.startsWith('p-') && srv.id !== 'public') ctx?.waitUntil?.(noteMember(env, game, srv.id, d.acct.slice(2)));
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      const pol = policyFor(srv, named);
      const server = srv.id === 'public' && !pol.server ? null : { ...serverView(srv, { origin: url.origin, game }), mentor: Boolean(d.mentor) };
      if (screen) {
        await countVisit(request, env, ctx, game, 'screen');
        // The big screen picks its room now, so the QR it shows puts every phone in that same room.
        let room = asked;
        if (!room) {
          try { room = (await (await lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json()).room ?? null; } catch { room = null; }
        }
        const joinUrl = `${url.origin}${openPath(meta)}${room ? `?room=${encodeURIComponent(room)}` : ''}`;
        // Local development: no phone can open this computer's own address, so no code for it; the card says to deploy.
        const local = isLocalOrigin(url.origin);
        let qr = null;
        if (!local) try { qr = qrSvg(joinUrl, { title: `Join ${meta.name ?? game}` }); } catch { /* too long for a QR: the address shows as text */ }
        // Television checkout and kids-server visibility follow the studio shop policy.
        const sh = await availableShellShop(env, cat, game, { kids: pol.kids });
        let shopQr = null;
        if (sh && !local) try { shopQr = qrSvg(`${url.origin}/shop/?game=${encodeURIComponent(game)}`, { title: `Shop: ${meta.name ?? game}` }); } catch { shopQr = null; }
        return appRoleSession(playPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, screen: true, joinUrl, qr, local, room, ticket, owner: d.owner, launch, server, shop: sh ? { ...sh, qr: shopQr, url: `${url.origin}/shop/?game=${game}` } : null }),request,env,meta,launch);
      }
      await countVisit(request, env, ctx, game, 'play');
      shareDaily(cat, url, ctx);
      const page=await appRoleSession(playPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, embed, preview: env.HOMIE_EMBED_PREVIEW === '1', ticket: embed ? null : ticket, owner: !embed && d.owner, launch, server, ...(embed ? {} : await chatWho(env, game, srv, d.acct)), shop: await availableShellShop(env, cat, game, { kids: pol.kids }) }),request,env,meta,launch);
      for(const cookie of recordsGuest?.cookies??[])page.headers.append('set-cookie',cookie);return page;
    }
    if (sub === 'watch') {
      // The same door as Play: a game that is private or an invite-only beta is watched only by whoever may play it.
      const asked = askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { watch: true });
      if (!door.ok) return shut();
      const policy = watchOf(meta);
      if (policy === 'off') return noWatchPage(cat, meta);
      // A server's door is its watch door too (an invite or an account); a beginner server is watched by anyone.
      const srv = asked !== null ? serverById(roomServer(asked)) : serverById('public') ?? PUBLIC_SERVER;
      if (!srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const d = await pageDoor(srv, { watching: true });
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, origin: url.origin, next: `${url.pathname}${url.search}`, watch: true });
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      await countVisit(request, env, ctx, game, 'watch');
      shareDaily(cat, url, ctx);
      return watchPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, room: asked, ticket, policy, owner: d.owner, ...(await chatWho(env, game, srv, d.acct)) });
    }
    if (sub === 'api/watch') {
      if (!door.ok || watchOf(meta) === 'off') return json({ ok: false, error: 'not-found' }, 404);
      // The busiest room now, to watch, of a server anyone may watch; nothing is reserved (a watcher takes no seat).
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pools = servers.filter((x) => x.state === 'open' && x.door === 'open').map((x) => x.id).join(',');
      let best = null;
      const wver = versionOf(meta?.netplay?.version);
      try { best = await (await lobby().fetch(`https://lobby/busiest?pools=${encodeURIComponent(pools)}${not ? `&not=${encodeURIComponent(not)}` : ''}${wver ? `&ver=${encodeURIComponent(wver)}` : ''}`)).json(); } catch { best = null; }
      return json({ ok: true, game, room: best?.room ?? null, players: best?.players ?? 0, max }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'api/lobby') {
      // A standalone copy's page reads this answer from another origin: the Worker's own `fetch` adds its header to
      // every answer of this address (worker/standalone.mjs), whichever line here made it.
      const app = isAppOrigin(request);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      // ?server=<id>: a room of that server's pool (its door first); none: public. Strangers never meet across servers.
      const sid = url.searchParams.get('server') ?? 'public';
      // An app plays on the public server only: it has no account and no invite to show a server's door.
      if (app && sid !== 'public') return json({ ok: false, error: 'app-public', message: 'A standalone copy plays on the public server.' }, 403);
      const srv = SERVER_ID.test(sid) || sid === 'public' ? serverById(sid) : null;
      if (!srv) return json({ ok: false, error: 'no-server', message: `${meta.name} has no server called ${String(sid).slice(0, 24)}.` }, 404);
      if (srv.id === 'public' && publicHidden() && !(await pageDoor(srv)).owner) return json({ ok: false, error: 'closed', message: 'Pick a server to play on.' }, 403);
      const d = await pageDoor(srv);
      if (!d.ok) return json({ ok: false, error: d.why, message: 'This server\'s door does not let you in.' }, 403);
      // A browser held out of a room asks for any other (`not`), so the Lobby never sends it back there.
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pol = policyFor(srv);
      // Strangers on different builds of the game never meet (section 23): the Lobby matches within the live build.
      // A standalone copy is the build it was made from, whatever is live now: it says its own (`gv`, or none for a
      // game that named none then) and is matched with copies of that build. What it says is its own word, so the
      // Lobby is told it came from an app (`app=1`) and keeps only a few such builds' rooms (LOBBY_APP_VERSIONS).
      const ver = app ? versionOf(url.searchParams.get('gv')) : versionOf(meta?.netplay?.version);
      if (app && meta?.room?.host === 'server' && ver !== meta.room.build) return json({ ok: false, error: 'stale', message: 'Update the app to play online.' }, 409);
      if (meta.room?.lifetime === 'persistent') {
        const room = srv.id === 'public' ? 'pub-1' : `s-${srv.id}-1`;
        if (not.split(',').includes(room)) return json({ ok: false, error: 'world-unavailable', message: 'This world is unavailable. Choose another named world.' }, 409);
        return json({ room, players: 0, max: humanSeats(pol), server: srv.id });
      }
      return lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${not ? `&not=${encodeURIComponent(not)}` : ''}${ver ? `&ver=${encodeURIComponent(ver)}` : ''}${app ? '&app=1' : ''}`, { method: 'POST' });
    }
    if (sub === 'api/agent') {
      // An AI's seat (worker/agents.mjs): its pass, the server's policy, a room with people in it, a ticket.
      return sitRoute(request, env, url, {
        meta, launch,
        serverOf: (id) => serverById(id),
        policyOf: (srv) => policyFor(srv),
        ticketFor: (holder) => ticketFor(env, game, holder),
        join: async (srv, pol) => {
          try {
            const reserve = pol.aiSeats + pol.guides;
            const r = await (await lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${max}&server=${srv.id}&agent=1&ai=${reserve}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json();
            return r.room ?? null;
          } catch { return null; }
        },
      });
    }
    if (sub === 'api/chat/report') {
      // A player reports one chat line (section 19): the room's own copy of it is what is kept, never the reporter's words.
      if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'a report comes from this site\'s own pages' }, 403);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      let body = {};
      try { body = JSON.parse((await request.text()).slice(0, 2048) || '{}'); } catch { return json({ ok: false, error: 'json' }, 400); }
      const room = String(body.room ?? '');
      const id = String(body.id ?? '');
      if (!ROOM_ID.test(room) || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) return json({ ok: false, error: 'bad-request', message: 'room and id name the message' }, 400);
      const reason = REPORT_REASONS.includes(body.reason) ? body.reason : 'other';
      const key = `${BROWSER_KEY.test(String(body.b ?? '')) ? body.b : ''}|${request.headers.get('cf-connecting-ip') ?? ''}`;
      if (!reportAllowed(key)) return json({ ok: false, error: 'rate', message: 'That is a lot of reports: the studio has them. Try again in a few minutes.' }, 429);
      let line = null;
      try { line = (await (await env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`)).fetch(`https://table/__chat?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}&op=line&id=${encodeURIComponent(id)}`)).json()).line ?? null; } catch { line = null; }
      if (!line) return json({ ok: false, error: 'gone', message: 'That message is no longer in the room.' }, 404);
      if (line.by === 'studio') return json({ ok: false, error: 'studio', message: 'That is the studio\'s own line.' }, 400);
      try { await fileReport(env, { game, room, line, reason }); } catch (error) {
        return json({ ok: false, error: 'not-migrated', message: `Reports need migration 0007_studio_chat.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
      }
      return json({ ok: true, message: 'Thanks for telling the studio. They will look at it.' });
    }
    if (sub === '__net' || sub === '__watch') {
      if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const room = url.searchParams.get('room') || 'main';
      if (!ROOM_ID.test(room)) return new Response('bad room', { status: 400 });
      // Who the ticket names: the door of a game that is not public, and in any game a signed-in player's account.
      const who = url.searchParams.get('t') ? await ticketSub(env, game, url.searchParams.get('t')) : null;
      if (launch !== 'public' && !(await ticketAllows(env, who, launch))) return new Response('this game is not open to you', { status: 403 });
      const b = BROWSER_KEY.test(url.searchParams.get('b') ?? '') ? url.searchParams.get('b') : '';
      // A watcher's socket (section 16): what the game lets watchers see goes with every socket, so a helper that only
      // says `watch` in its hello is held to it too; a game that cannot be watched refuses a watch door's socket here.
      const policy = watchOf(meta);
      const w = sub === '__net' && url.searchParams.get('w') === '1';
      if (w && policy === 'off') return new Response('this game cannot be watched', { status: 403 });
      // The room's server (section 17): its door for a person, and the policy the room applies. An AI's ticket
      // (a-<pass>) is checked against its pass and the server: a humans-only server refuses it here and again at the relay.
      const srv = serverById(roomServer(room));
      if (!srv) return new Response('this server does not exist', { status: 404 });
      const parts = holders(who);
      const agentPart = parts.find((x) => x.startsWith('a-'));
      const pol = policyFor(srv, !pooledRoom(room));
      let ag = null;
      if (agentPart && sub === '__net') {
        const pass = await passById(env, agentPart.slice(2));
        const why = passRefusal(pass, { game, server: srv.id, policy: pol, launch });
        if (why) return new Response(why.error === 'agents-off' ? 'This server is for humans only\n' : `${why.message}\n`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        ag = { ...agentFacts(pass), name: aiName(pass.label) };
      } else if (srv.state !== 'open' || srv.door !== 'open' || (srv.policy === 'beginner' && !w && sub === '__net')) {
        const access = await serverAccess(env, { game, server: srv, holders: parts, watching: w || sub === '__watch' });
        if (!access.ok) return new Response('this server is not open to you', { status: 403 });
      }
      // Room chat (section 19): the room's rules, and who this socket is to them: an account with a passkey (not a
      // guest), a member of this server, or another site's page watching from elsewhere (homie.rocks's room page).
      const chat = chatOf(meta, srv, await chatRowsOf(env));
      const { acct, member } = await chatWho(env, game, srv, who);
      const origin = request.headers.get('origin');
      const hub = sub === '__watch' && Boolean(origin) && origin !== 'null' && origin !== url.origin;
      const lean = { ...chat, emoji: chat.emoji.filter((e) => !REACTIONS.some((r) => r.k === e.k)) };
      // A supporter's badge (the shop, 0.24.0): what the player's account owns, looked up here, so a hello can never claim
      // one; none on a kids server, none for an AI or a watcher.
      const pid = !ag && !w && sub === '__net' ? parts.find((x) => x.startsWith('p-'))?.slice(2) : null;
      const badge = pid ? await roomBadge(env, cat, pid, { kids: pol.kids }) : null;
      const stub = sub === '__net' ? gateFor(env, game, room, max, b) : env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
      // Revision 9 (NETPLAY.md sections 22 and 23): the build that is live now (`cur`, always said, empty when the game
      // names none), the build this socket's page was served with (`gv`, from the socket's own address), and the game's
      // own stall time.
      const cur = versionOf(meta?.netplay?.version) ?? '';
      const gv = versionOf(url.searchParams.get('gv')) ?? '';
      const stall = Number(meta?.netplay?.stallMs) || 0;
      const target = `https://table/${sub}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}${b ? `&b=${b}` : ''}${who ? `&via=${encodeURIComponent(who)}` : ''}${sub === '__net' ? `&wp=${policy}${w ? '&w=1' : ''}` : ''}&pol=${encodeFacts(pol)}&chat=${encodeFacts(lean)}${acct ? '&acct=1' : ''}${member ? '&mem=1' : ''}${hub ? '&hub=1' : ''}${ag ? `&ag=${encodeFacts(ag)}` : ''}${badge ? `&bd=${encodeURIComponent(badge)}` : ''}&cur=${encodeURIComponent(cur)}${gv ? `&gv=${encodeURIComponent(gv)}` : ''}${stall ? `&stall=${stall}` : ''}${meta?.room?.contract ? `&rules=1&hz=${meta.room.tickHz ?? 20}` : ''}${meta?.room?.host === 'server' ? '&host=server' : ''}`;
      // The room's own failure to answer is told apart from the browser going away while it was connecting (a closed
      // tab, a reload racing its own socket): the second is a departure, said in one line with its room, never an
      // uncaught error with nothing on it.
      try { return await stub.fetch(new Request(target, request)); } catch (error) {
        const gone = departure(error);
        try { console[gone ? 'log' : 'error'](JSON.stringify({ at: new Date().toISOString(), ev: gone ? 'socket-gone' : 'room-unreachable', game, room, sub, error: errorLine(error) })); } catch { /* no console */ }
        return new Response(gone ? 'gone' : 'the room did not answer; try again', { status: gone ? 499 : 503 });
      }
    }
    // The same knock, relative to the game's own page: the same answer (see notAHomie).
    if (sub === '__homie' || sub.startsWith('__homie/')) return notAHomie(request);
    if (sub === '__game' || sub === '__game/' || sub === '__game/index.html') {
      if (url.searchParams.get('embed') === '1' && (!playerEnabled(cat, meta) || launch !== 'public')) return notFoundPage('Embedding is off for this game.', cat);
      const who = await ticketSub(env, game, url.searchParams.get('t'));
      // A play page left open across a deploy (0.46.5). One that names what it was made for (`sh`) and is behind is
      // told so, and reloads itself whole, once, to the same room and seat. One from before that handshake is sent
      // to a fresh page only when this game cannot work inside it: the game keeps verified results for a player, and
      // the old page has no player ticket to give its frame (a result would have nobody to be written for).
      if (url.searchParams.get('pf') === '1' && url.searchParams.get('embed') !== '1' && url.searchParams.get('want') !== 'screen' && !url.searchParams.has('watch')) {
        const said = url.searchParams.get('sh'), now = shellKey(meta);
        const ticketless = Boolean(meta.room?.records && env.DB) && !holders(who).some((x) => x.startsWith('p-'));
        if (said !== null ? said !== now : ticketless) {
          return new Response(shellStandIn(url.searchParams.get('room') ?? '', said !== null ? now : null), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
        }
      }
      if (launch !== 'public' && !(await ticketAllows(env, who, launch))) return new Response('This game is not open to you.\n', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      // An agent's frame (hands `self`): the game plays as that AI.
      const agentPart = holders(who).find((x) => x.startsWith('a-'));
      const pass = agentPart ? await passById(env, agentPart.slice(2)) : null;
      return gameDocument(request, env, url, game, meta, cat, { agent: pass?.live ? { name: aiName(pass.label), hands: pass.hands, role: pass.role } : null });
    }
    if (sub.startsWith('__game/')) return gameAsset(request, env, url, game, sub.slice('__game/'.length));
  }
  return fallback(request, env, url, getCat);
}

export {route};

