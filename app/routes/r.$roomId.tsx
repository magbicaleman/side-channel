import { type LoaderFunctionArgs, useNavigate } from "react-router";
import { useEffect, useState, useRef } from "react";
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
import { Settings, Mic, MicOff, Share2, Volume2, Phone } from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/r.$roomId";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const roomId = params.roomId;
  
  // Handle Client ID cookie
  const cookieHeader = request.headers.get("Cookie");
  let clientId: string | null = null;
  
  // Basic validation UUID regex (8-4-4-4-12 hex format)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => c.split("="))
    );
    const candidate = cookies["sidechannel_client_id"];
    // Validate candidate before accepting
    if (candidate && uuidRegex.test(candidate)) {
      clientId = candidate;
    }
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

function AudioPlayer({ stream, outputDeviceId }: { stream: MediaStream; outputDeviceId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (audioRef.current && outputDeviceId) {
      if ('setSinkId' in audioRef.current && typeof (audioRef.current as any).setSinkId === 'function') {
        (audioRef.current as any).setSinkId(outputDeviceId).catch((err: unknown) => {
          console.error("Failed to set output device:", err);
        });
      }
    }
  }, [outputDeviceId]);

  return <audio ref={audioRef} autoPlay playsInline />;
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
  const { 
    localStream, 
    peers, 
    toggleMute, 
    leave, 
    audioDevices, 
    selectedDeviceId, 
    switchDevice,
    audioOutputDevices,
    selectedOutputDeviceId,
    switchOutputDevice
  } = useWebRTC({
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

  const handleSpeakerToggle = () => {
    // If no output devices are found (iOS Safari usually), show toast
    if (!audioOutputDevices || audioOutputDevices.length === 0) {
      toast("Audio Output Settings", {
        description: "To switch between Speaker and Earpiece, please use the AirPlay/Audio controls in your device's Control Center.",
        duration: 5000,
      });
      return;
    }

    // Cycle logic: If current is not set or first, go to next.
    // If we have 'speaker' usage we can try to find devices labeled 'speaker'
    
    const currentIndex = audioOutputDevices.findIndex(d => d.deviceId === selectedOutputDeviceId);
    const nextIndex = (currentIndex + 1) % audioOutputDevices.length;
    const nextDevice = audioOutputDevices[nextIndex];
    
    if (nextDevice) {
      switchOutputDevice(nextDevice.deviceId);
      toast(`Switched to ${nextDevice.label || "Speaker"}`);
    }
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
      if (errMsg.toLowerCase().includes("abort")) return;
      setShareMessage(errMsg);
    }
  };

  const selectedDeviceLabel = audioDevices.find(d => d.deviceId === selectedDeviceId)?.label || "Default Microphone";
  const selectedOutputLabel = audioOutputDevices.find(d => d.deviceId === selectedOutputDeviceId)?.label || "Default Speaker";
  
  // Decide which icon to show for output
  // If explicitly "speaker", show volume-2. Any other ID (earpiece often empty or 'earpiece') show phone?
  // Actually simpler: if we have NO devices, we assume mobile/auto, show Volume2 as generic.
  // If we have devices, toggle between them.
  // Let's just use Volume2 for "Speaker" active, Phone for "Earpiece" active.
  // But detection is tricky by label.
  const isSpeaker = selectedOutputLabel.toLowerCase().includes("speaker");

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Room: {roomId}</h1>
        <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              disabled={!canShare}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
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
                    <label className="text-sm font-medium leading-none">
                      Microphone
                    </label>
                    <Select
                      value={selectedDeviceId}
                      onValueChange={(value) => switchDevice(value)}
                    >
                      <SelectTrigger>
                      <SelectValue placeholder="Select a microphone">
                        {selectedDeviceLabel}
                      </SelectValue>
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
                  
                  {audioOutputDevices.length > 0 && (
                     <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">
                          Speaker / Output
                        </label>
                        <Select
                          value={selectedOutputDeviceId}
                          onValueChange={(value) => switchOutputDevice(value)}
                        >
                          <SelectTrigger>
                             <SelectValue placeholder="Select output">
                                {selectedOutputLabel}
                             </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {audioOutputDevices.map((device) => (
                              <SelectItem key={device.deviceId} value={device.deviceId}>
                                {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                     </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
        </div>
      </div>
      
      <div className="p-4 border rounded-lg bg-card text-card-foreground">
         <div className="flex items-center justify-between">
           <div className="text-sm space-y-1">
             <p><span className="text-muted-foreground mr-1">Status:</span>{status}</p>
             <p><span className="text-muted-foreground mr-1">Client ID:</span>{clientId}</p>
             {shareMessage && <p className="text-green-600">{shareMessage}</p>}
           </div>
           <div className="flex gap-2">
             <Button
                variant={isMuted ? "destructive" : "secondary"}
                onClick={handleMuteToggle}
              >
                {isMuted ? <MicOff className="h-4 w-4 mr-2" /> : <Mic className="h-4 w-4 mr-2" />}
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              
              <Button
                variant="secondary"
                size="icon"
                onClick={handleSpeakerToggle}
                title="Toggle Speaker/Earpiece"
              >
                 {isSpeaker ? <Volume2 className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              </Button>

              <Button variant="destructive" onClick={handleLeave}>
                Leave
              </Button>
           </div>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Local User */}
        <div className="border rounded-lg p-6 flex flex-col items-center justify-center bg-muted/30 h-48 relative overflow-hidden">
           <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
             <span className="text-2xl">👤</span>
           </div>
           <h3 className="font-semibold">You ({clientId?.slice(0, 4)})</h3>
           <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1 max-w-full truncate px-4">
             <Mic className="h-3 w-3 inline" /> {selectedDeviceLabel}
           </p>
           {isMuted && (
             <div className="absolute top-2 right-2 bg-destructive/10 text-destructive text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
               <MicOff className="h-3 w-3" /> MUTED
             </div>
           )}
        </div>

        {/* Remote Peers */}
        {peers.map((peer) => (
          <div key={peer.id} className="border rounded-lg p-6 flex flex-col items-center justify-center bg-card h-48 relative">
            <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
              <span className="text-2xl">🔊</span>
            </div>
            <h3 className="font-semibold">Peer ({peer.id.slice(0, 4)})</h3>
            <div className="mt-2 flex items-center gap-2">
              {peer.muted ? (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <MicOff className="h-3 w-3" /> Muted
                </span>
              ) : (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Live
                </span>
              )}
            </div>
            
            <AudioPlayer stream={peer.stream} outputDeviceId={selectedOutputDeviceId} />
          </div>
        ))}
      </div>
    </div>
  );
}
