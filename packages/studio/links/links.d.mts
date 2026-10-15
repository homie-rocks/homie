export function randomId(): string;
export function appLink(address: string, params?: Record<string, string | number | boolean | null | undefined>, base?: string): string;
export function qrSvg(text: string, options?: { quiet?: number; dark?: string; light?: string; title?: string; minLevel?: 'L' | 'M' | 'Q' | 'H' }): string;
/** Epoch milliseconds for local date/time in an IANA zone; gaps and repeats reject by default. */
export function placeTime(date: string, time: string, timeZone: string, options?: {disambiguation?: 'reject' | 'earlier' | 'later'}): number;
