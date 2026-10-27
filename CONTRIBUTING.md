# Contributing

Issues and pull requests are welcome: bugs, docs, the game engine packages, the netplay
contract, the Gem Rush starter, and the plugin's skills. Everybody contributes the same
way, under their own name: you, the maintainers, and whoever presses the merge button.

## How a change gets in

This GitHub repository is a read-only mirror of `main` from Homie's source repository on
Cloudflare Artifacts. Open issues and pull requests here: a maintainer reviews a pull
request and lands it in the source repository, where the checks run, and it reaches this
mirror and ships to npm with the next release (a `release-*` tag). Homie's own
apps and games pick up a release by pinning its new version, like any studio.

Before you open one:

- run `npm ci && npm test` (the fast set); add `npm run test:heavy` if you touched
  browser, media or rules-prediction code; `npm run test:plugin` and `npm run validate`
  if you changed the plugin or a marketplace file. The merge queue checks the change again before it
  reaches main; a release only builds and publishes;
- keep the change small, and say what you saw: the command you ran and what it printed;
- an engine package's public modules are its API: a change that breaks a caller needs a
  new minor version while the packages are 0.x, and the packages that depend on it pin
  the new version (they pin each other exactly);
- a published version never changes: a change to a package ships as a new `version`.
  You can leave the bump to the maintainers; `npm run release:check` shows which
  packages changed since their version shipped;
- **a version bump needs a changelog section.** A pull request that moves
  `@homie-rocks/studio`'s version adds that version's section to the top of
  [CHANGELOG.md](CHANGELOG.md), in plain words for the people who make studios, then
  runs `node scripts/changelog.mjs --sync` (npm ships a copy in the package).
  `node scripts/changelog.mjs --check` says exactly what is missing and gives the text to write: the new
  section, and, once the version before yours has its release tag, the line that links
  that tag from its section;
- the netplay wire protocol is versioned: a change that a v1 client cannot ignore needs
  `v: 2` (see `packages/studio/netplay/NETPLAY.md`);
- never put a key, token or password in an issue, a pull request or a test.

`npm test` runs only the fast `*.test.mjs` files. The rules prediction checks that
need real Chrome (`rules-prediction-chrome.heavy.mjs`,
`rules-3d-prediction-chrome.heavy.mjs`, `rules-traffic-chrome.heavy.mjs`) are heavy
tests: `CHROME_PATH=/path/to/chrome npm run test:heavy` runs their smoke cases with
the rest of the heavy set. Chrome/Node tick-for-tick replay comparisons use virtual
clocks, since they check cross-runtime agreement. Run
`CHROME_PATH=/path/to/chrome npm run test:rules:extended` for the full real-time
Chrome soak as well as the extended rules corpus. It also includes the full
real-time traffic matrix, repeated browser handovers and the long 300-client
spatial-delivery workload. A focused repeated measurement is:

```sh
CHROME_PATH=/path/to/chrome ROOMS_FEEL_FILTER=60-browser ROOMS_FEEL_DELAY=300 \
ROOMS_FEEL_LOSS=.1 ROOMS_FEEL_REPEATS=30 ROOMS_FEEL_CPU=6 \
ROOMS_FEEL_RECEIPT=/tmp/prediction.json \
node --test packages/studio/test/rules-prediction-chrome.heavy.mjs
```

`ROOMS_FEEL_CPU` sets Chrome's CPU slowdown for both pages; omit it for normal speed.
Corrections and catch counts are measurements, not pass/fail thresholds. The checks
judge drawn movement, first-frame response and convergence to authoritative movement.

Report a security problem privately, as [SECURITY.md](SECURITY.md) says, never in an
issue.

## Your commits, under your own name

- **Use your own name and email.** Commit as yourself (`git config user.name` and
  `git config user.email`), with the name and the address you want on a public record
  that is kept for good. The address GitHub gives you to keep yours private (the one at
  `users.noreply.github.com`) is fine. The maintainers appear as themselves too. (The
  commits by `Homie` in the history are the project's own tooling; nobody else uses
  that name, or needs to.)
- **Sign off every commit**: `git commit -s`. The last section of this page says what
  the sign-off certifies. A commit you make on github.com (the web editor, a suggestion
  you apply) is signed off for you.
- **AI co-author trailers are fine.** When a tool that helped you adds a
  `Co-authored-by` line for itself, leave it in. You are still the author, and the
  sign-off is yours: a person certifies the change.
- **The other trailers that name a person are fine too**: `Signed-off-by`,
  `Co-authored-by`, `Reviewed-by`, `Acked-by`, `Tested-by`, `Reported-by` and
  `Helped-by`, each alone on its line as `Key: Name <address>`, with anybody's name and
  address.

## How maintainers merge

A maintainer reviews your pull request and, once its tests pass and every commit is
signed off, lands it on `main` in the source repository through its merge queue. You stay
the author of your commits, with your sign-offs, and the change appears here when the
mirror next updates; the pull request is then closed with a link to the commit. A
maintainer's own change goes through the same queue and the same checks.

## License: inbound = outbound

This repository is licensed under the Apache License, Version 2.0 ([LICENSE](LICENSE)).
Your contribution is licensed under the same terms, as section 5 of the License says:
what comes in goes out under Apache-2.0, to everyone. There is no contributor license
agreement (CLA) to sign, and you keep the copyright in your contribution.

## Sign off every commit (DCO)

Every commit in a pull request carries a `Signed-off-by` line with your name and an
email address you can be reached at, the same name and address as the commit's author:

    Signed-off-by: Your Name <your email address>

`git commit -s` adds it. For commits you already made, `git commit --amend -s` signs
the last one and `git rebase --signoff main` signs them all. The line says that you
certify the Developer Certificate of Origin 1.1 below: that you wrote the change, or
otherwise have the right to submit it under this project's open source license. The DCO
check on a pull request reads every commit in it (merge commits and bots aside), and a
pull request with an unsigned commit is not merged until the commit is signed off.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

`npm test` runs the fast set; `npm run test:heavy` adds the `*.heavy.mjs` files
(browser, media and long-running checks) with `HOMIE_TEST_HEAVY=1`. Long paced
experiments stay in `npm run test:rules:extended`.
