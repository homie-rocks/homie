/**
 * Assignment for games where each role knows or does something different.
 *
 * The game authors the tasks and their meaning. This module only guarantees
 * that an empty station does not make one of those authored tasks disappear,
 * and that several empty stations do not all land on the first person.
 */

export type MissingRolePolicy = 'balanced-relay';

export interface MissionTask<Role extends string, Payload = unknown> {
  readonly id: string;
  readonly role: Role;
  readonly payload: Payload;
  /** Tasks which should be presented before this one. */
  readonly after?: readonly string[];
}

export interface MissionAssignment<Role extends string, Payload = unknown> {
  readonly id: string;
  readonly sourceRole: Role;
  readonly assigneeRole: Role;
  readonly relayed: boolean;
  readonly order: number;
  readonly payload: Payload;
}

export interface MissionAssignments<Role extends string, Payload = unknown> {
  readonly byRole: ReadonlyMap<Role, readonly MissionAssignment<Role, Payload>[]>;
  /** Empty only when preserveAll is true and at least one role is occupied. */
  readonly unassigned: readonly MissionTask<Role, Payload>[];
  /** Dependency cycles are made deterministic and reported, never hidden. */
  readonly cycleBroken: readonly string[];
}

export interface MissionAssignmentOptions<Role extends string> {
  readonly roles: readonly Role[];
  readonly preserveAll: boolean;
  readonly missingRoles: MissingRolePolicy;
  /** Preferred relay roles for a missing source role, in order. */
  readonly fallbacks: Readonly<Partial<Record<Role, readonly Role[]>>>;
}

function orderedTasks<Role extends string, Payload>(
  tasks: readonly MissionTask<Role, Payload>[],
): { ordered: MissionTask<Role, Payload>[]; cycleBroken: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('mission.assign: task ids must be unique');

  const waiting = new Map<string, Set<string>>();
  for (const task of tasks) {
    const deps = new Set((task.after ?? []).filter((id) => byId.has(id) && id !== task.id));
    waiting.set(task.id, deps);
  }

  const ordered: MissionTask<Role, Payload>[] = [];
  const emitted = new Set<string>();
  while (ordered.length < tasks.length) {
    const ready = tasks
      .filter((task) => !emitted.has(task.id) && [...(waiting.get(task.id) ?? [])].every((id) => emitted.has(id)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (ready.length === 0) break;
    for (const task of ready) {
      emitted.add(task.id);
      ordered.push(task);
    }
  }

  const cycleBroken = tasks
    .filter((task) => !emitted.has(task.id))
    .map((task) => task.id)
    .sort();
  for (const id of cycleBroken) ordered.push(byId.get(id)!);
  return { ordered, cycleBroken };
}

/** Preserve and balance every authored task across the crew that is present. */
export function assignMissions<Role extends string, Payload>(
  tasks: readonly MissionTask<Role, Payload>[],
  options: MissionAssignmentOptions<Role>,
): MissionAssignments<Role, Payload> {
  if (options.missingRoles !== 'balanced-relay') {
    throw new Error(`mission.assign: unknown missing-role policy ${JSON.stringify(options.missingRoles)}`);
  }

  const roles = [...new Set(options.roles)];
  const byRole = new Map<Role, MissionAssignment<Role, Payload>[]>();
  for (const role of roles) byRole.set(role, []);
  const unassigned: MissionTask<Role, Payload>[] = [];
  const { ordered, cycleBroken } = orderedTasks(tasks);

  for (let order = 0; order < ordered.length; order += 1) {
    const task = ordered[order]!;
    let assignee: Role | undefined;
    if (byRole.has(task.role)) assignee = task.role;
    else {
      const preferred = options.fallbacks[task.role] ?? [];
      const candidates = [...roles].sort((a, b) => {
        const ai = preferred.indexOf(a);
        const bi = preferred.indexOf(b);
        const ap = ai < 0 ? Number.MAX_SAFE_INTEGER : ai;
        const bp = bi < 0 ? Number.MAX_SAFE_INTEGER : bi;
        return (byRole.get(a)?.length ?? 0) - (byRole.get(b)?.length ?? 0)
          || ap - bp
          || roles.indexOf(a) - roles.indexOf(b);
      });
      assignee = candidates[0];
    }

    if (assignee === undefined) {
      unassigned.push(task);
      continue;
    }
    byRole.get(assignee)!.push({
      id: task.id,
      sourceRole: task.role,
      assigneeRole: assignee,
      relayed: assignee !== task.role,
      order,
      payload: task.payload,
    });
  }

  if (options.preserveAll && roles.length > 0 && unassigned.length > 0) {
    throw new Error('mission.assign: preserveAll was requested but one or more tasks were dropped');
  }
  return { byRole, unassigned, cycleBroken };
}
