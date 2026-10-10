# Contributing

Issues and pull requests are welcome: bugs, docs, the game engine packages, the netplay
contract, the Gem Rush starter, and the plugin's skills. Everybody contributes the same
way, under their own name: you, the maintainers, and whoever presses the merge button.

## How a change gets in

This repository is where Homie's open parts are developed. A pull request is reviewed
and merged here, and ships to npm with the next release (a `release-*` tag). Homie's own
apps and games pick up a release by pinning its new version, like any studio.

Before you open one:

- run `npm ci && npm test`; `npm run test:plugin` and `npm run validate` if you changed
  the plugin or a marketplace file. CI runs all of them, on Node 22
  and 24, and a pull request merges when they pass;
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
  runs `node scripts/changelog.mjs --sync` (npm ships a copy in the package). CI's
  changelog check says exactly what is missing and gives the text to write: the new
  section, and, once the version before yours has its release tag, the line that links
  that tag from its section;
- the netplay wire protocol is versioned: a change that a v1 client cannot ignore needs
  `v: 2` (see `packages/studio/netplay/NETPLAY.md`);
- never put a key, token or password in an issue, a pull request or a test.

The rules prediction release gate includes the full delay/loss/host matrix on virtual
time and four real-Chrome smoke cases (about two minutes). The three moved starters
add 54 virtual delay/loss/seed cases and three real-Chrome canvas smokes (about
80 seconds). Their original eighteen real-time network cases run only in the
extended suite. Chrome/Node tick-for-tick replay comparisons remain in the gate
with virtual clocks, since they check cross-runtime agreement. Run
`CHROME_PATH=/path/to/chrome npm run test:rules:extended` for the full real-time
Chrome soak as well as the extended rules corpus. It also includes the full
real-time traffic matrix, repeated browser handovers and the long 300-client
spatial-delivery workload. The normal gate keeps two traffic handover cases for
actual tab visibility and socket closure; rate/seed correctness uses virtual time. A focused repeated measurement is:

```sh
CHROME_PATH=/path/to/chrome ROOMS_FEEL_FILTER=60-browser ROOMS_FEEL_DELAY=300 \
ROOMS_FEEL_LOSS=.1 ROOMS_FEEL_REPEATS=30 ROOMS_FEEL_CPU=6 \
ROOMS_FEEL_RECEIPT=/tmp/prediction.json \
node --test packages/studio/test/rules-prediction-chrome.test.mjs
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

A maintainer reviews your pull request and merges it once CI and the DCO check pass:

- with GitHub's **Squash and merge**, so a pull request is one commit on `main`. You are
  that commit's author. Its message is your commits' messages, sign-offs included;
  anyone else who authored a commit in the pull request is named as `Co-authored-by`;
  and the maintainer who merges is signed off under their own name (this repository
  requires a sign-off on every commit made on github.com, the merge button's included).
  A pull request of one commit keeps that commit's title and message as you wrote them.
  With more than one, the pull request's title becomes the commit's first line, so give
  it the title you want `main` to carry; the maintainer reads it before confirming;
- or with **Rebase and merge**, when the commits are worth keeping one by one: they land
  as you wrote them, each with its own sign-off;
- never with a merge commit. That method is switched off here;
- a maintainer's own change comes in the same way: a pull request, the same checks, and
  their own name on the commit.

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
