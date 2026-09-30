/*
 * @homie-rocks/studio/port — the toolkit the port skill uses to make an existing
 * single-player web game multiplayer on the netplay contract.
 *
 *   early        sandbox shims + first-touch audio (import first)
 *   createRoom   the host scaffold: bots, join-in-progress, rounds, host migration, snapshots
 *   createControls / createTouchControls / createKeys / synthKey
 *                keys on computers, a floating stick and small buttons on phones
 *   groundBasis / screenToGround / PlayerYaw
 *                the camera rules: input on screen axes, a yaw only the player turns
 *   exposePort   what `homie-studio port check` reads (owner tests)
 *   createHud    a minimal clock / scores / results overlay
 *   BotBrain, seek, nearest, rubberBand
 *                bot scaffolds
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
export { exposePort, type PortProbeOptions, type View } from './probe';
export { createRoom, type Room, type RoomOptions, type BodyBase, type RoomSnap, type RoomCkpt } from './room';
export { createHud, type HudOptions } from './hud';
export { BotBrain, seek, flee, wanderer, nearest, rubberBand, protectedNewcomer, type V2 } from './bots';
