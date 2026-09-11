import { useEffect, useRef, useState, useCallback } from 'react';
import './index.css';

interface VisNode {
  x: number; y: number;
  ox: number; oy: number;
  layer: number; idx: number; r: number;
}

const QUOTE_LINES = [
  "Why should the eye behold, not palaces of kings,",
  "To see how they were ruined by tumults of the times?",
  "The spider weaves the curtains in the palace,",
  "The owl calls the watches in the towers."
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const nodesRef = useRef<VisNode[]>([]);
  const layerNodesRef = useRef<VisNode[][]>([]);
  const weightsRef = useRef<Float32Array[]>([]);
  const sizesRef = useRef<number[]>([]);
  const dragRef = useRef<VisNode | null>(null);
  const entropyRef = useRef(0);
  const builtRef = useRef(false);

  const [text, setText] = useState('');
  const [loss, setLoss] = useState(3.5);

  const buildNodes = useCallback((w: number, h: number, layers: number[]) => {
    const nodes: VisNode[] = [];
    const layerArr: VisNode[][] = Array(layers.length).fill(null).map(() => []);
    const caps = layers.map((s, i) => {
      if (i === 0 || i === layers.length - 1) return 5;
      return Math.min(s, 8);
    });
    const stacked = window.matchMedia('(max-width: 900px)').matches;
    const px = Math.max(w * (stacked ? 0.12 : 0.15), stacked ? 36 : 60);
    const py = Math.max(h * (stacked ? 0.12 : 0.25), stacked ? 40 : 100);
    const yOffset = stacked ? 0 : 160;
    const uw = w - px * 2;
    for (let l = 0; l < layers.length; l++) {
      const n = caps[l];
      const uh = h - py * 2;
      const sy = uh / (n + 1);
      const x = px + (uw / (layers.length - 1)) * l;
      const totalH = sy * n;
      const startY = py + (uh - totalH) / 2 + sy / 2 + yOffset;
      for (let j = 0; j < n; j++) {
        const idx = Math.floor((j / n) * layers[l]);
        const node = { x, y: startY + sy * j, ox: x, oy: startY + sy * j, layer: l, idx, r: 4 };
        nodes.push(node);
        layerArr[l].push(node);
      }
    }
    nodesRef.current = nodes;
    layerNodesRef.current = layerArr;
    builtRef.current = true;
  }, []);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    workerRef.current = new Worker(
      new URL('./engine/worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e) => {
      if (e.data.type !== 'SYNC') return;
      const p = e.data.payload;
      if (p.text) setText(p.text);
      setLoss(p.loss);
      weightsRef.current = p.weights;
      sizesRef.current = p.layers;
      if (!builtRef.current && cvs.width > 0) buildNodes(cvs.width, cvs.height, p.layers);
    };

    workerRef.current.postMessage({ type: 'START' });

    const hitTest = (mx: number, my: number): VisNode | null => {
      const pad = window.matchMedia('(max-width: 900px)').matches ? 28 : 10;
      for (const n of nodesRef.current) {
        if ((mx - n.x) ** 2 + (my - n.y) ** 2 < (n.r + pad) ** 2) return n;
      }
      return null;
    };

    const pointerPos = (e: MouseEvent | TouchEvent) => {
      const r = cvs.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const sx = r.width > 0 ? cvs.width / r.width : 1;
      const sy = r.height > 0 ? cvs.height / r.height : 1;
      return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
    };

    const down = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) e.preventDefault();
      const p = pointerPos(e);
      dragRef.current = hitTest(p.x, p.y);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      const p = pointerPos(e);
      d.x = Math.max(d.r, Math.min(cvs.width - d.r, p.x));
      d.y = Math.max(d.r, Math.min(cvs.height - d.r, p.y));
    };
    const up = () => { dragRef.current = null; };

    const blockScroll = (e: TouchEvent) => {
      e.preventDefault();
    };

    let lastW = 0;
    let lastH = 0;
    const applySize = (w: number, h: number) => {
      if (dragRef.current) return;
      const rw = Math.max(1, Math.round(w));
      const rh = Math.max(1, Math.round(h));
      const mobile = window.innerWidth <= 900;
      if (lastW > 0 && mobile && rw === lastW) return;
      if (lastW > 0 && Math.abs(rw - lastW) < 2 && Math.abs(rh - lastH) < 2) return;
      lastW = rw;
      lastH = rh;
      cvs.width = rw;
      cvs.height = rh;
      if (sizesRef.current.length > 0) buildNodes(rw, rh, sizesRef.current);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === cvs.parentElement) {
          applySize(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });

    if (cvs.parentElement) {
      resizeObserver.observe(cvs.parentElement);
      applySize(cvs.parentElement.clientWidth, cvs.parentElement.clientHeight);
    }

    cvs.addEventListener('mousedown', down);
    cvs.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    document.addEventListener('touchmove', blockScroll, { passive: false, capture: true });

    let af = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const nodes = nodesRef.current;
      const layerNodes = layerNodesRef.current;
      const _sizes = sizesRef.current;
      const weights = weightsRef.current;

      let totalDisp = 0;
      for (const n of nodes) {
        if (n !== dragRef.current) {
          n.x += (n.ox - n.x) * 0.04;
          n.y += (n.oy - n.y) * 0.04;
        }
        const dx = n.x - n.ox, dy = n.y - n.oy;
        totalDisp += Math.sqrt(dx * dx + dy * dy);
      }
      const entropy = Math.min(1, totalDisp / 1200);
      entropyRef.current = entropy;
      if (entropy > 0.01 && workerRef.current) {
        workerRef.current.postMessage({ type: 'ENTROPY', payload: entropy });
      }

      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';

      const drawEdges = (polarity: 'pos' | 'neg') => {
        const glowColour = polarity === 'pos' ? '#0083b7' : '#c84000';
        const fillColour = polarity === 'pos' ? 'rgba(0,131,183,0.45)' : 'rgba(200,64,0,0.45)';

        ctx.beginPath();
        let count = 0;
        for (let li = 1; li < _sizes.length; li++) {
          const prev = layerNodes[li - 1];
          const curr = layerNodes[li];
          if (!prev || !curr) continue;
          const wa = weights[li - 1];
          if (!wa) continue;
          const ps = _sizes[li - 1];
          const limit = Math.sqrt(6 / (_sizes[li - 1] + _sizes[li]));
          for (const b of curr) {
            for (const a of prev) {
              const raw = b.idx < _sizes[li] && a.idx < ps ? wa[b.idx * ps + a.idx] : 0;
              if (Math.abs(raw) / limit < 0.5) continue;
              if (polarity === 'pos' ? raw <= 0 : raw > 0) continue;
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              count++;
            }
          }
        }
        if (count > 0) {
          ctx.shadowColor = glowColour;
          ctx.shadowBlur = 4;
          ctx.strokeStyle = fillColour;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      };

      drawEdges('pos');
      drawEdges('neg');

      ctx.globalCompositeOperation = 'source-over';
      for (const n of nodes) {
        const disp = Math.sqrt((n.x - n.ox) ** 2 + (n.y - n.oy) ** 2);
        const excited = disp > 8;
        const glow = excited ? '#c84000' : '#0083b7';

        ctx.shadowColor = glow;
        ctx.shadowBlur = excited ? 14 : 6;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = '#f7f7f0';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      af = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      resizeObserver.disconnect();
      cvs.removeEventListener('mousedown', down);
      cvs.removeEventListener('touchstart', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
      document.removeEventListener('touchmove', blockScroll, { capture: true });
      cancelAnimationFrame(af);
      workerRef.current?.terminate();
    };
  }, [buildNodes]);

  const workerChaos = Math.max(0, Math.min(1, (loss - 0.8) / 2.5));
  const chaos = Math.max(entropyRef.current * 1.5, workerChaos);

  return (
    <div className="shell">
      <div className="hud-wrap">
        <div className="hud">
          <div className="info">
            <div className="title-row">
              <span className="status-dot" aria-hidden="true"></span>
              <h1 className="title">Chaos Verse</h1>
            </div>
            <p className="desc">A character-level net trains on a four-line poem in a Web Worker. Drag a node to kick the weights.</p>
          </div>

          <div className="poem">
            <div className="poem-sizer" aria-hidden="true">
              {QUOTE_LINES.map((line, li) => (
                <PlainLine key={li} line={line} />
              ))}
            </div>
            <div className="poem-live">
              {QUOTE_LINES.map((line, li) => {
                const genStr = text ? textToLine(text, li) : line;
                let offset = 0;
                return (
                  <div className="poem-line" key={li}>
                    {line.split(/(\s+)/).map((token, ti) => {
                      if (token === '') return null;
                      const start = offset;
                      offset += token.length;
                      if (/^\s+$/.test(token)) {
                        return <span className="poem-space" key={ti}> </span>;
                      }
                      return (
                        <span className="poem-word" key={ti}>
                          {token.split('').map((orig, ci) => {
                            const ch = start + ci < genStr.length ? genStr[start + ci] : orig;
                            const hit = Math.random() < chaos;
                            if (!hit) {
                              return <span key={ci} className="ch">{ch}</span>;
                            }
                            const jx = (Math.random() - 0.5) * chaos * 18;
                            const jy = (Math.random() - 0.5) * chaos * 18;
                            const glyph = Math.random() > 0.4
                              ? '!@#$%^&*?~;:><'[Math.floor(Math.random() * 15)]
                              : ch;
                            const colours = ['#c84000', '#0083b7', '#f7f7f0'];
                            return (
                              <span
                                key={ci}
                                className="ch"
                                style={{
                                  transform: `translate(${jx}px, ${jy}px)`,
                                  opacity: 0.7 + Math.random() * 0.3,
                                  color: colours[Math.floor(Math.random() * 3)],
                                }}
                              >
                                {glyph}
                              </span>
                            );
                          })}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="metrics">
            <div className="metric-label">Cross-Entropy Loss</div>
            <div className="metric-value">{loss.toFixed(4)}</div>
          </div>
        </div>
      </div>

      <div className="net">
        <canvas ref={canvasRef} />
      </div>

      <div className="credit">
        Made by Yusuf Efe "Pasha" Kivilcim
      </div>
    </div>
  );
}

function PlainLine({ line }: { line: string }) {
  return (
    <div className="poem-line">
      {line.split(/(\s+)/).map((token, ti) => {
        if (token === '') return null;
        if (/^\s+$/.test(token)) {
          return <span className="poem-space" key={ti}> </span>;
        }
        return (
          <span className="poem-word" key={ti}>
            {token.split('').map((ch, ci) => (
              <span key={ci} className="ch">{ch}</span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function textToLine(text: string, lineIdx: number): string {
  return text.split('\n')[lineIdx] || ' ';
}
