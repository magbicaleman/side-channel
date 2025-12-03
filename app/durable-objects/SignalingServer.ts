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
  private sessions: Map<string, { ws: WebSocket; connectionId: string }> = new Map();
  // Track current mute state so new users can learn existing statuses
  private muteStates: Map<string, boolean> = new Map();
  private rateLimits: Map<string, { count: number; windowStart: number }> = new Map();
  private static readonly RATE_LIMIT_WINDOW_MS = 10_000;
  private static readonly RATE_LIMIT_MAX = 80;

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

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const forwardedProto = request.headers.get("X-Forwarded-Proto");
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    if (!isLocal) {
      const proto = forwardedProto ?? url.protocol.replace(":", "");
      if (proto !== "https") {
        return new Response("HTTPS required", { status: 400 });
      }
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== url.host) {
            return new Response("Origin not allowed", { status: 403 });
          }
        } catch {
          return new Response("Invalid origin", { status: 403 });
        }
      }
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
    const connectionId = crypto.randomUUID();

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
          const existing = this.sessions.get(clientId);
          if (existing) {
            ws.send(JSON.stringify({ type: "error", reason: "client-id-in-use" }));
            ws.close(4409, "client-id-in-use");
            return;
          }

          this.sessions.set(clientId, { ws, connectionId });
          this.broadcastUserJoined(clientId);
          console.log(`User joined: ${clientId}`);
          this.sendExistingMuteStates(ws);
        } else if (["offer", "answer", "ice-candidate"].includes(message.type)) {
           // Relay message
           if ('targetClientId' in message) {
             if (clientId && !this.consumeRateLimit(clientId)) {
               ws.close(4410, "rate-limit");
               return;
             }
             this.relayMessage(message);
           }
        } else if (message.type === "mute-state") {
          if (clientId && !this.consumeRateLimit(clientId)) {
            ws.close(4410, "rate-limit");
            return;
          }
          this.muteStates.set(message.senderClientId, message.muted);
          this.broadcastMuteState(message.senderClientId, message.muted);
        }

      } catch (err) {
        console.error("Error handling message:", err);
      }
    });

    ws.addEventListener("close", () => {
      if (clientId) {
        const entry = this.sessions.get(clientId);
        if (entry && entry.connectionId === connectionId) {
          this.sessions.delete(clientId);
          this.muteStates.delete(clientId);
          console.log(`User disconnected: ${clientId}`);
          this.broadcastUserLeft(clientId);
        }
      }
    });

    ws.addEventListener("error", () => {
      if (clientId) {
        const entry = this.sessions.get(clientId);
        if (entry && entry.connectionId === connectionId) {
          this.sessions.delete(clientId);
          this.muteStates.delete(clientId);
          console.log(`User disconnected: ${clientId}`);
          this.broadcastUserLeft(clientId);
        }
      }
    });
  }

  private broadcastUserJoined(newClientId: string) {
    const message = JSON.stringify({ type: "user-joined", clientId: newClientId });
    for (const [id, entry] of this.sessions) {
      if (id === newClientId) continue;
      try {
        entry.ws.send(message);
      } catch (e) {
        // Handle broken connections
        this.sessions.delete(id);
      }
    }
  }

  private broadcastUserLeft(clientId: string) {
    const message = JSON.stringify({ type: "user-left", clientId });
    for (const [id, entry] of this.sessions) {
      try {
        entry.ws.send(message);
      } catch (e) {
        this.sessions.delete(id);
      }
    }
  }

  private relayMessage(message: Extract<Message, { targetClientId: string }>) {
    const target = this.sessions.get(message.targetClientId);
    if (target) {
      try {
        target.ws.send(JSON.stringify(message));
      } catch (e) {
        this.sessions.delete(message.targetClientId);
      }
    } else {
      console.warn(`Target client ${message.targetClientId} not found.`);
    }
  }

  private broadcastMuteState(senderClientId: string, muted: boolean) {
    const message = JSON.stringify({ type: "mute-state", senderClientId, muted });
    for (const [id, entry] of this.sessions) {
      if (id === senderClientId) continue;
      try {
        entry.ws.send(message);
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

  private consumeRateLimit(clientId: string): boolean {
    const now = Date.now();
    const current = this.rateLimits.get(clientId);
    if (!current || now - current.windowStart > SignalingServer.RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(clientId, { count: 1, windowStart: now });
      return true;
    }

    if (current.count >= SignalingServer.RATE_LIMIT_MAX) {
      return false;
    }

    current.count += 1;
    this.rateLimits.set(clientId, current);
    return true;
  }
}
