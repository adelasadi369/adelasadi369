/** Growable ASCII byte writer with fast number formatting (for large XML/OBJ exports). */
export class ByteWriter {
  buf: Uint8Array;
  len = 0;
  constructor(initial = 1 << 20) {
    this.buf = new Uint8Array(initial);
  }
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  /** ASCII/UTF-8 text. */
  str(s: string) {
    this.ensure(s.length * 3);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) this.buf[this.len++] = c;
      else {
        const enc = new TextEncoder().encode(s.slice(i));
        this.buf.set(enc, this.len);
        this.len += enc.length;
        return;
      }
    }
  }
  int(n: number) {
    this.ensure(12);
    if (n < 0) {
      this.buf[this.len++] = 45;
      n = -n;
    }
    if (n === 0) {
      this.buf[this.len++] = 48;
      return;
    }
    let digits = 0;
    for (let m = n; m > 0; m = Math.floor(m / 10)) digits++;
    let p = this.len + digits;
    this.len = p;
    while (n > 0) {
      this.buf[--p] = 48 + (n % 10);
      n = Math.floor(n / 10);
    }
  }
  /** Fixed-point with up to 4 decimals, trailing zeros trimmed. */
  num(x: number) {
    let v = Math.round(x * 10000);
    if (v < 0) {
      this.ensure(1);
      this.buf[this.len++] = 45;
      v = -v;
    }
    const ip = Math.floor(v / 10000);
    let fp = v - ip * 10000;
    this.int(ip);
    if (fp === 0) return;
    this.ensure(5);
    this.buf[this.len++] = 46;
    let div = 1000;
    while (fp > 0) {
      const d = Math.floor(fp / div);
      this.buf[this.len++] = 48 + d;
      fp -= d * div;
      div /= 10;
    }
  }
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}
