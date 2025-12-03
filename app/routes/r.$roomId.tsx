import { type LoaderFunctionArgs, useNavigate } from "react-router";

import { useEffect, useState } from "react";
import { useWebRTC } from "~/hooks/useWebRTC";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Settings, Mic, MicOff, Share2 } from "lucide-react";
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
    const cookieParts = [
      `sidechannel_client_id=${clientId}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=21600", // 6 hours
    ];
    if (url.protocol === "https:") {
      cookieParts.push("Secure");
    }
    headers.append("Set-Cookie", cookieParts.join("; "));
  }

  // Construct WebSocket URL
  // In development, we might need to adjust this if using a different port or protocol
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  const protocol = url.protocol === "https:" || !isLocal ? "wss:" : "ws:";
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
  const [canShare, setCanShare] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

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
  const { localStream, peers, setPeerVolume, toggleMute, leave, audioDevices, selectedDeviceId, switchDevice } = useWebRTC({
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

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const handleShare = async () => {
    if (!canShare) return;
    setShareMessage(null);
    try {
      await navigator.share({
        title: `Join my room: ${roomId}`,
        text: "Hop into this Side Channel room",
        url: window.location.href,
      });
      setShareMessage("Shared successfully");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unable to share";
      // AbortError when user cancels; avoid noisy message
      if (errMsg.toLowerCase().includes("abort")) return;
      setShareMessage(errMsg);
    }
  };

  const selectedDeviceLabel = audioDevices.find(d => d.deviceId === selectedDeviceId)?.label || "Default Microphone";

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Room: {roomId}</h1>
      
      <div className="p-4 border rounded-lg bg-card text-card-foreground space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p><strong>Status:</strong> {status}</p>
            <p><strong>Your Client ID:</strong> {clientId}</p>
            {shareMessage && (
              <p className="text-xs text-muted-foreground mt-1">{shareMessage}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              disabled={!canShare}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share Room
            </Button>
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
            
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Audio Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      Microphone
                    </label>
                    <Select
                      value={selectedDeviceId}
                      onValueChange={(value) => switchDevice(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioDevices.map((device) => (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <Mic className="h-3 w-3" />
            {selectedDeviceLabel}
          </div>
        </div>

        {/* Remote Peers */}
        {peers.map(([peerId, peerInfo]) => {
          const isSpeaking = peerInfo.speaking && !peerInfo.muted;
          return (
            <div
              key={peerId}
              className={`border rounded-lg p-4 transition-all ${
                isSpeaking ? "ring-2 ring-amber-500 shadow-[0_0_0_4px_rgba(251,191,36,0.25)]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Peer ({peerId.slice(0, 8)})</h3>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {peerInfo.muted ? (
                    <>
                      <MicOff className="h-3 w-3 text-destructive" />
                      Muted
                    </>
                  ) : isSpeaking ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                      Speaking
                    </>
                  ) : (
                    <>
                      <Mic className="h-3 w-3" />
                      Live
                    </>
                  )}
                </span>
              </div>
              <audio
                ref={(audio) => {
                  if (audio) {
                    audio.srcObject = peerInfo.stream ?? null;
                    // HTMLMediaElement volume caps at 1; clamp to avoid errors
                    audio.volume = Math.min(1, Math.max(0, peerInfo.volume ?? 1));
                  }
                }}
                autoPlay
                playsInline
              />
              <div className="mt-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Volume
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={peerInfo.volume ?? 1}
                    onChange={(e) => setPeerVolume(peerId, Number(e.target.value))}
                    className="w-full accent-amber-500"
                    aria-label={`Adjust volume for ${peerId.slice(0, 8)}`}
                  />
                </label>
              </div>
              <div className="w-full h-32 bg-blue-100 rounded-md flex items-center justify-center">
                <span className="text-2xl">👤</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
