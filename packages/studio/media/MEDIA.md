# Studio media: music/ and videos/

A studio's songs, scores, loops, trailers, music videos and cutscenes live in the studio
repository as folders plus one manifest per kind. The manifests are the contract between
whatever made the media (the Homie plugin's `music` and `video` skills, or a person) and the
studio site, which turns every published entry into a page:

| Manifest | Page | Listed in |
| --- | --- | --- |
| `music/manifest.json` | `/music/<slug>/` (an audio player) | the home page, `/music/`, `/.well-known/homie-studio.json` `songs` |
| `videos/manifest.json` | `/videos/<slug>/` (a video player) | the home page, `/videos/`, `/.well-known/homie-studio.json` `videos` |

`homie-studio build` reads both manifests. `homie-studio media list` prints what the site will
show and why anything is left out.

## An entry

```json
{
  "v": 1,
  "items": [
    {
      "slug": "theme",
      "kind": "song",
      "title": "Night Owls Theme",
      "blurb": "The studio's theme: a short sung hook over a driving synth line.",
      "published": true,
      "duration": 16.0,
      "bpm": 120,
      "key": "A minor",
      "files": [
        { "role": "audio", "path": "music/theme/theme.mp3", "type": "audio/mpeg" },
        { "role": "cover", "path": "music/theme/cover.jpg", "type": "image/jpeg" },
        { "role": "loop", "path": "music/theme/theme-loop.ogg", "type": "audio/ogg", "bars": 8 },
        { "role": "master", "path": "music/theme/theme-master.wav", "type": "audio/wav", "public": false }
      ],
      "lyrics": "…",
      "credits": "Music made with Eleven Music (ElevenLabs).",
      "rights": { "provider": "elevenlabs", "plan": "creator", "commercial": true, "attribution": null },
      "for": { "game": "crown-thief" },
      "made": { "provider": "elevenlabs", "model": "music_v2", "at": "2026-09-30T02:00:00Z", "receipt": "music/theme/receipt.json" }
    }
  ]
}
```

- The manifest's order is the site's order (the plugin's skills put a new entry first).
- `slug`: lowercase letters, digits and hyphens, up to 40; it is the page address and never changes
  once published. `title` is required for a page; an entry without `slug` and `title` is kept in
  the manifest but gets no page.
- `kind`: music is `song`, `score`, `loop`, `stem` or `sfx`; video is `trailer`, `music-video`,
  `cutscene` or `clip`.
- `published`: only `true` entries get a page and a directory listing. Work in progress stays
  `false`.
- `files[].role`: music uses `audio` (what the player plays), `cover`, `loop`, `stem`,
  `master`; video uses `video` (the 16:9 cut the player plays), `vertical` (the 9:16 cut),
  `poster`, `captions` (WebVTT), `master`. `"public": false` keeps a file off the site (masters,
  raw captures). Loops and stems are offered for download on the song page, so another game can
  use them.
- `rights` and `credits` are shown on the page, in plain words. Say what the provider's terms
  say for the plan the file was made on; nothing on the site claims more.

## Where the bytes come from

A studio needs no storage for songs and videos: the site serves them itself. For every public
file of a published entry, the build picks the first that exists:

1. `key`: the file is in the studio's storage, an R2 bucket that `homie-studio storage add`
   creates (Cloudflare asks for a payment method on the account before R2 works, so the person
   agrees first) and `homie-studio media put <file>` uploads to; the site serves it at
   `/media/<key>`, with byte ranges so phones can seek.
2. `path`: the file is in the studio folder; the build copies it into the site as `/<path>` when
   it is 25 MiB or smaller (Cloudflare's limit for one static file), and the Worker answers byte
   ranges for it too. This is the default, and it needs nothing but a deploy.
3. `url`: an absolute `https://` address somewhere else.

A file with none of these is left out and `media list` says so. Media never goes into git: the
studio's `.gitignore` keeps `*.wav`, `*.mp3`, `*.flac`, `*.mp4`, `*.mov` and `*.webm` under
`music/` and `videos/` out of the repository, so without storage the site is deployed from the
computer that has the files. Keep deliveries under 25 MiB (the video skill's cuts do) or add
storage for bigger ones.
