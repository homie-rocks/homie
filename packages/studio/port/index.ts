/*
 * @homie-rocks/studio/port — the toolkit the port skill uses to make an existing
 * single-player web game multiplayer on the netplay contract.
 *
 *   early        sandbox shims + first-touch audio (import first)
 *   createControls / createTouchControls / createKeys / synthKey
 *                keys on computers, a floating stick and small buttons on phones
 *   groundBasis / screenToGround / PlayerYaw
 *                the camera rules: input on screen axes, a yaw only the player turns
 *   fitView / easeView / toScreen / createLabels / createBubbles
 *                a flat world on every screen (the whole of it, or filling an upright phone and following the
 *                player), name labels that never pile up, and speech bubbles over characters (room chat)
 *   exposePort   what `homie-studio port check` reads (owner tests)
 *   BotBrain, seek, nearest, rubberBand
 *                bot scaffolds; `skill` makes a bot play at the room's dial (NETPLAY.md section 17)
 *   createPersonaBrain, PERSONAS, botStats
 *                bots that want different things (port/personas.ts; also @homie-rocks/studio/personas, with no port shims)
 *   createPowerups, stepPowerups, collectPowerups, resolveHit, packPowerups
 *                host-owned pickups whose timers survive a host change (port/powerups.ts; also @homie-rocks/studio/powerups)
 *   jitter, engages, standoff
 *                the dial for the rest of a bot's decisions (port/skill.ts)
 *   createSaves  player accounts and cloud saves (a character that lasts days, on every device; saves/SAVES.md)
 *   lab          the Game Lab's calls (@homie-rocks/studio/lab): tracks, phases, tunables, overlays, views
 * and everything from @homie-rocks/studio/netplay.
 */
import './early';

export * from '../netplay/netplay';
export { installSandboxShims, sandboxReport, type SandboxReport } from './sandbox';
export { installAudioUnlock, audioReport } from './audio';
export { createKeys, synthKey, holdKey, tapKey, keyInfo, releaseAllSynthKeys, type Keys, type Dir } from './keys';
export { createTouchControls, type TouchControls, type TouchOptions, type TouchButton } from './touch';
export { createControls, type Controls, type ControlsOptions } from './controls';
export { groundBasis, screenToGround, PlayerYaw, type GroundBasis, type CameraLike } from './camera';
export { fitView, easeView, toScreen, createLabels, type Fit, type FitOptions, type LabelIn, type LabelOut, type LabelOptions, type LabelBox } from './view';
export { createBubbles, paintBubbles, wrapText, BUBBLE_FONT, type Bubbles, type BubbleOptions, type BubbleIn, type BubbleOut, type BubbleStyle } from './view';
export { exposePort, PORT_EXTRA_NAMES, type PortExtra, type PortProbeOptions, type View } from './probe';
export { BotBrain, brainOf, seek, flee, wanderer, nearest, rubberBand, protectedNewcomer, type V2 } from './bots';
export { jitter, engages, standoff } from './skill';
export * from './personas';
export * from './powerups';
export { lab, type TunableSpec, type TunableFile, type Tuned } from '../lab/lab';
export { createSaves, SAVES_VERSION, type Saves, type SavesOptions, type Player, type SaveEntry, type SetResult, type Memorial, type SavesStatus, type Conflict } from '../saves/saves';
