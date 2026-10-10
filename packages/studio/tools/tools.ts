/** A studio tool runs as trusted code in its own Worker. Never import an environment binding. */
export type Audience = 'public' | 'signed-in' | 'owner' | { app: string; role: string };
export interface ToolContext {
  readonly purchase?: { readonly id: string };
  readonly caller: { readonly id: string | null; readonly owner: boolean; readonly client: string | null; readonly roles: Readonly<Record<string, readonly string[]>> };
  records(args: { app: string; role?: string; collection: string; id?: string; operation?: 'read' | 'create' | 'update'; data?: Record<string, unknown>; version?: number }): Promise<unknown>;
  office(path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<unknown>;
  shop(): Promise<unknown>;
  rooms: { send(event: {game: string; room: string; event: string; data: unknown}): Promise<unknown> };
  database: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };
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
  events?: Record<string, {game: string; schema: Record<string, unknown>; audience?: Audience}>;
  handler(input: Input, context: ToolContext): unknown | Promise<unknown>;
}
export function defineTool<Input = Record<string, unknown>>(tool: StudioTool<Input>): StudioTool<Input> { return tool; }
