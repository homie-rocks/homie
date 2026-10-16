import type {BookingAvailability} from '../apps/apps';
/** A studio tool runs as trusted code in its own Worker. Never import an environment binding. */
export type Audience = 'public' | 'signed-in' | 'owner' | { app: string; role: string };
export interface ToolContext {
  readonly purchase?: { readonly id: string };
  readonly caller: { readonly id: string | null; readonly owner: boolean; readonly client: string | null; readonly studio?: {readonly origin: string; readonly verified: true; readonly method: 'oauth-client-credentials'}; readonly actingFor?: {readonly handle: string; readonly verified: false; readonly assertedBy: string}; readonly roles: Readonly<Record<string, readonly string[]>> };
  records(args: { app: string; role?: string; collection: string; id?: string; operation?: 'read' | 'create' | 'update' | 'delete'; data?: Record<string, unknown>; version?: number }): Promise<unknown>;
  office(path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<unknown>;
  shop(): Promise<unknown>;
  studios: {
    send(origin: string, event: string, input: {id: string; data: unknown}): Promise<{id: string}>;
    listTools(origin: string, options?: {cursor?: string}): Promise<{tools: Array<{name: string; description?: string; inputSchema: Record<string, unknown>}>; nextCursor?: string}>;
    call(origin: string, tool: string, args?: Record<string, unknown>, options?: {actingFor?: string}): Promise<{isError: boolean; data?: unknown; content: unknown[]}>;
  };
  bookings: {
    availability(args: {app: string; collection: string; after?: string; quantity?: number; option?: string; resource?: string; addons?: Record<string,number>}): Promise<BookingAvailability>;
    calendar(args: {app:string;startDate:string;endDate:string;timeZone?:string;time?:string;days?:number;durationMinutes?:number;capacity?:number;weekdays?:number[];resources?:string[];options?:unknown[];prefix?:string}): Array<{id:string;start:string;end:string;capacity:number;date:string;timeZone:string}>;
    hold(args: {app: string; collection: string; slot?: string; time?: string; option?: string; resource?: string; preferredResource?: string; addons?: string[] | Record<string,number>; addOns?: string[] | Record<string,number>; quantity?: number; id: string; token?: string; expiresAt: number}): Promise<BookingHold>;
    get(args: {id: string; token?: string}): Promise<BookingHold>;
    confirm(args: {id: string; token?: string; version: number}): Promise<BookingHold>;
    release(args: {id: string; token?: string; version: number}): Promise<BookingHold>;
    releaseExpired(args: {app: string; collection: string; now?: number}): Promise<{released: number}>;
  };
  events: { publish(event: {feed: string; id: string; data: unknown}): Promise<{id: string}> };
  rooms: { send(event: {game: string; room: string; event: string; data: unknown}): Promise<unknown> };
  database: {
    get(key: string): Promise<unknown>;
    getVersioned(key: string): Promise<{value: unknown; version: number} | null>;
    put(key: string, value: unknown, options?: {version?: number}): Promise<{ok: boolean; version?: number; conflict?: boolean}>;
    increment(key: string, amount?: number): Promise<{value: number; version: number}>;
    append(key: string, value: unknown): Promise<{value: unknown[]; version: number}>;
    list(options?: {prefix?: string; after?: string; limit?: number}): Promise<{items: {key: string; value: unknown; version: number}[]; next: string | null}>;
  };
  /** Dispatch a registered custom route in-process with this caller's identity. */
  fetchSelf(path: string, init?: RequestInit): Promise<Response>;
  /** Opt-in shared Cloudflare Rate Limiting binding. Anonymous callers need an explicit key. */
  rateLimit(name: string, key?: string): Promise<{success: boolean}>;
  fetch: typeof fetch;
  fetchWithSecret(name: string, url: string, init?: RequestInit): Promise<Response>;
  ai(model: string, input: unknown): Promise<unknown>;
}
export interface StudioTool<Input = Record<string, unknown>> {
  name: string;
  /** A prompt handler returns its template text. */
  kind?: 'tool' | 'prompt';
  description: string;
  audience: Audience;
  inputSchema: Record<string, unknown>;
  /** Price in currency minor units; uses the studio purchase settlement and refund path. */
  price?: { amount: number; currency: string; refund?: string; refundWindowDays?: number; taxCode?: string; automaticTax?: boolean; taxBehavior?: 'inclusive' | 'exclusive' | 'unspecified' };
  /** Tools sharing an explicitly named namespace share only this studio's tool data. */
  namespace?: string;
  /** A named HMAC secret delegates this one tool as an existing account. */
  webhook?: { secret: string; person: string };
  /** Named business feeds this trusted definition may publish. */
  publish?: string[];
  events?: Record<string, {game: string; schema: Record<string, unknown>; audience?: Audience}>;
  handler(input: Input, context: ToolContext): unknown | Promise<unknown>;
}
export function defineTool<Input = Record<string, unknown>>(tool: StudioTool<Input>): StudioTool<Input> { return tool; }

export interface BookingHold { allocations?: Array<{resource:string;collection:string;start:number;end:number;units:number}>; choices?: {option:string|null;resource:string|null;addons:Record<string,number>}; id: string; slot: string; quantity: number; state: string; version: number; expiresAt: number | null; paid: boolean }
