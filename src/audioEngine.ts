import { AudioBlock, TimelineEvent, GlobalEffects } from "./types";

// Setup global or lazy singleton context to bypass autoplay restrictions safely
let sharedAudioContext: AudioContext | null = null;
let reverbNoiseBuffer: AudioBuffer | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (sharedAudioContext.state === "suspended") {
    sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

// Generate algorithmic decay white-noise buffer for convolutional spring-reverb simulation
export function getReverbImpulseResponse(ctx: BaseAudioContext): AudioBuffer {
  if (reverbNoiseBuffer && reverbNoiseBuffer.sampleRate === ctx.sampleRate) {
    return reverbNoiseBuffer;
  }
  const duration = 2.0; // 2 seconds tail
  const rate = ctx.sampleRate;
  const len = rate * duration;
  const buffer = ctx.createBuffer(2, len, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      // Exponential decay of random noise
      const decay = Math.pow(1 - i / len, 3.5);
      data[i] = (Math.random() * 2 - 1) * decay * 0.7;
    }
  }
  reverbNoiseBuffer = buffer;
  return buffer;
}

function makeDistortionCurve(amount = 20) {
  const k = amount;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export function applyEffectsToNode(
  ctx: BaseAudioContext,
  sourceNode: AudioNode,
  destNode: AudioNode,
  effects: { echo: boolean; reverb: boolean; muffle: boolean },
  sound?: {
    decayMultiplier: number;
    cutoff: number;
    resonance: number;
    drive: number;
    noiseLevel: number;
  }
) {
  let lastNode = sourceNode;

  // A. Apply Overdrive Distortion if drive is configured
  if (sound && sound.drive > 0) {
    try {
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortionCurve(sound.drive);
      shaper.oversample = "4x";
      lastNode.connect(shaper);
      lastNode = shaper;
    } catch (e) {
      console.warn("Could not create WaveShaper distortion node:", e);
    }
  }

  // B. Apply customizable lowpass filter if cutoff or Q is customized
  if (sound && (sound.cutoff < 20000 || sound.resonance > 1.0)) {
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.setValueAtTime(sound.cutoff, ctx.currentTime);
    toneFilter.Q.setValueAtTime(sound.resonance, ctx.currentTime);
    lastNode.connect(toneFilter);
    lastNode = toneFilter;
  }

  // C. Apply exponential gate / envelope decay multiplier
  if (sound && sound.decayMultiplier !== 1.0) {
    try {
      const gateGain = ctx.createGain();
      gateGain.gain.setValueAtTime(1.0, ctx.currentTime);
      const decayDuration = Math.max(0.01, 2.0 * sound.decayMultiplier);
      gateGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + decayDuration);
      lastNode.connect(gateGain);
      lastNode = gateGain;
    } catch (e) {
      console.warn("Could not create dynamic gate gain:", e);
    }
  }

  // D. Analog White Noise overlay crackle injector
  if (sound && sound.noiseLevel > 0) {
    try {
      const noiseBuff = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
      const data = noiseBuff.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const d = Math.pow(1 - i / data.length, 4.0);
        data[i] = (Math.random() * 2 - 1) * d;
      }
      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuff;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime((sound.noiseLevel / 100) * 0.15, ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + Math.max(0.05, 1.2 * sound.decayMultiplier));

      noiseNode.connect(noiseGain);
      noiseGain.connect(destNode);

      noiseNode.start(ctx.currentTime);
      noiseNode.stop(ctx.currentTime + Math.max(0.1, 1.4 * sound.decayMultiplier));
    } catch (err) {
      console.warn("Noise injector error", err);
    }
  }

  // 1. Muffle (lowpass filter at 750Hz)
  if (effects.muffle) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(750, ctx.currentTime);
    filter.Q.setValueAtTime(1.0, ctx.currentTime);
    
    lastNode.connect(filter);
    lastNode = filter;
  }

  // 2. Reverb (using convolution helper)
  if (effects.reverb) {
    try {
      const convolver = ctx.createConvolver();
      convolver.buffer = getReverbImpulseResponse(ctx);
      const reverbGain = ctx.createGain();
      reverbGain.gain.setValueAtTime(0.45, ctx.currentTime);
      
      lastNode.connect(convolver);
      convolver.connect(reverbGain);
      reverbGain.connect(destNode);
    } catch (e) {
      console.warn("Could not create convolved Reverb effect node:", e);
    }
  }

  // 3. Echo (Delay with feedback loop)
  if (effects.echo) {
    const delay = ctx.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.28, ctx.currentTime);
    
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(0.42, ctx.currentTime);
    
    const delayWet = ctx.createGain();
    delayWet.gain.setValueAtTime(0.45, ctx.currentTime);
    
    lastNode.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    
    delay.connect(delayWet);
    delayWet.connect(destNode);
  }

  // Dry connection always goes to main destination
  lastNode.connect(destNode);
}

// Keep track of all live playing AudioBufferSourceNodes to update pitchbend/scratch in real-time
export interface ActivePlayInstance {
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  blockId: number;
  baseRate: number;
  localVolumeNode?: GainNode;
  filterNode?: BiquadFilterNode;
  delayFeedbackNode?: GainNode;
  delayWetNode?: GainNode;
  reverbWetNode?: GainNode;
}
export const livePlayInstances = new Set<ActivePlayInstance>();

// Synthesizer models for high-quality instant drum production (running in standard/offline context)
export function synthKick(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, pitchMultiplier = 1.0) {
  // Main sub fundamental sine oscillator
  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();
  
  // High click-transient triangle oscillator for snap
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();

  subOsc.type = "sine";
  subOsc.frequency.setValueAtTime(160 * pitchMultiplier, time);
  // Extremely rapid pitch sweep for heavy thud punch
  subOsc.frequency.exponentialRampToValueAtTime(45 * pitchMultiplier, time + 0.12);

  clickOsc.type = "triangle";
  clickOsc.frequency.setValueAtTime(480 * pitchMultiplier, time);
  clickOsc.frequency.exponentialRampToValueAtTime(90 * pitchMultiplier, time + 0.025);

  // Body gain envelope (fat sub sustain & decay)
  subGain.gain.setValueAtTime(velocity * 1.6, time);
  subGain.gain.exponentialRampToValueAtTime(0.005, time + 0.28);

  // Click gain envelope
  clickGain.gain.setValueAtTime(velocity * 0.42, time);
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

  subOsc.connect(subGain);
  subGain.connect(outNode);

  clickOsc.connect(clickGain);
  clickGain.connect(outNode);

  subOsc.start(time);
  clickOsc.start(time);
  subOsc.stop(time + 0.35);
  clickOsc.stop(time + 0.04);
}

export function synthSnare(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, pitchMultiplier = 1.0) {
  // Snare fundamental body hit
  const bodyOsc = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  bodyOsc.type = "sine";
  bodyOsc.frequency.setValueAtTime(260 * pitchMultiplier, time);
  bodyOsc.frequency.exponentialRampToValueAtTime(145 * pitchMultiplier, time + 0.08);
  
  bodyGain.gain.setValueAtTime(velocity * 0.95, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.005, time + 0.14);
  
  bodyOsc.connect(bodyGain);
  bodyGain.connect(outNode);

  // Snare noise crackle tail (much wider & crisper bandpass/highpass filtering)
  const noiseSize = ctx.sampleRate * 0.35;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuff;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(1600 * pitchMultiplier, time);
  bandpass.Q.setValueAtTime(1.8, time);

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(900 * pitchMultiplier, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(velocity * 1.1, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.005, time + 0.24);

  noiseSource.connect(bandpass);
  bandpass.connect(highpass);
  highpass.connect(noiseGain);
  noiseGain.connect(outNode);

  bodyOsc.start(time);
  noiseSource.start(time);
  bodyOsc.stop(time + 0.2);
  noiseSource.stop(time + 0.3);
}

export function synthHiHat(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, isOpen = false, pitchMultiplier = 1.0) {
  // White noise source
  const noiseSize = ctx.sampleRate * 0.45;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuff;

  // Ultra high pitch square wave oscillator to deliver premium metallic brass sheen
  const metalOsc = ctx.createOscillator();
  metalOsc.type = "square";
  metalOsc.frequency.setValueAtTime(Math.max(100, 9800 * pitchMultiplier), time);

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(Math.max(100, 8200 * pitchMultiplier), time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(velocity * 0.45, time);
  const duration = isOpen ? 0.35 : 0.085;
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  noiseSource.connect(filter);
  metalOsc.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  noiseSource.start(time);
  metalOsc.start(time);
  noiseSource.stop(time + duration + 0.05);
  metalOsc.stop(time + duration + 0.05);
}

export function synthClap(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, pitchMultiplier = 1.0) {
  const noiseSize = ctx.sampleRate * 0.3;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(Math.min(20000, Math.max(10, 1200 * pitchMultiplier)), time);
  bandpass.connect(outNode);

  // Clap consists of rapidly triggered impulse steps (0.01s intervals) followed by decaying tail
  const triggerImpulse = (offset: number, vol: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuff;
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(vol * velocity * 0.4, time + offset);
    gainNode.gain.exponentialRampToValueAtTime(0.005, time + offset + 0.025);
    src.connect(bandpass);
    src.connect(gainNode);
    gainNode.connect(outNode);
    src.start(time + offset);
    src.stop(time + offset + 0.03);
  };

  triggerImpulse(0.00, 0.82);
  triggerImpulse(0.01, 0.65);
  triggerImpulse(0.02, 0.45);
  // Heavy tail
  triggerImpulse(0.03, 1.0);
}

export function synthBassNode(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  // Deep chromatic starting at C2 (65.41 Hz)
  const freq = 65.41 * Math.pow(2, noteIndex / 12);

  const oscSub = ctx.createOscillator();
  const oscSaw = ctx.createOscillator();
  const freqFilter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  oscSub.type = "square";
  oscSub.frequency.setValueAtTime(freq, time);

  oscSaw.type = "sawtooth";
  oscSaw.frequency.setValueAtTime(freq * 1.005, time); // detuned

  freqFilter.type = "lowpass";
  freqFilter.frequency.setValueAtTime(140, time);
  freqFilter.frequency.exponentialRampToValueAtTime(700, time + 0.04);
  freqFilter.frequency.exponentialRampToValueAtTime(80, time + 0.28);

  gain.gain.setValueAtTime(velocity * 0.65, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.32);

  oscSub.connect(freqFilter);
  oscSaw.connect(freqFilter);
  freqFilter.connect(gain);
  gain.connect(outNode);

  oscSub.start(time);
  oscSaw.start(time);
  oscSub.stop(time + 0.35);
  oscSaw.stop(time + 0.35);
}

export function synthLeadNode(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  // Beautiful chromatic scale starting from C4 (261.63 Hz)
  const freq = 261.63 * Math.pow(2, noteIndex / 12);

  const oscSaw = ctx.createOscillator();
  const oscTri = ctx.createOscillator();
  const gain = ctx.createGain();

  oscSaw.type = "sawtooth";
  oscSaw.frequency.setValueAtTime(freq, time);

  oscTri.type = "triangle";
  oscTri.frequency.setValueAtTime(freq * 2, time); // octave detuned sparkler

  gain.gain.setValueAtTime(velocity * 0.32, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.45);

  oscSaw.connect(gain);
  oscTri.connect(gain);
  gain.connect(outNode);

  oscSaw.start(time);
  oscTri.start(time);
  oscSaw.stop(time + 0.5);
  oscTri.stop(time + 0.5);
}

export function synthTrumpet(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  // Brassy chromatic C4 to C5 scale
  const freq = 261.63 * Math.pow(2, noteIndex / 12);

  // Bright brassy style: Sawtooth + Triangle, quick brass swell spit
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(freq, time);
  // Add expressive pitch vibrato
  osc1.frequency.linearRampToValueAtTime(freq * 1.003, time + 0.12);
  osc1.frequency.linearRampToValueAtTime(freq * 0.997, time + 0.24);
  osc1.frequency.linearRampToValueAtTime(freq, time + 0.38);

  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(freq * 1.004, time); // slightly detuned for thickness

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(200, time);
  filter.frequency.exponentialRampToValueAtTime(4000, time + 0.05); // sharp brass spit
  filter.frequency.exponentialRampToValueAtTime(1200, time + 0.28);  // mellow warm sustain

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.32, time + 0.045); // crescendo swell
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.45);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.48);
  osc2.stop(time + 0.48);
}

export function updateActiveBlockParameters(blockId: number, key: string, value: number, masterVolume = 0.85) {
  for (const inst of livePlayInstances) {
    if (inst.blockId === blockId) {
      try {
        if (key === "volume") {
          inst.gainNode.gain.setValueAtTime(value * masterVolume, 0);
          if (inst.localVolumeNode) {
            inst.localVolumeNode.gain.setValueAtTime(value, 0);
          }
        } else if (key === "pitch") {
          inst.baseRate = value;
          inst.sourceNode.playbackRate.setValueAtTime(value, 0);
        } else if (key === "delay") {
          if (inst.delayFeedbackNode) {
            inst.delayFeedbackNode.gain.setValueAtTime(0.42 * value, 0);
          }
          if (inst.delayWetNode) {
            inst.delayWetNode.gain.setValueAtTime(value * 0.6, 0);
          }
        } else if (key === "reverb") {
          if (inst.reverbWetNode) {
            inst.reverbWetNode.gain.setValueAtTime(value * 0.65, 0);
          }
        } else if (key === "lowpass") {
          if (inst.filterNode) {
            const lpFreq = 20000 - (20000 - 250) * value;
            inst.filterNode.frequency.setValueAtTime(lpFreq, 0);
          }
        }
      } catch (e) {
        console.warn("Could not dynamically update active playing instance param:", e);
      }
    }
  }
}

// Subordinate dynamic effects network pipeline helper (Per Block / Channel)
export function createEffectsGraph(
  ctx: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
  block: { volume: number; delay: number; reverb: number; lowpass: number }
) {
  // 1. Channel gain
  const localVolume = ctx.createGain();
  localVolume.gain.setValueAtTime(block.volume, ctx.currentTime);

  // 2. Lowpass filter
  const filterNode = ctx.createBiquadFilter();
  filterNode.type = "lowpass";
  // Curve mapping: 0.0 limit -> 20000Hz (full bypass), 1.0 limit -> 200Hz (highly muffled)
  const lpFreq = 20000 - (20000 - 250) * block.lowpass;
  filterNode.frequency.setValueAtTime(lpFreq, ctx.currentTime);

  // 3. Delay line
  const delayNode = ctx.createDelay(1.0);
  const delayFeedback = ctx.createGain();
  const delayWet = ctx.createGain();
  delayNode.delayTime.setValueAtTime(0.28, ctx.currentTime);
  delayFeedback.gain.setValueAtTime(0.42 * block.delay, ctx.currentTime);
  delayWet.gain.setValueAtTime(block.delay * 0.6, ctx.currentTime);

  // Feedback delay wiring
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);

  // 4. Reverb simulation
  const reverbNode = ctx.createConvolver();
  const reverbWet = ctx.createGain();
  reverbNode.buffer = getReverbImpulseResponse(ctx);
  reverbWet.gain.setValueAtTime(block.reverb * 0.65, ctx.currentTime);

  // Connecting the nodes:
  // Input -> Filter -> Volume
  input.connect(filterNode);
  filterNode.connect(localVolume);

  // Dry path -> Output
  localVolume.connect(output);

  // Wet delay path
  localVolume.connect(delayNode);
  delayNode.connect(delayWet);
  delayWet.connect(output);

  // Wet reverb path
  localVolume.connect(reverbNode);
  reverbNode.connect(reverbWet);
  reverbWet.connect(output);

  return { localVolume, filterNode, delayWet, delayNode, reverbWet, delayFeedbackNode: delayFeedback };
}

// Preset algorithms that bake gorgeous 2-bar loop samples using high-speed OfflineAudioContext
export async function renderPresetLoop(
  type: "house" | "hiphop" | "techno" | "synthwave" | "bassline"
): Promise<{ buffer: AudioBuffer; points: number[] }> {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const bpm = 125;
  const secondsPerBeat = 60 / bpm;
  const loopBeats = 8; // 2 bars
  const totalDuration = secondsPerBeat * loopBeats; // around 3.84s

  const offline = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
  const out = offline.destination;

  // Let's schedule beats on the timeline
  if (type === "house") {
    // Standard beautiful four-to-the-floor
    for (let i = 0; i < 8; i++) {
      const beatTime = i * secondsPerBeat;
      synthKick(offline, out, beatTime, 1.0);
      if (i % 2 === 1) {
        synthSnare(offline, out, beatTime, 0.85);
      } else {
        // offbeat hats
        synthHiHat(offline, out, beatTime + secondsPerBeat / 2, 0.45, false);
      }
      synthHiHat(offline, out, beatTime, 0.18, false);
    }
  } else if (type === "techno") {
    // Deep heavy techno warehouse loop
    for (let i = 0; i < 8; i++) {
      const beatTime = i * secondsPerBeat;
      synthKick(offline, out, beatTime, 1.2);
      synthHiHat(offline, out, beatTime + secondsPerBeat / 2, 0.6, true); // wide hat
      if (i % 4 === 2 || i % 4 === 6 || i === 7) {
        synthClap(offline, out, beatTime, 0.9);
      }
    }
  } else if (type === "hiphop") {
    // Boom bap dusty swing rhythm
    const pattern = [
      { beat: 0.0, instrument: "kick", vol: 1.1 },
      { beat: 0.75, instrument: "kick", vol: 0.7 },
      { beat: 1.0, instrument: "kick", vol: 0.5 },
      { beat: 2.0, instrument: "snare", vol: 1.0 },
      { beat: 3.5, instrument: "kick", vol: 0.95 },
      { beat: 4.0, instrument: "kick", vol: 0.6 },
      { beat: 4.5, instrument: "hihat", vol: 0.8 },
      { beat: 6.0, instrument: "snare", vol: 1.0 },
      { beat: 7.0, instrument: "kick", vol: 0.5 },
    ];
    for (const item of pattern) {
      const t = item.beat * secondsPerBeat;
      if (item.instrument === "kick") synthKick(offline, out, t, item.vol);
      if (item.instrument === "snare") synthSnare(offline, out, t, item.vol);
      if (item.instrument === "hihat") synthHiHat(offline, out, t, item.vol, false);
    }
    // Ambient ticking hat
    for (let i = 0; i < 16; i++) {
      synthHiHat(offline, out, i * (secondsPerBeat / 2), 0.2, false);
    }
  } else if (type === "synthwave") {
    // Cyberpunk rhythmic retro lead
    // 8-step bassline / melody
    const notes = [0, 2, 3, 5, 7, 5, 3, 2]; // Minor scales
    for (let i = 0; i < 16; i++) {
      const time = i * (secondsPerBeat / 2);
      const noteIdx = notes[i % notes.length];
      synthLeadNode(offline, out, time, noteIdx, 0.8);
      if (i % 4 === 0) {
        synthKick(offline, out, time, 0.6);
      }
    }
  } else if (type === "bassline") {
    // Heavy modulated driving bass riff
    const bassline = [0, 0, 3, 3, 5, 5, 7, 2, 0, 0, 10, 10, 7, 7, 3, 2];
    for (let i = 0; i < 16; i++) {
      const time = i * (secondsPerBeat / 2);
      synthBassNode(offline, out, time, bassline[i], 0.9);
      if (i % 4 === 2) {
        synthSnare(offline, out, time, 0.4);
      }
    }
  }

  // Render the audio block asynchronously in offline context
  const renderedBuffer = await offline.startRendering();

  // Create clean graphical waveforms by extracting statistical peak points
  const channelData = renderedBuffer.getChannelData(0);
  const numPoints = 80;
  const step = Math.floor(channelData.length / numPoints);
  const waveformPoints: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step; j++) {
      const val = Math.abs(channelData[start + j]);
      if (val > max) max = val;
    }
    waveformPoints.push(Math.min(1.0, max * 1.4)); // amplify slightly for visual clarity
  }

  return { buffer: renderedBuffer, points: waveformPoints };
}

// Convert recorded arrays or microphones blobs to full visual Waveform arrays
export function computeWaveformFromBuffer(buffer: AudioBuffer): number[] {
  const channelData = buffer.getChannelData(0);
  const numPoints = 80;
  const step = Math.floor(channelData.length / numPoints);
  const list: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step; j++) {
      if (start + j < channelData.length) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
    }
    list.push(Math.min(1.0, max * 1.5));
  }
  return list;
}

// Generate an empty visual wave placeholder
export function makeEmptyWaveform(): number[] {
  return Array.from({ length: 80 }, () => 0.05 + Math.random() * 0.1);
}

// Global active instances tuner based on Live DJ board actions like Scratch slider, pitch bend etc.
export function updateActivePlaybackRates(globalEffects: GlobalEffects) {
  // Let's compute scale
  let scale = 1.0;

  // Pitch bend: -1 (semitones/octave) to +1, e.g. mapping factor:
  // speed ratio 0.70x to 1.30x
  scale += globalEffects.pitchBend * 0.35;

  // Scratch vinyl stop sweep: if true, immediately drag everything to 0
  if (globalEffects.scratchStop) {
    scale = globalEffects.scratchSpeed; // dynamically follow user mouse drag deceleration
  }

  // Ensure speed cannot fall strictly to 0.0 or negative to prevent Web Audio exceptions
  const finalPlaybackRate = Math.max(0.005, scale);

  for (const inst of livePlayInstances) {
    try {
      inst.sourceNode.playbackRate.setValueAtTime(inst.baseRate * finalPlaybackRate, 0);
    } catch (e) {
      // safe fallback
    }
  }
}

// Export a full mixdown of the entire timeline grid into a single CD-quality download
export async function exportMix(
  blocks: AudioBlock[],
  timeline: TimelineEvent[],
  bpm: number,
  masterVolume: number,
  globalFx: GlobalEffects
): Promise<Blob> {
  const secondsPerBeat = 60 / bpm;

  // Solve total timeline length in beats
  let maxBeat = 16; // default fallback minimum
  for (const item of timeline) {
    const end = item.startBeat + item.durationBeats;
    if (end > maxBeat) {
      maxBeat = end;
    }
  }

  // Add 4 beats room for tail reverb/delay decays smoothly
  const totalDurationSeconds = maxBeat * secondsPerBeat + 3.0;
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(2, sampleRate * totalDurationSeconds, sampleRate);

  // Setup master node inside offline mixdown context
  const masterGain = offline.createGain();
  masterGain.gain.setValueAtTime(masterVolume, 0);
  masterGain.connect(offline.destination);

  // Re-build all blocks matching the timeline placement schedule
  for (const item of timeline) {
    const block = blocks.find((b) => b.id === item.blockId);
    if (!block || !block.audioBuffer) continue;

    const source = offline.createBufferSource();
    source.buffer = block.audioBuffer;

    // Apply pitch bend & scratch effects if baked, default playbackRate based on block pitch slider
    source.playbackRate.setValueAtTime(block.pitch, 0);

    // Wire block-specific effect rack inside offline mixdown context
    const { localVolume } = createEffectsGraph(offline, source, masterGain, block);

    // Compute scheduling timeline timing
    const startTimeStamp = item.startBeat * secondsPerBeat;
    
    // Play sound!
    source.start(startTimeStamp);
    source.stop(startTimeStamp + (block.duration / block.pitch));
  }

  // Perform full visual progress rendering of mixed WAV data
  const finalBuffer = await offline.startRendering();
  return bufferToWavBlob(finalBuffer);
}

// Convert AudioBuffer to a physical download (.wav) file format using the standard RIFF/WAVE header
function bufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  const bufferLength = result.length * 2;
  const totalFileLength = 44 + bufferLength;
  const arrayBuffer = new ArrayBuffer(totalFileLength);
  const view = new DataView(arrayBuffer);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + bufferLength, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* chunk length */
  view.setUint32(40, bufferLength, true);

  // Write low-level short PCM data steps
  floatTo16BitPCM(view, 44, result);

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const len = inputL.length + inputR.length;
  const result = new Float32Array(len);
  let index = 0;
  let inputIndex = 0;
  while (index < len) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function synthLaserZap(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.connect(gain);
  gain.connect(outNode);
  osc.frequency.setValueAtTime(1800, time);
  osc.frequency.exponentialRampToValueAtTime(150, time + 0.15);
  gain.gain.setValueAtTime(velocity * 0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.16);
  osc.start(time);
  osc.stop(time + 0.18);
}

export function synthWhoosh(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const duration = 0.6;
  const noiseSize = ctx.sampleRate * duration;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuff;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.setValueAtTime(4.0, time);
  filter.frequency.setValueAtTime(200, time);
  filter.frequency.exponentialRampToValueAtTime(1200, time + duration / 2);
  filter.frequency.exponentialRampToValueAtTime(300, time + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.005, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.5, time + duration / 2);
  gain.gain.exponentialRampToValueAtTime(0.005, time + duration);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  noiseSource.start(time);
  noiseSource.stop(time + duration + 0.05);
}

export function synthMetallicRing(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc1.frequency.setValueAtTime(800, time);
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(1273, time);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(outNode);

  gain.gain.setValueAtTime(velocity * 0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.5);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.52);
  osc2.stop(time + 0.52);
}

export function synthGlitchBleep(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const steps = [1200, 1800, 900, 1500];
  const stepDuration = 0.04;
  steps.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(freq, time + idx * stepDuration);
    gain.gain.setValueAtTime(velocity * 0.4, time + idx * stepDuration);
    gain.gain.exponentialRampToValueAtTime(0.005, time + (idx + 1) * stepDuration - 0.005);
    osc.connect(gain);
    gain.connect(outNode);
    osc.start(time + idx * stepDuration);
    osc.stop(time + (idx + 1) * stepDuration);
  });
}

export function synthAirHorn(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const duration = 0.45;
  const freqs = [622.25, 624.0, 626.5];
  const masterHornGain = ctx.createGain();
  masterHornGain.connect(outNode);

  masterHornGain.gain.setValueAtTime(velocity * 0.28, time);
  for (let t = 0; t < duration; t += 0.06) {
    masterHornGain.gain.setValueAtTime(velocity * 0.28, time + t);
    masterHornGain.gain.setValueAtTime(velocity * 0.05, time + t + 0.035);
  }
  masterHornGain.gain.exponentialRampToValueAtTime(0.005, time + duration);

  freqs.forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, time);
    osc.connect(masterHornGain);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  });
}

export function synthRimshot(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(1400, time);
  osc.frequency.exponentialRampToValueAtTime(400, time + 0.02);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1200, time);

  gain.gain.setValueAtTime(velocity * 0.7, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.04);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc.start(time);
  osc.stop(time + 0.05);
}

export function synthSpaceDrone(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  const duration = 1.2;
  // Deep slow drone scale starting from A1 (55.00 Hz)
  const baseFreq = 55.00 * Math.pow(2, noteIndex / 12);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(baseFreq, time);
  osc2.type = "square";
  osc2.frequency.setValueAtTime(baseFreq + 0.3, time);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(300, time);
  filter.frequency.linearRampToValueAtTime(150, time + duration);

  gain.gain.setValueAtTime(0.01, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.5, time + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.005, time + duration);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + duration + 0.05);
  osc2.stop(time + duration + 0.05);
}

export function synthReverseCymbal(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const duration = 0.7;
  const noiseSize = ctx.sampleRate * duration;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuff;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(4000, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.005, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.35, time + duration - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.005, time + duration);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  noiseSource.start(time);
  noiseSource.stop(time + duration + 0.1);
}

export function synthAlienTap(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  // Alien tap scale starting from C3 (130.81 Hz)
  const baseFreq = 130.81 * Math.pow(2, noteIndex / 12);

  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(baseFreq, time);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(baseFreq * 20, time); // highly resonant bandpass filter tracking frequency
  filter.Q.setValueAtTime(30, time);

  gain.gain.setValueAtTime(velocity * 0.8, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.22);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc.start(time);
  osc.stop(time + 0.25);
}

export function synthSciFiGun(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const duration = 0.24;
  const numShots = 3;
  const shotDuration = duration / numShots;

  for (let i = 0; i < numShots; i++) {
    const shotTime = time + i * shotDuration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(1500, shotTime);
    osc.frequency.exponentialRampToValueAtTime(80, shotTime + shotDuration - 0.01);

    gain.gain.setValueAtTime(velocity * 0.5, shotTime);
    gain.gain.exponentialRampToValueAtTime(0.005, shotTime + shotDuration - 0.005);

    osc.connect(gain);
    gain.connect(outNode);

    osc.start(shotTime);
    osc.stop(shotTime + shotDuration);
  }
}

export function synthTom(ctx: BaseAudioContext, outNode: AudioNode, time: number, mode: "high" | "mid" | "low" = "mid", velocity = 1.0, pitchMultiplier = 1.0) {
  const osc = ctx.createOscillator();
  const clickOsc = ctx.createOscillator();
  const gain = ctx.createGain();
  const clickGain = ctx.createGain();

  let startFreq = 160;
  let endFreq = 65;
  let duration = 0.22;

  if (mode === "high") {
    startFreq = 220;
    endFreq = 95;
    duration = 0.18;
  } else if (mode === "low") {
    startFreq = 110;
    endFreq = 48;
    duration = 0.28;
  }

  // Scale frequencies with pitchMultiplier
  startFreq *= pitchMultiplier;
  endFreq *= pitchMultiplier;

  osc.type = "sine";
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + duration);

  clickOsc.type = "triangle";
  clickOsc.frequency.setValueAtTime(startFreq * 2.5, time);
  clickOsc.frequency.exponentialRampToValueAtTime(startFreq * 0.8, time + 0.02);

  gain.gain.setValueAtTime(velocity * 0.8, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + duration);

  clickGain.gain.setValueAtTime(velocity * 0.22, time);
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

  osc.connect(gain);
  gain.connect(outNode);

  clickOsc.connect(clickGain);
  clickGain.connect(outNode);

  osc.start(time);
  clickOsc.start(time);
  osc.stop(time + duration + 0.02);
  clickOsc.stop(time + 0.03);
}

export function synthCowbell(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, pitchMultiplier = 1.0) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = "square";
  osc1.frequency.setValueAtTime(540 * pitchMultiplier, time);

  osc2.type = "square";
  osc2.frequency.setValueAtTime(800 * pitchMultiplier, time);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(800 * pitchMultiplier, time);
  filter.Q.setValueAtTime(3.5, time);

  gain.gain.setValueAtTime(velocity * 0.75, time);
  gain.gain.exponentialRampToValueAtTime(0.005, time + 0.14);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.2);
  osc2.stop(time + 0.2);
}

export function synthShaker(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0, pitchMultiplier = 1.0) {
  const noiseSize = ctx.sampleRate * 0.08;
  const noiseBuff = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
  const data = noiseBuff.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuff;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(Math.max(100, 9500 * pitchMultiplier), time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.55, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.002, time + 0.075);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  noiseSource.start(time);
  noiseSource.stop(time + 0.09);
}

export function synthBellPluck(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  const baseFreq = 440 * Math.pow(2, noteIndex / 12);
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc1.frequency.setValueAtTime(baseFreq, time);

  osc2.type = "sine";
  osc2.frequency.setValueAtTime(baseFreq * 2.71, time); // Bell harmonic ratio

  gain.gain.setValueAtTime(velocity * 0.55, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(outNode);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.5);
  osc2.stop(time + 0.5);
}

export function synthFatSub(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  const baseFreq = 55.00 * Math.pow(2, noteIndex / 12); // Deep Sub A1 tuned
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(baseFreq * 1.5, time);
  osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.1);

  gain.gain.setValueAtTime(velocity * 0.9, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.55);

  osc.connect(gain);
  gain.connect(outNode);

  osc.start(time);
  osc.stop(time + 0.6);
}

export function synthFMOrgan(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  const baseFreq = 261.63 * Math.pow(2, noteIndex / 12); // C4 tuned
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const mainGain = ctx.createGain();

  carrier.type = "triangle";
  carrier.frequency.setValueAtTime(baseFreq, time);

  modulator.type = "sine";
  modulator.frequency.setValueAtTime(baseFreq * 2.0, time);

  modGain.gain.setValueAtTime(baseFreq * 0.8, time); // Modulation index
  
  mainGain.gain.setValueAtTime(velocity * 0.45, time);
  mainGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(mainGain);
  mainGain.connect(outNode);

  modulator.start(time);
  carrier.start(time);
  modulator.stop(time + 0.52);
  carrier.stop(time + 0.52);
}

export function synthRetroLead(ctx: BaseAudioContext, outNode: AudioNode, time: number, noteIndex = 0, velocity = 1.0) {
  const baseFreq = 220.00 * Math.pow(2, noteIndex / 12); // A3 tuned
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(baseFreq - 2, time);
  osc1.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.1);

  osc2.type = "sawtooth";
  osc2.frequency.setValueAtTime(baseFreq + 2, time);
  osc2.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.1);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2500, time);
  filter.frequency.exponentialRampToValueAtTime(800, time + 0.35);

  gain.gain.setValueAtTime(velocity * 0.42, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.42);
  osc2.stop(time + 0.42);
}

export function synthVocalScratch(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(100, time);
  osc.frequency.linearRampToValueAtTime(550, time + 0.08);
  osc.frequency.linearRampToValueAtTime(80, time + 0.18);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(800, time);
  filter.frequency.linearRampToValueAtTime(1200, time + 0.08);
  filter.frequency.linearRampToValueAtTime(500, time + 0.18);
  filter.Q.setValueAtTime(4.0, time);

  gain.gain.setValueAtTime(velocity * 0.65, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.19);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(outNode);

  osc.start(time);
  osc.stop(time + 0.2);
}

export function synthVinylCrackle(ctx: BaseAudioContext, outNode: AudioNode, time: number, velocity = 1.0) {
  // Quick snaps modeling vinyl dust/crackle
  const duration = 0.5;
  const numSpikes = 6;
  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(velocity * 0.2, time);
  mainGain.gain.linearRampToValueAtTime(0.0, time + duration);
  mainGain.connect(outNode);

  for (let i = 0; i < numSpikes; i++) {
    const spikeTime = time + i * 0.08 + Math.random() * 0.04;
    const osc = ctx.createOscillator();
    const subGain = ctx.createGain();
    
    osc.type = "triangle";
    osc.frequency.setValueAtTime(2800 + Math.random() * 3000, spikeTime);
    
    subGain.gain.setValueAtTime(0.18, spikeTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, spikeTime + 0.008);
    
    osc.connect(subGain);
    subGain.connect(mainGain);
    
    osc.start(spikeTime);
    osc.stop(spikeTime + 0.012);
  }
}
