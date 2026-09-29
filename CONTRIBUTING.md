# Contributing

Issues and pull requests are welcome: bugs, docs, the netplay contract, the Gem Rush
starter, and the plugin's skills.

## How a change gets in

This repository is a one-way copy of the open parts of Homie's development repository.
A pull request is reviewed here. Once it is accepted, it is applied to the development
repository with your authorship and your `Signed-off-by` line kept, and it comes back
here with the next sync. The pull request is then closed.

Before you open one:

- run `npm install && npm test`, and `npm run validate` if you changed the plugin or a
  marketplace file;
- keep the change small, and say what you saw: the command you ran and what it printed;
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
