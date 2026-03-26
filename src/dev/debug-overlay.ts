/**
 * Dev Debug Overlay — shows AudioContext state, engine count, and signal level.
 * Only mounted in dev mode.
 */

import type { EnginePool } from "@/audio/engine-pool";

export function mountDevDebug(ctx: AudioContext, pool: EnginePool): void {
  const panel = document.createElement("div");
  panel.id = "dev-audio-debug";
  panel.style.cssText = `
    position:fixed; top:0; right:0; z-index:10000;
    background:#111; color:#26fedc; font-family:monospace; font-size:11px;
    padding:8px 12px; border-bottom-left-radius:8px; border:1px solid #333;
    display:flex; flex-direction:column; gap:4px; min-width:220px;
  `;

  const testBtn = document.createElement("button");
  testBtn.textContent = "▶ Test Tone (1s)";
  testBtn.style.cssText = "background:#26fedc22;border:1px solid #26fedc;color:#26fedc;padding:2px 8px;cursor:pointer;font-family:monospace;font-size:11px;";
  testBtn.onclick = () => {
    void ctx.resume().then(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    });
  };
  panel.appendChild(testBtn);

  const statusLine = document.createElement("div");
  panel.appendChild(statusLine);
  const levelLine = document.createElement("div");
  panel.appendChild(levelLine);

  const tick = () => {
    statusLine.textContent = `ctx: ${ctx.state} | engines: ${pool.engineCount}`;
    const analyser = pool.analyser;
    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      const bars = Math.round(peak * 40);
      levelLine.textContent = `sig: ${"█".repeat(bars)}${"░".repeat(Math.max(0, 40 - bars))} ${peak.toFixed(4)}`;
    } else {
      levelLine.textContent = "sig: (analyser not ready)";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  document.body.appendChild(panel);
}
