/** A compiler-only facade: declarations supply contextual types without changing a game's source or its bundle. */
import { join } from 'node:path';
import { PACKAGE_ROOT } from './studio.mjs';

const q = JSON.stringify;
const record = (entries) => `{ ${entries.map(([n, t]) => `${q(n)}: ${t}`).join('; ')} }`;
function field(f) {
  if (f.t === 'bit' || f.t === 'press') return 'boolean';
  if (f.t === 'ref' || f.t === 'text') return 'string';
  if (f.t === 'vec3' || f.t === 'dir') return 'Vec3';
  if (f.t === 'list') return `ReadonlyArray<${field(f.of)}>`;
  if (f.t === 'map') return `Record<string, ${field(f.of)}>`;
  if (f.t === 'struct') return fields(Object.entries(f.fields));
  return 'number';
}
const fields = (list) => `{ ${list.map(([n, f]) => `get ${q(n)}(): ${field(f)}; set ${q(n)}(value: WriteState<${field(f)}>);`).join(' ')} }`;
const shapes = (table) => record(Object.entries(table).map(([n, fs]) => [n, fs.length ? fields(fs) : 'Record<string, never>']));
const value = (v) => v === null ? 'null' : Array.isArray(v) ? `Array<${[...new Set(v.map(value))].join(' | ') || 'never'}>` : typeof v === 'object' ? record(Object.entries(v).map(([n, x]) => [n, value(x)])) : typeof v;
const picks = (questions) => record(Object.entries(questions).map(([name, question]) => [name,
  question.type === 'choice' ? (Array.isArray(question.criteria) ? question.criteria : Object.keys(question.criteria)).map(q).join(' | ')
    : question.type === 'score' ? 'number' : 'boolean']));
// Vocabulary arguments are admitted by argsWhy; object offers expose their id.
function vocabularyTypes(vocab, view) {
  if (!vocab) return { goals: 'Goal', asks: 'GuideRequest', floorAsks: 'GuideRequest', decision: 'GuideDecision' };
  const argument = source => {
    if (source === 'player') return 'number';
    if (Array.isArray(source)) return source.map(q).join(' | ') || 'never';
    let fd = view[source?.slice(5)];
    if (fd?.t === 'list') fd = fd.of;
    if (fd?.t === 'struct') fd = fd.fields.id;
    return fd && ['text', 'ref', 'u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'fix', 'tick', 'ticks'].includes(fd.t) ? field(fd) : 'never';
  };
  const union = (table, discriminator, metadata) => Object.entries(table ?? {}).map(([name, def]) =>
    `{ readonly ${discriminator}: ${q(name)}; readonly args: Readonly<${record(Object.entries(def.args ?? {}).map(([key, source]) => [key, argument(source)]))}>; ${metadata} }`).join(' | ') || 'never';
  // A floor names one goal and one line, each with exactly its declared arguments, as argsWhy admits them.
  const choice = (table, name, args) => [`{ ${name}?: null; ${args}?: Record<string, never> }`, ...Object.entries(table ?? {}).map(([n, def]) => {
    const list = Object.entries(def.args ?? {}).map(([key, source]) => [key, argument(source)]);
    return `{ ${name}: ${q(n)}; ${args}${list.length ? `: Readonly<${record(list)}>` : '?: Record<string, never>'} }`;
  })].join(' | ');
  return { goals: union(vocab.goals, 'goal', "readonly from: 'brain' | 'floor'; readonly at: number; readonly asked: boolean; readonly state: 'active' | 'done' | 'failed'"),
    asks: union(vocab.asks, 'k', 'readonly from: number; readonly at: number'),
    // The arguments of a request the server admitted carry a compile-time mark, so a floor may forward
    // { goal: ask.k, args: ask.args } without narrowing while arguments it writes itself must fit their goal.
    floorAsks: 'GameRequest extends infer A ? A extends { args: object } ? Omit<A, \'args\'> & { readonly args: A[\'args\'] & Admitted } : never : never',
    decision: `(${choice(vocab.goals, 'goal', 'args')} | { goal: Extract<GameRequest['k'], GameGoal['goal']>; args: FloorRequest['args'] }) & (${choice(vocab.lines, 'say', 'sayArgs')})` };
}
export function rulesTypes(checked, tune) {
  const { schema: s, declarations: d } = checked;
  const vocabulary = vocabularyTypes(checked.vocab, d.view);
  const kind = (k) => `Self<${fields(k.fields)}, ${fields(k.motion)}, ${fields(k.input)}, ${q(k.name)}, ${k.player}, GameGoal>`;
  const all = record(s.kinds.map((k) => [k.name, kind(k)]));
  const create = record(s.kinds.filter((k) => !k.player).map((k) => [k.name, k.fields.length ? fields(k.fields) : 'Record<string, never>']));
  const asks = record(Object.entries(d.asks).map(([n, a]) => [n, fields(a.state)]));
  const tunables = { ...Object.fromEntries(Object.entries(tune.public ?? {}).map(([n, v]) => [n, v?.value ?? v])), ...Object.fromEntries(Object.entries(tune).filter(([n]) => n !== 'public').map(([n, v]) => [n, v?.value ?? v])) };
  const parameters = `${shapes(d.events)}, ${shapes(s.effects)}, ${fields(s.shared)}, ${all}, ${create}, ${asks}, ${value(tunables)}`;
  const answer = scope => checked.answerScopes ? `Extract<Answers, { ask: ${[...new Set([...(checked.answerScopes.scopes[scope] ?? []), ...checked.answerScopes.common])].map(q).join(' | ') || 'never'} }>` : 'Answers';
  const entities = record(s.kinds.map((k) => [k.name, `Entity<W, ${kind(k)}, ${fields(k.input)}, Events, Commands, ${fields(Object.entries(d.view))}, ${answer(k.name)}, GameGoal, FloorRequest, GameDecision>`]));
  const joins = s.kinds.filter((k) => k.player).map((k) => `{ kind: ${q(k.name)}; at: Point; heading?: Point; fields?: Partial<WriteState<${fields(k.fields)}>>; motion?: Partial<WriteState<${fields(k.motion)}>> }`).join(' | ') || 'never';
  const moves = `{ ${s.kinds.filter((k) => k.radius > 0).map((k) => `${q(k.name)}${k.player ? '' : '?'}: (body: MoveBody<${fields(k.motion)}>, input: ReadonlyState<${fields(k.input)}>, ctx: MoveContext<${value(checked.publicTune)}, ${fields(k.motion)}>) => undefined`).join('; ')} }`;
  return `// Generated from this game's checked declarations. The build always uses strict compiler settings.
export * from ${q(join(PACKAGE_ROOT, 'rules/rules.ts'))};
import type { RulesDef, Vec3, Fields } from ${q(join(PACKAGE_ROOT, 'rules/rules.ts'))};
import type { World, Self, Entity, Point, MoveBody, MoveContext, ReadonlyState, WriteState, EventData, RoomEvents, Goal, GuideRequest, GuideDecision } from ${q(join(PACKAGE_ROOT, 'rules/types.ts'))};
export type GameGoal = ${vocabulary.goals};
export type GameRequest = ${vocabulary.asks};
declare const admitted: unique symbol;
type Admitted = { readonly [admitted]: true };
type FloorRequest = ${vocabulary.floorAsks};
type GameDecision = ${vocabulary.decision};
type Events = ${shapes(d.events)};
type Commands = ${shapes(s.commands)};
type Answers = ${Object.entries(d.asks).map(([n, a]) => `{ ask: ${q(n)}; by: 'local' | 'ai' | 'floor'; picks: ${picks(a.questions)}; why?: string }`).join(' | ') || 'never'};
type GameRoomEvents = Omit<RoomEvents<Events>, 'answer'> & { answer: ${answer('room')} };
export type GameWorld = W;
export type GameSelf<K extends keyof GameEntities> = GameEntities[K];
type GameEntities = ${all};
type W = World<${parameters}>;
type RW = World<${parameters}, true>;
type Definition = Omit<RulesDef, 'entities' | 'room' | 'move' | 'asks'> & {
  entities: ${entities}; move?: Moves;
  room?: { records?: {key:string;identity:string;eligible?:string;fields:Readonly<Record<string,string>>}; rounds?: { seconds: number; breakSeconds: number }; bots?: { keep: number }; historySeconds?: number;
    start?: (world: RW) => void;
    join?: (ctx: Pick<W, 'map' | 'shared' | 'tune' | 'math' | 'round'>, player: { seat: number; driver: 'person' | 'bot' | 'ai'; owner: string }) => ${joins};
    on?: { [K in keyof (Omit<Events, keyof GameRoomEvents> & GameRoomEvents)]?: (world: RW, event: EventData<(Omit<Events, keyof GameRoomEvents> & GameRoomEvents)[K]>) => void };
  };
  asks?: ${record(Object.entries(d.asks).map(([n, a]) => [n, `{ state: Fields; questions: ${value(a.questions)}; floor: (state: ReadonlyState<${fields(a.state)}>) => ${picks(a.questions)} }`]))};
};
type Moves = ${moves};
export declare function defineRules(def: Definition): Definition;
export declare function defineMove(def: Moves): Moves;
`;
}

/** The view reads the same declared fields and names as the rules. */
export function rulesViewTypes(checked) {
  const s = checked.schema;
  const entities = record(s.kinds.map(k => [k.name, `ReadonlyState<Omit<GameSelf<${q(k.name)}>, 'input'>> & { readonly mine?: boolean }`]));
  const effects = record(Object.entries(s.effects).map(([n, fs]) => [n, `ReadonlyState<${fields(fs)}> & { readonly at?: Vec3; readonly id?: string; readonly tick: number }`]));
  const input = s.kinds.filter(k => k.player).map(k => `Partial<${fields(k.input)}>`).join(' | ') || 'Record<string, never>';
  return `export * from ${q(join(PACKAGE_ROOT, 'rules/view.ts'))};
import type { Room as BaseRoom, OpenRoomOptions, RoomRound, RoomStatus } from ${q(join(PACKAGE_ROOT, 'rules/view.ts'))};
import type { ReadonlyState, WriteState } from ${q(join(PACKAGE_ROOT, 'rules/types.ts'))};
import type { Vec3 } from ${q(join(PACKAGE_ROOT, 'rules/rules.ts'))};
import type { GameSelf, GameGoal, GameRequest } from './rules';
type Entities = ${entities};
type Commands = ${shapes(s.commands)};
type Effects = ${effects} & { enter: Entity; leave: Entity; placed: Entity; round: RoomRound | null; status: RoomStatus; say: { readonly slot: number; readonly seat: number | null; readonly text: string; readonly line?: string; readonly kind?: string; readonly args: Readonly<Record<string, unknown>> }; goal: { readonly slot: number; readonly goal: GameGoal; readonly prev: GameGoal | null; readonly askAt: number | null }; ask: { readonly slot: number; readonly k: string; readonly ask?: string; readonly from: number; readonly at: number; readonly args: Readonly<Record<string, unknown>> } };
export type Entity = Entities[keyof Entities];
// A request's own arguments; a button's k and args, still a union, pass together.
type AskArgs<K> = GameRequest extends infer A ? A extends { k: infer N; args: infer X } ? K extends N ? X : never : never : never;
export type Room<R = never> = Omit<BaseRoom<R>, 'me' | 'each' | 'get' | 'on' | 'shared' | 'input' | 'command' | 'tune' | 'ask' | 'askButtons'> & {
 // A name written out must be one of the vocabulary's, with its arguments. A name the view only has as a text (a list
 // of buttons it built itself) passes as it is, with any arguments: the server checks those when they arrive.
 ask<K extends string>(id: string, k: string extends K ? K : K extends GameRequest['k'] ? K : GameRequest['k'], ...args: string extends K ? [args?: Readonly<Record<string, unknown>>] : {} extends AskArgs<K> ? [args?: AskArgs<K>] : [args: AskArgs<K>]): void;
 askButtons(id: string, offer?: Record<string, unknown>): Array<GameRequest extends infer A ? A extends { k: string; args: object } ? Pick<A, 'k' | 'args'> & { readonly text: string } : never : never>;
 readonly me: Extract<Entity, { seat: number }> | null;
 readonly shared: ReadonlyState<${fields(s.shared)}>;
 readonly tune: ReadonlyState<${value(checked.publicTune)}>;
 each<K extends keyof Entities>(kind: K, fn: (entity: Entities[K]) => void): void;
 get(id: string): Entity | null;
 on<K extends keyof Effects>(name: K, fn: (event: Effects[K]) => void): () => void;
 input(sample: ${input}): void;
 command<K extends keyof Commands>(name: K, ...data: {} extends Commands[K] ? [data?: Commands[K]] : [data: Commands[K]]): void;
};
export declare function openRoom<R = never>(options?: OpenRoomOptions): Room<R>;
`;
}

/** Answers return to their caller. A room cannot receive an entity's ask response.
 * Literal asks in a known handler restrict that scope; shared helpers conservatively
 * contribute their asks to every scope, and a dynamic name retains the full union.
 */
export async function rulesAnswerScopes(entry) {
  const [{ parse }, { default: traverseModule }, fs, path] = await Promise.all([
    import('@babel/parser'), import('@babel/traverse'), import('node:fs'), import('node:path'),
  ]);
  const traverse = traverseModule.default ?? traverseModule;
  const scopes = new Map(); const common = new Set(); const seen = new Set(); let dynamic = false;
  const key = node => node?.key?.name ?? node?.key?.value;
  function read(file) {
    if (seen.has(file)) return; seen.add(file);
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
    traverse(ast, {
      ImportDeclaration(p) {
        const name = p.node.source.value; if (!name.startsWith('.')) return;
        const base = path.resolve(path.dirname(file), name);
        const target = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (target) read(target);
      },
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type !== 'MemberExpression' || (callee.property.name ?? callee.property.value) !== 'ask') return;
        const name = p.node.arguments[0];
        if (name?.type !== 'StringLiteral') { dynamic = true; return; }
        let scope;
        for (let a = p.parentPath; a; a = a.parentPath) {
          if (a.isObjectProperty() && key(a.node) === 'room') { scope = 'room'; break; }
          if (a.isObjectProperty() && a.parentPath?.isObjectExpression() && key(a.parentPath.parentPath?.node) === 'entities') { scope = key(a.node); break; }
        }
        if (!scope) common.add(name.value);
        else { const names = scopes.get(scope) ?? new Set(); names.add(name.value); scopes.set(scope, names); }
      },
    });
  }
  read(entry);
  return dynamic ? null : { common: [...common], scopes: Object.fromEntries([...scopes].map(([k, names]) => [k, [...names]])) };
}
