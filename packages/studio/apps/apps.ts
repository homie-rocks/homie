/** Lasting records through the same sandbox bridge used by saves and the shop. */
import { randomId } from '../links/links.mjs';
export interface AppRecord<T> { id: string; data: T; version: number; updatedAt: number }
export function createAppRecords<T extends Record<string, unknown>>({ collection }: { collection: string }) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(collection)) throw new Error('invalid collection');
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (e: MessageEvent) => {
    if (e.source !== parent || e.data?.type !== 'homie-app-result') return;
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id); clearTimeout(p.timer);
    if (e.data.result?.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.result?.error ?? 'app request failed'));
  };
  addEventListener('message', receive);
  const ask = (method: string, record?: string, data?: T, version?: number): Promise<any> => new Promise((resolve, reject) => {
    const id = randomId();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('app shell did not answer')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ type: 'homie-app', id, collection, method, record, data, version }, '*');
  });
  return {
    async list(): Promise<AppRecord<T>[]> { return (await ask('GET')).records; },
    async get(id: string): Promise<AppRecord<T> | null> { return (await ask('GET', id)).records[0] ?? null; },
    create: (data: T, id = randomId()) => ask('POST', id, data),
    update: (record: AppRecord<T>, data: T) => ask('PUT', record.id, data, record.version),
    remove: (record: AppRecord<T>) => ask('DELETE', record.id, undefined, record.version),
    dispose() { removeEventListener('message', receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('disposed')); } pending.clear(); },
  };
}
