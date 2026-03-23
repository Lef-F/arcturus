// Arcturus — Virtual Analog Voice DSP
// 8-voice polyphonic subtractive synthesizer.
// Signal flow: OSC A+B → Noise blend → Filter → Amp Envelope
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
oscb_level      = hslider("oscb_level",            0,    0,    1,    0.01);
oscb_pitch      = hslider("oscb_pitch",            0,  -24,   24,    1);
oscb_fine       = hslider("oscb_fine[unit:cents]", 0,  -50,   50,    0.1);
oscb_wave       = hslider("oscb_wave",             0,    0,    3,    1)   : int; // SAW/SQR/TRI/SIN
supersaw_detune = hslider("supersaw_detune",       0,    0,    1,    0.001);
supersaw_mix    = hslider("supersaw_mix",          0.5,  0,    1,    0.001);

// ── Filter module ──
cutoff      = hslider("cutoff[unit:Hz][scale:log]", 8000, 20, 20000, 0.1);
resonance   = hslider("resonance",   0.5,  0,   1,   0.01);
fenv_amount = hslider("fenv_amount", 0.5, -1,   1,   0.01);
filter_mode = hslider("filter_mode", 0,    0,   1,   0.001); // 0=LP(Moog), 0.5=Notch, 1=HP

// ── Filter Envelope module ──
f_attack  = hslider("f_attack[unit:s]",  0.01, 0.001, 5, 0.001);
f_decay   = hslider("f_decay[unit:s]",   0.30, 0.001, 5, 0.001);
f_sustain = hslider("f_sustain",         0.50, 0,     1, 0.01);
f_release = hslider("f_release[unit:s]", 0.50, 0.001, 5, 0.001);

// ── Amp Envelope module ──
attack  = hslider("attack[unit:s]",  0.01, 0.001, 5, 0.001);
decay   = hslider("decay[unit:s]",   0.30, 0.001, 5, 0.001);
sustain = hslider("sustain",         0.70, 0,     1, 0.01);
release = hslider("release[unit:s]", 0.50, 0.001, 5, 0.001);

// ── LFO module ──
lfo_rate      = hslider("lfo_rate[unit:Hz]",  1,    0.01, 20, 0.01);
lfo_depth     = hslider("lfo_depth",          0,    0,    1,  0.01);
lfo_shape     = hslider("lfo_shape",          0,    0,    4,  1)    : int; // SIN/TRI/SAW/SQR/S&H
lfo_delay     = hslider("lfo_delay[unit:s]",  0,    0,    3,  0.01);
lfo_to_pitch  = hslider("lfo_to_pitch",       0,    0,    1,  0.01);
lfo_to_filter = hslider("lfo_to_filter",      0,    0,    1,  0.01);

// ── Mod module ──
transpose = hslider("transpose", 0, -24, 24, 1) : int;

// ──────────────────────────────────────────────────────────────────────────────
// LFO
// ──────────────────────────────────────────────────────────────────────────────

// Phasor for shape/S&H derivations
lfoPhase = os.phasor(1.0, lfo_rate);

// Five LFO shapes
lfoSin = os.oscsin(lfo_rate);
lfoTri = os.triangle(lfo_rate);
lfoSaw = os.sawtooth(lfo_rate);
lfoSqr = 2.0 * (lfoPhase < 0.5) - 1.0;
// S&H: sample noise on each phasor wrap (rising edge detection)
shTrig = lfoPhase < lfoPhase';
lfoSH  = ba.sAndH(shTrig, no.noise);

lfoRaw = (lfoSin, lfoTri, lfoSaw, lfoSqr, lfoSH) : ba.selectn(5, lfo_shape);

// Fade-in: LFO ramps up over lfo_delay seconds after note on.
// When lfo_delay < 10ms, bypass (instant on) to avoid clicks.
lfoFadeIn = en.adsr(max(lfo_delay, 0.001), 0.001, 1.0, 0.001, gate);
lfoGate   = select2(lfo_delay < 0.01, lfoFadeIn, 1.0);

lfoSignal = lfoRaw * lfo_depth * lfoGate;

// ──────────────────────────────────────────────────────────────────────────────
// Oscillators
// ──────────────────────────────────────────────────────────────────────────────

// Base pitch: octave + semitone transpose + cent detune
baseFreq     = freq * pow(2, octave) * pow(2, transpose / 12.0) * pow(2, detune / 1200.0);
// LFO pitch mod: lfo_to_pitch=1 → ±1 octave vibrato at lfo_depth=1
pitchModFreq = baseFreq * pow(2, lfoSignal * lfo_to_pitch);

// OSC A — phasor for pulse width
ph  = os.phasor(1.0, pitchModFreq);
saw = os.sawtooth(pitchModFreq);
sq  = 2.0 * (ph < pulse_width) - 1.0;   // variable-width pulse
tri = os.triangle(pitchModFreq);
sn  = os.oscsin(pitchModFreq);

// Supersaw — JP-8000 style, 7 saws, asymmetric detuning
// Multipliers reverse-engineered from JP-8000 hardware (Shore, 2017):
// Upper: 1.1077, 1.0633, 1.0204 | Center: 1.0 | Lower: 0.9811, 0.9382, 0.8908
// At supersaw_detune=0: all saws at baseFreq (unison). At 1: full spread.
ssSlaves =
  os.sawtooth(pitchModFreq * (1 + (1.1077 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (1.0633 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (1.0204 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.9811 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.9382 - 1) * supersaw_detune)) +
  os.sawtooth(pitchModFreq * (1 + (0.8908 - 1) * supersaw_detune));
// Mix: center saw + slave saws scaled by supersaw_mix, normalized to ~±1
superSaw = (saw + ssSlaves * (supersaw_mix / 6.0)) / max(0.1, 1.0 + supersaw_mix * 0.5);

// Waveform select: 0=SAW, 1=SQR, 2=TRI, 3=SIN, 4=SUPER
oscA = (saw, sq, tri, sn, superSaw) : ba.selectn(5, wave_sel);

// OSC B — independent oscillator, relative pitch offset from OSC A
freqB = pitchModFreq * pow(2, (oscb_pitch + oscb_fine / 100.0) / 12.0);
phB   = os.phasor(1.0, freqB);
sawB  = os.sawtooth(freqB);
sqB   = 2.0 * (phB < pulse_width) - 1.0;
triB  = os.triangle(freqB);
snB   = os.oscsin(freqB);
oscB  = (sawB, sqB, triB, snB) : ba.selectn(4, oscb_wave);

// Additive blend: OSC A + OSC B scaled by oscb_level
oscMix = oscA + oscB * oscb_level;

// Noise blend (white noise)
mixed = oscMix * (1.0 - noise_level) + no.noise * noise_level;

// ──────────────────────────────────────────────────────────────────────────────
// Filter
// ──────────────────────────────────────────────────────────────────────────────

// Filter envelope (independent from amp envelope)
filterEnv  = en.adsr(f_attack, f_decay, f_sustain, f_release, gate);
// LFO filter mod: lfo_to_filter=1 → ±4 octave sweep at lfo_depth=1
lfoCutoff  = lfoSignal * lfo_to_filter * 4.0;
cutoffMod  = max(20, min(20000, cutoff * pow(2, filterEnv * fenv_amount * 4.0 + lfoCutoff)));
cutoffNorm = max(0.0001, min(0.9999, cutoffMod * 2.0 / ma.SR));

// Moog Ladder LP (24dB, self-oscillating at resonance→1, warm character)
moogOut = mixed : ve.moogLadder(cutoffNorm, resonance);

// Multimode SVF (Oberheim SEM-inspired: LP → Notch → HP continuous sweep)
// Q: maps resonance 0→1 to Q 0.5→20 (SVF doesn't self-oscillate by design)
qSVF    = 0.5 + resonance * 19.5;
svfLP   = mixed : fi.resonlp(cutoffMod, qSVF);
svfHP   = mixed : fi.resonhp(cutoffMod, qSVF);
svfNotch = svfLP + svfHP;  // notch = LP + HP output of same 2nd-order SVF
// filter_mode: 0→0.5 sweeps LP→Notch, 0.5→1 sweeps Notch→HP
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

ampEnv  = en.adsr(attack, decay, sustain, release, gate) * gain;
process = filtered * ampEnv;
