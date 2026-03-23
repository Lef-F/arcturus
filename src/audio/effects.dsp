// Arcturus — Effects Chain DSP
// Post-voice signal flow: Overdrive → Chorus → Delay → Reverb → Master
// Applied to the mixed output of all voices.
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

// Soft overdrive: blend soft-clipped signal with dry
overdriven(x) = x * (1 - drive) + ef.cubicnl(x, 0) * drive;

// Simple chorus: delayed copy modulated by LFO
modDelay = int(ma.SR * (0.02 + chorus_depth * 0.015 * (os.oscsin(chorus_rate) + 1) / 2));
chorus(x) = x + de.fdelay(int(ma.SR * 0.1), modDelay, x) * chorus_depth * 0.5;

// Feedback delay (mono)
delayLine = (+ ~ (@(int(delay_time * ma.SR)) * delay_feedback));

// Stereo reverb with dry/wet
reverbStereo(x) = re.zita_rev1_stereo(0, 200, 6000, 3, reverb_damp * 10 + 1, x, x);

process = _
  : overdriven
  : chorus
  : delayLine
  <: ((_ <: reverbStereo : *(reverb_mix), _ : *(1 - reverb_mix) <: !, !) : + ,
      (_ <: reverbStereo : *(reverb_mix), _ : *(1 - reverb_mix) <: !, !) : +)
  : *(master), *(master);
