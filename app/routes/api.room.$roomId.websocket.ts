import { type LoaderFunctionArgs } from "react-router";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const roomId = params.roomId;

  if (!roomId) {
    return new Response("Room ID required", { status: 400 });
  }

  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const id = context.cloudflare.env.SIGNALING.idFromName(roomId);
  const stub = context.cloudflare.env.SIGNALING.get(id);

  return stub.fetch(request);
}
