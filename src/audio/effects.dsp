// Arcturus — Effects Chain DSP
// Post-voice signal flow: Overdrive → Chorus → Delay → Reverb → Master
// Mono input (mixed polyphonic output) → stereo output.
//
// Encoders 9-15 map to these parameters (see mapper.ts).

import("stdfaust.lib");

// ── Overdrive (Encoder 15) ──
drive = hslider("drive", 0, 0, 1, 0.01);

// ── Chorus (Encoders 13-14) ──
chorus_rate  = hslider("chorus_rate[unit:Hz]",  1.5, 0.1, 10,   0.01);
chorus_depth = hslider("chorus_depth",           0.5, 0,    1,   0.01);

// ── Delay (Encoders 9-10) ──
delay_time     = hslider("delay_time[unit:s]",    0.25, 0.01, 2,    0.001);
delay_feedback = hslider("delay_feedback",         0.30, 0,    0.95, 0.01);

// ── Reverb (Encoders 11-12) ──
reverb_damp = hslider("reverb_damp",  0.5, 0, 1, 0.01);
reverb_mix  = hslider("reverb_mix",   0.3, 0, 1, 0.01);

// ── Master volume (not encoder-mapped — internal) ──
master = hslider("master", 0.8, 0, 1, 0.01);

// ── Signal processing ──

// Soft overdrive: cubic nonlinearity blended with dry
cubicNL(x) = x - x*x*x/3;
overdriven(x) = x*(1-drive) + cubicNL(max(-1, min(1, x*2))) * (drive*0.5);

// Chorus: LFO-modulated delay mixed with dry
chorusMod = chorus_depth * 0.015 * ma.SR * (0.5 + 0.5*os.oscsin(chorus_rate));
chorus(x) = x + de.fdelay(int(ma.SR * 0.05), int(chorusMod), x) * (chorus_depth * 0.5);

// Feedback delay
delayLine = (+ ~ (@(int(delay_time * ma.SR)) * delay_feedback));

// Mono reverb using 4-comb Schroeder network
combFeedback = 0.88 - reverb_damp * 0.25;
comb(dt) = (+ ~ (@(dt) * combFeedback));
monoReverb(x) = x <: comb(1557), comb(1617), comb(1491), comb(1422) :> *(0.25);

// Dry/wet reverb mix (mono)
reverbSection(x) = x*(1-reverb_mix) + monoReverb(x)*reverb_mix;

// Full chain: mono in → stereo out (7-sample right-channel offset for width)
process = _ : overdriven : chorus : delayLine : reverbSection : *(master) <: _, @(7);
