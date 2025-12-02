import { createRequestHandler } from "react-router";
export { SignalingServer } from "../app/durable-objects/SignalingServer";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Route WebSocket requests to Durable Object
    if (url.pathname.startsWith("/api/room/")) {
      const match = url.pathname.match(/\/api\/room\/([^\/]+)\/websocket/);
      if (match) {
        const roomId = match[1];
        const id = env.SIGNALING.idFromName(roomId);
        const stub = env.SIGNALING.get(id);
        return stub.fetch(request);
      }
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
