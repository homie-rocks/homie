# @homie-rocks/audio

Web Audio building blocks for games, with no samples: an output chain that
cannot clip, seeded noise and reverb, envelopes and ducks, a voice cap that
frees voices even when the audio clock freezes, a beat clock a stall cannot
move, and offline arrangement and sampler planners. It chooses no note, tempo,
cue or patch: every number that decides how something sounds is an argument.
It imports nothing, not even `three`.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/audio@0.1.0
```

## Use

```ts
import { Synth } from '@homie-rocks/audio/Synth.js';
import { AudioGate } from '@homie-rocks/audio/Gate.js';
import { blip, whoosh } from '@homie-rocks/audio/Voice.js';

let synth: Synth | null = null;

// No audio before a gesture: the gate builds the graph on the first one.
new AudioGate({
  context: () => synth?.ctx ?? null,
  volume: () => 0.8,
  build: (_ac, volume) => { synth = new Synth(volume); return true; },
}).listen();

function onJump(): void {
  if (!synth) return;
  blip(synth, synth.sfx, 660, 0.12, 0.4);   // a short tone on the sfx bus
  whoosh(synth, synth.sfx, 0.5, 0.3, true); // a rising noise sweep
}

// Once a frame: frees voices past their deadline even if the audio clock froze.
function onFrame(): void { synth?.sweep(); }
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Synth.js` | the graph: buses, sends, a limiter chain that cannot clip, seeded noise and reverb, envelopes, a 64-voice cap, an AudioParam guard |
| `Gate.js` | `AudioGate`: the browser's autoplay rule, obeyed once |
| `Voice.js` | `blip`, `whoosh`, panner and listener placement with the older-Safari fallback, `dopplerShift`, `inverseDistance` |
| `Oneshot.js` | `drop`, `hit`, `modes`, `wail`, `fmBell`: the graphs percussive one-shots are built from; every number is an argument |
| `Patch.js` | `pad` and `arp`: two sustained instruments, every field required |
| `Formant.js` | `syllable`, `radioBand`, `linkDropout`, `pttClick`: non-speech radio dialogue from a formant table |
| `Rig.js` | `VoiceRig`: one continuous voice per actor, with a distance cull and a rate gate |
| `Machine.js` | `MachineVoice`: the chassis under a continuous, positional, machine-like voice |
| `Bed.js` | `NoiseBed`: seeded noise layers under one duckable master |
| `Transport.js` | `MusicTransport`: a look-ahead step sequencer |
| `Beat.js` | `BeatGrid`, `BeatScheduler`: a musical position on the audio clock that resyncs without moving the grid |
| `Runner.js` | `BeatRunner`: runs a `BeatScheduler` in a browser, with a dual pump and a latency-compensated readout |
| `Latency.js` | `outputLatency`, `latencyLine`: the device's reported output latency, or null, never a guess |
| `ClockWatch.js` | `ClockWatch`, `CueGate`: notices an AudioContext clock that has stopped advancing |
| `Arrangement.js`, `Sampler.js` | `compileArrangement`, `planSamples`: offline render plans from caller-authored tempo maps, patterns and sample regions |

and 5 more in src/: `ChargeTone.js`, `Tier.js`, `Cast.js`, `VoicePool.js`, `RacerAudio.js`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
