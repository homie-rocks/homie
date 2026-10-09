// Packages missing from npm need one maintainer publication before OIDC can release them.
// Propagate that delay through all declared dependency kinds, independent of plan order.
export function deferredPackages(plan, packages) {
  const deferred = new Map(plan.filter((p) => !p.exists).map((p) => [p.name, 'first publication by a maintainer required']));
  let changed;
  do {
    changed = false;
    for (const p of plan) {
      if (p.published || deferred.has(p.name)) continue;
      const { pj } = packages.get(p.name);
      const held = Object.keys({ ...pj.dependencies, ...pj.peerDependencies, ...pj.optionalDependencies }).filter((name) => deferred.has(name));
      if (held.length) { deferred.set(p.name, `waiting for ${held.join(', ')}`); changed = true; }
    }
  } while (changed);
  return deferred;
}
