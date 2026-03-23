# **Technical Specification and Architectural Framework for the Arturia-JS Composite Synthesizer Ecosystem**

The realization of a professional-grade web-based synthesizer, termed the Arturia-JS Composite Synth, requires a meticulous synthesis of low-level hardware communication protocols, high-performance digital signal processing (DSP), and robust browser-based state management. By integrating the Arturia KeyStep Standard and the Arturia BeatStep Black Edition, developers can leverage the distinct ergonomic advantages of a melodic sequencer and a multi-encoder control plane. This technical report provides an exhaustive specification for the architecture, covering hardware fingerprinting, MIDI implementation mapping, virtual analog audio engine design using Faust, and persistent state management via IndexedDB.

## **Hardware Fingerprinting and Automated Role Assignment**

A fundamental requirement for the Arturia-JS Composite Synth is the ability to automatically identify and configure connected hardware without user intervention. This process, often referred to as hardware fingerprinting, relies on the System Exclusive (SysEx) protocol and the capabilities of the Web MIDI API to enumerate and interrogate connected MIDI interfaces.

### **The Identity Inquiry Protocol**

Upon initial load of the application environment, the system must broadcast a Universal System Exclusive Identity Request to all active MIDI output ports. This request follows the non-real-time universal system exclusive header, which is designed for device identification across manufacturers. The specific byte sequence for this inquiry is defined by the MIDI specification as $F0 \\ 7E \\ 7F \\ 06 \\ 01 \\ F7$.1 The $7F$ byte acts as an "all-call" identifier, ensuring that any device capable of processing the identity request will respond regardless of its internal MIDI ID setting.1  
The Arturia KeyStep and BeatStep respond to this query with an Identity Reply message. For these models, the manufacturer’s ID is the three-byte sequence $00 \\ 20 \\ 6B$.2 This manufacturer code identifies the response as originating from an Arturia device. The identity reply provides a structured payload containing the family code, the model number, and the firmware version level. By parsing these model-specific identifiers, the JavaScript application can distinguish between the KeyStep and the BeatStep, subsequently assigning the "Keyboard" role to the former and the "Control Plane" role to the latter.

### **Analysis of Identity Reply Metadata**

The Identity Reply contains granular information that allows the system to load the correct hardware mapping JSON file. The response structure is generally $F0 \\ 7E \\ \\text{\<deviceID\>} \\ 06 \\ 02 \\ 00 \\ 20 \\ 6B \\ \\text{ff} \\ \\text{ff} \\ \\text{dd} \\ \\text{dd} \\ \\text{ss} \\ \\text{ss} \\ \\text{ss} \\ \\text{ss} \\ F7$. The bytes marked as $\\text{ff} \\ \\text{ff}$ and $\\text{dd} \\ \\text{dd}$ represent the family code and family member code, respectively. Research into Arturia’s SysEx implementation reveals that these codes are unique to each product line, allowing for precise model differentiation even within the same hardware generation.1

| Byte Context | Hexadecimal Value | Significance |
| :---- | :---- | :---- |
| Manufacturer ID | 00 20 6B | Arturia 2 |
| Sub-ID \#1 | 06 | General Information |
| Sub-ID \#2 | 02 | Identity Reply |
| Device Family | 02 00 | Arturia Controller Line 1 |
| Model ID | Model-specific | Unique Member Code 1 |

The system uses this metadata to construct a unique fingerprint for each device. This is especially critical given that the "Black Edition" of the BeatStep is functionally identical to the original white model, meaning they share the same model ID and mapping requirements.1

### **Unique Device Identification and Port Stability**

A recurring challenge in browser-based MIDI applications is the instability of device identifiers provided by the MIDIPort.id attribute. On various operating systems, particularly Windows, these IDs are often generated based on the enumeration order or the specific USB port used, and they may change across reboots or browser sessions.8 Furthermore, if multiple identical devices are connected, the OS may differentiate them by appending numeric suffixes to their names, such as "BeatStep " and "BeatStep ".9  
To ensure that the roles of "Keyboard" and "Control Plane" are not swapped when both devices are connected, the Composite Synth implements a persistent hardware registry. This registry correlates the OS-assigned port name and the internal hardware ID retrieved via SysEx. By storing this correlation in IndexedDB, the application can re-verify the identity of each port upon initialization. If a port name remains constant but the hardware ID changes—indicating a different unit has been plugged into the same port—the system prompts the user for re-confirmation or automatically adjusts the internal routing to match the new hardware fingerprint.

## **MIDI Implementation Mapping for the KeyStep Standard**

The Arturia KeyStep Standard serves as the "Performer" module of the Composite Synth, handling melodic input, sequencing triggers, and high-resolution expressive control. The MIDI mapping for this device must focus on capturing the nuance of a live performance while maintaining tight synchronization with the audio engine's internal clock.

### **Real-Time Transport and Clock Synchronization**

The KeyStep transport section consists of Play/Pause, Stop, and Record buttons, which are essential for controlling the synth’s internal sequencer and time-dependent effects such as LFOs and delay lines. By default, these buttons transmit MIDI Real-Time Messages, which are single-byte status codes designed for high-priority synchronization.12

| Transport Action | MIDI Status Byte | Internal Engine Trigger |
| :---- | :---- | :---- |
| Start | 0xFA | Resets sequence to step 1 and begins clock 13 |
| Stop | 0xFC | Halts clock and pauses sequence 13 |
| Continue | 0xFB | Resumes clock from current position 13 |
| Timing Clock | 0xF8 | Increments internal tempo counter 12 |

The interpretation of these messages is influenced by the "Arm to Start" setting within the Arturia MIDI Control Center (MCC). When "Arm to Start" is active, the KeyStep waits for a physical Play button press before it begins transmitting clock or sequence data, preventing accidental triggers from external sources.16 The Composite Synth’s JavaScript sequencer must be capable of acting as both a master and a slave to these messages. In Master mode, the browser handles the tempo and sends 0xF8 clock pulses to the KeyStep, while in Slave mode, it listens for 0xFA, 0xFB, and 0xFC to govern its internal playback state.

### **Expressive Capacitive Touch Strips**

The KeyStep features two capacitive touch strips for Pitch and Modulation. Unlike mechanical wheels, touch strips offer instantaneous jumps and smooth glides, requiring a high degree of resolution in the software translation layer.  
The Modulation strip typically maps to MIDI Continuous Controller (CC) 1\.19 This is a 7-bit controller that provides values from 0 to 127\. In the Composite Synth’s audio engine, this should be routed to parameters that benefit from continuous variation, such as vibrato depth or filter frequency modulation intensity.  
The Pitch strip utilize the MIDI Pitch Bend message, which is a 14-bit protocol (En ll mm).20 This provides 16,384 discrete steps, ensuring that frequency shifts are heard as smooth glides rather than quantized steps. The system must reassemble the two 7-bit data bytes into a single integer using the following formula:

$$Value\_{14bit} \= (MSB \\times 128\) \+ LSB$$  
The resulting value is centered at 8192 ($0 \\times 2000$ in hexadecimal), with values below indicating a downward pitch shift and values above indicating an upward shift. This high-resolution data is then passed to the Faust audio worklet to control the frequency of the virtual analog oscillators.

### **Expression through Channel Aftertouch**

A defining feature of the KeyStep keyboard is its support for Channel Aftertouch, also known as Channel Pressure. This allows the performer to modulate the sound by applying pressure to the keys after the initial attack. The KeyStep transmits these messages using the status byte $D\_n$, followed by a single data byte indicating the pressure level from 0 to 127\.20  
To achieve a "pro" expressive feel, the Composite Synth maps Channel Aftertouch to the "Filter Opening" parameter in the Faust audio engine. This creates a tactile connection between the performer's physical effort and the harmonic content of the sound, simulating the behavior of high-end analog synthesizers. Because the KeyStep sends Channel Aftertouch—where a single value represents the maximum pressure of all keys held—the software must ensure that this modulation is applied globally to the filter cutoff across all active polyphonic voices.

## **MIDI Implementation Mapping for the BeatStep Control Plane**

The Arturia BeatStep Black Edition is designated as the "Control Plane," providing a dense array of knobs and pads for granular parameter manipulation and preset management. The objective for this module is to provide a "first-class" hardware experience where software parameters can be adjusted smoothly without the "value jumps" typically associated with absolute MIDI controllers.

### **Endless Encoders and Relative Mode Logic**

The BeatStep’s 16 rotary encoders are endless, meaning they do not have physical start or end points. This hardware design is ideally suited for "Relative Mode," where the encoder sends information about the direction and speed of movement rather than its absolute position. The Composite Synth utilizes the "Relative 1" (Binary Offset) mode, which can be configured via the Arturia MIDI Control Center.24  
In Binary Offset mode, the encoder transmits a MIDI CC message where the value 64 represents a "deadzone" or no movement. Clockwise rotation produces values greater than 64, while counter-clockwise rotation produces values less than 64\.

| Encoder Action | MIDI CC Value | Delta Interpretation |
| :---- | :---- | :---- |
| Slow Clockwise | 65 | Increment current value by 1 24 |
| Fast Clockwise | 66-70 | Increment value by higher amounts (Acceleration) 24 |
| Slow Counter-Clockwise | 63 | Decrement current value by 1 24 |
| Fast Counter-Clockwise | 58-62 | Decrement value by higher amounts 24 |

The JavaScript translation layer maintains the "logical position" of each parameter. When a relative CC message is received, the system updates the internal variable:

$$NewValue \= \\text{clamp}(CurrentValue \+ (IncomingValue \- 64\) \\times Sensitivity, 0, 1)$$  
This approach allows the physical knobs to "pick up" a parameter from its current software state regardless of where the knob was last positioned. This is critical for the Composite Synth, as it allows the user to switch patches and immediately begin tweaking the new sound from its saved state without audible discontinuities.

### **Pad Messaging for Preset and Performance Control**

The 16 pressure-sensitive pads on the BeatStep are assigned dual roles: Preset Selection and Performance Triggers.

1. **Program Change Mode (Presets):** The top row of pads (1-8) is configured to send MIDI Program Change messages (Cn pp).7 This enables the user to navigate the synthesizer's patch library instantaneously. Each pad corresponds to a specific index in the IndexedDB patch database, allowing for rapid sound switching during a live performance.  
2. **Note Mode (Performance):** The bottom row of pads (9-16) is configured to send MIDI Note messages (9n nn vv).7 These are mapped to internal percussive voices or sample triggers within the Faust audio engine. The pressure sensitivity of the pads is mapped to velocity, providing a rhythmic accompaniment layer to the KeyStep's melodic lines.

The BeatStep also provides visual feedback through its pad LEDs. When a pad is in "Note Mode," it can receive MIDI input to toggle its backlight.7 The Composite Synth sends Note On messages back to the BeatStep to light up the pads corresponding to active sequencer steps, creating a real-time visualization of the rhythmic pattern.

## **The Audio Engine: Virtual Analog Modeling with Faust**

To achieve the sonic character of a professional synthesizer, the audio engine of the Arturia-JS Composite Synth is built using the Faust (Functional Audio Stream) DSP language. Faust's highly optimized, sample-accurate processing is ideal for "Virtual Analog" (VA) modeling, which seeks to replicate the non-linear behaviors and organic warmth of physical electronic components.

### **Virtual Analog Oscillators (vco.lib)**

Standard digital oscillators, such as those generated by simple naive waveforms, suffer from "aliasing"—a form of distortion that occurs when frequency components exceed the Nyquist frequency. The Faust vco.lib provides alias-suppressed oscillators that use advanced techniques such as PolyBLEP (Polyphonic Band-Limited Step) to produce clean, high-fidelity waveforms even at the upper limits of human hearing.27  
The Composite Synth's oscillator section utilizes the following components:

* **os.sawNp:** This function implements a band-limited sawtooth wave where the order $N$ (typically 1 to 4\) determines the polynomial complexity and spectral purity.27  
* **os.pulse:** Essential for pulse-width modulation (PWM), a cornerstone of analog synthesis. The system maps a BeatStep encoder to the pulse width parameter, allowing for the "thick" chorus-like effects characteristic of classic synthesizers.  
* **os.square:** Provides the fundamental "hollow" timbre required for bass and lead sounds.

By combining multiple oscillators with slight detuning, the system emulates the "unstable" frequency behavior of analog voltage-controlled oscillators (VCOs).

### **Virtual Analog Filters (va\_filter.lib and vaeffects.lib)**

The filter is the defining component of an analog synthesizer's "soul." Classic filters, such as the Moog Ladder, are characterized by their non-linear resonance and "growl" when pushed into high feedback states. The Faust Virtual Analog Effects (VAE) library offers accurate mathematical models of these circuits.28  
The Composite Synth implements a selection of high-fidelity filters:

* **ve.moogLadder:** A 4th-order model of the famous transistor ladder filter. It includes internal feedback paths that allow the filter to self-oscillate when the resonance $Q$ is high.29 The relationship between the quality factor $Q$ and the internal feedback coefficient $k$ is given by:  
  $$k \= 4.0 \- \\frac{1.0}{Q}$$  
* **ve.korg35LPF:** A virtual analog model of the low-pass filter found in the Korg MS-20. It is known for its aggressive, overdriven resonance that "screams" when the cutoff is modulated.29  
* **ve.moogHalfLadder:** A 2nd-order variation that provides a smoother, more "vintage" roll-off, ideal for pad sounds and subtle filtering.29

These filters are implemented using Topology Preserving Transforms (TPT), which ensure that the digital model preserves the delay-free feedback loops of the original analog circuitry, resulting in a much more responsive and natural-sounding sweep compared to standard digital biquads.29

### **The WebAssembly (WASM) AudioWorklet Pipeline**

To maintain professional performance levels and prevent "audio pops" caused by main-thread interference (such as UI updates or mouse movements), the Faust DSP engine is compiled into WebAssembly and executed within an AudioWorkletProcessor. This architectural pattern ensures that the audio rendering occurs on a dedicated high-priority CPU thread.30  
The compilation pipeline for the Composite Synth is as follows:

1. **DSP Authoring:** The synth architecture is defined in a .dsp file, importing stdfaust.lib for access to the standard VA libraries.32  
2. **WASM Generation:** The @grame/faustwasm library compiles the Faust code into a WebAssembly module.33  
3. **Worklet Instantiation:** The browser loads the WASM module into the AudioWorkletGlobalScope via audioContext.audioWorklet.addModule().31  
4. **Buffer Management:** Because WASM operates on its own heap, the system manages a HeapAudioBuffer to efficiently clone audio data between the JavaScript memory and the WASM execution environment.35

This multi-threaded approach allows the system to handle 128-frame audio chunks (approximately 2.9ms at 44.1kHz) with extreme reliability. The use of SharedArrayBuffer for passing real-time modulation data between the MIDI manager and the audio worklet further minimizes latency, providing the tactile responsiveness expected of a hardware instrument.35

## **State Management and Persistence: The "Memory"**

A sophisticated synthesizer requires a robust memory system to store hardware configurations and user-designed sounds. The Arturia-JS Composite Synth utilizes IndexedDB, the browser's built-in transactional database, for this purpose.

### **IndexedDB Schema Design**

The database schema is designed to separate hardware-specific mapping data from the creative "patches" created by the user. This separation allows the same patch to be controlled by different physical hardware setups without data corruption.

#### **The hardware\_map Object Store**

This store defines the "Brain" or translation layer of the synth.

* **KeyPath:** control\_id (e.g., "BeatStep\_Encoder\_1").  
* **Indices:** cc\_number, midi\_channel.  
* **Stored Attributes:** target\_parameter\_path (the internal Faust path, e.g., /synth/filter/cutoff), mode (Relative/Absolute), sensitivity\_multiplier.

#### **The synth\_patches Object Store**

This store preserves the sonic state of the engine.

* **KeyPath:** patch\_id (auto-incrementing).  
* **Indices:** patch\_name, category.  
* **Stored Attributes:** parameter\_blob (a serialized JSON object containing the values of all virtual knobs), last\_modified\_timestamp.

When a pad on the BeatStep is pressed to select a patch, the system queries the synth\_patches store, retrieves the parameter blob, and iterates through the keys. Each value is sent to the AudioWorkletNode using the setParamValue method, which updates the DSP engine at the next audio block boundary.37

### **Soft Takeover and Value Scaling Algorithms**

When transitioning between patches or switching from mouse-based control to physical knobs, a mismatch often occurs between the hardware's position and the software's internal value. To prevent sudden, jarring jumps in parameters (such as volume or filter resonance), the system implements a **Soft Takeover** algorithm.39  
The fundamental logic for a "Hook" takeover involves a latching mechanism:

1. Upon loading a patch, the parameter is marked as "unlatched."  
2. Incoming MIDI CC values are compared to the internal software value.  
3. A "Security Threshold" (typically $\\pm 2$ MIDI units) is applied to account for sensor noise.42  
4. Only when the physical control "passes through" or meets the software value is the link established ("latched"), after which the software follows the hardware directly.

For a more advanced experience, the Composite Synth implements **Value Scaling**. This algorithm bridges the gap by scaling the hardware movement proportionally to the remaining distance the parameter can travel. The formula for the new software value $V\_{sw}$ given a hardware movement $\\Delta V\_{hw}$ is:

$$V\_{sw\\\_new} \= V\_{sw\\\_old} \+ \\Delta V\_{hw} \\times \\left( \\frac{V\_{sw\\\_target} \- V\_{sw\\\_old}}{V\_{hw\\\_target} \- V\_{hw\\\_old}} \\right)$$  
where the target values are the physical and logical maximums or minimums. This ensure that the software parameter moves in the correct direction immediately but "catches up" to the physical knob smoothly by the time it reaches its travel limit.21

## **Comprehensive MIDI and Protocol Data Charts**

To facilitate the implementation of the "translation layer," the following tables provide the necessary technical data for the Arturia hardware and web APIs.

### **Table 1: Arturia SysEx Identity and Manufacturer Data**

| Parameter | Identifier (Hex) | Description |
| :---- | :---- | :---- |
| Manufacturer Code | 00 20 6B | Arturia 2 |
| SysEx Identity Request | F0 7E 7F 06 01 F7 | Universal Inquiry |
| SysEx Identity Reply Header | F0 7E 00 06 02 | Universal Identity Response 1 |
| Product Family | 02 00 | Arturia Controllers 1 |
| Identity Request Timeout | 1000ms | Recommended wait time for reply 7 |

### **Table 2: BeatStep endless Encoder Behavior (Relative 1 Mode)**

| Physical Action | Direction | MIDI Byte | Increment/Decrement |
| :---- | :---- | :---- | :---- |
| Clockwise (Slow) | Up | 65 (0x41) | \+1 24 |
| Clockwise (Fast) | Up | 68 (0x44) | \+3 24 |
| Counter-Clockwise (Slow) | Down | 63 (0x3F) | \-1 24 |
| Counter-Clockwise (Fast) | Down | 60 (0x3C) | \-3 24 |
| Static | Neutral | 64 (0x40) | No Change 24 |

### **Table 3: KeyStep Performance and Expressive Controller Defaults**

| Control | MIDI Message Type | Default Identifier | Range/Function |
| :---- | :---- | :---- | :---- |
| Keyboard | Note On/Off | Status 8n/9n | 0-127 20 |
| Pitch Strip | Pitch Bend | Status En | 14-bit (0-16383) 20 |
| Mod Strip | Control Change | CC 1 | 7-bit (0-127) 19 |
| Aftertouch | Channel Pressure | Status Dn | 0-127 20 |
| Play Button | Real-Time | 0xFA | Start/Reset 12 |
| Stop Button | Real-Time | 0xFC | Stop/Pause 12 |

## **Web Environment Security and context Constraints**

Deploying the Arturia-JS Composite Synth requires adherence to modern browser security standards. Access to hardware-level MIDI communication and high-resolution multi-threading is restricted to ensure user privacy and system stability.

### **Secure Context and HTTPS Requirements**

The Web MIDI API and the AudioWorklet system are only accessible within a "Secure Context." This mandates that the application must be served over https:// or wss://.46 During local development, environments served via localhost or 127.0.0.1 are automatically considered secure.49  
Furthermore, the use of SharedArrayBuffer for low-latency communication between the MIDI manager and the audio thread requires the implementation of Cross-Origin Opener Policy (COOP) and Cross-Origin Embedder Policy (COEP) headers. Without these headers, browsers will disable the ability to share memory between threads, severely impacting the performance of the soft takeover and modulation scaling algorithms.35

### **MIDI Access Permissions (Chrome 124+ and Firefox 108+)**

As of Chrome 124, all MIDI access—not just SysEx communication—is gated behind an explicit user permission prompt.46 The application must implement a "Start Synth" or "Connect Controllers" button that initiates the navigator.requestMIDIAccess({ sysex: true }) call in response to a user gesture. This satisfy the browser’s "Transient Activation" requirement, allowing the application to begin polling the KeyStep and BeatStep for their identity fingerprints.

## **Calibration and Onboarding Flow**

The first-run experience of the Composite Synth is built around a calibration workflow that simultaneously solves three problems: browser permission acquisition, hardware identification, and encoder characterization.

### **Step-by-Step Calibration Sequence**

1. **Welcome Screen:** The user is presented with a "Connect Controllers" button. This satisfies Chrome 124+’s Transient Activation requirement, triggering `navigator.requestMIDIAccess({ sysex: true })` on click.
2. **Device Discovery:** Upon permission grant, the system broadcasts the SysEx Identity Request ($F0\ 7E\ 7F\ 06\ 01\ F7$) to all connected MIDI outputs and listens for Identity Reply messages within a 1000ms timeout window.
3. **Sequential Device Identification:** The user is prompted: *"Turn any knob on your first device."* The system listens for incoming CC messages and correlates the source MIDI port with the SysEx identity already received. This physically confirms which device the user is touching.
4. **Encoder Characterization:** While the user turns the knob, the system records a short burst of CC values to determine:
   - The actual acceleration curve (mapping slow/fast rotation to CC value offsets)
   - The effective deadzone width (values around 64 in Relative 1 mode)
   - Any firmware-specific quirks in the value range
5. **Repeat for Second Device:** The user is prompted to interact with the second controller. The system assigns roles automatically: KeyStep → Performer, BeatStep → Control Plane (based on SysEx model ID).
6. **Calibration Persistence:** The full calibration profile — device fingerprints, port associations, encoder characteristics, and role assignments — is stored in the `hardware_map` IndexedDB object store. On subsequent launches, the system verifies the stored fingerprint against connected hardware and skips calibration if the match is confirmed.

### **Re-Calibration Triggers**

The system automatically re-enters calibration if:
- A new, unrecognized MIDI device is detected.
- A stored device fingerprint does not match the SysEx identity on its expected port.
- The user manually triggers re-calibration from the hidden configuration menu.

## **Clock Architecture and Timing Strategy**

Perceptually flawless timing is a non-negotiable requirement. The user must feel zero lag between pressing a key and hearing sound, and zero jitter in sequenced patterns. The architecture places the browser as the master clock source, with the AudioWorklet thread as the authoritative timekeeper.

### **AudioWorklet as Master Clock**

The AudioWorklet `process()` method runs on a dedicated, real-time-priority OS thread, processing audio in 128-sample render quanta (~2.67ms at 48kHz). This makes it the most temporally stable scheduling source available in a browser — far superior to main-thread timers which suffer 4–16ms jitter from garbage collection, layout, and tab throttling.

The clock generation follows a **lookahead scheduling** pattern:

1. **Sample-accurate tick counting:** Inside the AudioWorklet, a sample counter accumulates per render quantum. When `samplesPerTick` is reached (calculated from BPM and 24 PPQN), a clock event is emitted.
2. **MessagePort relay:** The tick event is posted to the main thread via `port.postMessage()` with a precise AudioContext timestamp.
3. **Timestamped MIDI output:** The main thread calls `midiOutput.send([0xF8], timestamp)` using the Web MIDI API’s DOMHighResTimeStamp parameter. This offloads final timing to the OS MIDI driver layer (CoreMIDI on macOS: <1ms precision).
4. **Lookahead buffer:** Ticks are scheduled 5–20ms ahead of their target time, ensuring that even brief main-thread stalls (GC pauses) do not cause late delivery.

$$samplesPerTick = \frac{sampleRate \times 60}{BPM \times 24}$$

### **Hardware Clock Configuration**

Both the KeyStep and BeatStep must be configured for external USB clock via the Arturia MIDI Control Center (MCC):

| Device | MCC Setting | Value | Effect |
| :---- | :---- | :---- | :---- |
| KeyStep | Transport Input | USB | Sequencer/arpeggiator follows browser clock |
| KeyStep | Clock Out | Off (or USB) | Prevents clock feedback loops |
| BeatStep | Sync Source | USB | Internal rate encoder deactivated |

When configured for USB sync, the KeyStep’s Tempo knob and the BeatStep’s Rate encoder become inactive — tempo is governed entirely by the browser’s AudioWorklet clock. Transport messages (Start $FA$, Stop $FC$, Continue $FB$) are sent alongside clock pulses to control sequencer playback state.

### **SharedArrayBuffer Optimization (Optional)**

For tighter coupling between the AudioWorklet and MIDI output, the system can use a SharedArrayBuffer ring buffer instead of MessagePort. This avoids the ~1–5ms MessagePort latency but requires Cross-Origin Isolation headers (COOP/COEP). This is enabled by default when headers are present and falls back to MessagePort otherwise.

### **Jitter Characteristics**

| Source | Typical Jitter | Mitigation |
| :---- | :---- | :---- |
| AudioWorklet render quantum | ±2.67ms (at 48kHz, 128 samples) | Sample counting within the worklet is exact |
| MessagePort (worklet → main) | 1–5ms | Compensated by lookahead scheduling |
| Web MIDI send() with timestamp | <1ms (macOS CoreMIDI) | OS driver handles final delivery |
| **End-to-end** | **<1ms perceived** | Lookahead + OS timestamp = hardware-grade timing |

## **Polyphony Strategy**

### **Fixed Allocation with Active Voice Limit**

The Faust WASM polyphony system allocates a fixed number of voice instances at AudioWorklet node creation time. Changing the voice count requires destroying and recreating the node, which causes an audible gap. To avoid this:

- **8 voices are allocated at startup** as the default maximum. This provides headroom for rich chords while remaining performant on modern hardware.
- **A BeatStep encoder (Encoder 16) controls the active voice limit** (1–8 range). Voices above the limit are not triggered on new note-on events but existing sustained notes continue their release envelope naturally.
- **Voice allocation uses oldest-note-stealing:** when all active voices are occupied, the oldest voice is reassigned to the new note.

### **Faust Polyphony Architecture**

The DSP is authored using the `freq`/`gain`/`gate` convention. The Faust architecture automatically maps MIDI note events to voices:

- `freq` ← MIDI note number via $440 \times 2^{(note - 69) / 12}$
- `gain` ← MIDI velocity, normalized to $0.0 ... 1.0$
- `gate` ← $1$ on note-on, $0$ on note-off (triggers envelope)

The `effect` keyword defines a post-mix DSP block that runs once on the summed output of all voices, keeping effect processing cost constant regardless of voice count.

```faust
declare nvoices "8";

import("stdfaust.lib");

freq = hslider("freq", 440, 20, 20000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");

// Per-voice: oscillator → filter → envelope
process = os.sawtooth(freq) * gain * en.adsr(0.01, 0.1, 0.7, 0.3, gate) <: _,_;

// Post-mix: effects chain (runs once)
effect = dm.zita_light;
```

### **Performance Budget**

At 48kHz with 128-sample render quanta, the AudioWorklet has ~2.67ms per block. Approximate per-voice costs:

| Component | Relative Cost | Notes |
| :---- | :---- | :---- |
| PolyBLEP oscillator (sawNp) | Low | Efficient polynomial computation |
| Moog ladder filter (ve.moogLadder) | Medium | 4th-order with nonlinear feedback |
| ADSR envelope | Negligible | Simple state machine |
| **Total per voice** | **~0.15–0.3ms** | 8 voices ≈ 1.2–2.4ms of the 2.67ms budget |
| Effect chain (post-mix) | ~0.3–0.5ms | Fixed cost, independent of voice count |

This leaves headroom for the effects chain and system overhead. The hidden configuration menu allows users with lower-powered devices to reduce the maximum voice allocation (e.g., to 4) or increase the buffer size (256 or 512 samples).

### **Custom Voice Count Override**

The hidden configuration menu exposes a "Max Voices" setting (1–16). Changing this value requires destroying and recreating the Faust AudioWorklet node, which introduces a brief audio gap. Two strategies are available:

- **Option B (default):** Allocate the maximum at startup and limit active voices via the BeatStep encoder. No node recreation needed during performance.
- **Option C (alternative):** Defer node recreation to the next natural transport stop. The system waits for the user to press Stop, recreates the node with the new voice count, and restores all parameter state seamlessly.

The choice between these strategies may evolve as real-world performance characteristics are tested. The current parameter state and patch are always preserved across recreation.

## **Effects Chain Architecture**

All effects are implemented in Faust as the post-mix `effect` block, ensuring they run once on the combined voice output. Every effect parameter is mapped to a BeatStep encoder for first-class hardware control.

### **Signal Flow**

$$Voices_{sum} \rightarrow Overdrive \rightarrow Chorus \rightarrow Delay \rightarrow Reverb \rightarrow Master\ Volume \rightarrow Output$$

Overdrive is placed first in the chain to allow the filter and distortion interaction that defines analog synth character. Chorus follows to thicken the signal before time-based effects. Delay precedes reverb so that echoes are spatialized naturally.

### **Effect Implementations**

#### **Overdrive / Saturation**

Uses Faust’s cubic nonlinearity for soft-clipping distortion:

```faust
ef.cubicnl(drive, offset)
```

- `drive` ($0.0 ... 1.0$) — distortion intensity, mapped from BeatStep Encoder 15
- `offset` — fixed at $0$ for symmetric clipping (odd harmonics only)

Produces warm, tube-like saturation at low drive values and aggressive distortion when pushed. A post-distortion tone filter (single-pole low-pass) tames harsh high-frequency content.

#### **Chorus / Ensemble**

Built from modulated fractional delay lines:

```faust
chorus(rate, depth) = _ <: de.fdelay(4096, mod1), de.fdelay(4096, mod2) :> _
with {
    mod1 = 512 + depth * os.osc(rate);
    mod2 = 512 + depth * os.osc(rate * 1.07);
};
```

- `rate` ($0.1 ... 10$ Hz) — LFO speed, mapped from BeatStep Encoder 13
- `depth` ($0 ... 512$ samples) — modulation depth, mapped from BeatStep Encoder 14

The two delay lines use slightly detuned LFO rates (ratio $1.07$) to create a wider, more organic stereo image.

#### **Delay**

Tempo-synchronized echo using the master clock BPM:

```faust
ef.echo(maxDuration, duration, feedback)
```

- `duration` — derived from BPM and a note division selector: $duration = \frac{60}{BPM} \times \frac{4}{division}$
- `feedback` ($0.0 ... 0.95$) — echo decay, mapped from BeatStep Encoder 10
- BeatStep Encoder 9 controls delay time (via note division: 1/4, 1/8, dotted 1/8, 1/16, triplet, etc.)

Maximum delay buffer is set to 2 seconds, accommodating tempos down to ~30 BPM at whole-note divisions.

#### **Reverb**

Full-featured algorithmic reverb based on Fons Adriaensen’s zita-rev1:

```faust
re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, fsmax)
```

- `rdel` — pre-delay (~60ms default)
- `t60m` — mid-frequency decay time, mapped from BeatStep Encoder 11 ($0.5 ... 8.0$ seconds)
- Dry/wet mix mapped from BeatStep Encoder 12 ($0.0 ... 1.0$)
- `f1` ($200$ Hz), `f2` ($6000$ Hz), `t60dc` ($3.0$ s), `fsmax` ($48000$) — fixed defaults, adjustable via hidden config

### **BeatStep Encoder Layout (Default Page)**

| Encoder | Parameter | Range | Effect/Section |
| :---- | :---- | :---- | :---- |
| 1 | Oscillator waveform | Saw / Square / Pulse / Tri | Oscillator |
| 2 | Oscillator detune | $-1 ... +1$ semitone | Oscillator |
| 3 | Filter cutoff | $20 ... 20000$ Hz (log) | Filter |
| 4 | Filter resonance | $0.0 ... 1.0$ | Filter |
| 5 | Filter envelope amount | $-1.0 ... 1.0$ | Filter |
| 6 | Amp envelope attack | $1 ... 5000$ ms (log) | Envelope |
| 7 | Amp envelope decay/sustain | $0 ... 5000$ ms / $0 ... 1.0$ | Envelope |
| 8 | Amp envelope release | $1 ... 5000$ ms (log) | Envelope |
| 9 | Delay time (note division) | 1/4, 1/8, 1/8d, 1/16, 1/16t | Delay |
| 10 | Delay feedback | $0.0 ... 0.95$ | Delay |
| 11 | Reverb decay | $0.5 ... 8.0$ s | Reverb |
| 12 | Reverb dry/wet | $0.0 ... 1.0$ | Reverb |
| 13 | Chorus rate | $0.1 ... 10$ Hz | Chorus |
| 14 | Chorus depth | $0.0 ... 1.0$ | Chorus |
| 15 | Overdrive | $0.0 ... 1.0$ | Distortion |
| 16 | Active voice limit | $1 ... 8$ | System |

This is the initial single-page layout. Future iterations may introduce multi-page switching via BeatStep pads, allowing 16 encoders per page for deeper parameter access.

### **BeatStep Pad Layout**

| Pads | Mode | Function |
| :---- | :---- | :---- |
| 1–8 (top row) | Program Change | Patch selection from IndexedDB library |
| 9–16 (bottom row) | Note Mode | Percussive triggers / sample playback |

Pad LEDs provide visual feedback: active sequencer steps illuminate on note-mode pads, and the currently selected patch lights up on the preset row.

## **Hidden Configuration Menu**

A keyboard/mouse-accessible settings panel provides "second-class" controls for system-level parameters that do not require real-time hardware manipulation. These settings are persisted in IndexedDB alongside the hardware calibration data.

| Setting | Options | Default | Notes |
| :---- | :---- | :---- | :---- |
| Sample Rate | 44100 / 48000 Hz | 48000 | Lower for reduced CPU load |
| Buffer Size | 128 / 256 / 512 samples | 128 | Higher for stability on slower devices |
| Max Voice Allocation | 1–16 | 8 | Requires node recreation on change |
| Reverb crossover freq (f1) | 100–500 Hz | 200 | Advanced reverb tuning |
| Reverb high freq (f2) | 2000–10000 Hz | 6000 | Advanced reverb tuning |
| Re-Calibrate Hardware | Button | — | Re-enters calibration flow |
| MIDI Channel (KeyStep) | 1–16 | 1 | Must match MCC configuration |
| MIDI Channel (BeatStep) | 1–16 | 1 | Must match MCC configuration |

## **Conclusion and Strategic Roadmap**

The technical architecture of the Arturia-JS Composite Synth leverages the high-resolution tactile feedback of Arturia’s hardware to create a unique browser-based instrument. By implementing a calibration-first onboarding flow, the system simultaneously solves browser permission requirements, hardware identification, and encoder characterization in a single intuitive interaction.

The AudioWorklet-driven master clock provides hardware-grade timing precision (<1ms perceived jitter) through lookahead scheduling and OS-level MIDI timestamping. The fixed-allocation polyphony model (8 voices default, BeatStep-adjustable active limit) balances performance with musical flexibility, while the hidden configuration menu accommodates devices with varying processing capabilities.

The effects chain — overdrive, chorus, delay, and reverb — runs as a single post-mix Faust `effect` block, keeping CPU cost constant regardless of voice count. Every audible parameter is mapped to a BeatStep encoder for first-class hardware control, reinforcing the design philosophy that this is a hardware instrument that happens to run in a browser, not a software synth with optional MIDI support.

The use of Faust for virtual analog modeling provides the "soul" of the instrument, offering harmonic richness and resonant growl through TPT filter topologies and PolyBLEP oscillators. By wrapping this engine in a WASM-based AudioWorklet, the system achieves the low-latency, glitch-free performance required for professional music production. The integration of a persistent IndexedDB state manager and a sophisticated value-scaling soft takeover algorithm bridges the gap between digital software and physical control, providing a seamless tactile experience.

The BeatStep sequencer integration remains an open design question for future exploration. This specification serves as the definitive guide for the initial implementation milestone.

#### **Works cited**

1. mhugo/sysex: SYSEX documentation for some MIDI controllers \- GitHub, accessed March 23, 2026, [https://github.com/mhugo/sysex](https://github.com/mhugo/sysex)  
2. MIDI message (sysex?) to indicate version information of device \- Music Stack Exchange, accessed March 23, 2026, [https://music.stackexchange.com/questions/93895/midi-message-sysex-to-indicate-version-information-of-device](https://music.stackexchange.com/questions/93895/midi-message-sysex-to-indicate-version-information-of-device)  
3. BlackBox UG EN01 V1 | PDF | Sound Technology | Computer Engineering \- Scribd, accessed March 23, 2026, [https://www.scribd.com/document/911211503/BlackBox-UG-EN01-V1-1](https://www.scribd.com/document/911211503/BlackBox-UG-EN01-V1-1)  
4. MIDI Manufacturers ID numbers \- StudioCode.dev, accessed March 23, 2026, [https://studiocode.dev/doc/midi-manufacturers/](https://studiocode.dev/doc/midi-manufacturers/)  
5. midi\_control::vendor::arturia \- Rust \- Docs.rs, accessed March 23, 2026, [https://docs.rs/midi-control/latest/midi\_control/vendor/arturia/index.html](https://docs.rs/midi-control/latest/midi_control/vendor/arturia/index.html)  
6. SysEx Identity Reply: is the manufacturer ID one byte only? \- MIDI.org, accessed March 23, 2026, [https://midi.org/community/midi-specifications/sysex-identity-reply-is-the-manufacturer-id-one-byte-only](https://midi.org/community/midi-specifications/sysex-identity-reply-is-the-manufacturer-id-one-byte-only)  
7. Taming Arturia's Beatstep: Sysex codes for programming via iPad \- untergeek, accessed March 23, 2026, [https://www.untergeek.de/2014/11/taming-arturias-beatstep-sysex-codes-for-programming-via-ipad/](https://www.untergeek.de/2014/11/taming-arturias-beatstep-sysex-codes-for-programming-via-ipad/)  
8. Is the Web MIDI API Port ID unique to each device or the device in general? \- Stack Overflow, accessed March 23, 2026, [https://stackoverflow.com/questions/72592872/is-the-web-midi-api-port-id-unique-to-each-device-or-the-device-in-general](https://stackoverflow.com/questions/72592872/is-the-web-midi-api-port-id-unique-to-each-device-or-the-device-in-general)  
9. How to distinguish among multiple identical MIDI devices \- Gig Performer®, accessed March 23, 2026, [https://gigperformer.com/how-to-distinguish-among-multiple-identical-midi-devices](https://gigperformer.com/how-to-distinguish-among-multiple-identical-midi-devices)  
10. How to deal with multiple identical MIDI USB devices \- Stack Overflow, accessed March 23, 2026, [https://stackoverflow.com/questions/27173703/how-to-deal-with-multiple-identical-midi-usb-devices](https://stackoverflow.com/questions/27173703/how-to-deal-with-multiple-identical-midi-usb-devices)  
11. How to distinguish between multiple identical MIDI devices? – MIDI Hardware – MIDI.org Forum, accessed March 23, 2026, [https://midi.org/community/midi-hardware/how-to-distinguish-between-multiple-identical-midi-devices](https://midi.org/community/midi-hardware/how-to-distinguish-between-multiple-identical-midi-devices)  
12. Start/Stop buttons always send MMC Start/Stop... even when set to Off \- Arturia Forums, accessed March 23, 2026, [https://legacy-forum.arturia.com/index.php?topic=84621.0](https://legacy-forum.arturia.com/index.php?topic=84621.0)  
13. MIDI Transport Controls, accessed March 23, 2026, [https://www.pika.blue/posts/tenori-on/transport/](https://www.pika.blue/posts/tenori-on/transport/)  
14. New Keystep, MIDI Control Centre Turn Off Transport Controls Does not Work, accessed March 23, 2026, [https://legacy-forum.arturia.com/index.php?topic=95475.0](https://legacy-forum.arturia.com/index.php?topic=95475.0)  
15. Transport behaviour in MIDI sync mode \- Arturia Forums, accessed March 23, 2026, [https://legacy-forum.arturia.com/index.php?topic=89617.0](https://legacy-forum.arturia.com/index.php?topic=89617.0)  
16. Arturia Keystep 37 start stop "problem" with external midi synthesizer \- Reddit, accessed March 23, 2026, [https://www.reddit.com/r/synthesizers/comments/1nyv6y8/arturia\_keystep\_37\_start\_stop\_problem\_with/](https://www.reddit.com/r/synthesizers/comments/1nyv6y8/arturia_keystep_37_start_stop_problem_with/)  
17. Disable Transport on Keystep 37? : r/synthesizers \- Reddit, accessed March 23, 2026, [https://www.reddit.com/r/synthesizers/comments/uybcud/disable\_transport\_on\_keystep\_37/](https://www.reddit.com/r/synthesizers/comments/uybcud/disable_transport_on_keystep_37/)  
18. Arturia KeyStep 32: Arpeggiator, transport, and velocity all broken? Or am I missing something? : r/Arturia\_users \- Reddit, accessed March 23, 2026, [https://www.reddit.com/r/Arturia\_users/comments/1ki23j2/arturia\_keystep\_32\_arpeggiator\_transport\_and/](https://www.reddit.com/r/Arturia_users/comments/1ki23j2/arturia_keystep_32_arpeggiator_transport_and/)  
19. Pitch and Mod Strip Settings \- Arturia, accessed March 23, 2026, [https://legacy-forum.arturia.com/index.php?topic=106799.0](https://legacy-forum.arturia.com/index.php?topic=106799.0)  
20. How can I assign the Aftertouch to the same CC/CV as the mod strip? \- Arturia users forum, accessed March 23, 2026, [https://forum.arturia.com/t/how-can-i-assign-the-aftertouch-to-the-same-cc-cv-as-the-mod-strip/1304](https://forum.arturia.com/t/how-can-i-assign-the-aftertouch-to-the-same-cc-cv-as-the-mod-strip/1304)  
21. Whats the best way to scale midi to large numbers? : r/MaxMSP \- Reddit, accessed March 23, 2026, [https://www.reddit.com/r/MaxMSP/comments/7k1b7d/whats\_the\_best\_way\_to\_scale\_midi\_to\_large\_numbers/](https://www.reddit.com/r/MaxMSP/comments/7k1b7d/whats_the_best_way_to_scale_midi_to_large_numbers/)  
22. MIDI 2.0 Proxy Value Scaling \- Bome Forum, accessed March 23, 2026, [https://forum.bome.com/t/midi-2-0-proxy-value-scaling/7611](https://forum.bome.com/t/midi-2-0-proxy-value-scaling/7611)  
23. KeyStep Pro \- Keyboard & Peripherals \- Arturia FAQ, accessed March 23, 2026, [https://support.arturia.com/hc/en-us/articles/4405741087634-KeyStep-Pro-Keyboard-Peripherals](https://support.arturia.com/hc/en-us/articles/4405741087634-KeyStep-Pro-Keyboard-Peripherals)  
24. Endless Rotary Encoders – Questions about UNIFY \- PlugInGuru Forums, accessed March 23, 2026, [https://forums.pluginguru.com/questions-about-unify-v1-0/endless-rotary-encoders/](https://forums.pluginguru.com/questions-about-unify-v1-0/endless-rotary-encoders/)  
25. Knob encoder acceleration setting \- Arturia, accessed March 23, 2026, [https://legacy-forum.arturia.com/index.php?topic=82122.60](https://legacy-forum.arturia.com/index.php?topic=82122.60)  
26. Arturia Beatstep and endless encoders \- Forum \- FL Studio, accessed March 23, 2026, [https://forum.image-line.com/viewtopic.php?t=173461](https://forum.image-line.com/viewtopic.php?t=173461)  
27. oscillators \- Faust Libraries \- Grame, accessed March 23, 2026, [https://faustlibraries.grame.fr/libs/oscillators/](https://faustlibraries.grame.fr/libs/oscillators/)  
28. faustlibraries/vaeffects.lib at master \- GitHub, accessed March 23, 2026, [https://github.com/grame-cncm/faustlibraries/blob/master/vaeffects.lib](https://github.com/grame-cncm/faustlibraries/blob/master/vaeffects.lib)  
29. vaeffects \- Faust Libraries \- Grame, accessed March 23, 2026, [https://faustlibraries.grame.fr/libs/vaeffects/](https://faustlibraries.grame.fr/libs/vaeffects/)  
30. Wasm Audio Worklets API — Emscripten 5.0.4-git (dev) documentation, accessed March 23, 2026, [https://emscripten.org/docs/api\_reference/wasm\_audio\_worklets.html](https://emscripten.org/docs/api_reference/wasm_audio_worklets.html)  
31. Background audio processing using AudioWorklet \- Web APIs | MDN \- Mozilla, accessed March 23, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/Web\_Audio\_API/Using\_AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet)  
32. Faust Libraries, accessed March 23, 2026, [https://faustlibraries.grame.fr/](https://faustlibraries.grame.fr/)  
33. grame-cncm/faustwasm: Faust for WebAudio written in TypeScript \- GitHub, accessed March 23, 2026, [https://github.com/grame-cncm/faustwasm](https://github.com/grame-cncm/faustwasm)  
34. AudioWorkletNode \- Web APIs | MDN, accessed March 23, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode)  
35. Audio worklet design pattern | Blog \- Chrome for Developers, accessed March 23, 2026, [https://developer.chrome.com/blog/audio-worklet-design-pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)  
36. tomduncalf/emscripten-audio-worklet-example \- GitHub, accessed March 23, 2026, [https://github.com/tomduncalf/emscripten-audio-worklet-example](https://github.com/tomduncalf/emscripten-audio-worklet-example)  
37. faust-webaudio-wasm.js \- gists · GitHub, accessed March 23, 2026, [https://gist.github.com/nuchi/3c02892cfe755daf692cc3f29881a0d4](https://gist.github.com/nuchi/3c02892cfe755daf692cc3f29881a0d4)  
38. Automation and MIDI Control \- Native Instruments, accessed March 23, 2026, [https://www.native-instruments.com/ni-tech-manuals/komplete-kontrol-manual/en/automation-and-midi-control](https://www.native-instruments.com/ni-tech-manuals/komplete-kontrol-manual/en/automation-and-midi-control)  
39. Review & Video: Pioneer DDJ-SX Serato DJ Controller \- Digital DJ Tips, accessed March 23, 2026, [https://www.digitaldjtips.com/pioneer-ddj-sx-serato-dj-controller-review/](https://www.digitaldjtips.com/pioneer-ddj-sx-serato-dj-controller-review/)  
40. Mixxx User Manual \- Mirror, accessed March 23, 2026, [https://mirror.clarkson.edu/gentoo/distfiles/f0/mixxx-manual-2.3-it.pdf](https://mirror.clarkson.edu/gentoo/distfiles/f0/mixxx-manual-2.3-it.pdf)  
41. Remote Knobs to support Soft Takeover \- Ideas / Feature requests \- Electra One Community, accessed March 23, 2026, [https://forum.electra.one/t/remote-knobs-to-support-soft-takeover/3954](https://forum.electra.one/t/remote-knobs-to-support-soft-takeover/3954)  
42. The New MIDI Remote is \- Page 6 \- Cubase \- Steinberg Forums, accessed March 23, 2026, [https://forums.steinberg.net/t/the-new-midi-remote-is/769749?page=6](https://forums.steinberg.net/t/the-new-midi-remote-is/769749?page=6)  
43. midi: soft takeover \- Page 3 \- Forum \- FL Studio, accessed March 23, 2026, [https://forum.image-line.com/viewtopic.php?t=91077\&start=50](https://forum.image-line.com/viewtopic.php?t=91077&start=50)  
44. midi: soft takeover \- Image-Line Forums \- FL Studio, accessed March 23, 2026, [https://forum.image-line.com/viewtopic.php?t=91077](https://forum.image-line.com/viewtopic.php?t=91077)  
45. MIDI Remote, Relative value mode \- Cubase \- Steinberg Forums, accessed March 23, 2026, [https://forums.steinberg.net/t/midi-remote-relative-value-mode/772139](https://forums.steinberg.net/t/midi-remote-relative-value-mode/772139)  
46. Access to MIDI devices now requires user permission | Blog \- Chrome for Developers, accessed March 23, 2026, [https://developer.chrome.com/blog/web-midi-permission-prompt](https://developer.chrome.com/blog/web-midi-permission-prompt)  
47. Web MIDI API \- MDN Web Docs, accessed March 23, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/Web\_MIDI\_API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)  
48. Navigator: requestMIDIAccess() method \- Web APIs | MDN, accessed March 23, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess)  
49. Web MIDI API Test \- WebAPI check, accessed March 23, 2026, [https://webapicheck.vercel.app/apis/web-midi-api](https://webapicheck.vercel.app/apis/web-midi-api)