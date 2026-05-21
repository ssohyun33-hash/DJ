import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Mic,
  Volume2,
  Trash2,
  Download,
  Disc,
  Music,
  Sliders,
  Sparkles,
  Layers,
  Activity,
  PlusCircle,
  HelpCircle,
  VolumeX,
} from "lucide-react";
import { AudioBlock, TimelineEvent, DrumPad, GlobalEffects, BlockType, PadCustomSettings } from "./types";
import {
  getAudioContext,
  synthKick,
  synthSnare,
  synthHiHat,
  synthClap,
  synthBassNode,
  synthLeadNode,
  renderPresetLoop,
  computeWaveformFromBuffer,
  makeEmptyWaveform,
  createEffectsGraph,
  updateActivePlaybackRates,
  exportMix,
  livePlayInstances,
  synthLaserZap,
  synthWhoosh,
  synthMetallicRing,
  synthGlitchBleep,
  synthAirHorn,
  synthRimshot,
  synthSpaceDrone,
  synthReverseCymbal,
  synthAlienTap,
  synthSciFiGun,
  synthTrumpet,
  synthTom,
  synthCowbell,
  synthShaker,
  updateActiveBlockParameters,
  applyEffectsToNode,
  synthBellPluck,
  synthFatSub,
  synthFMOrgan,
  synthRetroLead,
  synthVocalScratch,
  synthVinylCrackle,
} from "./audioEngine";

const getMasterOutputNode = (ctx: AudioContext): GainNode => {
  if (!(ctx as any)._masterOutput) {
    const node = ctx.createGain();
    node.connect(ctx.destination);
    (ctx as any)._masterOutput = node;
  }
  return (ctx as any)._masterOutput;
};

export default function App() {
  // State for 20 customizable recording/audio blocks
  const [blocks, setBlocks] = useState<AudioBlock[]>(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `Block #${String(i + 1).padStart(2, "0")}`,
      type: "empty",
      audioBuffer: null,
      duration: 0,
      volume: 0.8,
      pitch: 1.0,
      delay: 0.0,
      reverb: 0.0,
      lowpass: 0.0,
      waveformPoints: makeEmptyWaveform(),
      looping: true,
    }));
  });

  // Custom persistent behavior settings for every pad (effects, pitch, melody sequence, etc.)
  const [padSettings, setPadSettings] = useState<Record<string, PadCustomSettings>>(() => {
    const initial: Record<string, PadCustomSettings> = {};
    const pads = [
      "kick", "snare", "hihat-cls", "hihat-opn", "cowbell", "shaker",
      "tom-high", "tom-mid", "tom-low", "clap", "synth-bass", "trumpet-melody",
      "laser-zap", "whoosh", "metallic-ring", "glitch-bleep", "air-horn",
      "rimshot", "drone", "rev-cymbal", "alien-tap", "scifi-gun",
      "plucked-string", "fat-sub", "fm-organ", "synthwave-lead", "scratch-sfx", "vinyl-crackle"
    ];
    pads.forEach((id) => {
      // Default to slightly different note index for melody items to sound interesting out-of-the-box
      let defaultBaseNote = 2; // Mi
      if (id === "synth-bass" || id === "fat-sub") defaultBaseNote = 0; // Do
      if (id === "drone") defaultBaseNote = 4; // Sol
      if (id === "alien-tap") defaultBaseNote = 5; // La
      if (id === "fm-organ" || id === "trumpet-melody") defaultBaseNote = 1; // Re
      if (id === "plucked-string") defaultBaseNote = 3; // Re# / Fa
      if (id === "synthwave-lead") defaultBaseNote = 7; // Ti / High note

      initial[id] = {
        pitchOffset: 0,
        baseNoteIndex: defaultBaseNote,
        melodySequence: [],
        currentSeqIndex: 0,
        useSequence: false,
        effects: {
          echo: false,
          reverb: false,
          muffle: false,
        },
        sound: {
          decayMultiplier: 1.0,
          cutoff: 20000,
          resonance: 1.0,
          drive: 0,
          noiseLevel: 0,
        },
      };
    });
    return initial;
  });

  const padSettingsRef = useRef(padSettings);
  useEffect(() => {
    padSettingsRef.current = padSettings;
  }, [padSettings]);

  const [customizingPadId, setCustomizingPadId] = useState<string | null>(null);

  const [activeBlockId, setActiveBlockId] = useState<number>(1);
  const [selectedPaintBlockId, setSelectedPaintBlockId] = useState<number>(1);
  const [brushSteps, setBrushSteps] = useState<number>(4);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null);

  // Sequences placed on the timeline tracks (lanes 0 to 3)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([
    // Prepulate with some nice standard triggers on Block 1 & 2 to give immediate feedback
    { id: "e1", blockId: 1, trackIndex: 0, startBeat: 0, durationBeats: 4 },
    { id: "e2", blockId: 1, trackIndex: 0, startBeat: 4, durationBeats: 4 },
    { id: "e3", blockId: 1, trackIndex: 0, startBeat: 8, durationBeats: 4 },
    { id: "e4", blockId: 2, trackIndex: 1, startBeat: 4, durationBeats: 4 },
    { id: "e5", blockId: 2, trackIndex: 1, startBeat: 12, durationBeats: 4 },
  ]);

  // General audio environment configuration
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [isMetronomeOn, setIsMetronomeOn] = useState(false);

  // Global live effects console
  const [globalFx, setGlobalFx] = useState<GlobalEffects>({
    scratchSpeed: 1.0,
    scratchStop: false,
    delayTime: 0.3,
    delayFeedback: 0.4,
    reverbMix: 0.2,
    pitchBend: 0.0,
  });

  // Master recordings
  const [isRecordingMaster, setIsRecordingMaster] = useState(false);
  const [masterMediaRecorder, setMasterMediaRecorder] = useState<MediaRecorder | null>(null);
  const [masterAudioChunks, setMasterAudioChunks] = useState<Blob[]>([]);

  // Mic/Pad local recording states
  const [micRecordingBlockId, setMicRecordingBlockId] = useState<number | null>(null);
  const [padRecordingBlockId, setPadRecordingBlockId] = useState<number | null>(null);
  const [micSecondsCount, setMicSecondsCount] = useState(0);
  const [padJamNotes, setPadJamNotes] = useState<Array<{ padId: string; time: number }>>([]);

  const [activeKeys, setActivePads] = useState<{ [id: string]: boolean }>({});
  const [currentInfoTab, setCurrentInfoTab] = useState<"pads" | "volumes" | "blocks" | "timeline">("pads");
  const [padZone, setPadZone] = useState<"instruments" | "sfx" | "all">("all");

  const [padVolumes, setPadVolumes] = useState<Record<string, number>>({
    kick: 0.8,
    snare: 0.8,
    "hihat-cls": 0.8,
    "hihat-opn": 0.8,
    "tom-high": 0.8,
    "tom-mid": 0.8,
    "tom-low": 0.8,
    cowbell: 0.8,
    shaker: 0.8,
    clap: 0.8,
    "synth-bass": 0.8,
    "synth-lead": 0.8,
    "trumpet-melody": 0.8,
    "laser-zap": 0.8,
    whoosh: 0.8,
    "metallic-ring": 0.8,
    "glitch-bleep": 0.8,
    "air-horn": 0.8,
    rimshot: 0.8,
    drone: 0.8,
    "rev-cymbal": 0.8,
    "alien-tap": 0.8,
    "scifi-gun": 0.8,
  });
  
  // Vinyl visual rotation angle state
  const [vinylAngle, setVinylAngle] = useState(0);

  // Create Refs for real-time playhead scheduler loops to bypass state-lag
  const blocksRef = useRef<AudioBlock[]>(blocks);
  const timelineRef = useRef<TimelineEvent[]>(timeline);
  const bpmRef = useRef(bpm);
  const masterVolumeRef = useRef(masterVolume);
  const globalFxRef = useRef(globalFx);
  const isPlayingRef = useRef(isPlaying);
  const padsRecordingNotesRef = useRef<Array<{ padId: string; time: number }>>([]);
  const padRecordingStartTimeRef = useRef<number>(0);
  const padVolumesRef = useRef<Record<string, number>>(padVolumes);
  const masterMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const masterAudioChunksRef = useRef<Blob[]>([]);
  const masterDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { timelineRef.current = timeline; }, [timeline]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { masterVolumeRef.current = masterVolume; }, [masterVolume]);
  useEffect(() => { globalFxRef.current = globalFx; }, [globalFx]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { padVolumesRef.current = padVolumes; }, [padVolumes]);

  // Keep Vinyl slowly rotating on playhead updates
  useEffect(() => {
    let animId: number;
    if (isPlaying && !globalFx.scratchStop) {
      const updateAngle = () => {
        setVinylAngle((prev) => (prev + (bpm / 60) * 1.8) % 360);
        animId = requestAnimationFrame(updateAngle);
      };
      animId = requestAnimationFrame(updateAngle);
    }
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, bpm, globalFx.scratchStop]);

  // Preset blocks generation upon startup so the user hears music files on day 1
  useEffect(() => {
    const loadStartupBeats = async () => {
      try {
        const hRes = await renderPresetLoop("house");
        const sRes = await renderPresetLoop("synthwave");
        setBlocks((prev) =>
          prev.map((b) => {
            if (b.id === 1) {
              return {
                ...b,
                type: "preset-loop",
                name: "Retro House Beat",
                audioBuffer: hRes.buffer,
                waveformPoints: hRes.points,
                duration: hRes.buffer.duration,
              };
            }
            if (b.id === 2) {
              return {
                ...b,
                type: "preset-loop",
                name: "Aether Synth Arp",
                audioBuffer: sRes.buffer,
                waveformPoints: sRes.points,
                duration: sRes.buffer.duration,
              };
            }
            return b;
          })
        );
      } catch (err) {
        console.error("Autoplay buffer generation blocked until gesture", err);
      }
    };
    loadStartupBeats();
  }, []);

  // Metronome audio pulse trigger
  const playMetronomeSound = (ctx: AudioContext, freq: number) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gainNode);
    gainNode.connect(getMasterOutputNode(ctx));
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  };

  // Playhead step trigger callback
  const playTimelineStep = useCallback((beatIndex: number) => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // Trigger metronome woodblock if active
    if (isMetronomeOn && beatIndex % 4 === 0) {
      playMetronomeSound(ctx, beatIndex === 0 ? 1200 : 750);
    }

    // Capture elements scheduled on this specific pulse beat
    const stepEvents = timelineRef.current.filter((ev) => ev.startBeat === beatIndex);

    stepEvents.forEach((ev) => {
      const block = blocksRef.current.find((b) => b.id === ev.blockId);
      if (!block || !block.audioBuffer) return;

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = block.audioBuffer;

      // Base sample rate multiplier
      const baseRate = block.pitch;

      const blockGain = ctx.createGain();
      // Combine individual channel volume and master level multipliers
      blockGain.gain.setValueAtTime(block.volume * masterVolumeRef.current, ctx.currentTime);

      const effects = createEffectsGraph(ctx, sourceNode, blockGain, block);
      blockGain.connect(getMasterOutputNode(ctx));

      // Realtime pitch bend and scratch stops scale calculations
      let scale = 1.0 + globalFxRef.current.pitchBend * 0.35;
      if (globalFxRef.current.scratchStop) {
        scale = globalFxRef.current.scratchSpeed;
      }
      sourceNode.playbackRate.setValueAtTime(baseRate * Math.max(0.015, scale), ctx.currentTime);

      const playRef = {
        sourceNode,
        gainNode: blockGain,
        blockId: block.id,
        baseRate,
        localVolumeNode: effects.localVolume,
        filterNode: effects.filterNode,
        delayFeedbackNode: effects.delayFeedbackNode,
        delayWetNode: effects.delayWet,
        reverbWetNode: effects.reverbWet,
      };

      livePlayInstances.add(playRef);
      sourceNode.onended = () => {
        livePlayInstances.delete(playRef);
      };

      // Play through timeline
      sourceNode.start(0);
      sourceNode.stop(ctx.currentTime + block.duration / baseRate + 2.0); // Padding space for decay tail
    });
  }, [isMetronomeOn]);

  // Master Clock sequencer tick handler
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = (60 / bpm) * 1000;
    
    const triggerTick = () => {
      setCurrentBeat((prev) => {
        const next = (prev + 1) % 32;
        playTimelineStep(next);
        return next;
      });
    };

    // Fire the initial tick on play tap
    playTimelineStep(currentBeat);

    const clockTimer = setInterval(triggerTick, intervalMs);
    return () => clearInterval(clockTimer);
  }, [isPlaying, bpm, playTimelineStep]);

  // Synthesize Drum Pad inputs on user trigger
  const triggerPadPlay = (padId: string, pitchFactor = 1.0) => {
    const ctx = getAudioContext();
    
    // Retrieve custom settings for this pad
    const settings = padSettingsRef.current?.[padId] ?? {
      pitchOffset: 0,
      baseNoteIndex: 0,
      melodySequence: [],
      currentSeqIndex: 0,
      useSequence: false,
      effects: { echo: false, reverb: false, muffle: false },
      sound: { decayMultiplier: 1.0, cutoff: 20000, resonance: 1.0, drive: 0, noiseLevel: 0 }
    };

    // Create local pad channel strip Gain Node to apply user's mix volume in real-time
    const padGainNode = ctx.createGain();
    const padVol = padVolumesRef.current?.[padId] ?? 0.8;
    padGainNode.gain.setValueAtTime(padVol, ctx.currentTime);
    
    // Run all outputs through the individual effects graph!
    applyEffectsToNode(ctx, padGainNode, getMasterOutputNode(ctx), settings.effects, settings.sound);

    // Pulse glowing neon states
    setActivePads((prev) => ({ ...prev, [padId]: true }));
    setTimeout(() => {
      setActivePads((prev) => ({ ...prev, [padId]: false }));
    }, 180);

    // If pad performance recording is active, track midi timings
    if (padRecordingBlockId !== null) {
      const offsetMs = Date.now() - padRecordingStartTimeRef.current;
      padsRecordingNotesRef.current.push({ padId, time: offsetMs / 1000 });
      setPadJamNotes([...padsRecordingNotesRef.current]);
    }

    try {
      // 1. Calculate noteIndex for melody-type pads, OR pitchMultiplier for drum-type pads
      const isMelody = ["synth-bass", "trumpet-melody", "drone", "alien-tap", "plucked-string", "fat-sub", "fm-organ", "synthwave-lead"].includes(padId);
      
      let noteIndex = settings.baseNoteIndex;
      if (isMelody && settings.useSequence && settings.melodySequence.length > 0) {
        noteIndex = settings.melodySequence[settings.currentSeqIndex];
        // Advance melody player sequence index statefully
        const nextIdx = (settings.currentSeqIndex + 1) % settings.melodySequence.length;
        setPadSettings((prev) => ({
          ...prev,
          [padId]: {
            ...prev[padId],
            currentSeqIndex: nextIdx,
          }
        }));
      }

      const pitchMultiplier = Math.pow(2, settings.pitchOffset / 12) * pitchFactor;

      // 2. Synthesize with computed values!
      if (padId === "kick") synthKick(ctx, padGainNode, ctx.currentTime, 1.0, pitchMultiplier);
      else if (padId === "snare") synthSnare(ctx, padGainNode, ctx.currentTime, 0.9, pitchMultiplier);
      else if (padId === "hihat-cls") synthHiHat(ctx, padGainNode, ctx.currentTime, 0.5, false, pitchMultiplier);
      else if (padId === "hihat-opn") synthHiHat(ctx, padGainNode, ctx.currentTime, 0.55, true, pitchMultiplier);
      else if (padId === "tom-high") synthTom(ctx, padGainNode, ctx.currentTime, "high", 0.95, pitchMultiplier);
      else if (padId === "tom-mid") synthTom(ctx, padGainNode, ctx.currentTime, "mid", 0.95, pitchMultiplier);
      else if (padId === "tom-low") synthTom(ctx, padGainNode, ctx.currentTime, "low", 0.95, pitchMultiplier);
      else if (padId === "cowbell") synthCowbell(ctx, padGainNode, ctx.currentTime, 0.8, pitchMultiplier);
      else if (padId === "shaker") synthShaker(ctx, padGainNode, ctx.currentTime, 0.7, pitchMultiplier);
      else if (padId === "clap") synthClap(ctx, padGainNode, ctx.currentTime, 0.85, pitchMultiplier);
      else if (padId === "synth-bass") synthBassNode(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "synth-lead" || padId === "trumpet-melody") {
        synthTrumpet(ctx, padGainNode, ctx.currentTime, noteIndex, 0.75);
      }
      else if (padId === "laser-zap") synthLaserZap(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "whoosh") synthWhoosh(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "metallic-ring") synthMetallicRing(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "glitch-bleep") synthGlitchBleep(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "air-horn") synthAirHorn(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "rimshot") synthRimshot(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "drone") synthSpaceDrone(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "rev-cymbal") synthReverseCymbal(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "alien-tap") synthAlienTap(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "scifi-gun") synthSciFiGun(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "plucked-string") synthBellPluck(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "fat-sub") synthFatSub(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "fm-organ") synthFMOrgan(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "synthwave-lead") synthRetroLead(ctx, padGainNode, ctx.currentTime, noteIndex, 1.0);
      else if (padId === "scratch-sfx") synthVocalScratch(ctx, padGainNode, ctx.currentTime, 1.0);
      else if (padId === "vinyl-crackle") synthVinylCrackle(ctx, padGainNode, ctx.currentTime, 1.0);
    } catch (err) {
      console.warn("Synth trigger context bypassed", err);
    }
  };

  // Keyboard shortcut actions for tactile pad interactions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        return; // ignore during rename input focus
      }
      const key = e.key.toLowerCase();
      if (key === "q") triggerPadPlay("kick");
      if (key === "w") triggerPadPlay("snare");
      if (key === "e") triggerPadPlay("hihat-cls");
      if (key === "j") triggerPadPlay("hihat-opn");
      if (key === "k") triggerPadPlay("cowbell");
      if (key === "l") triggerPadPlay("shaker");
      if (key === "z") triggerPadPlay("tom-high");
      if (key === "x") triggerPadPlay("tom-mid");
      if (key === "c") triggerPadPlay("tom-low");
      if (key === "r") triggerPadPlay("clap");
      if (key === "t") triggerPadPlay("synth-bass");
      if (key === "y") triggerPadPlay("trumpet-melody");
      if (key === "u") triggerPadPlay("laser-zap");
      if (key === "i") triggerPadPlay("whoosh");
      if (key === "o") triggerPadPlay("metallic-ring");
      if (key === "p") triggerPadPlay("glitch-bleep");
      if (key === "a") triggerPadPlay("air-horn");
      if (key === "s") triggerPadPlay("rimshot");
      if (key === "d") triggerPadPlay("drone");
      if (key === "f") triggerPadPlay("rev-cymbal");
      if (key === "g") triggerPadPlay("alien-tap");
      if (key === "h") triggerPadPlay("scifi-gun");
      if (key === "v") triggerPadPlay("plucked-string");
      if (key === "b") triggerPadPlay("fat-sub");
      if (key === "n") triggerPadPlay("fm-organ");
      if (key === "m") triggerPadPlay("synthwave-lead");
      if (key === "1") triggerPadPlay("scratch-sfx");
      if (key === "2") triggerPadPlay("vinyl-crackle");
      
      // Transport control hotkeys
      if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [padRecordingBlockId]);

  // Spring back pitch bend wheel controller behavior
  const handlePitchBendRelease = () => {
    let curVal = globalFx.pitchBend;
    const decrementsCount = 10;
    const intervalTime = 16; // ms
    const reductionFactor = curVal / decrementsCount;
    let stepCount = 0;

    const springClock = setInterval(() => {
      curVal -= reductionFactor;
      stepCount++;

      if (stepCount >= decrementsCount || Math.abs(curVal) < 0.04) {
        clearInterval(springClock);
        curVal = 0.0;
      }

      setGlobalFx((prev) => {
        const next = { ...prev, pitchBend: curVal };
        updateActivePlaybackRates(next);
        return next;
      });
    }, intervalTime);
  };

  const handleVinylScratchChange = (val: number) => {
    // Scratch disk behavior: Adjusts playback acceleration and flags stop sweep
    const value = parseFloat(val.toString());
    setGlobalFx((prev) => {
      const next = {
        ...prev,
        scratchSpeed: value,
        scratchStop: value < 0.95 || value > 1.05,
      };
      updateActivePlaybackRates(next);
      return next;
    });
  };

  const handleVinylScratchRelease = () => {
    // Automatically spring playback speed rate back to flat, organic 1.0 normal rate
    setGlobalFx((prev) => {
      const next = { ...prev, scratchSpeed: 1.0, scratchStop: false };
      updateActivePlaybackRates(next);
      return next;
    });
  };

  // Vinyl motor speed drag controller stops
  const toggleVinylMotorStop = () => {
    if (globalFx.scratchStop) {
      // Classic vinyl spin startup acceleration
      let cur = 0.01;
      const startClock = setInterval(() => {
        cur += 0.12;
        if (cur >= 1.0) {
          cur = 1.0;
          clearInterval(startClock);
          setGlobalFx((prev) => {
            const next = { ...prev, scratchSpeed: 1.0, scratchStop: false };
            updateActivePlaybackRates(next);
            return next;
          });
        } else {
          setGlobalFx((prev) => {
            const next = { ...prev, scratchSpeed: cur, scratchStop: true };
            updateActivePlaybackRates(next);
            return next;
          });
        }
      }, 35);
    } else {
      // Slow vinyl brake deceleration stop over 1.2 seconds
      let cur = 1.0;
      const stopClock = setInterval(() => {
        cur -= 0.095;
        if (cur <= 0.01) {
          cur = 0.0;
          clearInterval(stopClock);
          setGlobalFx((prev) => {
            const next = { ...prev, scratchSpeed: 0.0, scratchStop: true };
            updateActivePlaybackRates(next);
            return next;
          });
        } else {
          setGlobalFx((prev) => {
            const next = { ...prev, scratchSpeed: cur, scratchStop: true };
            updateActivePlaybackRates(next);
            return next;
          });
        }
      }, 40);
    }
  };

  const [playingAuditionBlockId, setPlayingAuditionBlockId] = useState<number | null>(null);
  const auditionSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopBlockAudition = () => {
    if (auditionSourceRef.current) {
      try {
        auditionSourceRef.current.stop();
      } catch (e) {}
      auditionSourceRef.current = null;
    }
    setPlayingAuditionBlockId(null);
  };

  const triggerBlockAudition = (blockId: number) => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    if (playingAuditionBlockId === blockId) {
      stopBlockAudition();
      return;
    }

    stopBlockAudition();

    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!block || !block.audioBuffer) return;

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = block.audioBuffer;

    const baseRate = block.pitch;

    const blockGain = ctx.createGain();
    blockGain.gain.setValueAtTime(block.volume * masterVolumeRef.current, ctx.currentTime);

    const effects = createEffectsGraph(ctx, sourceNode, blockGain, block);
    blockGain.connect(getMasterOutputNode(ctx));

    sourceNode.playbackRate.setValueAtTime(baseRate, ctx.currentTime);

    const playRef = {
      sourceNode,
      gainNode: blockGain,
      blockId: block.id,
      baseRate,
      localVolumeNode: effects.localVolume,
      filterNode: effects.filterNode,
      delayFeedbackNode: effects.delayFeedbackNode,
      delayWetNode: effects.delayWet,
      reverbWetNode: effects.reverbWet,
    };

    livePlayInstances.add(playRef);
    setPlayingAuditionBlockId(blockId);
    auditionSourceRef.current = sourceNode;

    sourceNode.onended = () => {
      livePlayInstances.delete(playRef);
      setPlayingAuditionBlockId((curr) => curr === blockId ? null : curr);
      if (auditionSourceRef.current === sourceNode) {
        auditionSourceRef.current = null;
      }
    };

    sourceNode.start(0);
  };

  // Individual audio block parameter changes helpers
  const updateBlockValue = (blockId: number, key: keyof AudioBlock, value: any) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, [key]: value } : b))
    );
    // Notify audio engine to apply changes in real-time if a sound is currently playing
    if (typeof value === "number") {
      updateActiveBlockParameters(blockId, key, value, masterVolumeRef.current);
    }
  };

  // High fidelity loop baking engines
  const triggerPresetBake = async (targetId: number, type: "house" | "hiphop" | "techno" | "synthwave" | "bassline") => {
    try {
      const result = await renderPresetLoop(type);
      const namesMap: Record<string, string> = {
        house: "House Loop",
        hiphop: "Boom-Bap Beats",
        techno: "Hard Bass Techno",
        synthwave: "Synth Arpeggio Loop",
        bassline: "Fat Modulated Bassline",
      };
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === targetId
            ? {
                ...b,
                type: "preset-loop",
                name: namesMap[type] || "Custom Loop",
                audioBuffer: result.buffer,
                waveformPoints: result.points,
                duration: result.buffer.duration,
              }
            : b
        )
      );
    } catch (err) {
      console.error("Renderer thread crashed", err);
    }
  };

  // Hard Reset workspace buttons parameters
  const triggerFullReset = () => {
    setIsPlaying(false);
    setCurrentBeat(0);
    setTimeline([
      { id: "e1", blockId: 1, trackIndex: 0, startBeat: 0, durationBeats: 4 },
      { id: "e2", blockId: 1, trackIndex: 0, startBeat: 4, durationBeats: 4 },
      { id: "e3", blockId: 1, trackIndex: 0, startBeat: 8, durationBeats: 4 },
    ]);
    setBlocks((prev) =>
      prev.map((b) => ({
        ...b,
        type: b.id === 1 || b.id === 2 ? b.type : "empty",
        audioBuffer: b.id === 1 || b.id === 2 ? b.audioBuffer : null,
        waveformPoints: b.id === 1 || b.id === 2 ? b.waveformPoints : makeEmptyWaveform(),
        duration: b.id === 1 || b.id === 2 ? b.duration : 0,
        volume: 0.8,
        pitch: 1.0,
        delay: 0.0,
        reverb: 0.0,
        lowpass: 0.0,
      }))
    );
    setBpm(120);
    setMasterVolume(0.85);
    setGlobalFx({
      scratchSpeed: 1.0,
      scratchStop: false,
      delayTime: 0.3,
      delayFeedback: 0.4,
      reverbMix: 0.2,
      pitchBend: 0.0,
    });
    setMicRecordingBlockId(null);
    setPadRecordingBlockId(null);
    setPadZone("all");
    setPadVolumes({
      kick: 0.8,
      snare: 0.8,
      "hihat-cls": 0.8,
      "hihat-opn": 0.8,
      "tom-high": 0.8,
      "tom-mid": 0.8,
      "tom-low": 0.8,
      cowbell: 0.8,
      shaker: 0.8,
      clap: 0.8,
      "synth-bass": 0.8,
      "synth-lead": 0.8,
      "trumpet-melody": 0.8,
      "laser-zap": 0.8,
      whoosh: 0.8,
      "metallic-ring": 0.8,
      "glitch-bleep": 0.8,
      "air-horn": 0.8,
      rimshot: 0.8,
      drone: 0.8,
      "rev-cymbal": 0.8,
      "alien-tap": 0.8,
      "scifi-gun": 0.8,
    });
  };

  // Hardware Microphone record captures
  const startMicRecording = async (targetBlockId: number) => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(mediaStream);
      const audioChunks: Blob[] = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunks.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        ctx.decodeAudioData(
          arrayBuffer,
          (decodedBuffer) => {
            const visualWave = computeWaveformFromBuffer(decodedBuffer);
            setBlocks((prev) =>
              prev.map((b) =>
                b.id === targetBlockId
                  ? {
                      ...b,
                      type: "mic-recording",
                      name: `Vocal Recording #${targetBlockId}`,
                      audioBuffer: decodedBuffer,
                      waveformPoints: visualWave,
                      duration: decodedBuffer.duration,
                    }
                  : b
              )
            );
          },
          (err) => {
            console.error("Audio buffer decoder thread failed", err);
          }
        );

        // Turn off stream tracks immediately
        mediaStream.getTracks().forEach((track) => track.stop());
      };

      // Set state to trigger timers
      setMicRecordingBlockId(targetBlockId);
      setMicSecondsCount(0);
      recorder.start();

      (window as any).activeMicRecorder = recorder;
    } catch (err) {
      console.error("Access to microphone media interface was denied", err);
      alert("Microphone connection failed. Please enable browser microphone access for recordings.");
    }
  };

  // Mic Timer counters
  useEffect(() => {
    let timerClock: any;
    if (micRecordingBlockId !== null) {
      timerClock = setInterval(() => {
        setMicSecondsCount((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timerClock);
  }, [micRecordingBlockId]);

  const stopMicRecording = () => {
    const recorder = (window as any).activeMicRecorder as MediaRecorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setMicRecordingBlockId(null);
  };

  // Pad Playback Jams recordings
  const startPadJamRecording = (targetBlockId: number) => {
    padsRecordingNotesRef.current = [];
    padRecordingStartTimeRef.current = Date.now();
    setPadJamNotes([]);
    setPadRecordingBlockId(targetBlockId);
    setMicSecondsCount(0);
  };

  // Jam Recording completion synthesis
  const stopPadJamRecording = async (targetBlockId: number) => {
    setPadRecordingBlockId(null);
    const notes = padsRecordingNotesRef.current;
    if (notes.length === 0) {
      return;
    }

    // Dynamic compilation using standard Offline Context to make user-friendly playable layers
    const ctx = getAudioContext();
    const sampleRate = ctx.sampleRate;
    const totalLength = 4.0; // 4 seconds record loop standard
    
    const offline = new OfflineAudioContext(2, sampleRate * totalLength, sampleRate);
    const out = offline.destination;

    const localSeqIndices: Record<string, number> = {};

    notes.forEach((note) => {
      const triggerTime = note.time;
      if (triggerTime >= totalLength) return;

      const settings = padSettingsRef.current?.[note.padId] ?? {
        pitchOffset: 0,
        baseNoteIndex: 0,
        melodySequence: [],
        currentSeqIndex: 0,
        useSequence: false,
        effects: { echo: false, reverb: false, muffle: false },
        sound: { decayMultiplier: 1.0, cutoff: 20000, resonance: 1.0, drive: 0, noiseLevel: 0 }
      };

      const padGainNode = offline.createGain();
      const padVol = padVolumesRef.current?.[note.padId] ?? 0.8;
      padGainNode.gain.setValueAtTime(padVol, triggerTime);
      
      // Apply offline custom effects and sound parameters!
      applyEffectsToNode(offline, padGainNode, out, settings.effects, settings.sound);

      const isMelody = ["synth-bass", "trumpet-melody", "drone", "alien-tap"].includes(note.padId);
      
      let noteIndex = settings.baseNoteIndex;
      if (isMelody && settings.useSequence && settings.melodySequence.length > 0) {
        if (localSeqIndices[note.padId] === undefined) {
          localSeqIndices[note.padId] = 0;
        }
        const sIdx = localSeqIndices[note.padId];
        noteIndex = settings.melodySequence[sIdx];
        localSeqIndices[note.padId] = (sIdx + 1) % settings.melodySequence.length;
      }

      const pitchMultiplier = Math.pow(2, settings.pitchOffset / 12);

      if (note.padId === "kick") synthKick(offline, padGainNode, triggerTime, 1.0, pitchMultiplier);
      else if (note.padId === "snare") synthSnare(offline, padGainNode, triggerTime, 0.9, pitchMultiplier);
      else if (note.padId === "hihat-cls") synthHiHat(offline, padGainNode, triggerTime, 0.5, false, pitchMultiplier);
      else if (note.padId === "hihat-opn") synthHiHat(offline, padGainNode, triggerTime, 0.55, true, pitchMultiplier);
      else if (note.padId === "tom-high") synthTom(offline, padGainNode, triggerTime, "high", 0.95, pitchMultiplier);
      else if (note.padId === "tom-mid") synthTom(offline, padGainNode, triggerTime, "mid", 0.95, pitchMultiplier);
      else if (note.padId === "tom-low") synthTom(offline, padGainNode, triggerTime, "low", 0.95, pitchMultiplier);
      else if (note.padId === "cowbell") synthCowbell(offline, padGainNode, triggerTime, 0.8, pitchMultiplier);
      else if (note.padId === "shaker") synthShaker(offline, padGainNode, triggerTime, 0.7, pitchMultiplier);
      else if (note.padId === "clap") synthClap(offline, padGainNode, triggerTime, 0.85, pitchMultiplier);
      else if (note.padId === "synth-bass") synthBassNode(offline, padGainNode, triggerTime, noteIndex, 1.0);
      else if (note.padId === "synth-lead" || note.padId === "trumpet-melody") {
        synthTrumpet(offline, padGainNode, triggerTime, noteIndex, 0.75);
      }
      else if (note.padId === "laser-zap") synthLaserZap(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "whoosh") synthWhoosh(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "metallic-ring") synthMetallicRing(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "glitch-bleep") synthGlitchBleep(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "air-horn") synthAirHorn(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "rimshot") synthRimshot(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "drone") synthSpaceDrone(offline, padGainNode, triggerTime, noteIndex, 1.0);
      else if (note.padId === "rev-cymbal") synthReverseCymbal(offline, padGainNode, triggerTime, 1.0);
      else if (note.padId === "alien-tap") synthAlienTap(offline, padGainNode, triggerTime, noteIndex, 1.0);
      else if (note.padId === "scifi-gun") synthSciFiGun(offline, padGainNode, triggerTime, 1.0);
    });

    const rendered = await offline.startRendering();
    const visualWave = computeWaveformFromBuffer(rendered);

    setBlocks((prev) =>
      prev.map((b) =>
        b.id === targetBlockId
          ? {
              ...b,
              type: "pad-recording",
              name: `Drum Pad Jam #${targetBlockId}`,
              audioBuffer: rendered,
              waveformPoints: visualWave,
              duration: rendered.duration,
            }
          : b
      )
    );
  };

  // Real-time complete Performance Recording
  const startMasterPerformanceRecording = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") ctx.resume();

      // Clear previous chunks
      masterAudioChunksRef.current = [];

      // Create a master destination
      const dest = ctx.createMediaStreamDestination();
      masterDestinationRef.current = dest;

      // Connect master output node to the recorder destination
      const masterOutput = getMasterOutputNode(ctx);
      masterOutput.connect(dest);

      // Determine mime-type
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/aac";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = ""; // Fallback
      }

      const recorder = mimeType 
        ? new MediaRecorder(dest.stream, { mimeType }) 
        : new MediaRecorder(dest.stream);

      masterMediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          masterAudioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const recordedBlob = new Blob(masterAudioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const downloadUrl = URL.createObjectURL(recordedBlob);
        const downloadTrigger = document.createElement("a");
        downloadTrigger.href = downloadUrl;
        downloadTrigger.download = `bandboard_performance_${Date.now()}.webm`;
        document.body.appendChild(downloadTrigger);
        downloadTrigger.click();
        document.body.removeChild(downloadTrigger);
        URL.revokeObjectURL(downloadUrl);

        // Disconnect
        if (masterDestinationRef.current) {
          try {
            masterOutput.disconnect(masterDestinationRef.current);
          } catch (e) {}
          masterDestinationRef.current = null;
        }
      };

      recorder.start(250); // Slice chunks every 250ms
      setIsRecordingMaster(true);

      // Always play from beat 1 when starting a performance recording
      setCurrentBeat(0);
      setIsPlaying(true);
    } catch (err) {
      console.error("Failed to start performance recording:", err);
      alert("Performance recording could not start. Please check browser permissions and try again.");
    }
  };

  const stopMasterPerformanceRecording = () => {
    setIsRecordingMaster(false);
    if (masterMediaRecorderRef.current && masterMediaRecorderRef.current.state !== "inactive") {
      masterMediaRecorderRef.current.stop();
    }
  };

  // Sequencer Grid Paint-Brush brush behaviors
  const toggleTimelineSlot = (trackIndex: number, startBeat: number) => {
    // Check if place is occupied
    const matched = timeline.find(
      (ev) =>
        ev.trackIndex === trackIndex &&
        startBeat >= ev.startBeat &&
        startBeat < ev.startBeat + ev.durationBeats
    );

    if (matched) {
      // Set this clip as active for detail configuration!
      setSelectedTimelineClipId(matched.id);
    } else {
      // Insert selected brush block onto timeline
      const block = blocks.find((b) => b.id === selectedPaintBlockId);
      if (!block) return;

      // Determine default duration length (user selected paint brush length in grid beats)
      const duration = brushSteps;

      const newClip: TimelineEvent = {
        id: `c_${Date.now()}_${Math.random()}`,
        blockId: selectedPaintBlockId,
        trackIndex,
        startBeat,
        durationBeats: duration,
      };
      setTimeline((prev) => [...prev, newClip]);
      setSelectedTimelineClipId(newClip.id);
    }
  };

  // Immediate High Speed Mix download Exports
  const handleMixDownExport = async () => {
    try {
      setIsPlaying(false);
      const outputBlob = await exportMix(blocks, timeline, bpm, masterVolume, globalFx);
      const downloadUrl = URL.createObjectURL(outputBlob);
      const downloadTrigger = document.createElement("a");
      downloadTrigger.href = downloadUrl;
      downloadTrigger.download = `bandboard_mixdown_${bpm}bpm.wav`;
      document.body.appendChild(downloadTrigger);
      downloadTrigger.click();
      document.body.removeChild(downloadTrigger);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Export thread was interrupted", err);
      alert("Failed to render master mix. Make sure your browser has Audio capabilities enabled.");
    }
  };

  // Predefined UI layouts values
  const trackLabels = [
    { name: "🥁 Beats Track", color: "border-emerald-500/20 text-emerald-400" },
    { name: "🎹 Melodic Hooks", color: "border-cyan-500/20 text-cyan-400" },
    { name: "🎙️ Vocals & Recs", color: "border-pink-500/20 text-pink-400" },
    { name: "✨ Atmosphere FX", color: "border-amber-500/20 text-amber-400" },
  ];

  const padDetails: DrumPad[] = [
    { id: "kick", label: "Kick Drum [Q]", color: "from-emerald-600 to-emerald-800 focus:ring-emerald-500 shadow-emerald-500/20", triggerKey: "Q", type: "drum" },
    { id: "snare", label: "Snare Tap [W]", color: "from-teal-600 to-teal-800 focus:ring-teal-500 shadow-teal-500/20", triggerKey: "W", type: "drum" },
    { id: "hihat-cls", label: "Closed Hat [E]", color: "from-cyan-600 to-cyan-800 focus:ring-cyan-500 shadow-cyan-500/20", triggerKey: "E", type: "drum" },
    { id: "hihat-opn", label: "Open Hat [J]", color: "from-sky-700 to-sky-900 focus:ring-sky-600 shadow-sky-600/20", triggerKey: "J", type: "drum" },
    { id: "cowbell", label: "808 Cowbell [K]", color: "from-amber-700 to-amber-900 focus:ring-amber-600 shadow-amber-600/20", triggerKey: "K", type: "drum" },
    { id: "shaker", label: "Shaker [L]", color: "from-teal-700 to-teal-900 focus:ring-teal-600 shadow-teal-600/20", triggerKey: "L", type: "drum" },
    { id: "tom-high", label: "High Tom [Z]", color: "from-rose-700 to-rose-950 focus:ring-rose-500 shadow-rose-500/25", triggerKey: "Z", type: "drum" },
    { id: "tom-mid", label: "Mid Tom [X]", color: "from-pink-700 to-pink-950 focus:ring-pink-500 shadow-pink-500/25", triggerKey: "X", type: "drum" },
    { id: "tom-low", label: "Low Tom [C]", color: "from-purple-700 to-purple-950 focus:ring-purple-500 shadow-purple-500/25", triggerKey: "C", type: "drum" },
    { id: "clap", label: "Hand Clap [R]", color: "from-purple-600 to-purple-800 focus:ring-purple-500 shadow-purple-500/20", triggerKey: "R", type: "drum" },
    { id: "synth-bass", label: "Synth Sub [T]", color: "from-pink-600 to-pink-800 focus:ring-pink-500 shadow-pink-500/20", triggerKey: "T", type: "synth" },
    { id: "trumpet-melody", label: "Trumpet Melody [Y]", color: "from-amber-600 to-amber-800 focus:ring-amber-500 shadow-amber-500/20", triggerKey: "Y", type: "synth" },
    { id: "laser-zap", label: "Laser Zap [U]", color: "from-indigo-600 to-indigo-800 focus:ring-indigo-500 shadow-indigo-500/20", triggerKey: "U", type: "fx" },
    { id: "whoosh", label: "Deep Whoosh [I]", color: "from-sky-600 to-sky-800 focus:ring-sky-500 shadow-sky-500/20", triggerKey: "I", type: "fx" },
    { id: "metallic-ring", label: "Metal Ring [O]", color: "from-rose-600 to-rose-800 focus:ring-rose-500 shadow-rose-500/20", triggerKey: "O", type: "fx" },
    { id: "glitch-bleep", label: "Glitch Bleep [P]", color: "from-lime-600 to-lime-800 focus:ring-lime-500 shadow-lime-500/20", triggerKey: "P", type: "fx" },
    { id: "air-horn", label: "Air Horn [A]", color: "from-red-600 to-red-800 focus:ring-red-500 shadow-red-500/20", triggerKey: "A", type: "fx" },
    { id: "rimshot", label: "Rimshot Tap [S]", color: "from-yellow-600 to-yellow-800 focus:ring-yellow-500 shadow-yellow-500/20", triggerKey: "S", type: "drum" },
    { id: "drone", label: "Space Drone [D]", color: "from-slate-600 to-slate-800 focus:ring-slate-500 shadow-slate-500/20", triggerKey: "D", type: "synth" },
    { id: "rev-cymbal", label: "Reverse Cym [F]", color: "from-violet-600 to-violet-800 focus:ring-violet-500 shadow-violet-500/20", triggerKey: "F", type: "fx" },
    { id: "alien-tap", label: "Alien Tap [G]", color: "from-emerald-700 to-emerald-900 focus:ring-emerald-600 shadow-emerald-600/20", triggerKey: "G", type: "synth" },
    { id: "scifi-gun", label: "Sci-Fi Gun [H]", color: "from-fuchsia-600 to-fuchsia-800 focus:ring-fuchsia-500 shadow-fuchsia-500/20", triggerKey: "H", type: "fx" },
  ];

  // Active block reference details
  const activeBlock = blocks.find((b) => b.id === activeBlockId);

  // Derived settings for currently right-clicked / customized pad (calculated dynamically)
  const customizingPad = padDetails.find((p) => p.id === customizingPadId);
  const padCustomSettings = customizingPad ? padSettings[customizingPad.id] : null;

  return (
    <div className="min-h-screen bg-[#07090e] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,24,48,0.6),rgba(0,0,0,0))] text-zinc-100 font-sans p-2 sm:p-4">
      {/* Absolute Header Area */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between border-b border-zinc-800 pb-4 mb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="relative py-1 px-3 bg-cyan-500/10 border border-cyan-400 rounded-lg text-cyan-400 font-mono text-xs tracking-wider uppercase animate-pulse">
              Studio Active
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
              DJ Board and Music Timeline
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-xl">
            A real-time hybrid workstation. Synthesize instant beats, record live vocals inside 20 modular block channels, tweak physical vinyl brakes, and arrange compositions.
          </p>
        </div>

        {/* Global Toolbar and Master Reset */}
        <div className="flex items-center gap-2 justify-end w-full md:w-auto">
          <button
            onClick={triggerFullReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-lg text-xs font-semibold text-zinc-300 transition-colors cursor-pointer"
            id="btn-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Workspace
          </button>

          <a
            href="#help"
            onClick={(e) => {
              e.preventDefault();
              alert(
                "=== HELPFUL STUDIO DICTIONARY ===\n\n" +
                  "1. DJ DRUM PADS: Trigger live synthetic drums. Key binds (Q, W, E, R, T, Y) trigger corresponding sounds.\n" +
                  "2. VINYL PLATER & BRAKES: Slow down playback speed dynamically or tap 'VINYL BRAKE' to smoothly stop and start all audios with real vinyl stop bends.\n" +
                  "3. SPRING PITCHWHEEL: Move up/down to coarse tune, release to spring back to neutral.\n" +
                  "4. 20 CHANNELS: Click a block index, record microphone sound inside, or use high quality bake loop. Adjust Local Echo/Delays per slot!\n" +
                  "5. TIMELINE SEQUENCER: Click empty beats on tracks to paint. Select your active painting block below the matrix."
              );
            }}
            className="flex items-center gap-1 bg-zinc-950 font-mono hover:bg-zinc-900 text-zinc-400 p-2 border border-zinc-800 rounded-lg text-xs"
          >
            <HelpCircle className="w-4 h-4 text-cyan-400" /> Help
          </a>
        </div>
      </header>

      {/* Main Column Framework */}
      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* LEFT COLUMN: DJ Studio Deck (5 grid cols span) */}
        <div className="lg:col-span-5 bg-[#0b0f16]/95 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
              <span className="text-xs font-mono tracking-widest text-[#00ffcc] uppercase flex items-center gap-1.5">
                <Disc className="w-3.5 h-3.5 animate-spin" /> Live DJ Controller
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentInfoTab("pads")}
                  className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded transition cursor-pointer ${
                    currentInfoTab === "pads" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/25" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Pads Grid
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentInfoTab("volumes")}
                  className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded transition cursor-pointer ${
                    currentInfoTab === "volumes" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/25" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Pad Volumes
                </button>
              </div>
            </div>

            {/* Conditional Sub-views */}
            {currentInfoTab === "pads" && (
              <div className="flex flex-col gap-2">
                {/* Drum Pad Zones Controls */}
                <div className="grid grid-cols-3 gap-1 bg-black/60 p-1 border border-zinc-900 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPadZone("instruments")}
                    className={`text-center py-1.5 rounded-lg transition-all text-[10px] font-mono font-bold cursor-pointer uppercase ${
                      padZone === "instruments"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    🥁 Instruments
                  </button>
                  <button
                    type="button"
                    onClick={() => setPadZone("sfx")}
                    className={`text-center py-1.5 rounded-lg transition-all text-[10px] font-mono font-bold cursor-pointer uppercase ${
                      padZone === "sfx"
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    ✨ Special SFX
                  </button>
                  <button
                    type="button"
                    onClick={() => setPadZone("all")}
                    className={`text-center py-1.5 rounded-lg transition-all text-[10px] font-mono font-bold cursor-pointer uppercase ${
                      padZone === "all"
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    🌌 All Together
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-2">
                  {padDetails
                    .filter((pad) => {
                      if (padZone === "instruments") {
                        return ["kick", "snare", "hihat-cls", "hihat-opn", "cowbell", "shaker", "tom-high", "tom-mid", "tom-low", "clap", "synth-bass", "trumpet-melody", "rimshot", "drone"].includes(pad.id);
                      }
                      if (padZone === "sfx") {
                        return ["laser-zap", "whoosh", "metallic-ring", "glitch-bleep", "air-horn", "rev-cymbal", "alien-tap", "scifi-gun"].includes(pad.id);
                      }
                      return true; // "all"
                    })
                    .map((pad) => {
                      const padSetState = padSettings[pad.id];
                      const isCustomized = padSetState && (
                        padSetState.pitchOffset !== 0 ||
                        padSetState.useSequence ||
                        padSetState.effects.echo ||
                        padSetState.effects.reverb ||
                        padSetState.effects.muffle
                      );

                      return (
                        <button
                          key={pad.id}
                          id={`live-pad-${pad.id}`}
                          onClick={() => triggerPadPlay(pad.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCustomizingPadId(pad.id);
                          }}
                          className={`relative overflow-hidden h-20 rounded-xl bg-gradient-to-b ${pad.color} p-1.5 text-left flex flex-col justify-between transition-all active:scale-[0.93] border border-zinc-800 group cursor-pointer ${
                            activeKeys[pad.id] ? "ring-2 ring-cyan-400 scale-[0.95]" : ""
                          }`}
                          title="Right-click to adjust pitch, melody solfege tones, and effects!"
                        >
                          <div className="flex justify-between items-center w-full">
                            <span className="text-[7.5px] font-mono tracking-wider px-1 py-0.5 bg-black/40 rounded italic text-zinc-300">
                              {pad.type.toUpperCase()}
                            </span>
                            <div className="flex items-center gap-1">
                              {isCustomized && (
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" title="Custom parameters active" />
                              )}
                              <span className="text-[7.5px] font-mono text-cyan-300 opacity-90 font-bold">
                                {pad.triggerKey}
                              </span>
                            </div>
                          </div>
                          <div>
                            <h3 className="font-semibold text-[9.5px] text-white leading-tight mt-1 truncate">
                              {pad.label.split(" [")[0]}
                            </h3>
                          </div>
                          {/* Subtle retro glowing overlay */}
                          <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {currentInfoTab === "volumes" && (
              <div className="max-h-[380px] overflow-y-auto pr-1 flex flex-col gap-2 mb-2 custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {padDetails.map((pad) => (
                    <div key={pad.id} className="bg-zinc-950/70 border border-zinc-900 rounded-xl p-2 flex flex-col justify-between h-16">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-zinc-300 font-medium truncate w-[75%]">{pad.label.split(" [")[0]}</span>
                        <span className="text-cyan-400 font-semibold font-mono">{(padVolumes[pad.id] ?? 0.8).toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.5"
                        step="0.05"
                        value={padVolumes[pad.id] ?? 0.8}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setPadVolumes((prev) => ({ ...prev, [pad.id]: val }));
                        }}
                        className="w-full h-1 bg-zinc-800 accent-cyan-400 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Turntable Platter & Pitchbend Station Controls */}
          <div className="bg-zinc-950/60 rounded-xl p-3 border border-zinc-800">
            <h3 className="text-xs font-mono tracking-wider text-zinc-400 mb-2.5 uppercase flex items-center justify-between">
              <span>🎚️ Deck Braking & Pitch modulation</span>
              <span className="text-[10px] text-zinc-500 font-mono">BPM: {bpm}</span>
            </h3>

            <div className="grid grid-cols-12 gap-3 items-center">
              {/* Spinning Vinyl Plater */}
              <div className="col-span-8 flex flex-col items-center justify-center bg-black/40 p-2.5 rounded-lg border border-zinc-900">
                <div className="relative w-28 h-28 rounded-full border border-zinc-800 bg-[#0c0d12] flex items-center justify-center p-1 shadow-inner overflow-hidden">
                  {/* Vinyl Groove Lines */}
                  <div
                    style={{ transform: `rotate(${vinylAngle}deg)` }}
                    className="absolute inset-0.5 rounded-full border-12 border-[#161a22] flex items-center justify-center transition-transform duration-75 ease-out"
                  >
                    {/* Vinyl Label Center */}
                    <div className="w-10 h-10 rounded-full bg-cyan-400/90 flex items-center justify-center relative shadow-md">
                      <div className="w-2 h-2 rounded-full bg-black" />
                      {/* Stylized vinyl sticker design */}
                      <div className="absolute w-full h-0.5 bg-white/20" />
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 w-full flex items-center gap-1">
                  <div className="flex-1">
                    <span className="text-[9px] font-mono text-zinc-500 block mb-0.5">MANUAL SCRATCH SPEED</span>
                    <input
                      type="range"
                      min="0.30"
                      max="1.70"
                      step="0.05"
                      value={globalFx.scratchSpeed}
                      onChange={(e) => handleVinylScratchChange(parseFloat(e.target.value))}
                      onMouseUp={handleVinylScratchRelease}
                      onTouchEnd={handleVinylScratchRelease}
                      className="w-full accent-[#45f3ff] bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>
                  <button
                    onClick={toggleVinylMotorStop}
                    className={`px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider rounded uppercase transition border ${
                      globalFx.scratchStop
                        ? "bg-emerald-500/10 border-emerald-400 text-emerald-400"
                        : "bg-pink-500/10 border-pink-500 text-pink-400"
                    }`}
                  >
                    Vinyl Brake
                  </button>
                </div>
              </div>

              {/* Pitch Bend Wheel (Vertical Lever) */}
              <div className="col-span-4 flex flex-col items-center justify-between h-full bg-black/40 py-2.5 px-1.5 rounded-lg border border-zinc-900">
                <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest text-center leading-tight">
                  PITCH BEND
                </span>

                <div className="relative h-24 my-1 flex items-center justify-center w-full">
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.05"
                    value={globalFx.pitchBend}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      setGlobalFx((prev) => {
                        const next = { ...prev, pitchBend: value };
                        updateActivePlaybackRates(next);
                        return next;
                      });
                    }}
                    onMouseUp={handlePitchBendRelease}
                    onTouchEnd={handlePitchBendRelease}
                    className="absolute -rotate-90 origin-center w-24 h-1 cursor-pointer accent-[#00ffcc]"
                    style={{ background: "#1f2937" }}
                  />
                  {/* Visual Center Ruler indicator */}
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-zinc-700/60 pointer-events-none" />
                </div>

                <div className="text-center font-mono text-[9px] mt-1 text-[#00ffcc]">
                  {(globalFx.pitchBend >= 0 ? "+" : "") + globalFx.pitchBend.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: 20 Slots Matrix Array & Modular Controls Strip (7 grid cols span) */}
        <div className="lg:col-span-7 bg-[#0b0f16]/95 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
              <span className="text-xs font-mono tracking-widest text-cyan-400 uppercase flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> 20 Multi-Track Blocks Matrix
              </span>
              <span className="text-[10px] text-zinc-500 italic">
                Selected Brush: #{selectedPaintBlockId}
              </span>
            </div>

            {/* Array Matrix of 20 Slots */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              {blocks.map((block) => (
                <button
                  key={block.id}
                  id={`block-matrix-${block.id}`}
                  onClick={() => {
                    setActiveBlockId(block.id);
                    setSelectedPaintBlockId(block.id);
                  }}
                  className={`h-11 rounded-lg border text-left p-1.5 flex flex-col justify-between transition-all relative overflow-hidden group ${
                    activeBlockId === block.id
                      ? "bg-cyan-950/40 border-cyan-400 shadow-sm shadow-cyan-400/20"
                      : block.type !== "empty"
                      ? "bg-zinc-900/95 border-zinc-700 hover:border-zinc-500"
                      : "bg-zinc-950/40 border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/20"
                  } ${selectedPaintBlockId === block.id ? "ring-1 ring-[#00ffcc]/60" : ""}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[10px] font-mono leading-none font-semibold text-zinc-400">
                      #{String(block.id).padStart(2, "0")}
                    </span>
                    {block.type !== "empty" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400 animate-pulse" />
                    )}
                  </div>
                  
                  {/* Waveform peak indicator */}
                  <div className="text-[9px] font-medium tracking-tight text-ellipsis overflow-hidden whitespace-nowrap text-zinc-300">
                    {block.type === "empty" ? "Empty" : block.name}
                  </div>

                  {/* Micro waveform overlay at bottom */}
                  {block.type !== "empty" && (
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 flex items-end opacity-40 overflow-hidden">
                      {block.waveformPoints.slice(0, 30).map((pt, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-[#00ffcc]"
                          style={{ height: `${pt * 100}%` }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Individual Expanded Channel Adjuster Strip */}
          {activeBlock && (
            <div className="bg-zinc-950/50 rounded-xl p-3 border border-zinc-800">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-900 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center font-mono font-bold text-xs text-[#45f3ff]">
                    #{String(activeBlock.id).padStart(2, "0")}
                  </div>
                  <div>
                    <input
                      type="text"
                      value={activeBlock.name}
                      onChange={(e) => updateBlockValue(activeBlock.id, "name", e.target.value)}
                      className="bg-transparent border-b border-zinc-800 hover:border-zinc-600 focus:border-cyan-500 focus:outline-none text-zinc-200 font-bold text-xs px-1"
                      placeholder="Rename block..."
                    />
                    <p className="text-[9px] text-zinc-500 mt-0.5">
                      Type:{" "}
                      <span className="uppercase text-cyan-500 font-mono">
                        {activeBlock.type === "empty" ? "Unassigned Slot" : activeBlock.type}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Local Actions Strip: Mic capturing and preset synthesis generator dropdowns */}
                <div className="flex flex-wrap items-center gap-1 bg-black/40 p-1 rounded-lg border border-zinc-900">
                  {activeBlock.type !== "empty" && (
                    <button
                      type="button"
                      onClick={() => triggerBlockAudition(activeBlock.id)}
                      className={`flex items-center gap-1 text-[10px] font-mono uppercase px-2.5 py-1 rounded transition cursor-pointer font-bold ${
                        playingAuditionBlockId === activeBlock.id
                          ? "bg-pink-600 hover:bg-pink-700 text-white"
                          : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/25"
                      }`}
                    >
                      {playingAuditionBlockId === activeBlock.id ? (
                        <>
                          <Pause className="w-3 h-3 fill-white" /> Stop Sample
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-cyan-400" /> Play Sample
                        </>
                      )}
                    </button>
                  )}

                  {micRecordingBlockId === activeBlock.id ? (
                    <button
                      onClick={stopMicRecording}
                      className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-mono uppercase px-2 py-1 rounded animate-pulse"
                    >
                      <Activity className="w-3 h-3 animate-spin" /> Stop Rec ({micSecondsCount}s)
                    </button>
                  ) : (
                    <button
                      onClick={() => startMicRecording(activeBlock.id)}
                      disabled={padRecordingBlockId !== null}
                      className="flex items-center gap-1 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 text-[10px] font-mono px-2 py-1 rounded transition cursor-pointer"
                    >
                      <Mic className="w-3 h-3 text-red-500" /> Mic Rec
                    </button>
                  )}

                  {padRecordingBlockId === activeBlock.id ? (
                    <button
                      onClick={() => stopPadJamRecording(activeBlock.id)}
                      className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-mono px-2.5 py-1 rounded animate-pulse"
                    >
                      Stop Jam ({padJamNotes.length} notes)
                    </button>
                  ) : (
                    <button
                      onClick={() => startPadJamRecording(activeBlock.id)}
                      disabled={micRecordingBlockId !== null}
                      className="flex items-center gap-1 hover:bg-zinc-800 text-zinc-400 hover:text-[#00ffcc] text-[10px] font-mono px-2 py-1 rounded transition cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3 text-emerald-400" /> Record Jam
                    </button>
                  )}

                  {/* Programmatic Preset Generators */}
                  <div className="relative group">
                    <button className="flex items-center gap-0.5 hover:bg-zinc-800 text-[#00ffcc] text-[10px] font-mono px-2 py-1 rounded transition border border-transparent hover:border-zinc-700">
                      <Sparkles className="w-2.5 h-2.5" /> Bake presets
                    </button>
                    <div className="absolute right-0 bottom-full mb-1 z-50 hidden group-hover:block bg-[#0e1219] border border-zinc-800 rounded-lg min-w-[140px] shadow-lg py-1 p-0.5">
                      <button
                        onClick={() => triggerPresetBake(activeBlock.id, "house")}
                        className="w-full text-left font-mono text-[9px] hover:bg-zinc-800 hover:text-[#00ffcc] p-1.5 rounded transition text-zinc-300"
                      >
                        🌊 House Groove
                      </button>
                      <button
                        onClick={() => triggerPresetBake(activeBlock.id, "techno")}
                        className="w-full text-left font-mono text-[9px] hover:bg-zinc-800 hover:text-emerald-400 p-1.5 rounded transition text-zinc-300"
                      >
                        ⚡ Acid Techno
                      </button>
                      <button
                        onClick={() => triggerPresetBake(activeBlock.id, "hiphop")}
                        className="w-full text-left font-mono text-[9px] hover:bg-zinc-800 hover:text-cyan-400 p-1.5 rounded transition text-zinc-300"
                      >
                        💥 Boom-Bap Drums
                      </button>
                      <button
                        onClick={() => triggerPresetBake(activeBlock.id, "synthwave")}
                        className="w-full text-left font-mono text-[9px] hover:bg-zinc-800 hover:text-pink-400 p-1.5 rounded transition text-zinc-300"
                      >
                        🌌 Synthwave Lead
                      </button>
                      <button
                        onClick={() => triggerPresetBake(activeBlock.id, "bassline")}
                        className="w-full text-left font-mono text-[9px] hover:bg-zinc-800 hover:text-amber-400 p-1.5 rounded transition text-zinc-300"
                      >
                        🎹 Deep Subbass line
                      </button>
                    </div>
                  </div>

                  {activeBlock.type !== "empty" && (
                    <button
                      onClick={() =>
                        setBlocks((prev) =>
                          prev.map((b) =>
                            b.id === activeBlock.id
                              ? {
                                  ...b,
                                  type: "empty",
                                  name: `Block #${String(activeBlock.id).padStart(2, "0")}`,
                                  audioBuffer: null,
                                  waveformPoints: makeEmptyWaveform(),
                                }
                              : b
                          )
                        )
                      }
                      className="text-zinc-500 hover:text-red-400 p-1 transition rounded hover:bg-zinc-800"
                      title="Clear slot"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Sliders Area (Volume, Speed Pitch, delays, reverbs, and filter lowpass) */}
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                
                {/* 1. Vol Slider */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                    Volume
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.0"
                      max="1.5"
                      step="0.05"
                      value={activeBlock.volume}
                      onChange={(e) => updateBlockValue(activeBlock.id, "volume", parseFloat(e.target.value))}
                      className="flex-1 accent-emerald-400 bg-zinc-800 h-1.5 rounded"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-8 text-right">
                      {Math.round(activeBlock.volume * 100)}%
                    </span>
                  </div>
                </div>

                {/* 2. Speed Pitch Slider */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                    Pitch Shift
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.05"
                      value={activeBlock.pitch}
                      onChange={(e) => updateBlockValue(activeBlock.id, "pitch", parseFloat(e.target.value))}
                      className="flex-1 accent-cyan-400 bg-zinc-800 h-1.5 rounded"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-8 text-right">
                      {activeBlock.pitch.toFixed(2)}x
                    </span>
                  </div>
                </div>

                {/* 3. Echo Slider */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                    Echo Room
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={activeBlock.delay}
                      onChange={(e) => updateBlockValue(activeBlock.id, "delay", parseFloat(e.target.value))}
                      className="flex-1 accent-purple-400 bg-zinc-800 h-1.5 rounded"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-8 text-right">
                      {Math.round(activeBlock.delay * 100)}%
                    </span>
                  </div>
                </div>

                {/* 4. Space Reverb Slider */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                    Space Reverb
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={activeBlock.reverb}
                      onChange={(e) => updateBlockValue(activeBlock.id, "reverb", parseFloat(e.target.value))}
                      className="flex-1 accent-pink-400 bg-zinc-800 h-1.5 rounded"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-8 text-right">
                      {Math.round(activeBlock.reverb * 100)}%
                    </span>
                  </div>
                </div>

                {/* 5. Filter Lowpass (Muffle) Slider */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                    Muffle LP
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={activeBlock.lowpass}
                      onChange={(e) => updateBlockValue(activeBlock.id, "lowpass", parseFloat(e.target.value))}
                      className="flex-1 accent-amber-400 bg-[#1f2937] h-1.5 rounded"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-8 text-right">
                      {Math.round(activeBlock.lowpass * 100)}%
                    </span>
                  </div>
                </div>

              </div>

              {/* Graphic Audios Wave Representation */}
              <div className="mt-3.5 bg-black/50 border border-zinc-900 rounded-lg p-2.5 h-16 flex flex-col justify-between relative overflow-hidden">
                <div className="flex items-end justify-between h-4/5 w-full">
                  {activeBlock.waveformPoints.map((pt, index) => (
                    <div
                      key={index}
                      className="flex-1 mx-px bg-gradient-to-t from-cyan-500/80 to-[#00ffcc]"
                      style={{ height: `${pt * 100}%` }}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500 mt-1">
                  <span>Waveform representation (Mono decibels)</span>
                  <span>Clip Duration: {activeBlock.duration.toFixed(2)}s</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* BOTTOM SECTION: BandLab Multi-Track timeline workspace Grid */}
      <section className="max-w-7xl mx-auto mt-4 col-span-12 bg-[#0b0f16]/95 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
        
        {/* Playback Controls and Toolbar Panel */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="transport-play"
              onClick={() => {
                const ctx = getAudioContext();
                if (ctx.state === "suspended") ctx.resume();
                setIsPlaying((prev) => !prev);
              }}
              className={`flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-sm font-bold tracking-wider uppercase shadow-md transition-all active:scale-95 cursor-pointer ${
                isPlaying
                  ? "bg-pink-600 hover:bg-pink-700 text-white shadow-pink-600/15"
                  : "bg-emerald-500 hover:bg-emerald-600 text-[#07090e] shadow-emerald-500/15"
              }`}
            >
              {isPlaying ? <Pause className="w-4.5 h-4.5" /> : <Play className="w-4.5 h-4.5 fill-[#07090e]" />}
              {isPlaying ? "Pause" : "Play Set"}
            </button>

            <button
              id="transport-stop"
              onClick={() => {
                setIsPlaying(false);
                setCurrentBeat(0);
              }}
              className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-500 p-2.5 rounded-xl cursor-pointer"
              title="Stop playback"
            >
              <RotateCcw className="w-4 h-4 text-zinc-300" />
            </button>

            {/* Metronome toggler */}
            <button
              onClick={() => setIsMetronomeOn((prev) => !prev)}
              className={`px-3 py-2 text-xs font-mono rounded-xl border transition-colors cursor-pointer ${
                isMetronomeOn
                  ? "bg-amber-500/10 border-amber-500 text-amber-400"
                  : "bg-zinc-950 border-zinc-800 text-zinc-500"
              }`}
            >
              ⏲️ Metronome
            </button>

            {/* Live Master Performance recorder button */}
            <button
              onClick={() => {
                if (isRecordingMaster) {
                  stopMasterPerformanceRecording();
                } else {
                  startMasterPerformanceRecording();
                }
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold tracking-wider uppercase transition-all cursor-pointer ${
                isRecordingMaster
                  ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                  : "bg-zinc-950 border border-red-950 text-red-500 hover:bg-red-950/20 hover:border-red-800"
              }`}
              title={isRecordingMaster ? "Stop performance recording and export file" : "Record entire performance live to audio"}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${isRecordingMaster ? "bg-white animate-ping" : "bg-red-500"}`} />
              {isRecordingMaster ? "REC STOP" : "REC SET"}
            </button>
          </div>

          {/* Master tempo bpm slider */}
          <div className="flex flex-wrap items-center gap-4 bg-zinc-950/60 py-2.5 px-4 rounded-xl border border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Tempo (BPM)
              </span>
              <input
                type="range"
                min="100"
                max="180"
                step="1"
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value))}
                className="w-24 accent-[#45f3ff] bg-zinc-800 h-1 rounded cursor-pointer"
              />
              <span className="text-xs font-mono font-bold text-white bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                {bpm}
              </span>
            </div>

            {/* Master Volume gain */}
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-zinc-500" />
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Master Vol
              </span>
              <input
                type="range"
                min="0.0"
                max="1.2"
                step="0.05"
                value={masterVolume}
                onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                className="w-24 accent-emerald-400 bg-zinc-800 h-1 rounded cursor-pointer"
              />
              <span className="text-xs font-mono font-bold text-white bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>

            {/* Clear all timeline cells */}
            <button
              onClick={() => setTimeline([])}
              className="px-2 py-1 bg-zinc-900 hover:bg-red-950/20 text-[10px] font-mono border border-zinc-800 hover:border-red-900/30 text-zinc-400 hover:text-red-400 rounded transition"
            >
              🧹 Clear Grid
            </button>

            {/* Export session download triggers */}
            <button
              onClick={handleMixDownExport}
              className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-[#07090e] hover:brightness-110 text-xs font-bold rounded-xl transition cursor-pointer shadow-md"
            >
              <Download className="w-3.5 h-3.5" />
              Download Studio Mix (.wav)
            </button>
          </div>
        </div>

        {/* Active Block Clip Configuration Control Panel */}
        {(() => {
          const selectedClip = timeline.find((clip) => clip.id === selectedTimelineClipId);
          if (!selectedClip) return null;

          return (
            <div className="bg-zinc-950/90 border border-[#00ffcc]/30 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00ffcc] animate-pulse" />
                  <span className="text-xs font-mono font-black text-[#00ffcc] uppercase tracking-wider">
                    Block Clip Editor Panel
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Select parameters or drag box in grid to shift slot or lanes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                {/* 1. Track Lane Selector */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 uppercase">Track Lane</span>
                  <select
                    value={selectedClip.trackIndex}
                    onChange={(e) => {
                      const idx = parseInt(e.target.value);
                      setTimeline((prev) =>
                        prev.map((clip) =>
                          clip.id === selectedClip.id ? { ...clip, trackIndex: idx } : clip
                        )
                      );
                    }}
                    className="bg-black text-zinc-200 border border-zinc-800 rounded-lg px-2.5 py-1.5 focus:border-[#00ffcc] focus:outline-none"
                  >
                    {trackLabels.map((track, idx) => (
                      <option key={idx} value={idx}>
                        {track.name} (Ch #{idx + 1})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Start Beat Position */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 uppercase">Start Beat</span>
                  <div className="flex items-center gap-1 bg-black border border-zinc-800 rounded-lg px-2 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        const nextBeat = Math.max(0, selectedClip.startBeat - 1);
                        setTimeline((prev) =>
                          prev.map((clip) =>
                            clip.id === selectedClip.id ? { ...clip, startBeat: nextBeat } : clip
                          )
                        );
                      }}
                      className="px-1 text-zinc-400 hover:text-white"
                      title="Move left"
                    >
                      ◀
                    </button>
                    <span className="text-white font-bold w-6 text-center text-xs">
                      {selectedClip.startBeat + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextBeat = Math.min(31, selectedClip.startBeat + 1);
                        setTimeline((prev) =>
                          prev.map((clip) =>
                            clip.id === selectedClip.id ? { ...clip, startBeat: nextBeat } : clip
                          )
                        );
                      }}
                      className="px-1 text-zinc-400 hover:text-white"
                      title="Move right"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                {/* 3. Duration Beats */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 uppercase">Duration</span>
                  <select
                    value={selectedClip.durationBeats}
                    onChange={(e) => {
                      const beats = parseInt(e.target.value);
                      setTimeline((prev) =>
                        prev.map((clip) =>
                          clip.id === selectedClip.id ? { ...clip, durationBeats: beats } : clip
                        )
                      );
                    }}
                    className="bg-black text-zinc-200 border border-zinc-800 rounded-lg px-2.5 py-1.5 focus:border-[#00ffcc] focus:outline-none"
                  >
                    {[1, 2, 4, 8, 12, 16, 24, 32].map((beats) => (
                      <option key={beats} value={beats}>
                        {beats} {beats === 1 ? "Beat" : "Beats"}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 4. Pad Sound Source Mapping */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 uppercase">Trigger Audio Block</span>
                  <select
                    value={selectedClip.blockId}
                    onChange={(e) => {
                      const bid = parseInt(e.target.value);
                      setTimeline((prev) =>
                        prev.map((clip) =>
                          clip.id === selectedClip.id ? { ...clip, blockId: bid } : clip
                        )
                      );
                    }}
                    className="bg-black text-zinc-200 border border-zinc-800 rounded-lg px-2.5 py-1.5 focus:border-[#00ffcc] focus:outline-none"
                  >
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        Block #{String(b.id).padStart(2, "0")} ({b.audioBuffer === null ? "⚠️ Empty" : b.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action Operations */}
              <div className="flex items-center gap-2 mt-2 md:mt-0 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setTimeline((prev) => prev.filter((clip) => clip.id !== selectedClip.id));
                    setSelectedTimelineClipId(null);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-red-950/40 border border-red-900/40 hover:bg-red-900 text-red-300 hover:text-white font-bold cursor-pointer transition shadow-sm"
                >
                  🗑️ Delete Block
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTimelineClipId(null)}
                  className="px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white font-bold cursor-pointer transition"
                >
                  Deselect
                </button>
              </div>
            </div>
          );
        })()}

        {/* Multi-Track Sequencer Board Grid scrollable segment */}
        <div className="relative border border-zinc-900 bg-[#070a0f] rounded-2xl p-1 overflow-x-auto">
          
          {/* Paint brush indicator line */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-zinc-950 px-3 py-2 border-b border-zinc-900 rounded-t-xl gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 uppercase tracking-wider font-bold">
                🎨 Painting Brush Tool
              </span>
              <div className="h-4 w-px bg-zinc-800 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-zinc-500">Brush Duration:</span>
                {[1, 2, 4, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBrushSteps(s)}
                    className={`px-2 py-0.5 rounded font-mono text-[9px] font-bold cursor-pointer transition-colors ${
                      brushSteps === s
                        ? "bg-emerald-400 text-zinc-950 font-extrabold shadow-sm"
                        : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {s} {s === 1 ? "Beat" : "Beats"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-zinc-500">Paint Sound Block:</span>
              <select
                value={selectedPaintBlockId}
                onChange={(e) => {
                  const id = parseInt(e.target.value);
                  setSelectedPaintBlockId(id);
                  setActiveBlockId(id);
                }}
                className="bg-zinc-900 text-zinc-200 border border-zinc-700 rounded px-1 py-0.5 font-mono text-[10px] focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50"
              >
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    Slot #{String(b.id).padStart(2, "0")} ({b.type === "empty" ? "Empty" : b.name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-w-[850px] relative p-2">
            
            {/* Horizontal Ticks Time Ruler bar */}
            <div className="flex items-end mb-2 border-b border-zinc-900 pb-1 pl-[150px]">
              {Array.from({ length: 32 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 text-center font-mono text-[9px] relative min-w-[20px] transition-all ${
                    i === currentBeat && isPlaying
                      ? "text-rose-400 scale-125 font-black"
                      : i % 4 === 0
                      ? "text-cyan-400 font-bold"
                      : "text-zinc-600"
                  }`}
                >
                  {i === currentBeat && isPlaying && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] animate-bounce text-rose-500">
                      ▼
                    </span>
                  )}
                  <span>{i + 1}</span>
                  {/* Small line ticks */}
                  <div
                    className={`mx-auto w-0.5 mt-0.5 transition-all ${
                      i === currentBeat && isPlaying
                        ? "h-2 bg-rose-500"
                        : i % 4 === 0
                        ? "h-1.5 bg-cyan-500/60"
                        : "h-1 bg-zinc-800"
                    }`}
                  />
                </div>
              ))}
            </div>

            {/* Vertical lanes list of the 4 tracks */}
            <div className="flex flex-col gap-2 relative">
              
              {/* Dynamic playing active beat vertical sweeping line */}
              {isPlaying && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#e11d48] to-[#00ffcc] shadow-md shadow-pink-500 h-full z-10 pointer-events-none transition-all duration-100"
                  style={{
                    left: `${150 + (currentBeat / 32) * (100 - (150 / 850) * 100)}%`,
                    marginLeft: "-1px",
                  }}
                />
              )}

              {trackLabels.map((track, trackIndex) => {
                return (
                  <div key={trackIndex} className="flex items-center gap-2 relative z-0 h-14">
                    
                    {/* Left side channel strip panel */}
                    <div className="w-[140px] flex-shrink-0 bg-zinc-900 border-l-2 py-2 px-2.5 rounded-lg border-zinc-800 flex flex-col justify-between h-full bg-gradient-to-r from-zinc-950 to-zinc-900/40">
                      <p className="text-[11px] font-bold tracking-tight text-zinc-300 leading-tight">
                        {track.name}
                      </p>
                      <span className="text-[9px] font-mono text-zinc-600 uppercase">
                        Channel #{trackIndex + 1}
                      </span>
                    </div>

                    {/* Timeline step block segments tracks */}
                    <div className="flex-1 flex gap-1 h-full items-center relative">
                      {Array.from({ length: 32 }).map((_, columnIndex) => {
                        const matchedClip = timeline.find(
                          (ev) =>
                            ev.trackIndex === trackIndex &&
                            columnIndex >= ev.startBeat &&
                            columnIndex < ev.startBeat + ev.durationBeats
                        );

                        // Is this step cell the exact trigger coordinate start index
                        const isStart = matchedClip && matchedClip.startBeat === columnIndex;
                        const blockDetail = matchedClip
                          ? blocks.find((b) => b.id === matchedClip.blockId)
                          : null;

                        const isSelected = matchedClip && selectedTimelineClipId === matchedClip.id;

                        return (
                          <div
                            key={columnIndex}
                            onClick={() => toggleTimelineSlot(trackIndex, columnIndex)}
                            draggable={!!matchedClip}
                            onDragStart={(e) => {
                              if (matchedClip) {
                                e.dataTransfer.setData("text/plain", matchedClip.id);
                                e.dataTransfer.effectAllowed = "move";
                              }
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) => {
                              const dragClipId = e.dataTransfer.getData("text/plain");
                              if (dragClipId) {
                                e.preventDefault();
                                e.stopPropagation();
                                setTimeline((prev) =>
                                  prev.map((clip) =>
                                    clip.id === dragClipId
                                      ? { ...clip, trackIndex, startBeat: columnIndex }
                                      : clip
                                  )
                                );
                                setSelectedTimelineClipId(dragClipId);
                              }
                            }}
                            className={`flex-1 h-full min-w-[20px] rounded-lg transition-all border relative flex flex-col justify-between p-1 select-none cursor-pointer ${
                              isSelected
                                ? "ring-2 ring-[#00ffcc] border-white scale-[1.02] z-10"
                                : ""
                            } ${
                              matchedClip
                                ? isStart
                                  ? `bg-gradient-to-r from-[#161f30] to-[#0d121c] text-zinc-200 shadow-sm ${
                                      columnIndex === currentBeat && isPlaying
                                        ? "border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                                        : "border-[#45f3ff]"
                                    }`
                                  : `bg-[#0c0f16] border-l-transparent border-r-transparent text-zinc-400 border-dashed ${
                                      columnIndex === currentBeat && isPlaying
                                        ? "border-t-rose-400 border-b-rose-400"
                                        : "border-t-[#45f3ff] border-b-[#45f3ff]"
                                    }`
                                : columnIndex === currentBeat && isPlaying
                                ? "bg-rose-500/10 border-rose-500/50 shadow-[0_0_8px_rgba(244,63,94,0.25)]"
                                : "bg-black/25 border-zinc-900 hover:bg-zinc-900/30 hover:border-zinc-800"
                            }`}
                          >
                            {matchedClip && isStart && blockDetail && (
                              <div className="relative z-10 w-full flex flex-col justify-between h-full pointer-events-none">
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-[9px] font-mono font-bold text-[#00ffcc] leading-none">
                                    #{blockDetail.id}
                                  </span>
                                  <span className="text-[8px] font-medium max-w-[50px] leading-none text-ellipsis overflow-hidden text-zinc-400">
                                    {blockDetail.name}
                                  </span>
                                </div>

                                {/* Amplitude Wave Overlay */}
                                <div className="h-2 flex items-end opacity-60 overflow-hidden">
                                  {blockDetail.waveformPoints.slice(0, 12).map((pt, wIdx) => (
                                    <div
                                      key={wIdx}
                                      className="flex-1 bg-cyan-400 mx-px"
                                      style={{ height: `${pt * 100}%` }}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Background helper grid dots */}
                            {!matchedClip && (
                              <span className="m-auto w-1 h-1 rounded-full bg-zinc-800 group-hover:bg-zinc-700 pointer-events-none" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </section>

      {/* Embedded Simple How-To instructions card inside negative workspace footer margin */}
      <footer className="max-w-7xl mx-auto mt-6 border-t border-zinc-800 pt-4 pb-2 flex flex-col sm:flex-row justify-between text-xs text-zinc-500 gap-4">
        <div>
          <p>© 2026 bandboard workshop, Inc. All rights reserved.</p>
          <p className="mt-1">
            Utilizes hardware-accelerated polyphonic synthesis & Offline Audio Context mix downs.
          </p>
        </div>
        <div className="flex gap-4">
          <span className="text-[#00ffcc]">● Online Engine</span>
          <span>Buffer: Latency Normal</span>
        </div>
      </footer>

      {/* GORGEOUS MODAL DIALOG OVERLAY FOR PAD CUSTOM SETTINGS */}
      {customizingPadId && customizingPad && padCustomSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-900 bg-gradient-to-r from-zinc-950 to-zinc-900 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎛️</span>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100 font-sans tracking-wide">
                    Configure {customizingPad.label.split(" [")[0]}
                  </h2>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase">
                    Pad Channel Strip & Sequencer Behavior
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCustomizingPadId(null)}
                className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Container */}
            <div className="p-5 overflow-y-auto space-y-6 custom-scrollbar flex-1">
              {/* 1. Toggleable Board FX Pedals */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
                    💅 Board FX Chain
                  </h3>
                  <button
                    onClick={() => {
                      setPadSettings((prev) => ({
                        ...prev,
                        [customizingPadId]: {
                          ...prev[customizingPadId],
                          effects: { echo: false, reverb: false, muffle: false }
                        }
                      }));
                    }}
                    className="text-[10px] font-mono text-rose-500 hover:text-rose-400 transition-colors uppercase cursor-pointer"
                  >
                    Clear Chains
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setPadSettings((prev) => {
                        const current = prev[customizingPadId];
                        return {
                          ...prev,
                          [customizingPadId]: {
                            ...current,
                            effects: { ...current.effects, echo: !current.effects.echo }
                          }
                        };
                      });
                    }}
                    className={`p-3 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all text-center cursor-pointer ${
                      padCustomSettings.effects.echo
                        ? "bg-cyan-500/10 border-cyan-500 text-cyan-400 font-extrabold"
                        : "bg-zinc-900/30 border-zinc-900 text-zinc-500 hover:bg-zinc-900/60"
                    }`}
                  >
                    <span className="text-lg">🔁</span>
                    <span>Echo delay</span>
                  </button>

                  <button
                    onClick={() => {
                      setPadSettings((prev) => {
                        const current = prev[customizingPadId];
                        return {
                          ...prev,
                          [customizingPadId]: {
                            ...current,
                            effects: { ...current.effects, reverb: !current.effects.reverb }
                          }
                        };
                      });
                    }}
                    className={`p-3 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all text-center cursor-pointer ${
                      padCustomSettings.effects.reverb
                        ? "bg-purple-500/10 border-purple-500 text-purple-400 font-extrabold"
                        : "bg-zinc-900/30 border-zinc-900 text-zinc-500 hover:bg-zinc-900/60"
                    }`}
                  >
                    <span className="text-lg">🌌</span>
                    <span>Reverb</span>
                  </button>

                  <button
                    onClick={() => {
                      setPadSettings((prev) => {
                        const current = prev[customizingPadId];
                        return {
                          ...prev,
                          [customizingPadId]: {
                            ...current,
                            effects: { ...current.effects, muffle: !current.effects.muffle }
                          }
                        };
                      });
                    }}
                    className={`p-3 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all text-center cursor-pointer ${
                      padCustomSettings.effects.muffle
                        ? "bg-amber-500/10 border-amber-500 text-amber-400 font-extrabold"
                        : "bg-zinc-900/30 border-zinc-900 text-zinc-500 hover:bg-zinc-900/60"
                    }`}
                  >
                    <span className="text-lg">🔇</span>
                    <span>Muffle Filter</span>
                  </button>
                </div>
              </div>

              {/* 2. Solfege Pitch Settings */}
              <div className="space-y-3 pt-4 border-t border-zinc-900">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
                    🎵 Pitch Tuning multiplier
                  </h3>
                  <span className="text-xs font-mono font-bold text-zinc-400">
                    {padCustomSettings.pitchOffset > 0 ? `+${padCustomSettings.pitchOffset}` : padCustomSettings.pitchOffset} semitones
                  </span>
                </div>

                <div className="bg-zinc-900/35 p-3.5 rounded-xl border border-zinc-900 space-y-4">
                  {/* Pitch slider */}
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={padCustomSettings.pitchOffset}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            pitchOffset: val
                          }
                        }));
                      }}
                      className="w-full h-1.5 bg-zinc-800 accent-cyan-400 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                      <span>Low Low Do (-12)</span>
                      <span>Do (0)</span>
                      <span>High High Ti (+12)</span>
                    </div>
                  </div>

                  {/* Hotkeys to pitch offsets */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-zinc-500 font-mono uppercase">Quick chromatic pitch mappings:</p>
                    <div className="grid grid-cols-5 gap-1.5 text-center">
                      {[
                        { label: "Low Do", semi: -12 },
                        { label: "Low Sol", semi: -5 },
                        { label: "Standard", semi: 0 },
                        { label: "High Sol", semi: 7 },
                        { label: "High Do", semi: 12 },
                      ].map((mapping) => (
                        <button
                          key={mapping.semi}
                          onClick={() => {
                            setPadSettings((prev) => ({
                              ...prev,
                              [customizingPadId]: {
                                ...prev[customizingPadId],
                                pitchOffset: mapping.semi
                              }
                            }));
                          }}
                          className={`py-1 text-[9px] rounded font-semibold font-mono border cursor-pointer ${
                            padCustomSettings.pitchOffset === mapping.semi
                              ? "bg-cyan-500/10 border-cyan-500/50 text-cyan-400 hover:border-cyan-400"
                              : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                          }`}
                        >
                          {mapping.semi > 0 ? `+${mapping.semi}` : mapping.semi}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Custom Synthesizer & Sound Design Parameters (ALL PADS) */}
              <div className="space-y-3.5 pt-4 border-t border-zinc-900">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                    🔬 Direct Synth Wave Design
                  </h3>
                  <button
                    onClick={() => {
                      setPadSettings((prev) => ({
                        ...prev,
                        [customizingPadId]: {
                          ...prev[customizingPadId],
                          sound: {
                            decayMultiplier: 1.0,
                            cutoff: 20000,
                            resonance: 1.0,
                            drive: 0,
                            noiseLevel: 0,
                          }
                        }
                      }));
                    }}
                    className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors uppercase cursor-pointer"
                  >
                    Reset Timbre
                  </button>
                </div>

                <div className="bg-zinc-900/35 p-3.5 rounded-xl border border-zinc-900 space-y-4">
                  {/* Decay Envelope Duration */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Envelope Decay (Tail length)</span>
                      <span className="text-emerald-400 font-bold">{Math.round(padCustomSettings.sound.decayMultiplier * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3.0"
                      step="0.05"
                      value={padCustomSettings.sound.decayMultiplier}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            sound: {
                              ...prev[customizingPadId].sound,
                              decayMultiplier: val,
                            }
                          }
                        }));
                      }}
                      className="w-full h-1 bg-zinc-800 accent-emerald-400 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Cutoff Filter Cut */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Tone Cutoff Lowpass</span>
                      <span className="text-emerald-400 font-bold">
                        {padCustomSettings.sound.cutoff >= 20000 ? "Full Bright (Open)" : `${padCustomSettings.sound.cutoff} Hz`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="150"
                      max="20000"
                      step="50"
                      value={padCustomSettings.sound.cutoff}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            sound: {
                              ...prev[customizingPadId].sound,
                              cutoff: val,
                            }
                          }
                        }));
                      }}
                      className="w-full h-1 bg-zinc-800 accent-emerald-400 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Resonance Filter Q */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Resonance Peak Filter Q</span>
                      <span className="text-emerald-400 font-bold">Q = {padCustomSettings.sound.resonance.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="15.0"
                      step="0.1"
                      value={padCustomSettings.sound.resonance}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            sound: {
                              ...prev[customizingPadId].sound,
                              resonance: val,
                            }
                          }
                        }));
                      }}
                      className="w-full h-1 bg-zinc-800 accent-emerald-400 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Tube saturation Overdrive Distortion */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Saturation Overdrive (Drive)</span>
                      <span className="text-emerald-400 font-bold">{padCustomSettings.sound.drive}% Drive</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={padCustomSettings.sound.drive}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            sound: {
                              ...prev[customizingPadId].sound,
                              drive: val,
                            }
                          }
                        }));
                      }}
                      className="w-full h-1 bg-zinc-800 accent-emerald-400 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Vintage Noise Crackle */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Analog Noise Crackle floor</span>
                      <span className="text-emerald-400 font-bold">{padCustomSettings.sound.noiseLevel}% Hiss</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={padCustomSettings.sound.noiseLevel}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPadSettings((prev) => ({
                          ...prev,
                          [customizingPadId]: {
                            ...prev[customizingPadId],
                            sound: {
                              ...prev[customizingPadId].sound,
                              noiseLevel: val,
                            }
                          }
                        }));
                      }}
                      className="w-full h-1 bg-zinc-800 accent-emerald-400 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Melody Sequential Solfege Builder (Shown ONLY for synth / melody pads) */}
              {["synth-bass", "trumpet-melody", "drone", "alien-tap"].includes(customizingPadId) && (
                <div className="space-y-3 pt-4 border-t border-zinc-900">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                      <span>🎹 Melodic Solfege Pattern Builder</span>
                      <span className="px-1.5 py-0.5 bg-cyan-950 text-cyan-400 text-[8px] rounded uppercase font-semibold">
                        {customizingPadId === "trumpet-melody" ? "Chromatic C4-C5 Scale" : "Full Chromatic Range"}
                      </span>
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 font-mono">Use sequence</span>
                      <input
                        type="checkbox"
                        checked={padCustomSettings.useSequence}
                        onChange={(e) => {
                          setPadSettings((prev) => ({
                            ...prev,
                            [customizingPadId]: {
                              ...prev[customizingPadId],
                              useSequence: e.target.checked
                            }
                          }));
                        }}
                        className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="bg-zinc-900/35 p-3.5 rounded-xl border border-zinc-900 space-y-4">
                    {/* Active static base tone select */}
                    {!padCustomSettings.useSequence && (
                      <div className="space-y-4">
                        <p className="text-[10px] text-zinc-400 font-mono">
                          Select Fixed Tonal Base Pitch (White & # Black keys):
                        </p>
                        
                        <div className="space-y-3">
                          <div>
                            <p className="text-[9px] font-mono text-zinc-500 uppercase mb-1.5">🎹 White Keys (Diatonic):</p>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[
                                { name: "Do", idx: 0 },
                                { name: "Re", idx: 2 },
                                { name: "Mi", idx: 4 },
                                { name: "Fa", idx: 5 },
                                { name: "Sol", idx: 7 },
                                { name: "La", idx: 9 },
                                { name: "Ti", idx: 11 },
                                { name: "High Do", idx: 12 },
                              ].map((note) => (
                                <button
                                  key={note.idx}
                                  onClick={() => {
                                    setPadSettings((prev) => ({
                                      ...prev,
                                      [customizingPadId]: {
                                        ...prev[customizingPadId],
                                        baseNoteIndex: note.idx
                                      }
                                    }));
                                  }}
                                  className={`py-2 text-[10px] rounded font-bold tracking-wide border cursor-pointer transition-all ${
                                    padCustomSettings.baseNoteIndex === note.idx
                                      ? "bg-cyan-500/10 border-cyan-500/50 text-cyan-400 shadow hover:border-cyan-400"
                                      : "bg-zinc-900/50 border-zinc-850 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900"
                                  }`}
                                >
                                  {note.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] font-mono text-zinc-500 uppercase mb-1.5">✨ Sharp # Black Keys (Chromatics):</p>
                            <div className="grid grid-cols-5 gap-1.5">
                              {[
                                { name: "Do#", idx: 1 },
                                { name: "Re#", idx: 3 },
                                { name: "Fa#", idx: 6 },
                                { name: "Sol#", idx: 8 },
                                { name: "La#", idx: 10 },
                              ].map((note) => (
                                <button
                                  key={note.idx}
                                  onClick={() => {
                                    setPadSettings((prev) => ({
                                      ...prev,
                                      [customizingPadId]: {
                                        ...prev[customizingPadId],
                                        baseNoteIndex: note.idx
                                      }
                                    }));
                                  }}
                                  className={`py-2 text-[10px] rounded font-bold tracking-wide border cursor-pointer transition-all ${
                                    padCustomSettings.baseNoteIndex === note.idx
                                      ? "bg-fuchsia-500/10 border-fuchsia-500/50 text-fuchsia-400 shadow hover:border-fuchsia-400"
                                      : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900"
                                  }`}
                                >
                                  {note.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sequential state manager */}
                    {padCustomSettings.useSequence && (
                      <div className="space-y-3.5">
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] text-zinc-400 font-mono">
                            Build Sequence order (Tap panels to add notes):
                          </p>
                          <button
                            onClick={() => {
                              setPadSettings((prev) => ({
                                ...prev,
                                [customizingPadId]: {
                                  ...prev[customizingPadId],
                                  melodySequence: [],
                                  currentSeqIndex: 0
                                }
                              }));
                            }}
                            className="text-[9px] font-mono text-rose-500 hover:text-rose-400 uppercase cursor-pointer"
                          >
                            Clear Pattern
                          </button>
                        </div>

                        {/* Note pool selector input */}
                        <div className="space-y-2.5">
                          <div>
                            <p className="text-[9px] font-mono text-zinc-500 uppercase mb-1">Add White Key to pattern:</p>
                            <div className="grid grid-cols-4 gap-1">
                              {[
                                { name: "Do", idx: 0 },
                                { name: "Re", idx: 2 },
                                { name: "Mi", idx: 4 },
                                { name: "Fa", idx: 5 },
                                { name: "Sol", idx: 7 },
                                { name: "La", idx: 9 },
                                { name: "Ti", idx: 11 },
                                { name: "High Do", idx: 12 },
                              ].map((note) => (
                                <button
                                  key={note.idx}
                                  onClick={() => {
                                    setPadSettings((prev) => {
                                      const current = prev[customizingPadId];
                                      return {
                                        ...prev,
                                        [customizingPadId]: {
                                          ...current,
                                          melodySequence: [...current.melodySequence, note.idx]
                                        }
                                      };
                                    });
                                  }}
                                  className="py-1 text-[10px] rounded bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 text-zinc-300 font-semibold cursor-pointer text-center hover:bg-zinc-800"
                                >
                                  + {note.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] font-mono text-zinc-500 uppercase mb-1">Add Sharp # Black Key to pattern:</p>
                            <div className="grid grid-cols-5 gap-1">
                              {[
                                { name: "Do#", idx: 1 },
                                { name: "Re#", idx: 3 },
                                { name: "Fa#", idx: 6 },
                                { name: "Sol#", idx: 8 },
                                { name: "La#", idx: 10 },
                              ].map((note) => (
                                <button
                                  key={note.idx}
                                  onClick={() => {
                                    setPadSettings((prev) => {
                                      const current = prev[customizingPadId];
                                      return {
                                        ...prev,
                                        [customizingPadId]: {
                                          ...current,
                                          melodySequence: [...current.melodySequence, note.idx]
                                        }
                                      };
                                    });
                                  }}
                                  className="py-1 text-[10px] rounded bg-zinc-950 border border-zinc-805 hover:border-fuchsia-500/50 text-fuchsia-350 font-semibold cursor-pointer text-center hover:bg-zinc-900"
                                >
                                  + {note.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Preset sequences */}
                        <div className="flex gap-1.5 items-center">
                          <span className="text-[8.5px] text-zinc-500 font-mono uppercase">Presets:</span>
                          {[
                            { name: "Mi-Re-Do", val: [4, 2, 0] },
                            { name: "Do-Sol-La", val: [0, 7, 9] },
                            { name: "Do-Mi-Sol-Do", val: [0, 4, 7, 12] },
                            { name: "Do#-Fa#-La#", val: [1, 6, 10] },
                          ].map((patt) => (
                            <button
                              key={patt.name}
                              onClick={() => {
                                setPadSettings((prev) => ({
                                  ...prev,
                                  [customizingPadId]: {
                                    ...prev[customizingPadId],
                                    melodySequence: patt.val,
                                    currentSeqIndex: 0
                                  }
                                }));
                              }}
                              className="px-2 py-0.5 text-[8.5px] font-mono rounded bg-cyan-950/45 text-cyan-400 border border-cyan-900/10 hover:border-cyan-500/30 cursor-pointer"
                            >
                              {patt.name}
                            </button>
                          ))}
                        </div>

                        {/* Custom order sequence representation output */}
                        <div className="space-y-1">
                          <div className="text-[9.5px] font-mono text-zinc-500 flex justify-between uppercase">
                            <span>Active Melodic Queue string:</span>
                            <span className="text-zinc-400 font-bold">
                              {padCustomSettings.melodySequence.length} beats
                            </span>
                          </div>
                          
                          <div className="min-h-[48px] bg-black/40 border border-zinc-900 rounded-lg p-2 flex flex-wrap gap-1.5 items-center">
                            {padCustomSettings.melodySequence.length === 0 ? (
                              <span className="text-[10px] text-zinc-600 font-mono italic">
                                Sequence is empty. Tap notes above to compose, e.g. Mi, Re, Do!
                              </span>
                            ) : (
                              padCustomSettings.melodySequence.map((val, keyIdx) => {
                                const noteNames = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Ti", "High Do"];
                                const isCurrent = keyIdx === padCustomSettings.currentSeqIndex;
                                return (
                                  <div
                                    key={keyIdx}
                                    onClick={() => {
                                      // Remove single note out of sequence
                                      setPadSettings((prev) => {
                                        const current = prev[customizingPadId];
                                        const nextSeq = [...current.melodySequence];
                                        nextSeq.splice(keyIdx, 1);
                                        return {
                                          ...prev,
                                          [customizingPadId]: {
                                            ...current,
                                            melodySequence: nextSeq,
                                            currentSeqIndex: 0
                                          }
                                        };
                                      });
                                    }}
                                    className={`px-2 py-1 rounded text-[10.5px] font-bold font-mono border cursor-pointer select-none transition-all ${
                                      isCurrent
                                        ? "bg-cyan-500/25 border-cyan-400 text-cyan-300 scale-105 shadow"
                                        : "bg-zinc-900 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200 text-zinc-400"
                                    }`}
                                    title="Click to remove note"
                                  >
                                    {noteNames[val]}
                                  </div>
                                );
                              })
                            )}
                          </div>
                          <p className="text-[8.5px] text-zinc-600 font-mono italic">
                            * Sequencer will advance through these notes step-by-step each time you hit the pad. Click a note block to delete it.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 border-t border-zinc-900 bg-zinc-950 flex justify-between items-center">
              <button
                onClick={() => {
                  setPadSettings((prev) => ({
                    ...prev,
                    [customizingPadId]: {
                      pitchOffset: 0,
                      baseNoteIndex: customizingPadId === "synth-bass" ? 0 : customizingPadId === "drone" ? 4 : customizingPadId === "alien-tap" ? 5 : 2,
                      melodySequence: [],
                      currentSeqIndex: 0,
                      useSequence: false,
                      effects: {
                        echo: false,
                        reverb: false,
                        muffle: false,
                      },
                      sound: {
                        decayMultiplier: 1.0,
                        cutoff: 20000,
                        resonance: 1.0,
                        drive: 0,
                        noiseLevel: 0,
                      },
                    }
                  }));
                }}
                className="px-4 py-2 text-xs font-semibold text-rose-400 border border-rose-500/20 hover:border-rose-500 bg-rose-500/5 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 uppercase font-mono"
              >
                <span>🔄</span> Reset Pad
              </button>

              <button
                onClick={() => triggerPadPlay(customizingPadId)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-800 transition-all cursor-pointer mr-auto ml-1.5"
              >
                🔊 Preview Sound
              </button>

              <button
                onClick={() => setCustomizingPadId(null)}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black shadow-lg transition-all cursor-pointer"
              >
                Apply Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
