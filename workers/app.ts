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
    // Route WebSocket requests to Durable Object
    // Handled by app/routes/api.room.$roomId.websocket.ts via Remix Resource Route


    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
