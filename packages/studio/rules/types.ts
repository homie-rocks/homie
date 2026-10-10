/** The build specialises these faces from a game's declarations; the runtime still checks every write. */
import type { Vec3, BodyDef, Fields, ColliderDef, QueryDef } from './rules.ts';
import type { math } from './math.ts';

export type Point = { readonly x: number; readonly y: number; readonly z?: number };
export type ReadonlyState<T> = T extends object ? { readonly [K in keyof T]: ReadonlyState<T[K]> } : T;
export type WriteState<T> = T extends Vec3 ? keyof T extends keyof Vec3 ? Point : { [K in keyof T]: WriteState<T[K]> } : T extends object ? { [K in keyof T]: WriteState<T[K]> } : T;
type Payload<T> = {} extends T ? [data?: WriteState<T>] : [data: WriteState<T>];
type Query<T> = T extends object ? ReadonlyState<Omit<T, 'input'>> : never;
export interface Goal { readonly goal: string; readonly args: Readonly<Record<string, unknown>>; readonly from: 'brain' | 'floor'; readonly at: number; readonly asked: boolean; readonly state: 'active' | 'done' | 'failed' }
export interface GuideDecision { goal?: string | null; args?: Record<string, unknown>; say?: string | null; sayArgs?: Record<string, unknown> }
export interface GuideRequest { readonly k: string; readonly args: Readonly<Record<string, unknown>>; readonly from: number; readonly at: number }
export type GuideView<V, G = Goal, A = GuideRequest> = ReadonlyState<V> & { readonly goal: G | null; readonly asks: readonly A[] };
export interface Player<G = Goal> { readonly seat: number; readonly owner: string; readonly driver: 'person' | 'bot' | 'ai'; readonly away: boolean; readonly goal: G | null }
export type Self<F, M, I, K extends string, P extends boolean, G = Goal> = F & {
  readonly id: string; readonly kind: K; readonly pos: Vec3; get vel(): Vec3; set vel(value: Point); get heading(): Vec3; set heading(value: Point); readonly grounded: boolean;
  readonly motion: M; readonly input: ReadonlyState<I>;
} & (P extends true ? Player<G> : {});
export interface Hit { readonly entity?: string; readonly part?: string; readonly at: Point; readonly normal: Vec3; readonly dist?: number }
export interface RayOptions {
  terrain?: 'exact'; atTick?: number; profile?: string; radius?: number; shape?: 'sphere' | 'box' | 'capsule'; height?:number; geometryOnly?: boolean; entitiesOnly?: boolean; ignoreSelf?: boolean; ignore?: readonly string[]; kind?: string; tag?: string; layer?: string; where?: Readonly<Record<string, number | boolean | string | {gt?: number; gte?: number; lt?: number; lte?: number; eq?: number | boolean | string}>> }
export type RayHit = Hit & { readonly dist: number };
export interface RaySnapshot {sweep(body:{pos:Point;grounded?:boolean},delta:Point,options?:{ground?:boolean}):Hit|undefined;support(body:{pos:Point},distance?:number):(Hit&{dist:number})|undefined;ray(from:Point,direction:Point,max:number):RayHit|undefined;rayAll(from:Point,direction:Point,max:number):readonly RayHit[]}
export interface RayQueries { rays(options?:RayOptions):RaySnapshot; ray(from: Point, direction: Point, max: number, options?: RayOptions): RayHit | undefined; rayAll(from: Point, direction: Point, max: number, options?: RayOptions): readonly RayHit[] }
export type Area = { sphere: { at: Point; r: number } } | { box: { min: Point; max: Point } } | { cone: { at: Point; dir: Point; r: number; angle: number } };
export interface MapView { readonly name: string; spot(name: string): Vec3 | undefined; spots(name: string): readonly Vec3[] }
export interface Clock { readonly tick: number; readonly dt: number; ticks(seconds: number): number; readonly math: typeof math }
export interface Round { readonly n: number; readonly phase: 'live' | 'over'; readonly endsAt: number }
export type World<E, F, S, V, C, A, T, Room extends boolean = false> = Clock & {
  readonly tune: ReadonlyState<T>; readonly map: MapView; readonly stage: string; readonly level: number; readonly levelMax: number; readonly guideLevel: number; readonly guideSeats: readonly number[]; readonly kids: boolean; readonly levelSet: boolean;
  readonly shared: Room extends true ? S : ReadonlyState<S>;
  readonly round: Round & (Room extends true ? { end(): void; restart(): void } : {});
  random(): number;
  label(player:string):string;
  send<K extends keyof E>(target: string, event: K, ...data: Payload<E[K]>): void;
  dispatch<K extends keyof E>(target: string, event: K, ...data: Payload<E[K]>): boolean;
  sendRoom<K extends keyof E>(event: K, ...data: Payload<E[K]>): void;
  sendArea<K extends keyof E>(area: Area, event: K, ...data: Payload<E[K]>): void;
  after<K extends keyof E>(ticks: number, event: K, ...data: Payload<E[K]>): void;
  emit<K extends keyof F>(effect: K, at: Point | string, ...data: Payload<F[K]>): void;
  spawn<K extends keyof C>(kind: K, at: Point, fields?: Partial<WriteState<C[K]>>): string;
  near<K extends keyof V>(at: Point, radius: number, kind: K): readonly Query<V[K]>[];
  near(at: Point, radius: number): readonly Query<V[keyof V]>[];
  inBox<K extends keyof V>(box: { min: Point; max: Point }, kind: K): readonly Query<V[K]>[];
  inBox(box: { min: Point; max: Point }): readonly Query<V[keyof V]>[];
  route(graph: string | ReadonlyArray<readonly [number,number,number,readonly number[]]>, from: number, to: number, options?: {radius?:number;height?:number}): readonly number[];
  ray(from: Point, direction: Point, max: number, options?: RayOptions): RayHit | undefined;
  rays(options?:RayOptions):RaySnapshot;
  rayAll(from: Point, direction: Point, max: number, options?: RayOptions): readonly RayHit[];
  ask<K extends keyof A>(name: K, state: WriteState<A[K]>): boolean;
} & (Room extends true ? { announce<K extends keyof E>(event: K, ...data: Payload<E[K]>): void; finish(): void } : {
  goalDone(ok?: boolean): void;
  despawn(self: Exclude<V[keyof V], Player>): void;
  place(self: V[keyof V], at: Point, options?: { vel?: Point; heading?: Point }): void;
  sweep(self: V[keyof V], delta: Point, options?: { ignore?: readonly string[] }): Hit | undefined;
});
export type EventData<T> = ReadonlyState<T>;
export type Undeliverable<E> = { [K in keyof E]: { to: string; event: K; data: E[K] } }[keyof E];
export type BuiltIns<E = Record<string, never>> = { arrive: { why: 'join' | 'spawn' }; leave: {}; takeover: {}; undeliverable: Undeliverable<E>; answer: { ask: string; by: string; picks: Readonly<Record<string, unknown>>; why?: string } };
export type RoomEvents<E = Record<string, never>> = RoundEvents & { seatJoined: { seat: number; id: string; driver: 'person' | 'bot' | 'ai'; owner: string; took: boolean }; seatAway: { seat: number; id: string; away: boolean }; seatLeft: { seat: number; id: string }; answer: BuiltIns['answer']; undeliverable: BuiltIns<E>['undeliverable'] };
export type RoundEvents = { roundStart: { n: number }; roundOver: { n: number; results: readonly { seat: number; id: string; driver: 'person' | 'bot' | 'ai'; score: number; place: number }[] } };
type GuideWorld<W> = Pick<W, Extract<keyof W, 'tick' | 'dt' | 'ticks' | 'math' | 'map' | 'tune' | 'stage' | 'level' | 'levelMax' | 'guideLevel' | 'guideSeats' | 'kids' | 'levelSet' | 'round' | 'shared' | 'near' | 'inBox' | 'ray'>>;
export type Entity<W, S, I, E, C, V, Answer = BuiltIns['answer'], G = Goal, A = GuideRequest, D = GuideDecision> = {
  player?: true | { away?: 'neutral' | 'think'; leave?: 'despawn' | 'bot'; control?: string; takeover?: string }; fields?: Fields; motion?: Fields; input?: Fields; body?: BodyDef; collider?: ColliderDef; query?: QueryDef;
  tick?: (world: W, self: S) => void;
  think?: (world: W, self: S) => Partial<I>;
  on?: { [K in keyof (Omit<E, keyof BuiltIns> & Omit<BuiltIns<E>, 'answer'> & { answer: Answer })]?: (world: W, self: S, event: EventData<(Omit<E, keyof BuiltIns> & Omit<BuiltIns<E>, 'answer'> & { answer: Answer })[K]>) => void };
  commands?: { [K in keyof C]?: (world: W, self: S, event: EventData<C[K]>) => void };
  onRoom?: { [K in keyof (E & RoundEvents)]?: (world: W, self: S, event: EventData<(E & RoundEvents)[K]>) => void };
  guide?: { view: (world: GuideWorld<W>, self: ReadonlyState<Omit<S, 'input'>>) => V; floor?: (world: W, self: S, view: GuideView<V, G, A>) => D };
};
export interface MoveBody<M> { get pos(): Vec3; set pos(value: Point); get vel(): Vec3; set vel(value: Point); get heading(): Vec3; set heading(value: Point); grounded: boolean; readonly motion: M }
export interface MoveCollision<M> extends RayQueries { sweep(body: MoveBody<M>, delta: Point, options?: {ground?: boolean}): Hit | undefined; support(body: MoveBody<M>, distance?: number): (Hit & {dist: number}) | undefined; overlaps(body: MoveBody<M>): boolean }
export type MoveContext<T, M> = Clock & { readonly tune: ReadonlyState<T>; readonly map: MapView & MoveCollision<M>; readonly world: MoveCollision<M> };
