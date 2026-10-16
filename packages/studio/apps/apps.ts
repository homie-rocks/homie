/** Lasting records through the same sandbox bridge used by saves and the shop. */
import { randomId } from '../links/links.mjs';
export interface AppRecord<T> { id: string; data: T; version: number; updatedAt: number; booking?: {full: boolean; available: number; synced: boolean} }
export function createAppRecords<T extends Record<string, unknown>>({ collection }: { collection: string }) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(collection)) throw new Error('invalid collection');
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<() => void>();
  const receive = (e: MessageEvent) => {
    if(e.source === parent && e.data?.type === 'homie-app-changed' && e.data.collections?.includes(collection)) { for(const listener of listeners) listener(); return; }
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
    subscribe(listener: () => void) { listeners.add(listener); parent.postMessage({type:'homie-app-subscribe',collections:[collection]}, '*'); return () => {listeners.delete(listener);}; },
    async list(): Promise<AppRecord<T>[]> { return (await ask('GET')).records; },
    async get(id: string): Promise<AppRecord<T> | null> { return (await ask('GET', id)).records[0] ?? null; },
    create: (data: T, id = randomId()) => ask('POST', id, data),
    update: (record: AppRecord<T>, data: T) => ask('PUT', record.id, data, record.version),
    remove: (record: AppRecord<T>) => ask('DELETE', record.id, undefined, record.version),
    dispose() { listeners.clear(); removeEventListener('message', receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('disposed')); } pending.clear(); },
  };
}

/** Call the same trusted studio definition used by MCP. The shell supplies identity. */
export function createAppTools() {
  const pending = new Map<string, {resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  const receive = (e: MessageEvent) => {
    if (e.source !== parent || e.data?.type !== 'homie-app-result') return;
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id); clearTimeout(p.timer);
    if (e.data.result?.ok) p.resolve(e.data.result.data); else p.reject(new Error(e.data.result?.error ?? 'tool failed'));
  };
  addEventListener('message', receive);
  return {
    call<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = randomId();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('app shell did not answer')); }, 15000);
        pending.set(id, {resolve: value => resolve(value as T), reject, timer});
        parent.postMessage({type:'homie-app-tool', id, name, input}, '*');
      });
    },
    dispose() { removeEventListener('message', receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('disposed')); } pending.clear(); }
  };
}

export interface AppContext { app: string; origin: string; url: string; presence: number; now: number | null }
/** Public self address and live presence supplied by the authenticated shell. */
export function createAppContext() {
  let value: AppContext | null = null;
  const listeners = new Set<(context: AppContext) => void>();
  let resolve!: (context: AppContext) => void;
  const ready = new Promise<AppContext>(r => {resolve = r;});
  const receive = (e: MessageEvent) => {
    if(e.source !== parent || e.data?.type !== 'homie-app-context') return;
    value = Object.freeze(e.data.context) as AppContext;
    resolve(value); for(const listener of listeners) listener(value);
  };
  addEventListener('message', receive);
  parent.postMessage({type:'homie-app-context'}, '*');
  parent.postMessage({type:'homie-app-subscribe',collections:[]}, '*');
  return {
    ready,
    get current() {return value;},
    now: () => value?.now ?? Date.now(),
    subscribe(listener: (context: AppContext) => void) {listeners.add(listener); if(value)listener(value); return () => {listeners.delete(listener);};},
    dispose() {removeEventListener('message',receive);listeners.clear();}
  };
}

/** Native accessible choices; submit value() to the same booking tool used by an AI. */
export interface BookingAvailability {
  convention: 'studio.booking-availability/1';
  bookingTool: string;
  items: Array<{identifier: string; name?: string; availabilityStarts?: string; booking: {app: string; collection: string; slot: string; quantity: number; option?: string; resource?: string; addons?: Record<string,number>}}>;
  next: string|null;
}
export function createBookingChoices({container,options=[],resources=[],availability}:{container:HTMLElement;options?:Array<{id:string;name:string}>;resources?:Array<{id:string;name:string}>;availability?:BookingAvailability}) {
  if(availability){
    if(availability.convention!=='studio.booking-availability/1')throw new Error('Unsupported booking availability convention');
    const label=document.createElement('label');label.textContent='Available bookings';
    const select=document.createElement('select');select.name='booking';
    const empty=document.createElement('option');empty.value='';empty.textContent='Choose a booking';select.append(empty);
    const bookings=availability.items.map(item=>structuredClone(item.booking));
    for(const [index,item] of availability.items.entries()){
      const option=document.createElement('option');option.value=String(index);option.textContent=[item.name??item.booking.slot,item.availabilityStarts].filter(Boolean).join(' · ');select.append(option);
    }
    label.append(select);container.append(label);
    return {value:():Partial<BookingAvailability['items'][number]['booking']>=>select.value===''?{}:structuredClone(bookings[Number(select.value)]),dispose:()=>label.remove()};
  }
  const fields=new Map<string,HTMLSelectElement>();
  const group=document.createElement('fieldset');
  const legend=document.createElement('legend');legend.textContent='Choose an option';group.append(legend);
  for(const [name,choices] of [['option',options],['resource',resources]] as const) {
    if(!choices.length)continue;
    const label=document.createElement('label');label.textContent=name==='option'?'Option':'Resource';
    const select=document.createElement('select');select.name=name;
    const empty=document.createElement('option');empty.value='';empty.textContent=name==='option'?'Choose an option':'Any available resource';select.append(empty);
    for(const choice of choices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;select.append(option);}
    label.append(select);group.append(label);fields.set(name,select);
  }
  container.append(group);
  return {value:():{option?:string;resource?:string}=>Object.fromEntries([...fields].filter(([,select])=>select.value).map(([name,select])=>[name,select.value])),dispose:()=>group.remove()};
}
