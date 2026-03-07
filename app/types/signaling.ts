import { z } from "zod";
import { BEAT_PRESET_IDS, BEAT_STEPS, ROOM_MODES } from "~/lib/beat";

const BeatLaneSchema = z.object({
  kick: z.array(z.boolean()).length(BEAT_STEPS),
  snare: z.array(z.boolean()).length(BEAT_STEPS),
  hat: z.array(z.boolean()).length(BEAT_STEPS),
});

const BeatPresetIdSchema = z.enum(BEAT_PRESET_IDS);
const RoomModeSchema = z.enum(ROOM_MODES);

const BeatRoomStateSchema = z.object({
  mode: RoomModeSchema,
  bpm: z.number().int().min(60).max(220),
  steps: BeatLaneSchema,
  isPlaying: z.boolean(),
  startedAtMs: z.number().int().nullable(),
  updatedAtMs: z.number().int(),
  updatedBy: z.string().nullable(),
  presetId: BeatPresetIdSchema,
});

export const SignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    clientId: z.string(),
  }),
  z.object({
    type: z.literal("offer"),
    targetClientId: z.string(),
    payload: z.any(), // RTCSessionDescriptionInit
    senderClientId: z.string(),
  }),
  z.object({
    type: z.literal("answer"),
    targetClientId: z.string(),
    payload: z.any(), // RTCSessionDescriptionInit
    senderClientId: z.string(),
  }),
  z.object({
    type: z.literal("ice-candidate"),
    targetClientId: z.string(),
    payload: z.any(), // RTCIceCandidateInit
    senderClientId: z.string(),
  }),
  z.object({
    type: z.literal("user-left"),
    clientId: z.string(),
  }),
  z.object({
    type: z.literal("user-joined"),
    clientId: z.string(),
  }),
  z.object({
    type: z.literal("mute-state"),
    senderClientId: z.string(),
    muted: z.boolean(),
  }),
  z.object({
    type: z.literal("beat-set-pattern"),
    senderClientId: z.string(),
    bpm: z.number().int().min(60).max(220),
    steps: BeatLaneSchema,
    presetId: BeatPresetIdSchema,
  }),
  z.object({
    type: z.literal("beat-play"),
    senderClientId: z.string(),
  }),
  z.object({
    type: z.literal("room-mode-set"),
    senderClientId: z.string(),
    mode: RoomModeSchema,
  }),
  z.object({
    type: z.literal("beat-stop"),
    senderClientId: z.string(),
  }),
  z.object({
    type: z.literal("beat-state"),
    state: BeatRoomStateSchema,
    serverNowMs: z.number().int(),
  }),
  z.object({
    type: z.literal("beat-sync-request"),
    clientSentAtMs: z.number().int(),
  }),
  z.object({
    type: z.literal("beat-sync-response"),
    clientSentAtMs: z.number().int(),
    serverReceivedAtMs: z.number().int(),
    serverSentAtMs: z.number().int(),
  }),
]);

export type SignalMessage = z.infer<typeof SignalSchema>;
export type BeatStateMessage = Extract<SignalMessage, { type: "beat-state" }>;
