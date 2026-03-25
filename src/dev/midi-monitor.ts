/**
 * MIDI Monitor — dev-only overlay showing MIDI ports and a live message log.
 *
 * Attaches independently via requestMIDIAccess so it works during calibration,
 * synth view, and any other phase without being wired into app state.
 *
 * Mount with: new MidiMonitor()
 * The panel appends itself to document.body.
 */

const MAX_LOG = 500;

export class MidiMonitor {
  private readonly _panel: HTMLElement;
  private _portsEl!: HTMLElement;
  private _logEl!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _messages: string[] = [];
  private _collapsed = true;
  private _listeningInputs = new Set<string>(); // port ids already subscribed

  constructor() {
    this._panel = this._buildPanel();
    document.body.appendChild(this._panel);
    void this._attach();
  }

  // ── Private ──

  private _buildPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.id = "dev-midi-monitor";
    panel.style.cssText = `
      position:fixed; top:0; left:0; z-index:10000;
      background:#0d0d1a; color:#26fedc; font-family:monospace; font-size:11px;
      border-bottom-right-radius:8px; border:1px solid #333; border-top:none; border-left:none;
      min-width:340px; max-width:420px;
      display:flex; flex-direction:column;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding:5px 10px; background:#111;
      display:flex; justify-content:space-between; align-items:center;
      border-bottom:1px solid #333; gap:8px;
    `;

    const title = document.createElement("strong");
    title.textContent = "MIDI Monitor";
    title.style.cursor = "pointer";
    title.addEventListener("click", () => this._toggleCollapse());

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "copy log";
    copyBtn.style.cssText = `
      background:#26fedc22; border:1px solid #26fedc44; color:#26fedc;
      padding:1px 7px; cursor:pointer; font-family:monospace; font-size:10px;
      border-radius:3px;
    `;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this._copyToClipboard();
    });

    const toggle = document.createElement("span");
    toggle.id = "dev-midi-toggle";
    toggle.textContent = "▶";
    toggle.style.cursor = "pointer";
    toggle.addEventListener("click", () => this._toggleCollapse());

    header.appendChild(title);
    header.appendChild(copyBtn);
    header.appendChild(toggle);

    this._statusEl = document.createElement("div");
    this._statusEl.style.cssText = `padding:4px 10px; color:#888; border-bottom:1px solid #222;`;
    this._statusEl.textContent = "requesting MIDI access…";

    this._portsEl = document.createElement("pre");
    this._portsEl.style.cssText = `
      margin:0; padding:6px 10px; border-bottom:1px solid #222;
      white-space:pre; line-height:1.5; color:#aef;
    `;
    this._portsEl.textContent = "(no ports)";

    this._logEl = document.createElement("pre");
    this._logEl.style.cssText = `
      margin:0; padding:6px 10px;
      white-space:pre; line-height:1.5;
      max-height:220px; overflow-y:auto;
      color:#ccc;
    `;
    this._logEl.textContent = "(waiting for messages…)";

    const body = document.createElement("div");
    body.id = "dev-midi-monitor-body";
    body.style.display = "none"; // start collapsed
    body.appendChild(this._statusEl);
    body.appendChild(this._portsEl);
    body.appendChild(this._logEl);

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }

  private async _attach(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this._statusEl.textContent = "Web MIDI not supported in this browser";
      this._statusEl.style.color = "#f66";
      return;
    }

    let access: MIDIAccess;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      this._statusEl.textContent = "MIDI permission denied";
      this._statusEl.style.color = "#f66";
      return;
    }

    this._statusEl.textContent = "MIDI access granted";
    this._statusEl.style.color = "#26fedc";
    this._renderPorts(access);

    // Subscribe to all current inputs
    access.inputs.forEach((input) => this._subscribeInput(input));

    // Re-render ports and subscribe to new inputs on state changes
    // Use addEventListener (not onstatechange) to coexist with MIDIManager
    access.addEventListener("statechange", (e) => {
      const port = (e as MIDIConnectionEvent).port;
      this._renderPorts(access);
      if (port && port.type === "input" && port.state === "connected") {
        this._subscribeInput(port as MIDIInput);
      }
    });
  }

  private _subscribeInput(input: MIDIInput): void {
    if (this._listeningInputs.has(input.id)) return;
    this._listeningInputs.add(input.id);
    input.addEventListener("midimessage", (e) => {
      const data = (e as MIDIMessageEvent).data;
      if (!data || data.length === 0) return;
      const hex = Array.from(data)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
      const type = _messageType(data[0]);
      const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
      const line = `${time}  ${(input.name ?? "?").padEnd(22).slice(0, 22)}  ${type.padEnd(14)}  ${hex}`;
      this._messages.unshift(line);
      if (this._messages.length > MAX_LOG) this._messages.pop();
      this._logEl.textContent = this._messages.join("\n");
    });
  }

  private _renderPorts(access: MIDIAccess): void {
    const lines: string[] = [];
    access.inputs.forEach((i) =>
      lines.push(`IN   ${(i.name ?? "?").padEnd(28).slice(0, 28)}  [${i.state}]`)
    );
    access.outputs.forEach((o) =>
      lines.push(`OUT  ${(o.name ?? "?").padEnd(28).slice(0, 28)}  [${o.state}]`)
    );
    this._portsEl.textContent = lines.length ? lines.join("\n") : "(no ports visible)";
  }

  private async _copyToClipboard(): Promise<void> {
    const ports = this._portsEl.textContent ?? "";
    const log = this._messages.join("\n");
    const text = `=== MIDI Ports ===\n${ports}\n\n=== Message Log ===\n${log}`;
    await navigator.clipboard.writeText(text);
    const copyBtn = this._panel.querySelector<HTMLButtonElement>("button");
    if (copyBtn) {
      copyBtn.textContent = "copied!";
      setTimeout(() => { copyBtn.textContent = "copy log"; }, 1500);
    }
  }

  private _toggleCollapse(): void {
    const body = this._panel.querySelector<HTMLElement>("#dev-midi-monitor-body");
    const toggle = this._panel.querySelector<HTMLElement>("#dev-midi-toggle");
    if (!body || !toggle) return;
    this._collapsed = !this._collapsed;
    body.style.display = this._collapsed ? "none" : "";
    toggle.textContent = this._collapsed ? "▶" : "▼";
  }
}

// ── Helpers ──

function _messageType(status: number): string {
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  switch (type) {
    case 0x80: return `NoteOff ch${ch}`;
    case 0x90: return `NoteOn  ch${ch}`;
    case 0xa0: return `PolyAT  ch${ch}`;
    case 0xb0: return `CC      ch${ch}`;
    case 0xc0: return `PrgChg  ch${ch}`;
    case 0xd0: return `ChanAT  ch${ch}`;
    case 0xe0: return `PitchBd ch${ch}`;
    case 0xf0: return `SysEx`;
    default:   return `0x${status.toString(16).toUpperCase()}`;
  }
}
