// Arcturus — Effects Chain DSP
// Post-voice: Overdrive → Phaser → Chorus → Delay → Reverb → EQ → Width → Master
// Mono input → stereo output.
//
// See docs/SOUND_ENGINE.md for parameter reference and design decisions.

import("stdfaust.lib");

// ── FX module parameters (see MODULES in params.ts, module index 5) ──
drive           = hslider("drive",                    0,    0,    1,    0.01);
phaser_rate     = hslider("phaser_rate[unit:Hz]",     0.5,  0.1,  5,    0.01);
phaser_depth    = hslider("phaser_depth",             0,    0,    1,    0.01);
phaser_feedback = hslider("phaser_feedback",          0,    0,    0.9,  0.01);
chorus_rate     = hslider("chorus_rate[unit:Hz]",     1.5,  0.1,  10,   0.01);
chorus_depth    = hslider("chorus_depth",             0.5,  0,    1,    0.01);
delay_time      = hslider("delay_time[unit:s]",       0.25, 0.01, 2,    0.001);
delay_feedback  = hslider("delay_feedback",           0.30, 0,    0.95, 0.01);
delay_mod       = hslider("delay_mod",                0,    0,    1,    0.01);
reverb_damp     = hslider("reverb_damp",              0.5,  0,    1,    0.01);
reverb_mix      = hslider("reverb_mix",               0.3,  0,    1,    0.01);
reverb_size     = hslider("reverb_size",              0.5,  0,    1,    0.01);
eq_lo           = hslider("eq_lo[unit:dB]",           0,   -12,   12,   0.1);
eq_hi           = hslider("eq_hi[unit:dB]",           0,   -12,   12,   0.1);
stereo_width    = hslider("stereo_width",             1,    0,    2,    0.01);
master          = hslider("master",                   0.8,  0,    1,    0.01);
// Juno-60 BBD chorus mode: 0=Custom, 1=Juno-I, 2=Juno-II, 3=Juno-I+II
chorus_mode     = hslider("chorus_mode",              0,    0,    3,    1) : int;

// ── Signal processing ──

// Soft overdrive: cubic nonlinearity blended with dry
cubicNL(x) = x - x*x*x/3;
overdriven(x) = x*(1-drive) + cubicNL(max(-1, min(1, x*2))) * (drive*0.5);

// ── 4-stage allpass phaser ──
//
// fi.tf1(b0, b1, a1): H(z) = (b0 + b1*z^-1) / (1 + a1*z^-1)
// Allpass: H(z) = (c + z^-1)/(1 + c*z^-1) → b0=c, b1=1, a1=c
// LFO sweeps allpass coefficient c in [0, 0.97] for classic comb-notch phasing.
//
// Feedback loop: out[n] = in[n] + feedback * apChain(out[n-1])
// Dry-minus-depth*phased creates notches at phase-cancellation frequencies.
phaserA    = (0.5 + 0.5 * os.oscsin(phaser_rate)) * 0.97; // 0..0.97
ap1        = fi.tf1(phaserA, 1.0, phaserA);               // 1st order allpass
phaserWet  = + ~ (ap1 : ap1 : ap1 : ap1 : *(phaser_feedback));
phaserMono = _ <: _, (phaserWet : *(phaser_depth)) : -;

// ── Stereo BBD Chorus (Juno-60 inspired) ──
//
// Mode 0 (Custom): uses chorus_rate + chorus_depth, anti-phase stereo
// Mode 1 (Juno I):  0.5 Hz, 15ms depth, anti-phase L/R
// Mode 2 (Juno II): 0.83 Hz, 12ms depth, anti-phase L/R
// Mode 3 (Juno I+II): blend of I and II LFOs, anti-phase
//
// Anti-phase stereo: L and R LFOs are 180° out of phase — creates stereo
// width without mono comb filtering (key Juno-60 character).

junoRate_I  = 0.5;
junoRate_II = 0.83;

activeRate  = (chorus_rate, junoRate_I, junoRate_II, junoRate_I)  : ba.selectn(4, chorus_mode);
activeRate2 = (chorus_rate, junoRate_I, junoRate_II, junoRate_II) : ba.selectn(4, chorus_mode);
activeDepth = (chorus_depth * 0.015, 0.015, 0.012, 0.0125) : ba.selectn(4, chorus_mode);

lfoA = 0.5 + 0.5 * os.oscsin(activeRate);
lfoB = 0.5 + 0.5 * os.oscsin(activeRate2);
lfoL = select2(chorus_mode == 3, lfoA, (lfoA + lfoB) * 0.5);
lfoR = select2(chorus_mode == 3, 1.0 - lfoA, 1.0 - (lfoA + lfoB) * 0.5);

maxBufSamples = int(ma.SR * 0.05); // 50ms max buffer
modL = int(activeDepth * ma.SR * lfoL);
modR = int(activeDepth * ma.SR * lfoR);

chorusWet = select2(chorus_mode > 0, chorus_depth * 0.5, 0.5);

stereoChorus(x) =
  x + de.fdelay(maxBufSamples, modL, x) * chorusWet,
  x + de.fdelay(maxBufSamples, modR, x) * chorusWet;

// ── Feedback delay with tape flutter ──
//
// Slow triangle LFO (~0.3Hz) modulates delay time for analog tape flutter character.
// delay_mod=0: no flutter; delay_mod=1: ±10ms (480 samples at 48kHz)
flutterHz   = 0.3;
flutterLfo  = os.triangle(flutterHz);
flutterSamp = delay_mod * 480.0; // ±480 samples (~10ms at 48kHz)
maxDelayBuf = 100000;            // safe for 2s + flutter at 48kHz
delayN      = max(1, int(delay_time * ma.SR) + int(flutterSamp * flutterLfo));
delayLine   = (+ ~ (de.fdelay(maxDelayBuf, delayN) : *(delay_feedback)));

// ── Reverb: Schroeder 4-comb network with size control ──
//
// reverb_size scales comb delay times: 0.3x (tight room) to 2.0x (cathedral).
// sizeScale=0.3+size*1.7 → range [0.3, 2.0].
// Max scaled delay: 1617 * 2.0 = 3234 → buffer size 3500 covers all values.
sizeScale    = 0.3 + reverb_size * 1.7;
combFeedback = 0.88 - reverb_damp * 0.25;
comb(baseDt) = + ~ (de.delay(3500, int(baseDt * sizeScale)) : *(combFeedback));
monoReverb(x) = x <: comb(1557), comb(1617), comb(1491), comb(1422) :> *(0.25);
reverbSection(x) = x*(1-reverb_mix) + monoReverb(x)*reverb_mix;

// ── EQ: first-order shelving filters ──
//
// First-order Butterworth LP+HP sum to unity: LP(fc) + HP(fc) = identity.
// Low shelf:  LP*gain + HP  → boost/cut below 200Hz
// High shelf: LP + HP*gain  → boost/cut above 5kHz
// At gain=1 (0 dB eq_lo/eq_hi) both sections are transparent.
eqLoHz    = 200.0;
eqHiHz    = 5000.0;
eqLoGain  = pow(10, eq_lo / 20.0);
eqHiGain  = pow(10, eq_hi / 20.0);
lowShelf(x)  = fi.lowpass(1, eqLoHz, x) * eqLoGain + fi.highpass(1, eqLoHz, x);
highShelf(x) = fi.lowpass(1, eqHiHz, x) + fi.highpass(1, eqHiHz, x) * eqHiGain;
eqSection(x) = x : lowShelf : highShelf;

// ── Stereo width: M/S matrix ──
//
// w=0: mono (S=0), w=1: original stereo (identity), w=2: hyper-wide (double S)
// L' = M + S*w = L*(1+w)/2 + R*(1-w)/2
// R' = M - S*w = L*(1-w)/2 + R*(1+w)/2
widenStereo(l, r) = l * lc + r * rc, l * rc + r * lc
with {
  lc = (1.0 + stereo_width) * 0.5;
  rc = (1.0 - stereo_width) * 0.5;
};

// ── Full chain: mono → stereo ──
process = _ : overdriven
            : phaserMono
            : stereoChorus
            : par(i, 2, delayLine)
            : par(i, 2, reverbSection)
            : par(i, 2, eqSection)
            : widenStereo
            : par(i, 2, *(master));
