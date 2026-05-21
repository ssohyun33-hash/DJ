export interface DrumPad {
  id: string;
  label: string;
  color: string;
  triggerKey: string;
  type: "drum" | "synth" | "fx";
  synthPitchIndex?: number;
}

export type BlockType = "empty" | "mic-recording" | "pad-recording" | "preset-loop";

export interface AudioBlock {
  id: number;
  name: string;
  type: BlockType;
  audioBuffer: AudioBuffer | null; // Keeps standard stereo or mono audio data in memory
  duration: number; // Length in seconds
  volume: number; // Block-specific gain multiplier
  pitch: number; // Playback rate / shift (0.5x to 2.0x)
  delay: number; // Individual Delay amount
  reverb: number; // Individual Reverb amount
  lowpass: number; // 0 to 1 intensity filter
  waveformPoints: number[]; // Extracted amplitude data for rendering beautiful wave-shapes
  looping: boolean; // Is it set to loop when stretched
}

export interface TimelineEvent {
  id: string;
  blockId: number; // Reference to one of the 20 AudioBlocks (1-based)
  trackIndex: number; // Lane index (0 to 3)
  startBeat: number; // Left start grid column index
  durationBeats: number; // Right length in columns/beats
}

export interface TrackChannel {
  id: number;
  name: string;
  volume: number;
  isMuted: boolean;
}

export interface GlobalEffects {
  scratchSpeed: number; // Playback scaling (0 to 1) to simulate turntable scratching and slowing down
  scratchStop: boolean; // Actively halting playback rate to 0 with deceleration effect
  delayTime: number; // Master delay time (seconds)
  delayFeedback: number; // Master delay feedback (gain)
  reverbMix: number; // Master reverb mix percentage
  pitchBend: number; // Coarse master pitch bend factor (-1 to +1 relative semi-tones)
}

export interface PadCustomSettings {
  pitchOffset: number; // -12 to +12 semitones
  baseNoteIndex: number; // 0 to 12 mapping to chromatic notes
  melodySequence: number[]; // custom chromatic pitch indexes, e.g. [2, 1, 0]
  currentSeqIndex: number; // index of currently playing step in melodySequence
  useSequence: boolean; // toggle if we use custom melody sequence or just baseNoteIndex
  effects: {
    echo: boolean;
    reverb: boolean;
    muffle: boolean;
  };
  sound: {
    decayMultiplier: number; // 0.1 to 3.0, default 1.0
    cutoff: number; // 100 to 20000Hz, default 20000
    resonance: number; // 0.1 to 15.0, default 1.0
    drive: number; // 0 to 100, default 0 (overdrive saturation)
    noiseLevel: number; // 0 to 100, default 0 (analog crackle)
  };
}
