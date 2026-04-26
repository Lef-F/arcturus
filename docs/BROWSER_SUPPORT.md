# Browser support

Arcturus is a browser-based virtual analog synthesizer. Three browser APIs do the heavy lifting:

| API | What it powers | Required |
|---|---|---|
| **AudioWorklet** + **`SharedArrayBuffer`** | Faust DSP runs on a real-time audio thread | Yes — for any sound at all |
| **Web MIDI** | Hardware controllers (BeatStep, KeyStep, any MIDI keyboard) | Optional — keyboard + mouse work without it |
| **IndexedDB** | Patches, BeatStep calibration profile, UI preferences | Yes |

`SharedArrayBuffer` requires the page to be **cross-origin isolated** — Arcturus sets the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers, so this is taken care of for you.

## Compatibility matrix

| Browser | Hardware MIDI | Computer keyboard / mouse fallback |
|---|---|---|
| **Chrome / Edge / Brave / Arc** | ✅ Native — permission prompt on first request | ✅ |
| **Firefox** | ⚠️ Gated by default — see [below](#firefox) | ✅ |
| **Safari** | ❌ No `navigator.requestMIDIAccess` | ✅ |
| **Safari iOS / Chrome iOS** | ❌ Same as Safari (all iOS browsers use WebKit) | ✅ |

If your browser is in the ❌ column for MIDI, the synth still works — you just can't drive it from a hardware controller in that browser. Computer keyboard plays notes (`A`–`K`, `Z`/`X` for octaves, `1`–`8` to switch programs), and the mouse handles encoders + pads.

---

## <a id="firefox"></a>Firefox

Firefox supports the Web MIDI API natively, but **gates it behind a "site permission add-on" by default**. When Arcturus calls `navigator.requestMIDIAccess()`, Firefox throws:

```
DOMException: WebMIDI requires a site permission add-on to activate
```

Mozilla's reasoning: even though Web MIDI is a W3C standard, MIDI access can fingerprint connected hardware and can send data to physical devices, so they want an extra opt-in step. Two ways to satisfy that step.

### Easier path — install the Jazz-MIDI extension

A general-purpose Web MIDI bridge for Firefox, published on Mozilla's add-on store. One install, works on every Web MIDI site (not just Arcturus).

1. Go to **[Jazz-MIDI on AMO](https://addons.mozilla.org/en-US/firefox/addon/jazz-midi/)**.
2. Click **Add to Firefox**.
3. Reload Arcturus.

Pros: one click, works for every site, lives alongside other Firefox extensions.
Cons: it's a third-party extension; you trust Jazz-Soft (the publisher) with MIDI access.

### Power-user path — flip the gate flag in `about:config`

If you'd rather not install an extension, Firefox has an internal preference that disables the add-on requirement entirely. Web MIDI then works exactly like Chrome — a normal permission prompt the first time a site requests it.

1. Open a new tab and go to **`about:config`**.
2. Accept the *"Proceed with Caution"* warning.
3. Search for `midi`. You'll see three entries:
   - `dom.webmidi.enabled` — leave at `true` (this is the API itself, on by default)
   - `dom.webmidi.gated` — **toggle this from `true` to `false`** (click the ⇌ icon at the right)
   - `midi.testing` — leave at `false` (this swaps real devices for stub test devices)
4. Reload Arcturus. You should get a normal permission prompt the first time you connect a MIDI device.

Pros: no extension, applies globally across your Firefox profile.
Cons: the flag persists per-profile, so a fresh install / new profile resets it. Mozilla may rename or remove this flag in a future release.

### What if neither works?

The computer-keyboard + mouse fallback is fully functional in Firefox — you just won't get hardware MIDI. If you want the BeatStep / KeyStep experience, Chrome / Edge / Brave / Arc are the lowest-friction options today.

---

## Safari

Safari (desktop and iOS) doesn't ship the Web MIDI API at all. There's no flag to flip and no first-party extension that adds it. The synth boots and works with computer keyboard + mouse, but hardware MIDI controllers are not reachable.

If hardware MIDI is what you want on a Mac, Chrome / Edge / Brave / Arc all run on macOS and support Web MIDI natively.

---

## Chromium (Chrome, Edge, Brave, Arc, Opera)

Web MIDI is supported out of the box. The first time Arcturus calls `requestMIDIAccess({ sysex: true })` a small permission popover appears at the top of the window — click **Allow** and you're done. The grant persists per origin.

`sysex: true` is required because Arcturus uses MIDI System Exclusive messages to fingerprint Arturia devices during calibration. Browsers treat sysex as a stronger permission than plain MIDI; the popover wording reflects that.

## Reporting browser issues

If you hit a browser-specific quirk that isn't covered here, open an issue on [GitHub](https://github.com/Lef-F/arcturus/issues/new) with:

- Browser name + version (`about:` page or "About" menu)
- The exact error message from DevTools console
- A screenshot of the synth's footer notice if it shows one
