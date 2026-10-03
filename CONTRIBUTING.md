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
  the plugin or a marketplace file; and `npm run leaks`. CI runs all of them, on Node 22
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
- **Names and addresses go nowhere else.** Not in the sentences of a commit message, not
  in a comment, not in a file: this repository keeps no authors list, and Git's own
  record of who made each commit is the credit. The leak audit (below) fails an email
  address anywhere else.

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
- never with a merge commit. That method is switched off here: its title would write
  the branch's name into `main`, and a branch name with a folder in front of it reads
  to the leak audit as a path;
- from a fork, CI cannot read the maintainers' private terms (GitHub gives a fork's pull
  request no secrets), so the leak audit runs its public checks there and says so. The
  maintainer runs it with the private terms over your commits before merging;
- a maintainer's own change comes in the same way: a pull request, the same checks, and
  their own name on the commit.

## The leak audit: what it checks, and why

This repository's open parts are developed next to private ones, by people and by AI
tools that work in both, and what lands in public Git history stays there. The leak
audit (`scripts/audit.mjs`) is what keeps something private from landing here by
accident. `npm run leaks` runs it on what your next commit would hold; CI runs it on the
tree and on every commit a pull request adds: its files, its author and committer, and
its message.

It fails on:

- a home or machine path, which names somebody's computer;
- an email address in a file or in the sentences of a commit message. The exceptions are
  the security contact, and in a commit message a person's trailer (above);
- anything shaped like a secret: a key, a token, an account id, a UUID, a `workers.dev`
  host. A test's made-up values are listed in the script;
- the old npm scope, a path to a package folder this repository does not have, and a
  commit id from some other repository (a revert's message names the commit it undoes,
  and that one is this repository's own);
- a handful of words from the maintainers' private build process (the script's header
  lists them; a file that needs one in its ordinary sense is named in `ALLOWED_WORDS`).
  They fail in a commit message as well, so reword one there;
- a placeholder or a to-do marker left in a file;
- a symlink, a submodule, a binary, and a file of a secret-bearing kind (`.env`, a key);
- the maintainers' private terms: private projects, paths, hosts and ids, internal
  tool and product names, and names that are private in a file. They are written in no
  file here. CI reads them from a repository secret, and a finding gives only a term's
  number and kind (`private term #3 (private folder)`), never the term.

It does not check who you are. A commit's author and committer may be anybody, and a
person's name is never held against them there or on a trailer: a maintainer's name can
be a private term for the files and still be the name on their commits. What still fails
in an author or committer field is a private path, id, host or internal name: none of
those is anybody's name, and one gets there only when a tool fills in an identity by
mistake.

When it fails, the report names the check and the line. Fix a file and commit again; fix
a commit message with `git commit --amend` (or `git rebase -i main` for an earlier one)
and push again.

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
