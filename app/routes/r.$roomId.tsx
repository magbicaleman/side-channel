import { type LoaderFunctionArgs, useNavigate } from "react-router";

import { useEffect, useState } from "react";
import { useWebRTC } from "~/hooks/useWebRTC";
import { Button } from "~/components/ui/button";
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

export default function Room({ loaderData }: Route.ComponentProps) {
  const { roomId, clientId, websocketUrl } = loaderData as { 
    roomId: string; 
    clientId: string; 
    websocketUrl: string; 
  };
  const navigate = useNavigate();
  const [status, setStatus] = useState("Disconnected");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Initialize WebSocket
  useEffect(() => {
    if (!websocketUrl) return;

    const ws = new WebSocket(websocketUrl);
    setSocket(ws);

    ws.onopen = () => {
      setStatus("Connected");
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

  // Initialize WebRTC
  const { localStream, peers, toggleMute, leave } = useWebRTC({
    roomId,
    socket,
    clientId,
  });

  const handleMuteToggle = () => {
    const muted = toggleMute();
    setIsMuted(muted);
  };

  const handleLeave = () => {
    leave();
    navigate("/");
  };

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Room: {roomId}</h1>
      
      <div className="p-4 border rounded-lg bg-card text-card-foreground space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p><strong>Status:</strong> {status}</p>
            <p><strong>Your Client ID:</strong> {clientId}</p>
            <p className="text-xs text-muted-foreground mt-1">WebSocket URL: {websocketUrl}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={isMuted ? "destructive" : "secondary"}
              size="sm"
              onClick={handleMuteToggle}
            >
              {isMuted ? "Unmute Mic" : "Mute Mic"}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleLeave}>
              Leave Room
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Local Feed (Muted) */}
        <div className="border rounded-lg p-4 bg-muted/50">
          <h3 className="font-semibold mb-2">You ({clientId?.slice(0, 8)})</h3>
          {localStream ? (
            <video
              ref={(video) => {
                if (video) video.srcObject = localStream;
              }}
              autoPlay
              muted
              playsInline
              className="w-full h-32 bg-black rounded-md object-cover"
            />
          ) : (
            <div className="w-full h-32 bg-gray-200 rounded-md flex items-center justify-center">
              <span className="text-sm text-gray-500">Loading Camera...</span>
            </div>
          )}
        </div>

        {/* Remote Peers */}
        {peers.map(([peerId, stream]) => (
          <div key={peerId} className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Peer ({peerId.slice(0, 8)})</h3>
            <audio
              ref={(audio) => {
                if (audio) audio.srcObject = stream;
              }}
              autoPlay
              playsInline
              controls // Optional: for debugging
            />
            <div className="w-full h-32 bg-blue-100 rounded-md flex items-center justify-center">
              <span className="text-2xl">👤</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
