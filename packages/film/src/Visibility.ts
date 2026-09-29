/**
 * ============================================================================
 *  Visibility — one authored answer to "does this draw at t", enforced through
 *  the runtime systems that also have an opinion.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **No drawable draws while the timeline says it is hidden — including
 *   after a prewarm, an LOD change, a draw-budget sweep, an instanced
 *   repopulation and a backward seek.**
 *
 * ## The failure, correctly diagnosed
 *
 * One short film leaked future plants into an earlier shot. The
 * retrospective records the symptom accurately — *"setting a parent group to
 * `visible = false` was not sufficient"* — and the production's fix was to
 * walk every mesh and re-hide it at every relevant time. That fix works and it
 * does not generalise, because it treats the symptom.
 *
 * The cause is that **`.visible` had two writers**. The film's timeline wrote
 * it; so did a draw-budget/LOD sweep that walks the scene by distance and
 * turns things on. Last writer wins, the sweep runs after the seek, and the
 * plant comes back. Nothing is wrong with either writer. What is missing is
 * that one of them is AUTHORITATIVE and the other is advisory, and a boolean
 * field cannot express that.
 *
 * So this file does not add a third writer. It makes visibility a **gate with
 * two inputs**:
 *
 *     drawn = authored(t)  AND  every runtime owner's wish
 *
 * The timeline can only ever hide. A budget can only ever hide. Neither can
 * force something on, so no ordering between them exists to get wrong. That is
 * why `apply()` is safe to call from anywhere, at any point in the frame, as
 * often as you like — it is a pure function of the recorded wishes.
 *
 * ## Structural typing, so this is testable without a renderer
 *
 * Nothing here imports `three`. A node is anything with a `visible` boolean and
 * optional `children`; an instanced draw is anything additionally carrying a
 * `count`. `THREE.Object3D` and `THREE.InstancedMesh` satisfy those by
 * accident of being reasonable, and a plain object in a Node harness satisfies
 * them on purpose. A film-visibility rule that can only be checked with a GPU
 * attached is a rule that gets checked once.
 */

/** Anything with a visibility flag and, maybe, children. `THREE.Object3D` fits. */
export interface VisNode {
  visible: boolean;
  readonly children?: readonly VisNode[];
  readonly name?: string;
  /** Instanced draws: the live instance count. `THREE.InstancedMesh` fits. */
  count?: number;
}

/** A violation found by {@link auditVisibility}. */
export interface VisibilityLeak {
  readonly node: VisNode;
  readonly path: string;
  readonly code: 'drawn-while-hidden' | 'instances-while-hidden' | 'instance-overflow';
  readonly detail: string;
}

/** What the gate believes about one node. */
interface Claim {
  readonly node: VisNode;
  readonly path: string;
  /** The timeline's answer. */
  authored: boolean;
  /** Authored instance count, when the node is an instanced draw. */
  authoredCount: number | null;
  /** Every advisory owner that currently wants this hidden. */
  readonly vetoes: Set<string>;
}

export interface VisibilityGate {
  /**
   * Put a node under the gate. Idempotent by node: claiming twice updates the
   * path rather than making a second, invisible claim.
   */
  claim(node: VisNode, path: string): void;
  /** The timeline's answer for this node at the current authored time. */
  authored(node: VisNode, visible: boolean, count?: number): void;
  /**
   * An advisory owner — a draw budget, an LOD ladder, a frustum culler — says
   * it does not want this drawn. `wants: true` withdraws that owner's veto and
   * nothing else; it can never overrule the timeline.
   */
  runtime(node: VisNode, wants: boolean, owner: string): void;
  /** Write the resolved answer into every claimed node. Pure; call it freely. */
  apply(): void;
  /**
   * Forget every runtime veto but keep the authored answers.
   *
   * This is what a seek calls. A veto is a statement about the frame that was
   * about to be drawn — "too far away for this frame's budget" — and carrying
   * one across a jump in time is the same class of bug as carrying a particle
   * population across it.
   */
  clearRuntime(): void;
  /** Everything the gate knows, for a diagnostic. */
  claims(): readonly { readonly path: string; readonly authored: boolean; readonly vetoes: readonly string[] }[];
  /**
   * Compare the live scene against the authored intent.
   *
   * This is the acceptance test the retrospective asks for, and it is
   * deliberately independent of `apply()`: it reads what the nodes ACTUALLY
   * say now, so it catches a foreign system that wrote `.visible = true`
   * after the gate ran. A gate that graded its own homework would have gone
   * green on the exact bug it exists to catch.
   */
  audit(): VisibilityLeak[];
}

export function createVisibilityGate(): VisibilityGate {
  const claims = new Map<VisNode, Claim>();

  const resolved = (c: Claim): boolean => c.authored && c.vetoes.size === 0;

  return {
    claim(node, path) {
      const existing = claims.get(node);
      if (existing) { claims.set(node, { ...existing, path }); return; }
      claims.set(node, { node, path, authored: node.visible, authoredCount: null, vetoes: new Set() });
    },

    authored(node, visible, count) {
      const c = claims.get(node);
      if (!c) throw new Error(`visibility: node "${node.name ?? '(unnamed)'}" was never claimed; an unclaimed node is not gated and will leak`);
      c.authored = visible;
      c.authoredCount = count ?? null;
    },

    runtime(node, wants, owner) {
      const c = claims.get(node);
      if (!c) throw new Error(`visibility: node "${node.name ?? '(unnamed)'}" was never claimed`);
      if (wants) c.vetoes.delete(owner); else c.vetoes.add(owner);
    },

    apply() {
      for (const c of claims.values()) {
        c.node.visible = resolved(c);
        if (c.authoredCount !== null && typeof c.node.count === 'number') {
          // An instanced draw hidden by the gate keeps its buffer but draws
          // nothing. Zeroing the count as well as the flag is belt and braces
          // on purpose: a custom render pass that iterates instanced meshes
          // directly — which is how a scatter system gets its speed — reads
          // the count and not the flag.
          c.node.count = resolved(c) ? c.authoredCount : 0;
        }
      }
    },

    clearRuntime() {
      for (const c of claims.values()) c.vetoes.clear();
    },

    claims() {
      return [...claims.values()].map((c) => ({ path: c.path, authored: c.authored, vetoes: [...c.vetoes] }));
    },

    audit() {
      const leaks: VisibilityLeak[] = [];
      for (const c of claims.values()) {
        const want = resolved(c);
        if (!want && c.node.visible) {
          leaks.push({
            node: c.node, path: c.path, code: 'drawn-while-hidden',
            detail: c.authored
              ? `hidden by runtime owner(s) ${[...c.vetoes].join(', ')} but visible=true — something wrote the flag after the gate`
              : 'the timeline hides this at the current time, but visible=true — something wrote the flag after the gate',
          });
        }
        if (!want && typeof c.node.count === 'number' && c.node.count > 0) {
          leaks.push({
            node: c.node, path: c.path, code: 'instances-while-hidden',
            detail: `${c.node.count} instances remain on a node the timeline hides`,
          });
        }
        if (want && c.authoredCount !== null && typeof c.node.count === 'number' && c.node.count > c.authoredCount) {
          leaks.push({
            node: c.node, path: c.path, code: 'instance-overflow',
            detail: `${c.node.count} instances drawn where the timeline authored ${c.authoredCount} — a later shot's population is showing in this one`,
          });
        }
      }
      return leaks;
    },
  };
}

/**
 * Would this node draw, taking its whole ancestor chain into account?
 *
 * Walks UP, not down, because that is the question a leak asks. `parents` is
 * supplied by the caller rather than read off the node, so this works on
 * `THREE.Object3D` (which has `.parent`) and on a plain tree in a harness
 * (which does not) with one implementation.
 */
export function effectiveVisible(node: VisNode, parentOf: (n: VisNode) => VisNode | null | undefined): boolean {
  let cursor: VisNode | null | undefined = node;
  while (cursor) {
    if (!cursor.visible) return false;
    if (typeof cursor.count === 'number' && cursor.count <= 0) return false;
    cursor = parentOf(cursor);
  }
  return true;
}

/**
 * Every drawable under `root` that draws while an ancestor is hidden.
 *
 * In a well-behaved scene graph this is always empty — that is what a scene
 * graph is for. It is not always empty when a renderer draws instanced or
 * batched children from its own list rather than by walking, which is the
 * case that made the leaking-plants bug survive a correct-looking fix. `isDrawn` is
 * supplied by the caller because only the caller knows how its renderer
 * decides; the default asks the node.
 */
export function auditTree(
  root: VisNode,
  isDrawn: (n: VisNode) => boolean = (n) => n.visible && (typeof n.count !== 'number' || n.count > 0),
): VisibilityLeak[] {
  const leaks: VisibilityLeak[] = [];
  const walk = (node: VisNode, path: string, hiddenAncestor: string | null): void => {
    const here = path ? `${path}/${node.name ?? '?'}` : (node.name ?? '?');
    if (hiddenAncestor && isDrawn(node)) {
      leaks.push({
        node, path: here, code: 'drawn-while-hidden',
        detail: `draws while ancestor "${hiddenAncestor}" is hidden`,
      });
    }
    const nextHidden = hiddenAncestor ?? (node.visible ? null : here);
    for (const child of node.children ?? []) walk(child, here, nextHidden);
  };
  walk(root, '', null);
  return leaks;
}

/**
 * Apply an authored visibility SCHEDULE — the `{p, visible}` list a
 * {@link import('./Timeline.ts').PropInShot} carries — at a normalised
 * position within a shot.
 *
 * Reconstructed from the schedule alone, never from the previous frame, so
 * calling it at p=0.9 and then at p=0.1 gives the p=0.1 answer both times.
 * That is the whole difference between a schedule and a sequence of events.
 */
export function visibleAt(
  schedule: readonly { readonly p: number; readonly visible: boolean }[] | undefined,
  p: number,
  fallback = true,
): boolean {
  if (!schedule || schedule.length === 0) return fallback;
  let answer = fallback;
  // The first entry at or before p wins. A linear scan is right here: these
  // lists are two or three long and a binary search would be more code than
  // the thing it searches.
  for (const entry of schedule) {
    if (entry.p <= p) answer = entry.visible; else break;
  }
  return answer;
}
