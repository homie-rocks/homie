import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, loadavg } from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const app = process.argv.includes("--app");
const dir = await mkdtemp(join(tmpdir(), "physics-trial-"));
let browser, server;
const run = (cmd, args, cwd = repo) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1536" },
    timeout: 300000,
  });
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  return r.stdout;
};
try {
  const packs = {};
  for (const name of ["studio", "physics", "heightfield"]) {
    run("npm", [
      "pack",
      "--workspace",
      `packages/${name}`,
      "--pack-destination",
      dir,
    ]);
    packs[name] = join(
      dir,
      (await readdir(dir)).find(
        (n) => n.startsWith(`homie-rocks-${name}-`) && n.endsWith(".tgz"),
      ),
    );
  }
  const kit = join(dir, "kit");
  await mkdir(kit);
  run("tar", ["-xzf", packs.studio, "-C", kit]);
  const studio = join(dir, "studio");
  run(process.execPath, [
    join(kit, "package/bin/homie-studio.mjs"),
    "new",
    studio,
    "--name",
    "Physics Trial",
    "--no-install",
  ]);
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      packs.studio,
      packs.physics,
      packs.heightfield,
    ],
    studio,
  );
  const game = join(studio, app ? "apps/physics" : "games/physics");
  await mkdir(join(game, "src"), { recursive: true });
  await writeFile(join(game, app ? "app.json" : "game.json"), JSON.stringify({
    id: "physics", name: "Physics Trial", entry: "src/main.ts",
    ...(app ? { roles: { visitor: { signIn: false, can: [] } }, surfaces: { phone: "visitor", wall: "visitor" }, records: { persist: false, collections: {} } } : { players: { min: 1, max: 1 } }),
  }));
  await writeFile(
    join(game, "index.html"),
    '<canvas id="view" width="960" height="540"></canvas><script type="module" src="./assets/main.js"></script>',
  );
  await writeFile(
    join(game, "src/main.ts"),
    `
import {initPhysics} from '@homie-rocks/physics/Engine.js';
import {createWorld} from '@homie-rocks/physics/World.js';
await initPhysics();
const w=createWorld({}),box=(x,y,z)=>({kind:'box',halfExtents:{x,y,z}});
w.createBody({type:'static',position:{x:0,y:-.5,z:0},colliders:[{shape:box(1000,.5,10)}]});
for(let i=0;i<10;i++)w.createBody({type:'static',position:{x:i*.3+2,y:(i+.5)*.15,z:0},colliders:[{shape:box(2,.075,3)}]});
const player=w.createCharacter({position:{x:-2,y:1,z:0},radius:.3,height:1.8,stepHeight:.35,stepMinWidth:.05,snapDistance:.35,slopeLimit:.7,offset:.01,gravity:20,jumpSpeed:5});
const props=Array.from({length:20},(_,i)=>w.createBody({type:'dynamic',position:{x:-4+i*.4,y:3+i*.15,z:2.5},colliders:[{shape:box(.15,.15,.15)}]}));
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
let last=0,count=0;const times=[],costs=[];
function frame(now){
 if(last&&count>60)times.push(now-last);last=now;count++;
 const start=performance.now();w.controlCharacter(player,{x:count<300?2:-2,z:0});w.step(1/60);costs.push(performance.now()-start);
 ctx.fillStyle='#101c2c';ctx.fillRect(0,0,960,540);ctx.fillStyle='#657d89';ctx.fillRect(0,450,960,90);
 for(let i=0;i<10;i++)ctx.fillRect(480+i*18,450-(i+1)*9,120,9);
 for(const id of props){const p=w.bodyState(id).position;ctx.fillStyle='#edac52';ctx.fillRect(480+p.x*60-9,450-p.y*60-9,18,18);}
 const p=w.bodyState(w.characterState(player).body).position;ctx.fillStyle='#63e1c1';ctx.fillRect(480+p.x*60-18,450-p.y*60-54,36,108);
 ctx.fillStyle='white';ctx.font='22px sans-serif';ctx.fillText('Physics: stairs, a large floor and falling props',24,36);
 if(count<660)requestAnimationFrame(frame);else {times.sort((a,b)=>a-b);costs.sort((a,b)=>a-b);globalThis.result={frames:times.length,fps:1000/(times.reduce((a,b)=>a+b,0)/times.length),frameP95:times[Math.floor(times.length*.95)],physicsP95:costs[Math.floor(costs.length*.95)],grounded:w.characterState(player).grounded,position:p};w.dispose();}
}requestAnimationFrame(frame);
`,
  );
  run(process.execPath, [join(studio, "node_modules/@homie-rocks/studio/bin/homie-studio.mjs"), "build"], studio);
  const catalogue = JSON.parse(await readFile(join(studio, "site/dist/games.json"), "utf8"));
  if (app && catalogue.games.find((g) => g.id === "physics")?.kind !== "app") throw new Error("Physics was not built as an app");
  const output = join(studio, "site/dist/games/physics");
  server = createServer(async (req, res) => {
    try {
      const path = req.url === "/" ? "index.html" : req.url.slice(1);
      res.setHeader(
        "Content-Type",
        path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".wasm")
            ? "application/wasm"
            : "text/html",
      );
      res.end(await readFile(join(output, path)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const page = await browser.newPage(),
    errors = [];
  await page.setViewport({ width: 960, height: 540 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => globalThis.result, { timeout: 180000 });
  const result = await page.evaluate(() => globalThis.result);
  await page.screenshot({ path: join(tmpdir(), "physics-studio-trial.png") });
  console.log(
    JSON.stringify({
      kind: app ? "app" : "game",
      ...result,
      errors,
      load: loadavg(),
    }),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  if (result.fps < 59)
    throw new Error(`60 fps target missed: ${result.fps.toFixed(2)} fps`);
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
  console.log("Temporary studio deleted.");
}
