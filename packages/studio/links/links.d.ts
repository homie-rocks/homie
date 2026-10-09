export function randomId(): string;
export function appLink(address: string, params?: Record<string, string | number | boolean | null | undefined>, base?: string): string;
export function qrSvg(text: string, options?: { quiet?: number; dark?: string; light?: string; title?: string; minLevel?: 'L' | 'M' | 'Q' | 'H' }): string;
