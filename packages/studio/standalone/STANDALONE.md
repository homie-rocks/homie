# Standalone copies of a game

`homie-studio standalone` turns a game of your studio into an app of its own:

| Target | Made with | What comes out | Where it can go |
| --- | --- | --- | --- |
| `mac` | Electron | `out/mac/<debug or release>/<Name>.app` | Steam |
| `windows` | Electron | `out/windows/<debug or release>/<id>.exe` and its files | Steam |
| `linux` | Electron | `out/linux/<debug or release>/<id>` and its files | Steam |
| `ios` | Capacitor, Xcode | a simulator `.app`, or an `.ipa` with `--release` | the App Store |
| `android` | Capacitor, Gradle | a debug `.apk`, or an `.aab` with `--release` | Google Play |

Each is **the kind of file that store accepts for upload**. Whether a store takes your game is the store's
decision: its review, its fees and its rules are its own, and nothing here makes an app pass (see "Before you
spend money", below).

It is the **same web build** of the game, the one `homie-studio build` makes and your site serves, in the
thinnest shell each platform has. Nothing about one game lives in a shell. Multiplayer still goes through your
studio's own deployed site: the app asks its Lobby for a room and opens the room's socket, exactly as the play
page does. With no connection, or when no room answers, the game plays offline with its bots.

```sh
npx --no-install homie-studio standalone plan <game>      # what would be built, what is missing; changes nothing
npx --no-install homie-studio standalone build <game>     # every target this computer can make
npx --no-install homie-studio standalone build <game> --for mac,windows
npx --no-install homie-studio standalone run <game>       # the built desktop copy, here (--for ios | android)
npx --no-install homie-studio standalone run <game> --for ios --device   # onto the iPhone or iPad plugged in
npx --no-install homie-studio standalone steam <game>     # Steam's build file; uploads nothing
npx --no-install homie-studio standalone ci <game>        # a GitHub workflow that builds all five
```

In chat it is one tool, `game_standalone` (with `plan: true` first).

## What the standalone game does not have (v1)

Say this to whoever will ship it, before they do.

- **Player accounts and sign-in.** The app has no sign-in and no name entry. A player is a guest with a two-word
  handle; an account made on the site is not known to the app.
- **Cloud saves.** Saves and settings are kept on the device only (the saves helper's local mode). They do not
  follow a player to the site or to another device, and they are **lost when the app is uninstalled**.
- **The shop.** Nothing is sold in the app. The app stores have their own rules for selling, and none of that is
  built.
- **Room chat.** Off in the app: it has no report or mute controls yet, and a chat without them is not shipped.
- **Watching, the big screen, the owner's controls.** The app only plays.
- **Servers and private doors.** The app plays on the public server through an open door. A game that is private
  or invite-only, or a server behind an account or an invite, plays offline in the app.
- **Automatic updates.** The app is the build it was made from. A newer version reaches players only when you
  build again and ship the update through Steam or the store.
- **Steam's overlay, achievements and friends.** None of it has been run. The desktop app passes the switch the
  overlay needs when Steam starts it, but Electron apps often do not show Steam's overlay, and achievements,
  rich presence and friend invites are not wired.
- **Uploading, and a store's yes.** Builds are made on your computer and the upload steps are printed. Nothing is
  sent to Steam, App Store Connect or Google Play for you, and nothing here makes an app pass a review.
- **A signed Windows build.** Unsigned in v1: opened outside Steam, Windows shows its unknown-publisher warning.

## What has been run and what has not

This is version 1, and it says what it knows. By the people who wrote it, on one Mac and one iPhone; each line
was true on 2026-10-06 unless it says another day:

**Run and seen:**

- The macOS build (Apple silicon, and the universal one a release makes) started and the game loaded with its
  bots, from its own `app://game` origin, with no file failing to load. Every desktop build for the computer it
  is made on is started once like this, and its result says "started here and loaded the game: yes" or "NO".
- That build, pointed at a studio's local dev server, got a room from the Lobby and opened the room's socket.
- A macOS build signed ad hoc with the hardened runtime and the Steam entitlements started and loaded the game.
- The iOS simulator build ran in the iOS Simulator; the Android debug build ran in the Android emulator. Both
  offline, with their bots.
- An Android release bundle was signed by Gradle with a test key (the key's passwords given through the
  environment), and the bundle carries that key's certificate.
- The Windows build's program carries the game's icon and its name; the Linux build is a Linux program. Both
  were made on the Mac.
- **On a real iPhone (2026-10-07).** A 3D game's iOS build was signed for a development team, installed over
  the cable and started by hand, with the same three tools `standalone run --for ios --device` now runs. It
  loaded and played offline with its bots.
- **Online from that phone (2026-10-07).** A private room made in the app, joined from another device by its
  invite link, connected through a studio's live Worker. That site was on 0.31.0, from before standalone copies.
- **`standalone run --for ios --device` itself (2026-10-07).** It found the phone, read the team from the
  keychain, built and signed the app for the phone and installed it; the phone's own list of apps had it. The
  phone was locked, so the command waited a minute, said so, and stopped with "the game is on the phone, and
  the phone is locked". Its last two steps, starting the game and finding it among the phone's running programs,
  have been run against stand-ins only.

**Never run:**

- **The Windows and Linux builds have never been started**, on any computer. On Ubuntu 24.04 and later a program
  in a plain folder like `out/linux/` may refuse to start outside Steam until its `chrome-sandbox` file is owned
  by root with mode 4755, or it is started with `--no-sandbox`; an installer normally does the first, and there
  is none.
- **Nothing has been started by Steam.** Not the overlay, not the Linux build inside Steam's runtime, not the
  Steam API binding. `steam/app_build.vdf` is written from Steam's documented format and has never been run
  through `steamcmd`.
- **A macOS app signed with a Developer ID, and notarization.** The code asks the signer and the notary and then
  checks the result (`codesign --verify`, `xcrun stapler validate`); it says "notarized" only when the second
  agrees. That path has not been run with a real identity. Opening a notarized app on another Mac was not tried.
- **The iOS archive and its `.ipa`.** It needs Xcode signed in to an Apple account of your team; it was not run.
- **Quick play online from a phone.** The one site a phone build has met was older than 0.32.0, where an app
  cannot read the Lobby's answer: Quick play was offline there, as it should be.
- **A real Android phone.** The Android build has run in the emulator only. `standalone run --for android` hands
  over to Capacitor, which asks which phone or emulator; `--device` is for an iPhone or iPad.
- **`run --device` starting a game on an unlocked phone**, and each of its answers for a phone that is not
  ready (Developer Mode off, not trusted, no Apple account in Xcode), other than against stand-ins. The words
  it matches for those are the ones Xcode printed on 2026-10-07.
- **The GitHub workflow.** It is checked as text. Read the first run's log.
- **A copy meeting a deployed site**, and an old copy meeting a newer site, outside the tests.
- **Building from Windows or Linux.**

When one of these fails for you, that is news to us: tell Homie.

## Before Quick play can find a room

For **Quick play**, your studio must be on `@homie-rocks/studio` 0.32.0 or later **and deployed**. The app's
page is not served by your site, so it is another origin to your Worker; 0.32.0 is the first Worker that lets an
app read the Lobby's answer, which is how Quick play learns which room to join. With an older site, Quick play
is offline with the game's bots.

**A room made or joined by its code does not need that.** The room's own socket never asked where a page came
from, so "New private room" and "Join a room" connect through an older site too. That has been seen against a
site on 0.31.0; it is not promised for every older version.

The site's address is **built into every copy** (`--site <address>`, else `HOMIE_STANDALONE_SITE`, else the
address your last deploy from this computer got). A copy that has shipped keeps it for good, so put the studio
on its own domain (`studio.json` `cloudflare.domain`) before you ship: a workers.dev address belongs to the
Cloudflare account and changes if the Worker is renamed.

A game that loads something from another site at run time (a web font, a picture, an API) still needs a
connection for that in the app, exactly as on the web: bundle what the game must have offline. And a game whose
`index.html` carries a Content-Security-Policy that forbids inline scripts never hears the shell (a copy adds
one inline script to that page) and plays offline only; the plan warns when it sees one.

## On your own iPhone or iPad

```sh
npx --no-install homie-studio standalone run <game> --for ios --device
```

builds the game for the **one** iPhone or iPad plugged in to this Mac, signs it for your Apple team, installs it
over the cable, starts it, and then looks for it among the phone's running programs. It says the game is running
only when it found it there.

**`--device` is your yes to what this changes outside your computer:** it adds the phone to your Apple team's
list of development devices (a team may register a limited number a year, and a device stays on the list until
the membership year renews) and lets Xcode make a development profile for the app. The app is signed for that
phone only. It is a build to try, never one for the store, and it stops opening when its profile ends (a week
with a free Apple account, a year with a Developer membership).

What it needs, and what it says when one is missing:

- **A Mac with Xcode, signed in to your Apple account** (Xcode, Settings, Accounts). Not signed in: it says so.
- **Your team.** `HOMIE_APPLE_TEAM`, else the one team among the keychain's development identities (it says
  which it used, never an identity's name). None, or more than one: it stops and asks for `HOMIE_APPLE_TEAM`.
- **One phone, plugged in, unlocked, trusting this Mac.** None, or several: it says which models it sees and
  builds nothing. Locked: it waits a minute for you to unlock it. Not trusted: unlock it and tap Trust.
- **Developer Mode on**: on the phone, Settings, Privacy & Security, Developer Mode. The phone restarts and asks
  once more. The switch appears only after the phone has been plugged in to a Mac with Xcode.

Nothing it prints or returns names the phone, its id or your team's id: a phone is said by its model.

For an Android phone there is no `--device` yet: `standalone run <game> --for android` hands over to Capacitor,
with the JDK and SDK the build uses, and Capacitor asks which phone or emulator. That has been run on an
emulator, never on a real Android phone.

## Versions: an old copy and a new site

Name the game's revision in `game.json` (`"netplay": { "version": "1" }`, NETPLAY.md section 23) before you
ship, and raise it with every change an older copy cannot play with. Then:

- a copy asks the Lobby for a room of **its own** revision, so copies of one revision keep playing with each
  other, whatever the site runs now. The Lobby keeps rooms for the live revision and at most eight others at a
  time; a copy on a ninth is told to play offline for now;
- a copy that knocks at a room on a newer revision (a friend's invite link) is refused, plays on by itself, and
  says so: "Update <Name> to play online with everyone." It never reloads: only an update of the app brings a
  newer build. From then on it shows that line in place of Invite, because its invite would send a friend's
  browser to the newer version, which the copy cannot join;
- `homie-studio deploy` (and `deploy --plan`) says when a deploy makes a different revision live than the copies
  you built, and what that means for them.

## game.json

Everything is optional until a release:

```json
"standalone": {
  "appId": "com.example.gemrush",
  "version": "1.0.0",
  "build": 1,
  "orientation": "landscape",
  "icon": "icon.png",
  "steam": { "app": 0, "depots": { "windows": 0, "mac": 0, "linux": 0 } }
}
```

- `appId`: the app's id in both stores (letters and digits in dotted parts, each starting with a letter). With
  none, a build to try uses a made-up one: your domain reversed, else `rocks.homie.<studio>`, then the game's id.
  **`--release` refuses until you write one**: a store never lets it change.
- `version`, `build`: what a player sees and the store's build number (`--build <n>` overrides the number).
- `orientation`: `landscape`, `portrait` or `any` (phones).
- `icon`: a picture in the game's folder. Without it: `games/<id>/icon.png`, else the cover cropped square, else
  a tile with the game's first letter. Stores want a real square 1024 by 1024 picture.
- `steam`: your App ID and one Depot ID for each operating system, for `standalone steam`.

The app's name is the game's name; its publisher is the studio's. A name with a character a file's name cannot
have (`: / \ " < > | ? *`) is still the app's name on phones and in the window's title; the desktop app's file,
and what macOS shows in its menu bar and Dock, has a `-` in its place. Every path the command reports is where
the file is.

## Where everything is

All of it is in `.studio/standalone/<id>/`, which is git-ignored. Never edit it; never commit it.

```
web/         the shell's page (index.html, shell.js, shell.css), config.js, and game/ (the built game)
electron/    main.cjs, files.cjs and app.json, with a copy of web/
ios/  android/   the native projects Capacitor makes
icons/  assets/  the icon in every size
steam/       app_build.vdf
out/<target>/debug/    out/<target>/release/     what was built; a debug build never replaces a release
built.json   for each target, what its debug and its release copy were built from
node_modules/  package-lock.json   the wrapper tools
```

**Made again by every build:** `web/`, `electron/`, the icons, the config files, and the `out/` folder of what
is being built. **Kept between builds:** `node_modules/` (installed on the first build, a few hundred MB, and
again only when a pin changed or an install did not finish), `ios/` and `android/` (made by Capacitor once, and
again when the app's id or its name changed; their versions, orientation and icons are set on every build), and
the other kind's `out/` folder.

The wrapper tools are pinned twice: each tool at one exact version (`lib/standalone-pins.json`), and the whole
tree under them at exact versions with checksums (`lib/standalone-lock.json`, copied in as the project's
lockfile). A studio that never makes a standalone copy downloads none of them. When a file of theirs is
missing, the build installs them again, once, and says so.

`web/game/` is your site's build byte for byte, but for one script added to its `index.html`, which hands the
netplay helper the shell's word as your Worker does on the site.

## What each target needs

`standalone plan` checks this computer and says, for each target, whether it can be built here. A target whose
tool is missing is **skipped** with its fix; the others still build. Nothing is installed for you. A row says
"ok" only for what was looked at: a name in the environment is said as "set, checked later", not as working.

- **mac**: a Mac.
- **windows**, **linux**: any computer (a Windows build from a Mac needs no Wine).
- **ios**: a Mac with Xcode and its iOS platform.
- **android**: the Android SDK with the Android 36 platform (Android Studio installs both) and JDK 21 (22 to 24
  also work; Android Studio's own JDK is used when the one on your PATH does not fit, for every step).

A computer that cannot make a target can still get it: `standalone ci <game>` writes
`.github/workflows/standalone.yml`, which builds each target on GitHub's own Windows, Linux and macOS machines
when you start it by hand. Set the repository variable `HOMIE_SITE` to your studio's address first. Its macOS
and iOS jobs never make a release (it has no Apple certificate): the macOS app it makes is unsigned and the iOS
one is a simulator build.

## What a build's result means

- **built**: the tool finished and the file is at the path given. The desktop build for this computer's own
  system was also started once: "started here and loaded the game: yes" or "NO". Every other target says
  "built, not started on this computer". Built is not the same as works.
- **skipped**: a tool is missing; the fix is printed.
- **failed**: in the tool's own words.
- **UNSIGNED**: a release that was built and could not be signed (or signed and not notarized). No store takes
  it, and the command does not report success.

The command succeeds only when something was built, nothing failed, no release came out unsigned, and every
target you named with `--for` was built.

## A release, and signing

`--release` makes the file a store or Steam accepts for upload. Signing reads **environment variables only**:
never a file in the studio, never the chat. Only the one tool that signs is given them; npm, Capacitor and
every script they run are not.

| Variable | For |
| --- | --- |
| `HOMIE_APPLE_IDENTITY` | macOS: the name of your "Developer ID Application" identity. The app is signed with the hardened runtime |
| `HOMIE_APPLE_NOTARY_PROFILE` | macOS: a notarytool keychain profile. Make it yourself, in your own terminal: `xcrun notarytool store-credentials "homie-notary"` |
| `HOMIE_APPLE_TEAM` | iOS: your team id. Xcode, signed in to an Apple account of that team, signs the archive and exports an `.ipa` |
| `HOMIE_ANDROID_KEYSTORE`, `HOMIE_ANDROID_KEYSTORE_PASSWORD`, `HOMIE_ANDROID_KEY_ALIAS`, `HOMIE_ANDROID_KEY_PASSWORD` | Android: your upload key. The passwords reach Gradle through its environment, never a command line |

Set them where your AI's commands run, never in the chat: in a terminal, `export NAME=…` and start your AI from
that terminal; for a desktop app on a Mac, `launchctl setenv NAME …` in Terminal and then open the app again; in
the GitHub workflow they are repository secrets.

A macOS release without the identity is built and marked UNSIGNED. Signed without the profile it is marked NOT
NOTARIZED. With both, it is called notarized only when `xcrun stapler validate` confirms the ticket on the
finished app. An Android release without all four values is built and marked UNSIGNED. A macOS game with a
Steam app is signed with entitlements that let the Steam client load its overlay library; any other is signed
with the signer's own defaults.

## Before you spend money

What a store asks of you changes; these were true when this was written (2026-10-06), so check each store's own
page before you pay.

- **Apple**: the Apple Developer Program is a yearly membership (US$99 a year), needed to sign for iOS and to
  notarize for macOS. Apple reviews every app, and its guidelines let it reject one it judges to be a web site
  in a wrapper. A game whose files are all in the app and that plays offline is a better case than a page that
  loads from the web, and nothing guarantees approval.
- **Google Play**: a one-time registration fee (US$25). A personal account created since late 2023 must run a
  closed test with a number of testers for two weeks before it may publish to everyone.
- **Steam**: Steam Direct's fee is paid for each app (US$100, returned after the app earns a set amount), and
  Steam makes a new partner and a new app wait (about thirty days after paying, and a store page live for about
  two weeks) before release. Steam asks macOS builds to be signed and notarized.

## Steam

`standalone steam <game>` writes `steam/app_build.vdf` from your numbers, with each depot inside it pointing at
that system's release build (`out/<os>/release/`), and prints the one `steamcmd` command to run yourself. With
no numbers yet it says what to create in Steamworks, and the launch options to set there: `<id>.exe`,
`<Name>.app`, `<id>`. **For the Linux one, put `--no-sandbox` in its arguments**: inside Steam's Linux runtime
the browser engine's own sandbox cannot start, and the app does not turn it off by itself.

When Steam starts the game (Steam sets `SteamAppId` for what it starts), the app passes the one switch Steam's
overlay needs to draw (`in-process-gpu`). That is all it does for the overlay, it has not been run under Steam,
and many Electron apps show no overlay at all. `standalone run` puts `steam_appid.txt` beside the app it starts
for development, never in `out/`.

Steam's own API is off unless you ask: `"steam": { "api": true }` and `HOMIE_STEAMWORKS_SDK=<the SDK folder you
downloaded from Steamworks>`. The binding (`steamworks-ffi-node`) is then installed into the desktop app and
Steam's libraries are copied from your SDK. It has never been run. The app's log says whether it started
("the Steamworks binding started", or that it did not and why), and the game runs either way. No achievements
are wired in v1.

## The shells, briefly

- **Desktop** (`standalone/electron/main.cjs`): one window on `app://game/`, served from the app's own `web/`
  folder and nothing else (`files.cjs` decides which file an address names; a test runs it with hostile
  addresses). No Node in the page, no preload, sandboxed; a link opens in the person's browser; the page may
  only lock the pointer, go full screen and copy an invite link. Its storage and its single-instance lock are
  kept under the app's id, so two games never share them. A shipped copy has no developer tools and, on macOS, a
  menu of its own (the app, Edit, Window). F11 or Alt+Enter toggles full screen. `--smoke` is its self-check: it
  loads, waits, and prints one line of JSON.
- **Phones**: Capacitor's stock shell with the web folder bundled (`capacitor://localhost` on iOS,
  `https://localhost` on Android). Never `server.url`: the app does not load its page from a site.
- **The page** (`standalone/shell/`): the room button and its sheet, as on the play page. Invite shares the
  room's address on your site, so a friend in a browser joins the same room; Join a room takes a code; New
  private room makes one; Quick play asks the Lobby. When the Lobby has not answered in a second and a half the
  game starts offline, and a room that arrives later is offered, never switched to. A seat is remembered across
  restarts of the app.

## What the game's own code can reach

On the web, your Worker serves a game into a sandboxed frame that cannot touch the page around it. In an app the
game's frame is the shell's own origin (that is what lets its saves work), so **the game's code is trusted with
everything the app's page has**:

- its own storage (saves, settings, the room key), and the shell's page around it;
- on phones, **Capacitor's native bridge**. The shell uses no plugin, but the bridge is in every frame of the
  app, and through it code can ask the native side for things a web page cannot: requests that skip the
  browser's cross-origin rules, the native cookie store, and whatever plugins a future version adds.

This is your own game's code, so it is yours to trust. It matters when a game runs **somebody else's** code: an
ad or analytics script, a script loaded from another site, a part you did not read. In the app that code has
the same reach. Do not load scripts from the network in a game you ship as an app.

## What the Worker allows an app

One thing: `POST /<game>/api/lobby` from `app://game`, `capacitor://localhost` or `https://localhost` gets an
answer the app's page may read, whatever the answer is (`worker/standalone.mjs`). No credentials cross, the
Lobby is never opened to every origin, an app may only ask for the public server, and every POST that must come
from your own site's pages (players, saves, the shop, chat reports, the office) still refuses an app. That is
why an app has no account, no cloud saves and no shop.

An app says which revision it is, and anybody can claim to be an app. So the Lobby keeps rooms for at most
eight revisions besides the live one, never gives a server more rooms than it may have whatever revision asks,
and keeps at most 512 rooms for a game in all (rooms nobody is seated in make way first).
