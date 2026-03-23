/**
 * Config View — Hidden configuration menu (Ctrl+, or Esc).
 * Sample rate, buffer size, max voices, MIDI channels, re-calibration.
 */

import type { ArctConfig } from "@/types";

export class ConfigView {
  private _root: HTMLElement;
  private _visible = false;

  /** Called when user saves config changes. */
  onSave?: (config: Partial<ArctConfig>) => void;

  /** Called when user requests re-calibration. */
  onRecalibrate?: () => void;

  constructor(container: HTMLElement) {
    this._root = container;
    this._render();
    this._bindKeys();
  }

  /** Show the config panel. */
  show(): void {
    this._visible = true;
    const panel = this._root.querySelector<HTMLElement>(".config-panel");
    panel?.removeAttribute("hidden");
    panel?.setAttribute("aria-hidden", "false");
  }

  /** Hide the config panel. */
  hide(): void {
    this._visible = false;
    const panel = this._root.querySelector<HTMLElement>(".config-panel");
    panel?.setAttribute("hidden", "");
    panel?.setAttribute("aria-hidden", "true");
  }

  /** Populate fields from a saved config. */
  setConfig(config: Partial<ArctConfig>): void {
    const el = this._root;
    if (config.sampleRate !== undefined) {
      const sel = el.querySelector<HTMLSelectElement>("#config-sample-rate");
      if (sel) sel.value = String(config.sampleRate);
    }
    if (config.bufferSize !== undefined) {
      const sel = el.querySelector<HTMLSelectElement>("#config-buffer-size");
      if (sel) sel.value = String(config.bufferSize);
    }
    if (config.maxVoices !== undefined) {
      const inp = el.querySelector<HTMLInputElement>("#config-max-voices");
      if (inp) inp.value = String(config.maxVoices);
    }
  }

  get isVisible(): boolean {
    return this._visible;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="config-panel" hidden aria-hidden="true" role="dialog" aria-label="Settings">
        <div class="config-header">
          <h2 class="config-title">Settings</h2>
          <button class="config-close" aria-label="Close settings">✕</button>
        </div>
        <div class="config-body">
          <label class="config-row">
            <span>Sample Rate</span>
            <select id="config-sample-rate">
              <option value="44100">44100 Hz</option>
              <option value="48000" selected>48000 Hz</option>
            </select>
          </label>
          <label class="config-row">
            <span>Buffer Size</span>
            <select id="config-buffer-size">
              <option value="128" selected>128</option>
              <option value="256">256</option>
              <option value="512">512</option>
            </select>
          </label>
          <label class="config-row">
            <span>Max Voices</span>
            <input id="config-max-voices" type="number" min="1" max="16" value="8" />
          </label>
          <label class="config-row">
            <span>KeyStep Channel</span>
            <input id="config-ks-channel" type="number" min="1" max="16" value="1" />
          </label>
          <label class="config-row">
            <span>BeatStep Channel</span>
            <input id="config-bs-channel" type="number" min="1" max="16" value="1" />
          </label>
        </div>
        <div class="config-footer">
          <button class="btn btn-secondary" id="config-recalibrate-btn">Re-calibrate</button>
          <button class="btn btn-primary" id="config-save-btn">Save</button>
        </div>
      </div>
    `;

    this._root.querySelector(".config-close")?.addEventListener("click", () => this.hide());

    this._root.querySelector("#config-recalibrate-btn")?.addEventListener("click", () => {
      this.onRecalibrate?.();
    });

    this._root.querySelector("#config-save-btn")?.addEventListener("click", () => {
      this._save();
    });
  }

  private _save(): void {
    const el = this._root;
    const sampleRate = Number(el.querySelector<HTMLSelectElement>("#config-sample-rate")?.value) as ArctConfig["sampleRate"];
    const bufferSize = Number(el.querySelector<HTMLSelectElement>("#config-buffer-size")?.value) as ArctConfig["bufferSize"];
    const maxVoices = Number(el.querySelector<HTMLInputElement>("#config-max-voices")?.value);
    const midiChannelKeystep = Number(el.querySelector<HTMLInputElement>("#config-ks-channel")?.value);
    const midiChannelBeatstep = Number(el.querySelector<HTMLInputElement>("#config-bs-channel")?.value);

    this.onSave?.({ sampleRate, bufferSize, maxVoices, midiChannelKeystep, midiChannelBeatstep });
    this.hide();
  }

  private _bindKeys(): void {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this._visible) {
        this.hide();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        this._visible ? this.hide() : this.show();
      }
    });
  }
}
