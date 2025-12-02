import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [index("routes/_index.tsx"), route("r/:roomId", "routes/r.$roomId.tsx")] satisfies RouteConfig;
