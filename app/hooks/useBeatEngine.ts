import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BEAT_LANES,
  BEAT_PRESETS,
  BEAT_STEPS,
  cloneBeatGrid,
  createDefaultBeatState,
  getBeatPreset,
  type BeatGrid,
  type BeatLane,
  type BeatPresetId,
  type BeatRoomState,
  type RoomMode,
} from "~/lib/beat";
import { SignalSchema, type SignalMessage } from "~/types/signaling";

type ToneModule = typeof import("tone");

type EngineRef = {
  Tone: ToneModule;
  kick: any;
  snare: any;
  hat: any;
  limiter: any;
  repeatId: number;
};

const LOOP_MEASURES = 1;
const SYNC_INTERVAL_MS = 10_000;

const clampBpm = (value: number) => Math.max(60, Math.min(220, Math.round(value)));

const getLoopDurationSeconds = (bpm: number) => (60 / bpm) * 4 * LOOP_MEASURES;

const detectPresetId = (steps: BeatGrid, bpm: number): BeatPresetId => {
  const match = BEAT_PRESETS.find(
    (preset) =>
      preset.bpm === bpm &&
      BEAT_LANES.every((lane) =>
        preset.steps[lane].every((enabled, index) => enabled === steps[lane][index]),
      ),
  );

  return match?.id ?? "custom";
};

const createClockSample = (message: Extract<SignalMessage, { type: "beat-sync-response" }>) => {
  const receivedAtMs = Date.now();
  const roundTripMs = receivedAtMs - message.clientSentAtMs;
  const serverMidpointMs = (message.serverReceivedAtMs + message.serverSentAtMs) / 2;
  const clientMidpointMs = (message.clientSentAtMs + receivedAtMs) / 2;
  const offsetMs = serverMidpointMs - clientMidpointMs;

  return { offsetMs, roundTripMs };
};

export function useBeatEngine({
  socket,
  clientId,
}: {
  socket: WebSocket | null;
  clientId: string | null;
}) {
  const [beatState, setBeatState] = useState<BeatRoomState>(createDefaultBeatState);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [clockRttMs, setClockRttMs] = useState<number | null>(null);

  const beatStateRef = useRef(beatState);
  const engineRef = useRef<EngineRef | null>(null);
  const bestClockSampleRef = useRef<{ offsetMs: number; roundTripMs: number } | null>(null);

  beatStateRef.current = beatState;

  const sendMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(message));
    },
    [socket],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    let disposed = false;

    void import("tone").then((Tone) => {
      if (disposed) return;

      const limiter = new Tone.Limiter(-1).toDestination();
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0.01, release: 0.2 },
      }).connect(limiter);
      const snare = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
      }).connect(limiter);
      const hat = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 2400,
      }).connect(limiter);
      hat.frequency.value = 220;

      const transport = Tone.getTransport();
      transport.loop = true;
      transport.setLoopPoints(0, "1m");
      transport.bpm.value = beatStateRef.current.bpm;

      const repeatId = transport.scheduleRepeat((time) => {
        const currentState = beatStateRef.current;
        const stepSize = transport.PPQ / 4;
        const stepIndex = Math.floor(transport.getTicksAtTime(time) / stepSize) % BEAT_STEPS;

        if (currentState.steps.kick[stepIndex]) {
          kick.triggerAttackRelease("C1", "8n", time, 0.95);
        }
        if (currentState.steps.snare[stepIndex]) {
          snare.triggerAttackRelease("16n", time, 0.35);
        }
        if (currentState.steps.hat[stepIndex]) {
          hat.triggerAttackRelease("32n", time, 0.16);
        }

        Tone.Draw.schedule(() => {
          setActiveStep(stepIndex);
        }, time);
      }, "16n");

      engineRef.current = { Tone, kick, snare, hat, limiter, repeatId };
      setEngineLoaded(true);
    });

    return () => {
      disposed = true;
      const engine = engineRef.current;
      if (!engine) return;

      const transport = engine.Tone.getTransport();
      transport.stop();
      transport.clear(engine.repeatId);
      setActiveStep(-1);

      engine.kick.dispose();
      engine.snare.dispose();
      engine.hat.dispose();
      engine.limiter.dispose();
      engineRef.current = null;
    };
  }, []);

  const ensureAudioReady = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return false;

    await engine.Tone.start();
    if (engine.Tone.context.state !== "running") {
      await engine.Tone.context.resume();
    }

    setAudioReady(true);
    return true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const unlock = () => {
      void ensureAudioReady()
        .then((ready) => {
          if (!ready) return;
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        })
        .catch(() => {});
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ensureAudioReady]);

  useEffect(() => {
    if (!socket) return;

    const sendSyncRequest = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      sendMessage({
        type: "beat-sync-request",
        clientSentAtMs: Date.now(),
      });
    };

    sendSyncRequest();
    socket.addEventListener("open", sendSyncRequest);
    const interval = window.setInterval(sendSyncRequest, SYNC_INTERVAL_MS);

    return () => {
      socket.removeEventListener("open", sendSyncRequest);
      window.clearInterval(interval);
    };
  }, [sendMessage, socket]);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      const validated = SignalSchema.safeParse(parsed);
      if (!validated.success) return;

      const message = validated.data;
      if (message.type === "beat-state") {
        setBeatState(message.state);
        if (!bestClockSampleRef.current) {
          setClockOffsetMs(message.serverNowMs - Date.now());
        }
      }

      if (message.type === "beat-sync-response") {
        const sample = createClockSample(message);
        const best = bestClockSampleRef.current;
        if (!best || sample.roundTripMs <= best.roundTripMs) {
          bestClockSampleRef.current = sample;
          setClockOffsetMs(sample.offsetMs);
          setClockRttMs(sample.roundTripMs);
        }
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.Tone.getTransport().bpm.value = beatState.bpm;
  }, [beatState.bpm]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const transport = engine.Tone.getTransport();

    if (!audioReady || beatState.mode !== "cypher") {
      transport.stop();
      transport.seconds = 0;
      setActiveStep(-1);
      return;
    }

    if (!beatState.isPlaying || !beatState.startedAtMs) {
      transport.stop();
      transport.seconds = 0;
      setActiveStep(-1);
      return;
    }

    const estimatedServerNowMs = Date.now() + clockOffsetMs;
    const msUntilStart = beatState.startedAtMs - estimatedServerNowMs;
    const loopDurationSeconds = getLoopDurationSeconds(beatState.bpm);
    const immediateOffsetSeconds =
      ((estimatedServerNowMs - beatState.startedAtMs) / 1000) % loopDurationSeconds;
    const offsetSeconds = msUntilStart > 0 ? 0 : (immediateOffsetSeconds + loopDurationSeconds) % loopDurationSeconds;
    const when = engine.Tone.now() + Math.max(0.03, msUntilStart > 0 ? msUntilStart / 1000 : 0.03);

    transport.stop();
    transport.start(when, offsetSeconds);
  }, [audioReady, beatState.isPlaying, beatState.mode, beatState.startedAtMs, beatState.bpm, clockOffsetMs]);

  const previewLane = useCallback(
    (lane: BeatLane) => {
      const engine = engineRef.current;
      if (!engine || !audioReady) return;

      const now = engine.Tone.now();
      if (lane === "kick") {
        engine.kick.triggerAttackRelease("C1", "8n", now, 0.95);
      }
      if (lane === "snare") {
        engine.snare.triggerAttackRelease("16n", now, 0.35);
      }
      if (lane === "hat") {
        engine.hat.triggerAttackRelease("32n", now, 0.16);
      }
    },
    [audioReady],
  );

  const pushPattern = useCallback(
    (nextSteps: BeatGrid, nextBpm: number, presetId?: BeatPresetId) => {
      if (!clientId) return;

      const bpm = clampBpm(nextBpm);
      sendMessage({
        type: "beat-set-pattern",
        senderClientId: clientId,
        bpm,
        steps: cloneBeatGrid(nextSteps),
        presetId: presetId ?? detectPresetId(nextSteps, bpm),
      });
    },
    [clientId, sendMessage],
  );

  const setMode = useCallback(
    (mode: RoomMode) => {
      if (!clientId || mode === beatStateRef.current.mode) return;
      sendMessage({
        type: "room-mode-set",
        senderClientId: clientId,
        mode,
      });
    },
    [clientId, sendMessage],
  );

  const setBpm = useCallback(
    (nextBpm: number) => {
      pushPattern(beatStateRef.current.steps, nextBpm, detectPresetId(beatStateRef.current.steps, clampBpm(nextBpm)));
    },
    [pushPattern],
  );

  const applyPreset = useCallback(
    async (presetId: BeatPresetId) => {
      if (presetId === "custom") return;
      const ready = await ensureAudioReady();
      if (!ready) return;
      const preset = getBeatPreset(presetId);
      pushPattern(preset.steps, preset.bpm, preset.id);
    },
    [ensureAudioReady, pushPattern],
  );

  const toggleStep = useCallback(
    async (lane: BeatLane, stepIndex: number) => {
      const ready = await ensureAudioReady();
      if (!ready) return;
      const nextSteps = cloneBeatGrid(beatStateRef.current.steps);
      nextSteps[lane][stepIndex] = !nextSteps[lane][stepIndex];
      pushPattern(nextSteps, beatStateRef.current.bpm, "custom");
      previewLane(lane);
    },
    [ensureAudioReady, previewLane, pushPattern],
  );

  const play = useCallback(async () => {
    if (!clientId) return;
    const ready = await ensureAudioReady();
    if (!ready) return;
    sendMessage({
      type: "beat-play",
      senderClientId: clientId,
    });
  }, [clientId, ensureAudioReady, sendMessage]);

  const stop = useCallback(() => {
    if (!clientId) return;
    sendMessage({
      type: "beat-stop",
      senderClientId: clientId,
    });
  }, [clientId, sendMessage]);

  const currentPreset = useMemo(
    () => (beatState.presetId === "custom" ? null : getBeatPreset(beatState.presetId)),
    [beatState.presetId],
  );

  return {
    beatState,
    activeStep,
    audioReady,
    clockOffsetMs,
    clockRttMs,
    currentPreset,
    engineLoaded,
    ensureAudioReady,
    setMode,
    setBpm,
    applyPreset,
    toggleStep,
    play,
    stop,
  };
}
