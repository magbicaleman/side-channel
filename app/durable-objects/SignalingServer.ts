import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

// Validation schemas
const JoinSchema = z.object({
  type: z.literal("join"),
  clientId: z.string(),
});

const MuteStateSchema = z.object({
  type: z.literal("mute-state"),
  muted: z.boolean(),
  senderClientId: z.string(),
});

const SignalSchema = z.object({
  type: z.enum(["offer", "answer", "ice-candidate"]),
  targetClientId: z.string(),
  payload: z.any(), // WebRTC payloads can be complex, keeping it flexible
  senderClientId: z.string(),
});

const MessageSchema = z.union([JoinSchema, SignalSchema, MuteStateSchema]);

type Message = z.infer<typeof MessageSchema>;

export class SignalingServer extends DurableObject {
  // Map<ClientId, WebSocket>
  private sessions: Map<string, WebSocket> = new Map();
  // Track current mute state so new users can learn existing statuses
  private muteStates: Map<string, boolean> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore any existing sessions if needed, but for ephemeral signaling we might not need to.
    // However, DOs are persistent, so in-memory state stays as long as the DO is alive.
    // We'll rely on in-memory state.
    
    // Clean up disconnected sessions periodically if needed, 
    // but WebSocket 'close' event is usually enough.
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleSession(ws: WebSocket) {
    ws.accept();
    
    // We don't know the clientId yet. We'll wait for the 'join' message.
    let clientId: string | null = null;

    ws.addEventListener("message", async (event) => {
      try {
        const rawData = typeof event.data === "string" ? event.data : "";
        if (!rawData) return;

        const parsed = JSON.parse(rawData);
        const validation = MessageSchema.safeParse(parsed);

        if (!validation.success) {
          console.error("Invalid message:", validation.error);
          return;
        }

        const message = validation.data;

        if (message.type === "join") {
          clientId = message.clientId;
          this.sessions.set(clientId, ws);
          this.broadcastUserJoined(clientId);
          console.log(`User joined: ${clientId}`);
          this.sendExistingMuteStates(ws);
        } else if (["offer", "answer", "ice-candidate"].includes(message.type)) {
           // Relay message
           if ('targetClientId' in message) {
             this.relayMessage(message);
           }
        } else if (message.type === "mute-state") {
          this.muteStates.set(message.senderClientId, message.muted);
          this.broadcastMuteState(message.senderClientId, message.muted);
        }

      } catch (err) {
        console.error("Error handling message:", err);
      }
    });

    ws.addEventListener("close", () => {
      if (clientId && this.sessions.has(clientId)) {
        this.sessions.delete(clientId);
        this.muteStates.delete(clientId);
        console.log(`User disconnected: ${clientId}`);
        this.broadcastUserLeft(clientId);
      }
    });
  }

  private broadcastUserJoined(newClientId: string) {
    const message = JSON.stringify({ type: "user-joined", clientId: newClientId });
    for (const [id, ws] of this.sessions) {
      if (id !== newClientId) {
        try {
          ws.send(message);
        } catch (e) {
          // Handle broken connections
          this.sessions.delete(id);
        }
      }
    }
  }

  private broadcastUserLeft(clientId: string) {
    const message = JSON.stringify({ type: "user-left", clientId });
    for (const [id, ws] of this.sessions) {
      try {
        ws.send(message);
      } catch (e) {
        this.sessions.delete(id);
      }
    }
  }

  private relayMessage(message: Extract<Message, { targetClientId: string }>) {
    const targetWs = this.sessions.get(message.targetClientId);
    if (targetWs) {
      try {
        targetWs.send(JSON.stringify(message));
      } catch (e) {
        this.sessions.delete(message.targetClientId);
      }
    } else {
      console.warn(`Target client ${message.targetClientId} not found.`);
    }
  }

  private broadcastMuteState(senderClientId: string, muted: boolean) {
    const message = JSON.stringify({ type: "mute-state", senderClientId, muted });
    for (const [id, ws] of this.sessions) {
      if (id === senderClientId) continue;
      try {
        ws.send(message);
      } catch (e) {
        this.sessions.delete(id);
      }
    }
  }

  private sendExistingMuteStates(targetWs: WebSocket) {
    for (const [id, muted] of this.muteStates) {
      try {
        targetWs.send(JSON.stringify({ type: "mute-state", senderClientId: id, muted }));
      } catch (e) {
        // if we fail to send, let the regular message handlers deal with cleanup
      }
    }
  }
}
