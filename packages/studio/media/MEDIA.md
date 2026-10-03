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
      "date": "2026-09-30",
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
- `date` (0.27.0): the day (or day and time, UTC) it came out; without one, `made.at`. A video's page gives it to
  search engines as the video's upload date, and they show no video without one (the build says when a video has
  neither). A music manifest's top-level `"album": "Night Route"` (or an entry's own `album`) makes its songs one
  album in the pages' structured data (site/SITE.md, "Search engines and AI agents").
- `rights` and `credits` are shown on the page, in plain words. Say what the provider's terms
  say for the plan the file was made on; nothing on the site claims more.

## Covers and posters

Every song's page, its card and the directory's manifest show a cover (a video: a poster), the first of:

1. its own `cover` file (a video's `poster`);
2. the manifest's own, for every entry without one: `"cover": "music/night-route/cover.jpg"` at the top of
   `music/manifest.json` (an album's cover; `"poster"` in `videos/manifest.json`), a path in the studio or an
   `https://` address, served like any file;
3. the landing still of the game the entry was made for (`for.game`);
4. the studio's share picture (`site/theme.json` `social`).

homie.rocks shows a cover only from the studio's own site, as a `.jpg`, `.png`, `.webp`, `.avif` or `.gif`.

## Where the bytes come from

A new studio needs no storage for songs and videos: the site serves each file itself, up to 25 MiB
a file (Cloudflare's limit for one static file of a Worker). Once the studio has storage, its big
media lives in R2 instead. For every public file of a published entry, the build picks the first
that applies:

1. `r2`: the file is in the studio's own R2 bucket, put there by `homie-studio media move` (or a
   deploy). The site serves it at **the same address it always had**, `/<path>` (for example
   `/videos/trailer/trailer.mp4`), from R2, with byte ranges (206: phones seek with them, Safari needs
   them to play a video at all), HEAD, an ETag and `If-None-Match` (304), and the same
   `Cache-Control` as the site's own files (`public, max-age=0, must-revalidate`). A deploy's build
   no longer carries the file in the site's static assets.
2. `key`: a file `homie-studio media put` uploaded before 0.18.0 is served at `/media/<key>`, as it
   always was (`media move` leaves it alone).
3. `path`: the file is in the studio folder; the build copies it into the site as `/<path>` when it
   is 25 MiB or smaller, and the Worker answers byte ranges for it too. This is the default, and it
   needs nothing but a deploy.
4. `url`: an absolute `https://` address somewhere else.

A file with none of these is left out and `media list` says so.

### Big media goes to R2, by default, once the studio has storage

`homie-studio storage add` makes the studio's R2 bucket (one step the person agrees to: Cloudflare
asks for a payment method on the account before R2 works, even inside its free tier). From then on,
every `npm run deploy` first moves the studio's big media into it, and `homie-studio media move` does
the same on its own:

- **What moves:** every public file of a published song or video that is over 1 MiB, or that git
  leaves out of the repository (`*.mp4`, `*.mp3`, `*.wav`… under `music/` and `videos/`, by the
  studio's `.gitignore`). A deploy from another computer, or Cloudflare's Workers Builds, does not
  have git-ignored files, so a file that is only on this computer would disappear from the site;
  in R2 it stays. `studio.json` sets another size: `"media": { "r2Over": 5242880 }` (bytes), or
  `"media": { "r2Over": false }` to move nothing on its own (`media move <file>` still moves the file
  it names).
- **How:** each file is hashed (SHA-256), uploaded with `wrangler r2 object put` to the key that is
  its path, read back with `wrangler r2 object get --pipe` and hashed again. Only when the size and
  the hash match does `media move` record it on the manifest's file:

  ```json
  { "role": "video", "path": "videos/trailer/trailer.mp4", "type": "video/mp4", "bytes": 45431041,
    "r2": { "key": "videos/trailer/trailer.mp4", "sha256": "8efe9b96…", "bytes": 45431041, "at": "2026-10-02T03:00:00Z" } }
  ```

  A copy that comes back different is refused, nothing is recorded, and the file stays on the site.
  The file on this computer is never deleted, moved or changed.
- **After a re-cut** at the same path, the next `media move` or deploy sees a different hash and
  uploads it again; until then a deploy's site carries the changed file itself when it fits.
- **`media move --dry-run`** says what would move and calls nothing; **`media move --verify`** reads
  every file R2 already holds back and checks its hash again.
- **Local `dev`** still copies a moved file into the local site when it is 25 MiB or smaller,
  because `wrangler dev`'s own R2 is empty; a bigger one does not play locally.

**What it costs (Cloudflare's R2 pricing):** serving costs nothing in bandwidth (R2 has no egress
fees). Storage is free up to 10 GB-month, then US$0.015 per GB-month; uploads (Class A operations)
are free up to 1 million a month, reads (Class B) up to 10 million a month. A video served from R2
costs one or two reads per byte range a player asks for. Beyond the free tier Cloudflare bills the
studio's own account; `media move` and `media list` say how much the studio's media adds up to, and
warn past 10 GB. Wrangler uploads at most 300 MiB in one go: a bigger file is refused with the
reason (the video skill's deliveries are far smaller).

Why not the site's own files for everything? A Worker's static files are at most 25 MiB each (and
20,000 per version on the free plan); every deploy of a site carrying them uploads whichever
changed; a byte range of a static file is cut out by the Worker after reading the whole file; and
files git does not keep exist only on the computer that made them.

Media never goes into git: the studio's `.gitignore` keeps `*.wav`, `*.mp3`, `*.flac`, `*.mp4`,
`*.mov` and `*.webm` under `music/` and `videos/` out of the repository. Commit the manifests: they
name each file's R2 copy, which is all a deploy from anywhere else needs.
