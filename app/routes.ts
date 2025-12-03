import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/_index.tsx"), 
    route("r/:roomId", "routes/r.$roomId.tsx"),
    route("api/room/:roomId/websocket", "routes/api.room.$roomId.websocket.ts"),
] satisfies RouteConfig;
