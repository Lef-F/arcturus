// Arcturus — Virtual Analog Voice DSP
// 8-voice polyphonic subtractive synthesizer.
// Signal flow: OSC A+B → Noise blend → Wavefolder → HPF → Filter → Amp Envelope
//
// See docs/SOUND_ENGINE.md for full parameter reference.
declare nvoices "8";

import("stdfaust.lib");

// ── Voice control (set per-voice by the polyphonic runtime) ──
freq = hslider("freq[unit:Hz]", 440, 20, 20000, 0.1);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");

// ── OSC module ──
wave_sel        = hslider("waveform",              0,    0,    4,    1)   : int; // SAW/SQR/TRI/SIN/SUPER
octave          = hslider("octave",                0,   -2,    2,    1)   : int;
detune          = hslider("detune[unit:cents]",    0, -100,  100,    0.1);
pulse_width     = hslider("pulse_width",           0.5,  0.05, 0.95,  0.01);
noise_level     = hslider("noise_level",           0,    0,    1,    0.01);
noise_color     = hslider("noise_color",           0,    0,    1,    1)   : int; // 0=white, 1=pink
oscb_level      = hslider("oscb_level",            0,    0,    1,    0.01);
oscb_pitch      = hslider("oscb_pitch",            0,  -24,   24,    1);
oscb_fine       = hslider("oscb_fine[unit:cents]", 0,  -50,   50,    0.1);
oscb_wave       = hslider("oscb_wave",             0,    0,    3,    1)   : int; // SAW/SQR/TRI/SIN
supersaw_detune = hslider("supersaw_detune",       0,    0,    1,    0.001);
supersaw_mix    = hslider("supersaw_mix",          0.5,  0,    1,    0.001);
// Hard sync: OscB phase resets OscA on each OscB cycle wrap
osc_sync        = hslider("osc_sync",              0,    0,    1,    1)   : int;
// Buchla-style wavefolder: 0=dry, 1=fully folded (harmonic enrichment)
timbre          = hslider("timbre",                0,    0,    1,    0.01);

// ── Filter module ──
cutoff      = hslider("cutoff[unit:Hz][scale:log]", 8000, 20, 20000, 0.1);
resonance   = hslider("resonance",    0.5,  0,   1,   0.01);
fenv_amount = hslider("fenv_amount",  0.5, -1,   1,   0.01);
filter_mode = hslider("filter_mode",  0,    0,   1,   0.001); // 0=LP(Moog), 0.5=Notch, 1=HP
// Keyboard filter tracking: 0=none, 0.5=half, 1=full (C3=261.63Hz neutral)
key_track   = hslider("key_track",    0,    0,   1,   0.01);
// Velocity → filter cutoff: 1.0 = up to +2 octaves at max velocity
vel_to_cutoff = hslider("vel_to_cutoff", 0, 0, 1, 0.01);
// Passive HPF (Juno-106 style): 0=off~1Hz, 1=18Hz, 2=59Hz, 3=185Hz
hpf_cutoff  = hslider("hpf_cutoff",   0,    0,   3,   1)    : int;

// ── Filter Envelope module ──
f_attack  = hslider("f_attack[unit:s]",  0.01, 0.001, 5, 0.001);
f_decay   = hslider("f_decay[unit:s]",   0.30, 0.001, 5, 0.001);
f_sustain = hslider("f_sustain",         0.50, 0,     1, 0.01);
f_release = hslider("f_release[unit:s]", 0.50, 0.001, 5, 0.001);
// ADS mode (Oberheim SEM): Decay = Release; 0=ADSR, 1=ADS
fenv_mode = hslider("fenv_mode",         0,    0,     1, 1) : int;

// ── Amp Envelope module ──
attack  = hslider("attack[unit:s]",  0.01, 0.001, 5, 0.001);
decay   = hslider("decay[unit:s]",   0.30, 0.001, 5, 0.001);
sustain = hslider("sustain",         0.70, 0,     1, 0.01);
release = hslider("release[unit:s]", 0.50, 0.001, 5, 0.001);
// ADS mode (Oberheim SEM): Decay = Release; 0=ADSR, 1=ADS
aenv_mode = hslider("aenv_mode",     0,    0,     1, 1) : int;
// Velocity → amplitude: 0=ignore velocity, 1=full velocity sensitivity
vel_to_amp = hslider("vel_to_amp",   0,    0,     1, 0.01);

// ── LFO module ──
lfo_rate      = hslider("lfo_rate[unit:Hz]",  1,    0.01, 20, 0.01);
lfo_depth     = hslider("lfo_depth",          0,    0,    1,  0.01);
lfo_shape     = hslider("lfo_shape",          0,    0,    4,  1)    : int; // SIN/TRI/SAW/SQR/S&H
lfo_delay     = hslider("lfo_delay[unit:s]",  0,    0,    3,  0.01);
lfo_to_pitch  = hslider("lfo_to_pitch",       0,    0,    1,  0.01);
lfo_to_filter = hslider("lfo_to_filter",      0,    0,    1,  0.01);
lfo_to_pw     = hslider("lfo_to_pw",          0,    0,    1,  0.01); // LFO → PWM depth
lfo_to_amp    = hslider("lfo_to_amp",         0,    0,    1,  0.01); // LFO → Amplitude (tremolo)

// ── Mod module ──
transpose       = hslider("transpose",       0, -24, 24, 1) : int;
glide           = hslider("glide[unit:s]",   0.001, 0.001, 3, 0.001); // portamento time
// Poly Mod (Prophet-5 style): routes filter envelope and Osc B to Osc A pitch/PW and filter
poly_fenv_freq  = hslider("poly_fenv_freq",  0,  0,  1,  0.01); // FEnv → Osc A pitch FM
poly_fenv_pw    = hslider("poly_fenv_pw",    0,  0,  1,  0.01); // FEnv → Osc A pulse width
poly_oscb_freq  = hslider("poly_oscb_freq",  0, -1,  1,  0.01); // Osc B → Osc A pitch FM (bipolar)
poly_oscb_pw    = hslider("poly_oscb_pw",    0,  0,  1,  0.01); // Osc B → Osc A pulse width
poly_oscb_filt  = hslider("poly_oscb_filt",  0, -1,  1,  0.01); // Osc B → filter cutoff FM (bipolar)

// ── GLOB module ──
// Vintage drift: per-voice independent slow noise on pitch and filter.
// Each polyphonic Faust instance has its own noise generator state, so voices
// diverge organically — no shared state.
vintage = hslider("vintage", 0, 0, 1, 0.01);

// ──────────────────────────────────────────────────────────────────────────────
// LFO
// ──────────────────────────────────────────────────────────────────────────────

lfoPhase = os.phasor(1.0, lfo_rate);

lfoSin = os.oscsin(lfo_rate);
lfoTri = os.triangle(lfo_rate);
lfoSaw = os.sawtooth(lfo_rate);
lfoSqr = 2.0 * (lfoPhase < 0.5) - 1.0;
shTrig = lfoPhase < lfoPhase';
lfoSH  = ba.sAndH(shTrig, no.noise);

lfoRaw = (lfoSin, lfoTri, lfoSaw, lfoSqr, lfoSH) : ba.selectn(5, lfo_shape);

lfoFadeIn = en.adsr(max(lfo_delay, 0.001), 0.001, 1.0, 0.001, gate);
lfoGate   = select2(lfo_delay < 0.01, lfoFadeIn, 1.0);

lfoSignal = lfoRaw * lfo_depth * lfoGate;

// ──────────────────────────────────────────────────────────────────────────────
// Vintage drift (per-voice independent noise)
// ──────────────────────────────────────────────────────────────────────────────

// Slow, smooth random drift — ~2s time constant gives glacially slow wander
driftSig    = no.noise : si.smooth(ba.tau2pole(2.0));
pitchDrift  = driftSig * vintage * 0.004;  // ±~7 cents at vintage=1
filterDrift = driftSig * vintage * 0.12;   // ±~12% cutoff shift at vintage=1

// ──────────────────────────────────────────────────────────────────────────────
// Base frequencies
// ──────────────────────────────────────────────────────────────────────────────

// Raw base pitch: octave shift + semitone transpose + cent detune
baseFreqRaw = freq * pow(2, octave) * pow(2, transpose / 12.0) * pow(2, detune / 1200.0);
// Glide: slew baseFreq with si.smooth; bypass below 5ms to avoid clicks
// Vintage drift is multiplicative on the slewed freq (so portamento slides to the drifted target)
baseFreq    = select2(glide < 0.005,
                baseFreqRaw,
                baseFreqRaw : si.smooth(ba.tau2pole(glide))) * (1.0 + pitchDrift);

// ──────────────────────────────────────────────────────────────────────────────
// Osc B (baseFreq-relative — independent of LFO vibrato, enables poly mod FM)
// ──────────────────────────────────────────────────────────────────────────────

freqB = baseFreq * pow(2, (oscb_pitch + oscb_fine / 100.0) / 12.0);
phB   = os.phasor(1.0, freqB);
sawB  = os.sawtooth(freqB);
triB  = os.triangle(freqB);
snB   = os.oscsin(freqB);

// ──────────────────────────────────────────────────────────────────────────────
// Filter envelope (needed by poly mod routing)
// ──────────────────────────────────────────────────────────────────────────────

// ADS mode: when fenv_mode=1, release follows decay (Oberheim SEM)
f_release_eff = select2(fenv_mode, f_release, f_decay);
filterEnv     = en.adsr(f_attack, f_decay, f_sustain, f_release_eff, gate);

// ──────────────────────────────────────────────────────────────────────────────
// Pulse width modulation (LFO + poly mod combined)
// ──────────────────────────────────────────────────────────────────────────────

// LFO → PW: lfo_to_pw=1 → ±45% PW modulation at lfo_depth=1
// Poly mod → PW: FEnv and OscB each add additional PW modulation
pwMod = max(0.05, min(0.95,
  pulse_width
  + lfoSignal    * lfo_to_pw   * 0.45
  + filterEnv    * poly_fenv_pw * 0.4
  + (2.0 * (phB < 0.5) - 1.0) * poly_oscb_pw * 0.2));

// OscB square with same PW (tracks poly mod PW too)
sqB = 2.0 * (phB < pwMod) - 1.0;
oscB = (sawB, sqB, triB, snB) : ba.selectn(4, oscb_wave);

// ──────────────────────────────────────────────────────────────────────────────
// Poly mod routing
// ──────────────────────────────────────────────────────────────────────────────

// Poly mod pitch: FEnv → ±2 oct FM, OscB → ±0.5 oct FM (at depth=1)
polyPitchMod = filterEnv * poly_fenv_freq * 2.0
             + oscB      * poly_oscb_freq * 0.5;

// Poly mod filter: OscB → ±3 oct cutoff sweep at depth=1
polyFiltMod  = oscB * poly_oscb_filt * 3.0;

// ──────────────────────────────────────────────────────────────────────────────
// Oscillators — Osc A
// ──────────────────────────────────────────────────────────────────────────────

// Final pitch: LFO vibrato + poly mod on top of glide+drift base
pitchModFreq = baseFreq * pow(2, lfoSignal * lfo_to_pitch + polyPitchMod);

// Free-running phasor for Osc A
ph = os.phasor(1.0, pitchModFreq);

// Hard sync: OscB rising edge (cycle wrap) resets OscA phase to 0
syncTrig   = phB < phB';
phHardSync = os.hs_phasor(pitchModFreq, syncTrig);
phA        = select2(osc_sync, ph, phHardSync);

// Osc A waveforms using sync-aware phasor (saw/sq); tri/sin use freq directly
saw = 2.0 * phA - 1.0;
sq  = 2.0 * (phA < pwMod) - 1.0;
tri = os.triangle(pitchModFreq);
sn  = os.oscsin(pitchModFreq);

// Supersaw — JP-8000 style, 7 saws, asymmetric detuning
// Multipliers from Shore (2017), JP-8000 hardware analysis:
// Upper: 1.1077, 1.0633, 1.0204 | Center: 1.0 | Lower: 0.9811, 0.9382, 0.8908
ssSlaves =
  os.sawtooth(pitchModFreq * (1 + (1.1077 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (1.0633 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (1.0204 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.9811 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.9382 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.8908 - 1) * supersaw_detune));
superSaw = (saw + ssSlaves * (supersaw_mix / 6.0)) / max(0.1, 1.0 + supersaw_mix * 0.5);

// Waveform select: 0=SAW, 1=SQR, 2=TRI, 3=SIN, 4=SUPER
oscA = (saw, sq, tri, sn, superSaw) : ba.selectn(5, wave_sel);

// Additive blend: OSC A + OSC B scaled by oscb_level
oscMix = oscA + oscB * oscb_level;

// ──────────────────────────────────────────────────────────────────────────────
// Wavefolder — Buchla Timbre (OSC E16)
// ──────────────────────────────────────────────────────────────────────────────

// Sine-based wavefolder: at timbre=0 dry, at timbre=1 sin(pi*x*4) creates rich harmonics
// Blends from identity to a deeply folded sine function, adding odd/even harmonics.
wavefolded = oscMix * (1.0 - timbre) + sin(oscMix * ma.PI * (1.0 + timbre * 3.0)) * timbre;

// ──────────────────────────────────────────────────────────────────────────────
// Noise blend
// ──────────────────────────────────────────────────────────────────────────────

// Noise color: 0=white (flat spectrum), 1=pink (−3dB/oct, Oberheim SEM character)
noiseOut = select2(noise_color, no.noise, no.pink_noise);
mixed    = wavefolded * (1.0 - noise_level) + noiseOut * noise_level;

// ──────────────────────────────────────────────────────────────────────────────
// Passive HPF (Juno-106 style — strips sub-bass before resonant LPF)
// ──────────────────────────────────────────────────────────────────────────────

// 4 positions: 0=~1Hz (bypass), 1=18Hz, 2=59Hz, 3=185Hz
// Using 1Hz for "off" avoids discontinuities — attenuation at audio freq is negligible.
hpfFreqHz = (1.0, 18.0, 59.0, 185.0) : ba.selectn(4, hpf_cutoff);
hpfOut    = mixed : fi.highpass(1, hpfFreqHz);

// ──────────────────────────────────────────────────────────────────────────────
// Filter
// ──────────────────────────────────────────────────────────────────────────────

// LFO filter mod: lfo_to_filter=1 → ±4 octave sweep at lfo_depth=1
lfoCutoff     = lfoSignal * lfo_to_filter * 4.0;

// Key tracking: pow(freq/C3, key_track) scales cutoff with note pitch
// C3=261.63Hz is the neutral point (no cutoff change there)
keyTrackMult  = pow(freq / 261.63, key_track);

// Velocity → filter cutoff: up to +2 octaves at full velocity (gain=1)
velCutoffMod  = gain * vel_to_cutoff * 2.0;

// Combined cutoff: base × keytrack × pow(2, FENV + LFO + polymod + velmod + vintage drift)
cutoffMod  = max(20, min(20000,
  cutoff * keyTrackMult
  * pow(2, filterEnv * fenv_amount * 4.0 + lfoCutoff + polyFiltMod + velCutoffMod + filterDrift)));
cutoffNorm = max(0.0001, min(0.9999, cutoffMod * 2.0 / ma.SR));

// Moog Ladder LP (24dB, self-oscillating at resonance→1, warm character)
moogOut = hpfOut : ve.moogLadder(cutoffNorm, resonance);

// Multimode SVF (Oberheim SEM-inspired: LP → Notch → HP continuous sweep)
qSVF     = 0.5 + resonance * 19.5;
svfLP    = hpfOut : fi.resonlp(cutoffMod, qSVF);
svfHP    = hpfOut : fi.resonhp(cutoffMod, qSVF);
svfNotch = svfLP + svfHP;
svfOut = select2(filter_mode <= 0.5,
  svfLP * (1 - 2*filter_mode) + svfNotch * (2*filter_mode),
  svfNotch * (2 - 2*filter_mode) + svfHP * (2*filter_mode - 1)
);

// Crossfade Moog → SVF over first 5% of filter_mode (0 = pure Moog character)
filtBlend = min(1.0, filter_mode * 20);
filtered  = moogOut * (1 - filtBlend) + svfOut * filtBlend;

// ──────────────────────────────────────────────────────────────────────────────
// Amp envelope + output
// ──────────────────────────────────────────────────────────────────────────────

// ADS mode: when aenv_mode=1, release follows decay (Oberheim SEM)
release_eff = select2(aenv_mode, release, decay);

// Velocity sensitivity for amplitude:
// vel_to_amp=0 → gain has no effect (fixed full volume)
// vel_to_amp=1 → full velocity control (quiet at low velocity)
gainMod = (1.0 - vel_to_amp) + vel_to_amp * gain;

// Tremolo: lfo_to_amp=1 → full amplitude modulation at lfo_depth=1
// lfoSignal is −1..+1; map to 0..1 range for modulation depth
ampTremolo = 1.0 - lfo_to_amp * max(0.0, lfoSignal * 0.5 + 0.5);

ampEnv  = en.adsr(attack, decay, sustain, release_eff, gate) * gainMod;
process = filtered * ampEnv * ampTremolo;
