import { z } from "zod";

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
]);

export type SignalMessage = z.infer<typeof SignalSchema>;
