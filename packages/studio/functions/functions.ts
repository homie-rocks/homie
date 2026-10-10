import type { ToolContext, StudioTool } from '../tools/tools';
export interface StudioEvent<Data = unknown> { readonly id: string; readonly type: string; readonly at: number; readonly data: Data; readonly attempt: number }
export interface StudioFunction<Data = unknown> {
  name: string;
  event: string;
  /** Cloudflare cron expression; scheduled events are named by this function. */
  schedule?: string;
  /** Permit an explicit owner replay command to consume retained history. */
  replay?: boolean;
  events?: StudioTool['events'];
  handler(event: StudioEvent<Data>, context: ToolContext): unknown | Promise<unknown>;
}
export function defineFunction<Data = unknown>(definition: StudioFunction<Data>): StudioFunction<Data> { return definition; }
