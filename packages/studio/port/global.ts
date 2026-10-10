/*
 * The same toolkit as one classic script for STATIC ports (games made of
 * plain <script> tags): `homie-studio build` compiles it to homie-port.js in
 * the game's folder, and `homie-studio port import` loads it first in <head>.
 * Everything is on window.HomiePort (HomiePort.createControls, HomiePort.createTouchControls, …).
 */
import * as port from './index';

(window as unknown as { HomiePort: typeof port }).HomiePort = port;
