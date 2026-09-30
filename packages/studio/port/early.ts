/*
 * Import this FIRST in a bundled port (before three.js, before the game):
 *
 *   import '@homie-rocks/studio/port/early';
 *
 * It makes the sandboxed play frame safe for a single-player game's habits
 * (localStorage, cookies, gamepads) and arms the first-touch audio unlock.
 * A static port gets the same from homie-port.js, the first script in <head>.
 */
import { installAudioUnlock } from './audio';
import { installSandboxShims } from './sandbox';

installSandboxShims();
installAudioUnlock();
