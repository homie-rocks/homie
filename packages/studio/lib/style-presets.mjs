/**
 * THE STYLE VOCABULARY the decisions pick from (lib/decisions.mjs): render styles, named palettes, light and camera
 * set-ups, fonts and the starter library's families, each with the words in a prompt that point at it. Taste, kept
 * as data: the automatic path reads it, the style board mixes it, and a person steers past it with their own values.
 */

/** How the world is drawn. `family`: the starter library family that fits; `materials`: the material model. */
export const RENDERS = Object.freeze({
  'lowpoly-flat': { label: 'Flat low-poly', words: /\b(low[- ]?poly|cozy|cosy|cute|toy|minimal|clean|simple|wholesome|chill)\b/i, materials: 'flat', outline: false, family: 'kenney', fonts: { display: 'Fredoka', body: 'Nunito' }, vfx: 'soft', note: 'faceted shapes in flat palette colours: the cheapest look on a phone, the most coherent, and the richest free library' },
  toon: { label: 'Toon / cel', words: /\b(toon|cel|cartoon|anime|comic|neon|cyber|synth|arcade)\b/i, materials: 'toon', outline: true, family: 'kaykit', fonts: { display: 'Lilita One', body: 'Nunito' }, vfx: 'toon', note: 'banded light and ink outlines: reads at any size, loud on a TV' },
  painted: { label: 'Stylised hand-painted', words: /\b(painterly|painted|storybook|watercolou?r|ghibli-like|fairy ?tale|whimsical|hand[- ]painted)\b/i, materials: 'hand-painted', outline: false, family: 'kaykit', fonts: { display: 'Fraunces', body: 'Lora' }, vfx: 'soft', note: 'soft painted albedo with the light baked gently in: warm and storybook' },
  'stylised-pbr': { label: 'Stylised PBR', words: /\b(realistic|real|photo|gritty|grounded|military|pbr)\b/i, materials: 'pbr', outline: false, family: 'polyhaven', fonts: { display: 'Rajdhani', body: 'Inter' }, vfx: 'soft', note: 'metal and roughness under real light: the most expensive look on a phone (textures and memory)' },
  'pixel-hd2d': { label: 'Pixel / HD-2D', words: /\b(pixel|8[- ]?bit|16[- ]?bit|retro|hd[- ]?2d|sprite)\b/i, materials: 'pixel', outline: false, family: 'kenney', fonts: { display: 'Press Start 2P', body: 'Silkscreen' }, vfx: 'pixel', note: 'pixel sprites in a low-poly world with tilt-shift and bloom (the sprite branch is phase 3; the board shows the world)' },
  voxel: { label: 'Voxel', words: /\b(voxel|blocky|blocks|cube|minecraft-like)\b/i, materials: 'flat', outline: false, family: 'kenney', fonts: { display: 'Silkscreen', body: 'Nunito' }, vfx: 'pixel', note: 'everything built of cubes: crisp, cheap, playful' },
});

/** The codex keys every palette fills (frontmatter `palette`), plus `ramp`: 12 to 16 colours for textures. */
export const PALETTE_KEYS = Object.freeze(['bg', 'ink', 'accent', 'accent2', 'danger', 'good', 'gold']);

export const PALETTES = Object.freeze({
  'autumn-grove': { label: 'Autumn grove: rust, moss and cream', words: /\b(forest|woods?|grove|autumn|fall|fox(es)?|berr(y|ies)|mushroom|acorn|leaf|leaves)\b/i,
    bg: '#1f2a24', ink: '#f6ecd9', accent: '#e9893a', accent2: '#8fbf5a', danger: '#e2553f', good: '#7fcf6a', gold: '#f2c14e',
    ramp: ['#2c3b31', '#3f5640', '#5d7a4a', '#8fbf5a', '#c9d98a', '#6b4a2f', '#9a6a3d', '#c98a4b', '#e9893a', '#b8442e', '#f6ecd9', '#d9c7a3', '#f2c14e', '#7a5a8c'] },
  'meadow-morning': { label: 'Meadow morning: sky blue, grass and butter', words: /\b(meadow|farm|garden|spring|sunny|bright|happy|picnic|village)\b/i,
    bg: '#cfe8f5', ink: '#1d2b3a', accent: '#ff8a5b', accent2: '#5cbf8a', danger: '#e2553f', good: '#45b36b', gold: '#ffd25a',
    ramp: ['#9fd3ef', '#cfe8f5', '#f8f3e6', '#8fd06a', '#5cbf8a', '#3f8f5a', '#ffd25a', '#ffb347', '#ff8a5b', '#e86a6a', '#b07ad9', '#8a6a4a', '#5a4a3a', '#ffffff'] },
  'embers-night': { label: 'Embers at night: warm golds on soot', words: /\b(fire|ember|lava|volcano|forge|torch|lantern|burning|ash(en)?)\b/i,
    bg: '#120c0a', ink: '#f6e7d3', accent: '#f4b23c', accent2: '#7ad38a', danger: '#ff5a4e', good: '#5fdc8b', gold: '#f2c14e',
    ramp: ['#120c0a', '#2b1d16', '#4a2e20', '#6e3b22', '#a4512a', '#e0702f', '#f4b23c', '#ffd98a', '#f6e7d3', '#7ad38a', '#3f6b4a', '#5a4a6e'] },
  'neon-dusk': { label: 'Neon dusk: magenta and cyan on ink', words: /\b(neon|cyber|synth(wave)?|city|night ?club|future|retro[- ]future|laser)\b/i,
    bg: '#0b0a1a', ink: '#eef0ff', accent: '#ff3fa4', accent2: '#2ee6f2', danger: '#ff4d4d', good: '#4dff9a', gold: '#ffd84a',
    ramp: ['#0b0a1a', '#1a1438', '#2c1f5e', '#4b2a8c', '#7a35c4', '#ff3fa4', '#ff7ac8', '#2ee6f2', '#7af3ff', '#ffd84a', '#eef0ff', '#3a3a5e'] },
  'candy-pop': { label: 'Candy pop: bubblegum and mint', words: /\b(candy|sweet|sugar|pastel|toy|kawaii|party|bubble|jelly)\b/i,
    bg: '#fff2f7', ink: '#2a1f3d', accent: '#ff5fa2', accent2: '#4fd1c5', danger: '#ff4f64', good: '#40c07a', gold: '#ffc94d',
    ramp: ['#fff2f7', '#ffd6e8', '#ff9ec7', '#ff5fa2', '#c45fd1', '#8a7cff', '#4fd1c5', '#a6f0d9', '#ffc94d', '#ff9a5a', '#2a1f3d', '#ffffff'] },
  'frost-blue': { label: 'Frost: ice blue and snow', words: /\b(snow|ice|icy|winter|frost|frozen|arctic|polar|penguin)\b/i,
    bg: '#eaf3fb', ink: '#14243a', accent: '#3d8bff', accent2: '#8fe3ff', danger: '#ff5a6a', good: '#41c08a', gold: '#ffcc4d',
    ramp: ['#ffffff', '#eaf3fb', '#cfe2f5', '#a9cbee', '#7fb0e6', '#3d8bff', '#2a5fb0', '#14243a', '#8fe3ff', '#c7f3ff', '#ffcc4d', '#b4a3d9'] },
  'desert-noon': { label: 'Desert noon: sand, terracotta and turquoise', words: /\b(desert|sand|dune|canyon|western|cowboy|egypt|pyramid|savanna)\b/i,
    bg: '#f5e2c0', ink: '#3a2412', accent: '#d9653b', accent2: '#2bb3a8', danger: '#c8322a', good: '#5aa84a', gold: '#f2b632',
    ramp: ['#fff3dc', '#f5e2c0', '#e8c48f', '#d9a35f', '#c47a3f', '#d9653b', '#a8452a', '#6e2e1a', '#3a2412', '#2bb3a8', '#7ad3c8', '#f2b632'] },
  'deep-sea': { label: 'Deep sea: teal dark with coral', words: /\b(ocean|sea|under ?water|reef|coral|fish|submarine|diver?|pirate|island|beach)\b/i,
    bg: '#06222e', ink: '#e6fbff', accent: '#ff7a59', accent2: '#3fe0c5', danger: '#ff5a6a', good: '#5fe08a', gold: '#ffd166',
    ramp: ['#03141b', '#06222e', '#0b3a4a', '#11566a', '#1a7a8c', '#3fe0c5', '#a6f5e6', '#ff7a59', '#ffb08a', '#ffd166', '#e6fbff', '#5a4a8c'] },
  'moonlit-grove': { label: 'Moonlit grove: indigo, silver and firefly', words: /\b(night|moon(lit)?|dark|spooky|haunted|ghost|witch|owl|halloween|grave)\b/i,
    bg: '#0e1430', ink: '#e8ecff', accent: '#c9a8ff', accent2: '#b8f26a', danger: '#ff5e7a', good: '#6fe0a0', gold: '#ffe08a',
    ramp: ['#070a1c', '#0e1430', '#1b2350', '#2c3770', '#47509a', '#7c84c9', '#c9a8ff', '#e8ecff', '#b8f26a', '#ffe08a', '#3a5a4a', '#5e3a5a'] },
  'heroic-dawn': { label: 'Heroic dawn: steel blue and gold', words: /\b(hero(ic)?|epic|fantasy|kingdom|castle|knight|quest|rpg|dungeon|sword|dragon|adventure)\b/i,
    bg: '#1a2238', ink: '#f3efe6', accent: '#e8b84a', accent2: '#6aa8e0', danger: '#e04a3a', good: '#5ac07a', gold: '#f2c14e',
    ramp: ['#0f1526', '#1a2238', '#2c3a5c', '#4a5f8c', '#6aa8e0', '#b8d4f0', '#f3efe6', '#d9c49a', '#e8b84a', '#a8742a', '#8c3a2a', '#4a6a3a'] },
  'space-ink': { label: 'Space: ink black with signal orange', words: /\b(space|galaxy|planet|star(ship)?|rocket|alien|asteroid|sci[- ]?fi|moon ?base|orbit)\b/i,
    bg: '#07080f', ink: '#eef2ff', accent: '#ff8a3d', accent2: '#5ad1ff', danger: '#ff4d5e', good: '#59e08a', gold: '#ffd24d',
    ramp: ['#07080f', '#11142a', '#1e2447', '#2f3a6e', '#4a5aa0', '#5ad1ff', '#b8ecff', '#eef2ff', '#ff8a3d', '#ffb87a', '#ffd24d', '#8c5ad9'] },
  'ash-dawn': { label: 'Ash dawn: muted greys with rose', words: /\b(ruin(s|ed)?|post[- ]?apocalyp\w*|grim|bleak|ash|ashen|wasteland|mist(y)?|fog(gy)?|quiet|melanchol\w*)\b/i,
    bg: '#2a2a2e', ink: '#ece6e0', accent: '#e8927c', accent2: '#9cb8b0', danger: '#d9584a', good: '#86b886', gold: '#d9b86a',
    ramp: ['#1a1a1e', '#2a2a2e', '#3e3d42', '#57555c', '#7a7680', '#a49ea6', '#ece6e0', '#e8927c', '#c26a5a', '#9cb8b0', '#6a8a84', '#d9b86a'] },
});

/** Light set-ups (the style.light decision). `key`: the sun's direction (from the light toward the scene). */
export const LIGHTS = Object.freeze({
  morning: { label: 'Soft morning', words: /\b(morning|dawn|spring|fresh)\b/i, key: [-0.5, -1, -0.35], intensity: 2.2, hardness: 0.35, sky: 'mix:bg>#ffffff:0.35', ground: 'mix:accent2>bg:0.25', fog: 0.35, shadows: 'blob', toonSteps: 3, bloom: 0.1, tiltShift: false },
  noon: { label: 'Bright noon', words: /\b(noon|midday|sunny|bright|desert|beach)\b/i, key: [-0.2, -1, -0.15], intensity: 2.8, hardness: 0.75, sky: 'mix:bg>#ffffff:0.5', ground: 'mix:gold>accent2:0.45', fog: 0.2, shadows: 'blob', toonSteps: 2, bloom: 0.05, tiltShift: false },
  golden: { label: 'Golden hour', words: /\b(golden|sunset|dusk|evening|warm|autumn|fall)\b/i, key: [-0.85, -0.55, -0.25], intensity: 2.4, hardness: 0.55, sky: 'mix:accent>#ffffff:0.45', ground: 'mix:accent2>accent:0.3', fog: 0.45, shadows: 'blob', toonSteps: 3, bloom: 0.25, tiltShift: false },
  night: { label: 'Moonlight and lamps', words: /\b(night|moon(lit)?|dark|spooky|neon|stars?|lantern|ember|fire)\b/i, key: [0.4, -1, 0.3], intensity: 1.1, hardness: 0.4, sky: 'bg', ground: 'mix:accent2>bg:0.6', fog: 0.6, shadows: 'blob', toonSteps: 3, bloom: 0.5, tiltShift: false },
  overcast: { label: 'Soft overcast', words: /\b(overcast|cloudy|grey|gray|misty|fog(gy)?|ash|quiet)\b/i, key: [-0.3, -1, -0.2], intensity: 1.6, hardness: 0.15, sky: 'mix:bg>#ffffff:0.25', ground: 'mix:accent2>bg:0.5', fog: 0.7, shadows: 'blob', toonSteps: 2, bloom: 0.05, tiltShift: false },
});

/** Camera set-ups (the style.camera decision): distance in metres, field of view in degrees, the angle above the ground. */
export const CAMERAS = Object.freeze({
  'high-3/4': { label: 'High three-quarter', projection: 'perspective', pitch: 52, distance: 22, fov: 38, note: 'the whole arena and every player readable on a phone' },
  'close-3/4': { label: 'Close three-quarter', projection: 'perspective', pitch: 40, distance: 11, fov: 42, note: 'nearer the characters: more detail on screen, less of the world' },
  iso: { label: 'Isometric', projection: 'orthographic', pitch: 35.264, distance: 20, fov: 30, note: 'a diorama: tidy and readable, the HD-2D and tactics look' },
  'top-down': { label: 'Top-down', projection: 'perspective', pitch: 80, distance: 24, fov: 35, note: 'the map is the screen: best for a crowd and for aiming' },
  chase: { label: 'Chase', projection: 'perspective', pitch: 18, distance: 7, fov: 60, note: 'behind the player: speed and scale, one body at a time' },
  side: { label: 'Side', projection: 'perspective', pitch: 6, distance: 14, fov: 35, note: 'a platformer\'s view: jumps read exactly' },
});

/** Genres (from the prompt and the codex), with the defaults they bring. */
export const GENRES = Object.freeze({
  gather: { words: /\b(gather|collect|harvest|forag\w*|berr(y|ies)|gems?|coins?|pick ?up|treasure|loot|farm)\b/i, camera: 'high-3/4', heads: 2.5, heightM: 0.9, clips: ['idle', 'walk', 'run', 'pick-up', 'emote'] },
  brawl: { words: /\b(brawl|fight|arena|knock|bump|smash|wrestl\w*|sumo|battle royale)\b/i, camera: 'high-3/4', heads: 2.5, heightM: 1.0, clips: ['idle', 'run', 'jump', 'attack', 'hit', 'die'] },
  race: { words: /\b(race|racing|kart|car|drive|driving|drift|speed)\b/i, camera: 'chase', heads: 3, heightM: 1.0, clips: ['idle', 'drive', 'boost', 'crash'] },
  rpg: { words: /\b(rpg|quest|dungeon|adventure|mmo|wow|zones?|class(es)?|loot|level up)\b/i, camera: 'iso', heads: 4.5, heightM: 1.7, clips: ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'die', 'interact'] },
  platformer: { words: /\b(platform(er)?|jump(ing)?|parkour|climb)\b/i, camera: 'side', heads: 3, heightM: 1.1, clips: ['idle', 'run', 'jump', 'fall', 'land'] },
  shooter: { words: /\b(shoot(er|ing)?|blaster|gun|laser|tank|twin[- ]stick)\b/i, camera: 'top-down', heads: 5, heightM: 1.8, clips: ['idle', 'run', 'aim', 'shoot', 'hit', 'die'] },
  party: { words: /\b(party|mini[- ]?games?|silly|chaos|couch)\b/i, camera: 'high-3/4', heads: 2.5, heightM: 1.0, clips: ['idle', 'run', 'jump', 'emote', 'win'] },
  puzzle: { words: /\b(puzzle|match|tiles?|board game|cards?|chess)\b/i, camera: 'top-down', heads: 3, heightM: 1.0, clips: ['idle', 'emote', 'win'] },
  sports: { words: /\b(soccer|football|golf|basketball|hockey|ball|sports?)\b/i, camera: 'high-3/4', heads: 3, heightM: 1.2, clips: ['idle', 'run', 'kick', 'jump', 'win'] },
});

/** Starter library families: which look each belongs to. */
export const FAMILIES = Object.freeze({
  kenney: { label: 'Kenney (CC0)', renders: ['lowpoly-flat', 'voxel', 'pixel-hd2d'], note: 'clean flat-colour low-poly kits: nature, food, pets, dungeons, cars' },
  kaykit: { label: 'KayKit (CC0)', renders: ['toon', 'painted'], note: 'stylised gradient-atlas low-poly: adventurers, dungeons, props' },
  polyhaven: { label: 'Poly Haven (CC0)', renders: ['stylised-pbr'], note: 'photo-scanned props, materials and skies' },
});

/** Shape language words. */
export const SHAPES = Object.freeze({
  round: { label: 'Round and soft', words: /\b(cozy|cosy|cute|soft|friendly|gentle|bubbly|kids?|round)\b/i, bevel: 0.6, note: 'round silhouettes and big soft bevels: friendly at a glance' },
  angular: { label: 'Angular and sharp', words: /\b(tense|dark|grim|aggressive|sharp|edgy|horror|cyber|military)\b/i, bevel: 0.1, note: 'pointed silhouettes and crisp edges: tension and speed' },
  blocky: { label: 'Blocky', words: /\b(blocky|voxel|cube|lego|toy|robot)\b/i, bevel: 0.25, note: 'boxes with small bevels: toy-like and readable' },
});

/** Google Fonts (OFL) by mood, for style.ui. */
export const FONT_SETS = Object.freeze({
  friendly: { display: 'Fredoka', body: 'Nunito' },
  bold: { display: 'Lilita One', body: 'Nunito' },
  storybook: { display: 'Fraunces', body: 'Lora' },
  clean: { display: 'Rajdhani', body: 'Inter' },
  pixel: { display: 'Press Start 2P', body: 'Silkscreen' },
  future: { display: 'Orbitron', body: 'Inter' },
});

/** Which words mean which mood (palette, light and shape read them). */
export const MOODS = Object.freeze({
  cozy: /\b(cozy|cosy|cute|warm|gentle|calm|chill|relax\w*|wholesome|soft|friendly|sweet)\b/i,
  tense: /\b(tense|dark|grim|horror|scary|creepy|spooky|survival|hardcore)\b/i,
  loud: /\b(neon|loud|wild|chaos|crazy|party|arcade|electric)\b/i,
});
