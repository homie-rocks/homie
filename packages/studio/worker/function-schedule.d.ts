/** A five-field Cloudflare cron expression in UTC (Sunday = 1), parsed. */
export interface Schedule {
  parts: string[];
  fields: {values: number[]; special: string[]}[];
  dayMatches(date: Date): boolean;
  /** Whether the expression is due at this time (its UTC minute). */
  matches(time: number): boolean;
}
/** Parse a cron expression; throws on one Cloudflare would refuse. */
export function parseSchedule(expression: string): Schedule;
/** The first time after `after` the expression is due, or null when it never is. */
export function nextDue(expression: string | Schedule, after?: number): number | null;
export function scheduleTrigger(definitions: {schedule?: string}[], options?: {eventFeeds?: boolean}): string | null;
export function scheduleStatus(definitions: {name: string; schedule?: string}[], crons: string[], now?: number): {function: string; schedule: string; nextDue: string | null; status: string}[];
