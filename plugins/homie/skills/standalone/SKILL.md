---
name: standalone
description: Make a studio's game into an app of its own, a desktop app for macOS, Windows and Linux (the kind of build Steam accepts for upload) and a phone app for iOS and Android (the files the App Store and Google Play accept for upload; each store's review, fees and rules are its own). It is the same web build of the game in a thin shell (Electron on computers, Capacitor on phones) that still finds its rooms on the studio's own deployed site and plays offline with its bots when it cannot. Use when someone asks for a Steam build, a desktop app, a download, an installer, an iPhone, iPad or Android app, a store release, or "a standalone version" of a game.
compatibility: Node 22 and a studio on @homie-rocks/studio 0.32.0 or later. A Mac for the macOS and iOS builds (Xcode for iOS). The Android SDK and JDK 21 for Android. Nothing is installed for the person; a target whose tool is missing is skipped, and a GitHub workflow can build it instead.
---

# A game as an app of its own

A studio is the folder with `studio.json`. `homie-studio standalone` wraps a game the studio already has. It does
not port it, rewrite it or change how it plays: the app shows the same files `homie-studio build` makes.
`node_modules/@homie-rocks/studio/standalone/STANDALONE.md` is the full guide; read it before a release, and
read its "What has been run and what has not" to the person before they count on anything it lists as never
run.

With no terminal, the `game_standalone` tool does the same (with `plan: true` first). Its build is a background
job that takes minutes: `studio_job` gives the result in words when it is done, and those words, with the list
of what the standalone game does not have, are for the person.

## 1. Plan first, and say what is missing

```sh
npx --no-install homie-studio standalone plan <id>
```

It changes nothing and installs nothing. Tell the person, in your own short words, all of this:

- **Which targets this computer can build**, and for each one it cannot, why and the fix it printed. Never
  install a JDK, Xcode, Android Studio or anything else for them: say the fix and let them choose. A computer
  that cannot make a target can still get it from GitHub (section 5).
- **The address built into every copy.** A shipped copy keeps it for good. If it is a workers.dev address,
  say so and recommend the studio's own domain before shipping. With no address the copy plays offline only.
- **Every warning it printed**, as it is.
- **What the standalone game does not have (v1)**, as the plan lists it. Say it before they ship anything, not
  after: no player accounts or sign-in, no cloud saves (saves stay on the device and are lost when the app is
  uninstalled), no shop, no room chat, no watching or big screen, only the public server through an open door,
  no automatic updates, Steam's overlay and achievements never run, an unsigned Windows build, and nothing is
  uploaded to a store for them. Do not soften it and do not leave a line out. If one of these matters to them,
  the honest answer today is that the web game has it and the app does not.
- **What a store is.** A build is the kind of file a store accepts for upload, never a promise that the store
  takes the game. Before they pay anything, tell them what STANDALONE.md's "Before you spend money" says (Apple's
  yearly membership and its review, which can reject a web game in a wrapper; Google Play's fee and its closed
  test for new personal accounts; Steam Direct's fee for each app and its waiting periods), and that those facts
  have a date on them: they check each store's own page.

Two things must be true before a copy can find rooms: the studio is on `@homie-rocks/studio` 0.32.0 or later
(the `studio-setup` skill's upgrade), **and it has been deployed since** (the `publish` skill). The plan cannot
see which version the live site runs; ask, or deploy.

Before anything ships, the game should name its revision: `"netplay": { "version": "1" }` in its `game.json`.
An older copy then keeps playing with other copies of its revision, and says "Update <Name> to play online
with everyone." when it meets a newer one. Raise the number with every change an older copy cannot play with.

## 2. Build

```sh
npx --no-install homie-studio standalone build <id>                    # every target this computer can make
npx --no-install homie-studio standalone build <id> --for mac,windows  # only these
```

It builds the game for the web first, installs the wrapper tools into `.studio/standalone/<id>/` the first time
(a few hundred MB, once; say so before you start), and takes minutes: run it as a background task and tell the
person what is happening. Everything it makes is in `.studio/standalone/<id>/out/<target>/`. That folder is
git-ignored: never commit it, never edit it.

Read the result and say it truthfully. A target is **built**, **skipped** (a tool is missing: say the fix) or
**failed** (say why, in its words); a release that could not be signed is **UNSIGNED**, and the command does not
report success. "Skipped" is not "built", and built is not "works": the result says, for the one desktop build
this computer can run, "started here and loaded the game: yes" or "NO", and for every other target "built, not
started on this computer". Pass that on as it is. The Windows and Linux builds have never been started by the
people who made this, on any computer: say so when you hand one over.

Each kind has its own folder (`out/<target>/debug/`, `out/<target>/release/`): a build to try never replaces a
release.

## 3. Try it

```sh
npx --no-install homie-studio standalone run <id>            # this computer's desktop build
npx --no-install homie-studio standalone run <id> --for ios  # or android: Capacitor picks a device or simulator
```

Play it with the person. Check that it finds a room when the studio is online (the room button says "Room 3")
and plays with its bots when it is not ("Playing offline · Try again").

## 4. A release

Only when the person asks to ship.

1. `game.json` needs the app's id first: `"standalone": { "appId": "com.example.gemrush" }`. A store never lets
   it change, so it is the person's to choose (a domain they own, reversed). `--release` stops and prints the
   exact lines when it is missing. Version, build number, orientation, icon and Steam's numbers go in the same
   block.
2. A real icon: a square 1024 by 1024 PNG at `games/<id>/icon.png`. Without one the app wears the game's cover
   or a letter, which no store page should.
3. Signing comes from **environment variables the person sets themselves**: `HOMIE_APPLE_IDENTITY` and
   `HOMIE_APPLE_NOTARY_PROFILE` (macOS), `HOMIE_APPLE_TEAM` (iOS, with Xcode signed in to an Apple account of
   that team), the four `HOMIE_ANDROID_*` (Android). Never
   ask for a password, a keystore or a certificate in the chat, never write one to a file, and never run
   `xcrun notarytool store-credentials` for them: they run it in their own terminal. Tell them how a value
   gets there when they work in a desktop app: a terminal they start their AI from, `launchctl setenv` on a
   Mac, or a repository secret for the workflow. The build says UNSIGNED, or NOT NOTARIZED, for what it could
   not do, and "notarized" only when Apple's own tool confirms it on the finished app. Signing with a real
   Developer ID, notarizing, and the iOS archive have never been run by the people who made this: read the
   result closely the first time.
4. `npx --no-install homie-studio standalone build <id> --release`.
5. **Uploading is the person's.** The build prints the exact steps for Steam (`steamcmd`), App Store Connect
   (Transporter) and Google Play (the Play Console). Hand them over; run none of them.

For Steam: `npx --no-install homie-studio standalone steam <id>` writes Steam's build file from the numbers in
`game.json`, or says what to create in Steamworks first, with the launch options to set there (the Linux one
needs `--no-sandbox` in its arguments). Nothing here has been started by Steam: not the overlay (Electron apps
often show none), not the Linux build in Steam's runtime, not the build file through `steamcmd`. Say that, and
do not promise an overlay.

## 5. A target this computer cannot make

```sh
npx --no-install homie-studio standalone ci <id>
```

writes `.github/workflows/standalone.yml`: the five builds on GitHub's own Windows, Linux and macOS machines,
started by hand from the Actions tab. Commit it on a branch like any change, and tell the person to set the
repository variable `HOMIE_SITE` to the studio's address. It signs nothing but an Android release, never makes
a macOS or iOS release (its macOS app is unsigned and its iOS one is a simulator build), and uploads to no
store. The workflow itself has not been run by the people who made it: read the first run's log with them.

## After a deploy

`homie-studio deploy` says when it makes a different netplay version live than the copies that were built. Pass
that on: copies already out keep playing offline and with each other, and need an update to play with everyone.
