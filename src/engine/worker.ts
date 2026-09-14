const QUOTE = "Why should the eye behold, not palaces of kings,\nTo see how they were ruined by tumults of the times?\nThe spider weaves the curtains in the palace,\nThe owl calls the watches in the towers.";

class Net {
  layers: number[];
  w: Float32Array[];
  b: Float32Array[];
  a: Float32Array[];
  input: Float32Array;
  target: Float32Array;
  alphabet: string[];
  c2i: Map<string, number>;
  ws: number;
  loss = 3.5;
  pos = 0;

  constructor() {
    this.ws = 14;
    const chars = new Set(QUOTE.split(''));
    this.alphabet = Array.from(chars).sort();
    this.c2i = new Map();
    this.alphabet.forEach((c, i) => this.c2i.set(c, i));
    const aLen = this.alphabet.length;
    this.layers = [this.ws * aLen, 48, aLen];
    this.w = [];
    this.b = [];
    for (let i = 0; i < this.layers.length - 1; i++) {
      const fan = this.layers[i] * this.layers[i + 1];
      const lim = Math.sqrt(6 / (this.layers[i] + this.layers[i + 1]));
      const wa = new Float32Array(fan);
      for (let j = 0; j < fan; j++) wa[j] = (Math.random() * 2 - 1) * lim;
      this.w.push(wa);
      this.b.push(new Float32Array(this.layers[i + 1]));
    }
    this.a = this.layers.map(s => new Float32Array(s));
    this.input = new Float32Array(this.layers[0]);
    this.target = new Float32Array(aLen);
  }

  encode(str: string, vec: Float32Array) {
    vec.fill(0);
    const aLen = this.alphabet.length;
    for (let i = 0; i < this.ws; i++) {
      const c = i < str.length ? str[i] : ' ';
      const idx = this.c2i.get(c);
      if (idx !== undefined) vec[i * aLen + idx] = 1;
    }
  }

  forward(input: Float32Array) {
    this.a[0].set(input);
    for (let l = 0; l < this.layers.length - 1; l++) {
      const ni = this.layers[l], no = this.layers[l + 1];
      for (let j = 0; j < no; j++) {
        let s = this.b[l][j];
        const off = j * ni;
        for (let i = 0; i < ni; i++) s += this.a[l][i] * this.w[l][off + i];
        this.a[l + 1][j] = l < this.layers.length - 2 ? Math.max(0, s) : s;
      }
      if (l === this.layers.length - 2) {
        let mx = -Infinity;
        for (let j = 0; j < no; j++) if (this.a[l + 1][j] > mx) mx = this.a[l + 1][j];
        let se = 0;
        for (let j = 0; j < no; j++) { this.a[l + 1][j] = Math.exp(this.a[l + 1][j] - mx); se += this.a[l + 1][j]; }
        for (let j = 0; j < no; j++) this.a[l + 1][j] /= se;
      }
    }
  }

  backward(target: Float32Array, lr: number) {
    const L = this.layers.length;
    let delt = new Float32Array(this.layers[L - 1]);
    for (let i = 0; i < delt.length; i++) delt[i] = this.a[L - 1][i] - target[i];
    for (let l = L - 2; l >= 0; l--) {
      const ni = this.layers[l], no = this.layers[l + 1];
      const prev = new Float32Array(ni);
      for (let j = 0; j < no; j++) {
        const d = delt[j], off = j * ni;
        this.b[l][j] -= lr * d;
        for (let i = 0; i < ni; i++) {
          prev[i] += d * this.w[l][off + i];
          this.w[l][off + i] -= lr * d * this.a[l][i];
        }
      }
      if (l > 0) for (let i = 0; i < ni; i++) prev[i] *= this.a[l][i] > 0 ? 1 : 0;
      delt = prev;
    }
  }

  step() {
    if (this.pos + this.ws >= QUOTE.length) this.pos = 0;
    const win = QUOTE.slice(this.pos, this.pos + this.ws);
    const tgt = QUOTE[this.pos + this.ws];
    this.encode(win, this.input);
    this.target.fill(0);
    const ti = this.c2i.get(tgt);
    if (ti !== undefined) this.target[ti] = 1;
    this.forward(this.input);
    this.backward(this.target, 0.015);
    const p = ti !== undefined ? Math.max(1e-7, this.a[this.layers.length - 1][ti]) : 1e-7;
    this.loss = this.loss * 0.997 + (-Math.log(p)) * 0.003;
    this.pos++;
  }

  generate(): string {
    let out = QUOTE.slice(0, this.ws);
    const v = new Float32Array(this.layers[0]);
    for (let i = 0; i < QUOTE.length - this.ws; i++) {
      this.encode(out.slice(out.length - this.ws), v);
      this.forward(v);
      let mx = -1, mi = 0;
      const pr = this.a[this.layers.length - 1];
      for (let j = 0; j < pr.length; j++) if (pr[j] > mx) { mx = pr[j]; mi = j; }
      out += this.alphabet[mi] || ' ';
    }
    return out;
  }

  noise(severity: number) {
    this.loss = Math.min(this.loss + severity * 0.5, 3.8);
    for (const wa of this.w)
      for (let i = 0; i < wa.length; i++)
        if (Math.random() < severity * 0.02) {
          wa[i] += (Math.random() - 0.5) * severity * 0.2;
          if (wa[i] > 2.0) wa[i] = 2.0;
          if (wa[i] < -2.0) wa[i] = -2.0;
        }
  }
}

const net = new Net();
let running = false;
let tick = 0;

self.onmessage = (e) => {
  const { type, payload } = e.data;
  if (type === 'START' && !running) { running = true; loop(); }
  if (type === 'STOP') running = false;
  if (type === 'ENTROPY' && payload > 0.01) net.noise(payload);
};

function loop() {
  if (!running) return;
  for (let i = 0; i < 80; i++) net.step();
  tick++;
  self.postMessage({
    type: 'SYNC',
    payload: {
      loss: net.loss,
      text: tick % 4 === 0 ? net.generate() : null,
      weights: net.w,
      layers: net.layers
    }
  });
  setTimeout(loop, 0);
}
