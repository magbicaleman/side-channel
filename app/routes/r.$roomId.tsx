import { type LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/r.$roomId";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const roomId = params.roomId;
  
  // Handle Client ID cookie
  const cookieHeader = request.headers.get("Cookie");
  let clientId: string | null = null;
  
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map(c => c.split("="))
    );
    clientId = cookies["sidechannel_client_id"];
  }

  const headers = new Headers();
  if (!clientId) {
    clientId = crypto.randomUUID();
    headers.append("Set-Cookie", `sidechannel_client_id=${clientId}; Path=/; HttpOnly; SameSite=Lax`);
  }

  // Construct WebSocket URL
  // In development, we might need to adjust this if using a different port or protocol
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const host = url.host;
  const websocketUrl = `${protocol}//${host}/api/room/${roomId}/websocket`;

  return Response.json({ 
    roomId, 
    clientId,
    websocketUrl 
  }, { headers });
}

export default function Room() {
  const { roomId, clientId, websocketUrl } = useLoaderData<typeof loader>();
  const [status, setStatus] = useState("Disconnected");

  useEffect(() => {
    if (!websocketUrl) return;

    const ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
      setStatus("Connected");
      // Send join message
      ws.send(JSON.stringify({
        type: "join",
        clientId: clientId
      }));
    };

    ws.onclose = () => {
      setStatus("Disconnected");
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Error");
    };

    return () => {
      ws.close();
    };
  }, [websocketUrl, clientId]);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Room: {roomId}</h1>
      <div className="p-4 border rounded-lg bg-card text-card-foreground">
        <p><strong>Status:</strong> {status}</p>
        <p><strong>Your Client ID:</strong> {clientId}</p>
        <p className="text-xs text-muted-foreground mt-2">WebSocket URL: {websocketUrl}</p>
      </div>
    </div>
  );
}
