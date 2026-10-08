/** A small integer generator. Save state with the rest of the game's state. */
export class Random {
  readonly state: Uint32Array;
  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error('nav: seed must be a uint32');
    this.state = new Uint32Array([seed]);
  }
  next = (): number => {
    const n = (Math.imul(this.state[0]!, 1664525) + 1013904223) >>> 0;
    this.state[0] = n;
    return n / 4294967296;
  };
}
