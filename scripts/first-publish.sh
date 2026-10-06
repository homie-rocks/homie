#!/usr/bin/env bash
# The ONE-TIME npm bootstrap for a package that is not on npm yet, run by a maintainer
# from a clean checkout of this repository's main, after the package's first version is
# merged:
#
#   npx -y npm@11 login                      (once, if not logged in)
#   HOMIE_AUDIT_TERMS=... bash scripts/first-publish.sh
#
# Releases are published by GitHub Actions with trusted publishing (OIDC, provenance,
# no token): .github/workflows/publish.yml. But npm lets a package name a trusted
# publisher only once the package EXISTS on the registry, so a brand-new package cannot
# be created by that workflow. This script does exactly that part, once:
#
#   0. checks: the checkout is clean and is the public main (so npm gets exactly what
#      this repository holds), the leak audit of that tree and of every commit is clean
#      with the maintainers' private terms (HOMIE_AUDIT_TERMS, as in CI), `npx -y npm@11`
#      answers 11.15 or later (for `npm trust`), and npm is logged in (the account name
#      is not printed);
#   1. npm ci and a full build, from clean build outputs;
#   2. asks the registry which packages exist. Only packages that do NOT exist are
#      published here; a new version of an existing package is left for the workflow;
#   3. a DRY RUN of every bootstrap publish, and stops at the first error, before
#      anything is published;
#   4. publishes them from this checkout, in dependency order, and stops at the first
#      error;
#   5. registers the workflow as EVERY package's trusted publisher (repository
#      homie-rocks/homie, workflow publish.yml, environment npm), and sets each package
#      to "require two-factor authentication and disallow tokens";
#   6. checks the registry: each bootstrapped package is there with the same integrity
#      as the tarball this checkout packs. Whether a package trusts the workflow is step
#      5's own answer, said per package; nothing is inferred afterwards.
#
# Every call that writes to the registry (publish, its dry run, npm trust, npm access) runs
# as `npx -y npm@11`, whatever the global npm is (a global self-upgrade can fail); reads use
# the global npm. It is safe to run again: a published package, a registered publisher and
# a set access level are each skipped.
#
# 2FA, AND WHY EVERY npm trust CALL TALKS STRAIGHT TO THE TERMINAL. npm asks for two-factor in the
# browser, and it can only ask when its output is a terminal: with its output sent to a file or a
# pipe it fails at once with EOTP instead. This script used to hide `npm trust github` in a file and
# to ask `npm trust list` whether a package was registered already, through a pipe. The first could
# never be approved, and the second (which needs two-factor itself) printed its sign-in prompt,
# which was read as "yes, trusted": packages were skipped that had no publisher, and a release
# was refused by the registry for each of them (a 404 on the PUT). So step 5 now runs each call in
# the open and goes by its exit status alone. When npm asks, press ENTER, approve in the browser and
# tick "skip two-factor authentication for the next 5 minutes": the rest of the calls then pass
# without asking. The slow checks (steps 0 to 2, about twelve minutes) come before the first
# question, so they never eat into that window.
#
#   bash scripts/first-publish.sh                 every package
#   bash scripts/first-publish.sh camera render   step 5 for these only (a new package, or one a
#                                                 release was refused for)
#
# Nothing here pushes to git. It prints no secret and no account name.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
GH_REPO="homie-rocks/homie"
WORKFLOW="publish.yml"
ENVIRONMENT="npm"
say() { printf '\n== %s\n' "$*"; }
# 0 = on npm, 1 = not on npm (E404); anything else stops the run.
on_npm() {
  local err
  if npm view "$1" version --prefer-online > /dev/null 2> "$WORK/view.err"; then return 0; fi
  err="$(cat "$WORK/view.err")"
  if printf '%s' "$err" | grep -q -E 'E404|404 Not Found|is not in this registry'; then return 1; fi
  die "npm view $1 failed: $(printf '%s' "$err" | head -1)"
}
die() { printf '\nfirst-publish: STOPPED: %s\n' "$*" >&2; exit 1; }
npm11() { npx -y npm@11 "$@"; }

cd "$REPO"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "0. The checkout, the audit, npm and the login"
[ -z "$(git status --porcelain)" ] || die "this checkout has uncommitted changes: publish only a merged commit"
COMMIT="$(git rev-parse HEAD)"
echo "commit $COMMIT"
GIT_TERMINAL_PROMPT=0 git fetch -q origin main || die "could not fetch the public repository"
[ "$COMMIT" = "$(git rev-parse origin/main)" ] || die "HEAD is $COMMIT, the public main is $(git rev-parse origin/main): check out the public main, so npm gets exactly what this repository holds."
echo "pushed: the public main is this commit"
node scripts/audit.mjs --require-terms > "$WORK/audit.txt" || { cat "$WORK/audit.txt"; die "the leak audit of $COMMIT is not clean"; }
head -1 "$WORK/audit.txt"
node scripts/audit.mjs --history --require-terms > "$WORK/history.txt" || { cat "$WORK/history.txt"; die "the leak audit of this repository's history is not clean"; }
head -1 "$WORK/history.txt"
NPM_VERSION="$(npm11 --version)" || die "npx -y npm@11 did not run"
node -e 'const [a,b]=process.argv[1].split(".").map(Number); process.exit(a>11||(a===11&&b>=15)?0:1)' "$NPM_VERSION" \
  || die "npx -y npm@11 gave npm $NPM_VERSION: npm trust needs 11.15 or later"
npm11 whoami > /dev/null 2>&1 || die "npm is not logged in: run npx -y npm@11 login, then this again"
echo "npm $NPM_VERSION (npx -y npm@11), logged in"

say "1. Install and build"
git clean -q -f -d -X -- packages   # stale dist/ and build info never reach a tarball
npm ci --no-audit --no-fund
npm run build

say "2. What the registry has"
PLAN="$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const root = JSON.parse(readFileSync("package.json", "utf8"));
const pkgs = new Map();
for (const dir of root.workspaces) {
  const pj = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  if (!pj.private) pkgs.set(pj.name, { dir, pj });
}
const out = [], seen = new Set();
const visit = (n, stack) => {
  if (seen.has(n)) return;
  if (stack.includes(n)) throw new Error(`dependency cycle: ${[...stack, n].join(" -> ")}`);
  for (const d of Object.keys(pkgs.get(n).pj.dependencies ?? {})) if (pkgs.has(d)) visit(d, [...stack, n]);
  seen.add(n); out.push(n);
};
for (const n of [...pkgs.keys()].sort()) visit(n, []);
for (const n of out) console.log(`${n} ${pkgs.get(n).dir} ${pkgs.get(n).pj.version}`);
')"
NEW=()
while read -r name dir version; do
  if on_npm "$name"; then
    if on_npm "$name@$version"; then echo "on npm       $name@$version"
    else echo "exists       $name (version $version is left for the workflow)"; fi
  else
    echo "BOOTSTRAP    $name@$version"
    NEW+=("$name $dir $version")
  fi
done <<< "$PLAN"

if [ "${#NEW[@]}" -gt 0 ]; then
  say "3. Dry run of the ${#NEW[@]} bootstrap publishes"
  for row in "${NEW[@]}"; do
    read -r name dir version <<< "$row"
    npm11 publish --workspace "$dir" --access public --dry-run > /dev/null 2> "$WORK/dry.err" \
      || { cat "$WORK/dry.err" >&2; die "the dry run of $name@$version failed; nothing was published"; }
    echo "ok (dry)     $name@$version"
  done

  say "4. Publish (first versions only)"
  for row in "${NEW[@]}"; do
    read -r name dir version <<< "$row"
    echo "publishing   $name@$version"
    npm11 publish --workspace "$dir" --access public \
      || die "$name@$version did not publish. The packages before it did; run this again to continue."
  done
else
  say "3-4. Nothing to bootstrap: every package exists on npm"
fi

say "5. Trusted publisher ($GH_REPO, $WORKFLOW, environment $ENVIRONMENT) and publishing access"
# No call here has its output redirected, and nothing asks npm whether a package is registered already (see the
# header). A package npm refuses is not a reason to stop: the commonest refusal is a publisher that is there
# already, which cannot be told from another refusal without hiding npm's prompt, so it is listed at the end.
ONLY=" $* "
REGISTERED=()
REFUSED=()
while read -r name dir version; do
  if [ "$#" -gt 0 ] && [[ "$ONLY" != *" $name "* ]] && [[ "$ONLY" != *" ${name#@homie-rocks/} "* ]]; then continue; fi
  if npm11 trust github "$name" --file "$WORKFLOW" --repo "$GH_REPO" --env "$ENVIRONMENT" --allow-publish --yes < /dev/tty; then
    echo "registered   $name"
    REGISTERED+=("$name")
  else
    echo "not now      $name (npm refused: read its words above)"
    REFUSED+=("$name")
  fi
  npm11 access set mfa=publish "$name" < /dev/tty || echo "             publishing access was not set for $name (set it on its access page)"
  sleep 2 # npm's guidance for bulk registration: a pause between calls avoids rate limiting
done <<< "$PLAN"

say "6. Registry check"
BAD=0
for row in ${NEW[@]+"${NEW[@]}"}; do   # an empty array is "unbound" to bash 3.2 (macOS) under set -u
  read -r name dir version <<< "$row"
  want="$(npm11 pack --workspace "$dir" --dry-run --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].integrity))')"
  got=""
  for _ in 1 2 3 4 5 6; do
    got="$(npm view "$name@$version" dist.integrity --prefer-online 2>/dev/null || true)"
    [ -n "$got" ] && break
    sleep 5
  done
  if [ -z "$got" ]; then echo "MISSING      $name@$version"; BAD=1
  elif [ "$got" != "$want" ]; then echo "DIFFERENT    $name@$version (the registry's tarball is not this checkout's)"; BAD=1
  else echo "on npm       $name@$version"; fi
done
[ "$BAD" = 0 ] || die "the registry check failed"
say "Done. Registered now: ${#REGISTERED[@]}."
if [ "${#REFUSED[@]}" -gt 0 ]; then
  echo "npm refused ${#REFUSED[@]}. A package that already names this workflow is refused a second time, and that is fine;"
  echo "anything else is not. Each one's access page says which (Trusted Publisher: $GH_REPO, $WORKFLOW, $ENVIRONMENT):"
  for name in "${REFUSED[@]}"; do
    echo "  https://www.npmjs.com/package/$name/access"
    for row in ${NEW[@]+"${NEW[@]}"}; do
      # A package this run created cannot have had a publisher: its refusal is a failure, never "already".
      [ "${row%% *}" = "$name" ] && FRESH_REFUSED=1
    done
  done
  [ -z "${FRESH_REFUSED:-}" ] || die "a package published for the first time just now was refused a trusted publisher: a release cannot publish it until it has one"
fi
echo "From now on a release is a tag in the public repo: git tag release-YYYY-MM-DD && git push origin release-YYYY-MM-DD"
