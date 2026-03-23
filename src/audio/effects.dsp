// Arcturus — Effects Chain DSP
// Post-voice signal flow: Overdrive → Chorus (stereo) → Delay → Reverb → Master
// Mono input (mixed polyphonic output) → stereo output.

import("stdfaust.lib");

// ── FX module parameters (see MODULES in params.ts, module index 6) ──
drive          = hslider("drive",                    0,    0,    1,    0.01);
chorus_rate    = hslider("chorus_rate[unit:Hz]",     1.5,  0.1,  10,   0.01);
chorus_depth   = hslider("chorus_depth",             0.5,  0,    1,    0.01);
delay_time     = hslider("delay_time[unit:s]",       0.25, 0.01, 2,    0.001);
delay_feedback = hslider("delay_feedback",           0.30, 0,    0.95, 0.01);
reverb_damp    = hslider("reverb_damp",              0.5,  0,    1,    0.01);
reverb_mix     = hslider("reverb_mix",               0.3,  0,    1,    0.01);
master         = hslider("master",                   0.8,  0,    1,    0.01);
// Juno-60 BBD chorus mode: 0=Custom (uses rate/depth), 1=Juno-I, 2=Juno-II, 3=Juno-I+II
chorus_mode    = hslider("chorus_mode",              0,    0,    3,    1) : int;

// ── Signal processing ──

// Soft overdrive: cubic nonlinearity blended with dry
cubicNL(x) = x - x*x*x/3;
overdriven(x) = x*(1-drive) + cubicNL(max(-1, min(1, x*2))) * (drive*0.5);

// ── Stereo BBD Chorus (Juno-60 inspired) ──
//
// Mode 0 (Custom): uses chorus_rate + chorus_depth, anti-phase stereo
// Mode 1 (Juno I):  0.5 Hz, 15ms depth, anti-phase L/R
// Mode 2 (Juno II): 0.83 Hz, 12ms depth, anti-phase L/R
// Mode 3 (Juno I+II): blend of I and II LFOs, anti-phase
//
// Anti-phase stereo is the key Juno-60 character: L and R LFOs are 180° out
// of phase — creates stereo width without mono comb filtering.

junoRate_I  = 0.5;
junoRate_II = 0.83;

// Active LFO rate per mode (mode 0 uses user-defined chorus_rate)
activeRate  = (chorus_rate, junoRate_I, junoRate_II, junoRate_I)  : ba.selectn(4, chorus_mode);
// Second LFO rate for I+II blend
activeRate2 = (chorus_rate, junoRate_I, junoRate_II, junoRate_II) : ba.selectn(4, chorus_mode);
// Active depth in seconds (mode 0 uses scaled chorus_depth)
activeDepth = (chorus_depth * 0.015, 0.015, 0.012, 0.0125) : ba.selectn(4, chorus_mode);

// LFO signals — mode 3 blends two rates for I+II character
lfoA = 0.5 + 0.5 * os.oscsin(activeRate);
lfoB = 0.5 + 0.5 * os.oscsin(activeRate2);
lfoL = select2(chorus_mode == 3, lfoA, (lfoA + lfoB) * 0.5);
// Right channel: anti-phase (180° = invert)
lfoR = select2(chorus_mode == 3, 1.0 - lfoA, 1.0 - (lfoA + lfoB) * 0.5);

maxBufSamples = int(ma.SR * 0.05); // 50ms max delay buffer
modL = int(activeDepth * ma.SR * lfoL);
modR = int(activeDepth * ma.SR * lfoR);

// Juno modes: fixed 50% wet; Custom mode: scales with chorus_depth
chorusWet = select2(chorus_mode > 0, chorus_depth * 0.5, 0.5);

// Stereo chorus: mono in → stereo out with anti-phase LFOs
stereoChorus(x) =
  x + de.fdelay(maxBufSamples, modL, x) * chorusWet,
  x + de.fdelay(maxBufSamples, modR, x) * chorusWet;

// ── Feedback delay (applied per-channel) ──
delayLine = (+ ~ (@(int(delay_time * ma.SR)) * delay_feedback));

// ── Reverb: 4-comb Schroeder network (applied per-channel) ──
combFeedback = 0.88 - reverb_damp * 0.25;
comb(dt) = (+ ~ (@(dt) * combFeedback));
monoReverb(x) = x <: comb(1557), comb(1617), comb(1491), comb(1422) :> *(0.25);
reverbSection(x) = x*(1-reverb_mix) + monoReverb(x)*reverb_mix;

// ── Full chain: mono → stereo ──
// Overdrive (mono) → stereo chorus split → parallel delay+reverb per channel
process = _ : overdriven
            : stereoChorus
            : par(i, 2, delayLine)
            : par(i, 2, reverbSection)
            : par(i, 2, *(master));
