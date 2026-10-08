/** T2 instrumentation for a disposable Preview only. Keep its normal default Worker and Lobby exports; replace its Table export with
 * MeasuredTable as Table from this file. This file is never imported by the production Worker or the desktop build.
 * A room named saving-<bytes>-<suffix> pads only its save envelope; the real host, relay, SQLite transaction,
 * alarm, epoch reservation and output gate are unchanged. Snapshots identify saves for an outside clock.
 */
import { Table } from '../../worker/index.mjs';

export class MeasuredTable extends Table {
  roomFor(...args) {
    const room = super.roomFor(...args);
    if (!room.measured && this.env.HOMIE_PREVIEW === '1') {
      room.measured = true;
      const send = room.hostFrame.bind(room);
      room.hostFrame = (m, text) => {
        if (m.t === 'snap') {
          const saved = this.savedTick === m.k;
          m = { ...m, measure: { saved, bytes: this.savedBytes ?? 0, object: this.ctx.id.toString() } };
          text = JSON.stringify(m);
        }
        return send(m, text);
      };
    }
    return room;
  }
  saveRoom(bytes) {
    const target = Number(/^saving-(\d+)-/.exec(this.code ?? '')?.[1]);
    if (this.env.HOMIE_PREVIEW === '1' && target && this.durable && !this.durable.measured) {
      this.durable.measured = true;
      const write = this.durable.write.bind(this.durable);
      this.durable.write = (value) => {
        const padded = { ...value, padding: '' };
        const base = new TextEncoder().encode(JSON.stringify(padded)).length;
        if (base > target) throw new Error(`T2 save needs ${base} bytes, exceeding the requested ${target}`);
        padded.padding = 'x'.repeat(target - base);
        write(padded);
        this.savedBytes = target;
        this.savedTick = JSON.parse(value.host).core.tick;
      };
    }
    return super.saveRoom(bytes);
  }
}
