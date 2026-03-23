// Arcturus — Virtual Analog Voice DSP
// 8-voice polyphonic subtractive synthesizer
// Signal flow: Oscillator → Moog Ladder Filter → Amp Envelope → Output
//
// Faust polyphonic convention: declare nvoices enables automatic voice allocation.
// The `freq`, `gain`, and `gate` parameters are controlled per-voice by the runtime.
declare nvoices "8";

import("stdfaust.lib");

// ── Voice control (set by keyOn/keyOff or direct param) ──
freq = hslider("freq[unit:Hz]", 440, 20, 20000, 0.1);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");

// ── Oscillator params (Encoder 1-2) ──
waveform = hslider("waveform", 0, 0, 3, 1) : int;
detune   = hslider("detune[unit:cents]", 0, -100, 100, 0.1);

// ── Filter params (Encoder 3-5) ──
cutoff      = hslider("cutoff[unit:Hz][scale:log]", 8000, 20, 20000, 0.1);
resonance   = hslider("resonance", 0.5, 0, 1, 0.01);
fenv_amount = hslider("fenv_amount", 0.5, -1, 1, 0.01);

// ── Amp ADSR params (Encoder 6-8) ──
attack  = hslider("attack[unit:s]",  0.01, 0.001, 5, 0.001);
decay   = hslider("decay[unit:s]",   0.30, 0.001, 5, 0.001);
sustain = hslider("sustain",         0.70, 0,     1, 0.01);
release = hslider("release[unit:s]", 0.50, 0.001, 5, 0.001);

// ── Oscillator ──
detunedFreq = freq * pow(2, detune / 1200);
saw = os.sawtooth(detunedFreq);
sq  = os.square(detunedFreq);
tri = os.triangle(detunedFreq);
sn  = os.oscsin(detunedFreq);
osc = (saw, sq, tri, sn) : ba.selectn(4, waveform);

// ── Filter ──
// Filter envelope modulates cutoff by ±4 octaves at max amount
fenv       = en.adsr(attack, decay, sustain, release, gate) * fenv_amount;
cutoffMod  = max(20, min(20000, cutoff * pow(2, fenv * 4)));
filtered   = osc : ve.moogLadder(cutoffMod, resonance);

// ── Amp envelope ──
ampEnv = en.adsr(attack, decay, sustain, release, gate) * gain;

process = filtered * ampEnv;
