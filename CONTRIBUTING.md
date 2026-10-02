# Contributing

Issues and pull requests are welcome: bugs, docs, the game engine packages, the netplay
contract, the Gem Rush starter, and the plugin's skills.

## How a change gets in

This repository is where Homie's open parts are developed. A pull request is reviewed
and merged here, and ships to npm with the next release (a `release-*` tag). Homie's own
apps and games pick up a release by pinning its new version, like any studio.

Before you open one:

- run `npm ci && npm test`; `npm run test:plugin` and `npm run validate` if you changed
  the plugin or a marketplace file; and `npm run leaks`. CI runs all of them, on Node 22
  and 24, and a pull request merges when they pass;
- keep the change small, and say what you saw: the command you ran and what it printed;
- an engine package's public modules are its API: a change that breaks a caller needs a
  new minor version while the packages are 0.x, and the packages that depend on it pin
  the new version (they pin each other exactly);
- a published version never changes: a change to a package ships as a new `version`.
  You can leave the bump to the maintainers; `npm run release:check` shows which
  packages changed since their version shipped;
- a pull request that moves `@homie-rocks/studio`'s version adds that version's section
  to the top of [CHANGELOG.md](CHANGELOG.md), in plain words for the people who make
  studios, then runs `node scripts/changelog.mjs --sync` (npm ships a copy in the
  package). CI's changelog check says exactly what is missing;
- the netplay wire protocol is versioned: a change that a v1 client cannot ignore needs
  `v: 2` (see `packages/studio/netplay/NETPLAY.md`);
- never put a key, token or password in an issue, a pull request or a test.

Report a security problem privately, as [SECURITY.md](SECURITY.md) says, never in an
issue.

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
otherwise have the right to submit it under this project's open source license. A pull
request with an unsigned commit is not merged until the commit is signed off.

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
