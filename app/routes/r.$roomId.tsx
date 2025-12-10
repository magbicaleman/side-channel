import { type LoaderFunctionArgs, useNavigate } from "react-router";
import { useEffect, useState, useRef } from "react";
import { useWebRTC } from "~/hooks/useWebRTC";
import { Button } from "~/components/ui/button";
import { ModeToggle } from "~/components/mode-toggle";
import { Card } from "~/components/ui/card";
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
import { 
  Settings, 
  Mic, 
  MicOff, 
  Share2, 
  Volume2, 
  Phone, 
  Copy, 
  Check, 
  LogOut,
  Users
} from "lucide-react";
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

function PeerCard({ 
  id, 
  muted, 
  stream, 
  isLocal = false, 
  micLabel,
  outputDeviceId 
}: { 
  id: string; 
  muted?: boolean; 
  stream?: MediaStream; 
  isLocal?: boolean; 
  micLabel?: string;
  outputDeviceId?: string;
}) {
  return (
    <Card className="bg-neutral-900 border-neutral-800 relative overflow-hidden h-48 md:h-56 flex flex-col items-center justify-center transition-all hover:border-neutral-700 animate-in fade-in zoom-in-95 duration-500">
      {/* Status Overlay */}
      <div className="absolute top-3 right-3 flex gap-2">
        {muted ? (
          <div className="bg-red-500/20 text-red-500 rounded-full p-1.5 backdrop-blur-sm">
            <MicOff className="w-4 h-4" />
          </div>
        ) : (
          <div className="bg-green-500/20 text-green-500 rounded-full p-1.5 backdrop-blur-sm">
            <Mic className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Avatar Circle */}
      <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-2xl md:text-3xl font-bold mb-4 shadow-xl ${isLocal ? 'bg-primary/20 text-primary border-2 border-primary/30' : 'bg-neutral-800 text-neutral-400 border-2 border-neutral-700'}`}>
        {id.slice(0, 2).toUpperCase()}
      </div>

      {/* User Info */}
      <div className="text-center px-4 w-full">
        <h3 className="font-semibold text-neutral-200 truncate w-full">
          {isLocal ? "You" : `Peer ${id.slice(0, 4)}`}
        </h3>
        {micLabel && (
          <p className="text-xs text-neutral-500 mt-1 truncate max-w-full">
            {micLabel}
          </p>
        )}
      </div>

      {/* Viz/Pulse Effect (Simple CSS animation for active mic could go here) */}
      {!muted && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
      )}

      {/* Audio Element for Remote Peers */}
      {!isLocal && stream && outputDeviceId && (
        <AudioPlayer stream={stream} outputDeviceId={outputDeviceId} />
      )}
    </Card>
  );
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
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

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

  // Check Share Capability
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

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
    // Use View Transition for exit
    navigate("/", { viewTransition: true });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!canShare) {
        handleCopyLink();
        return;
    }
    try {
      await navigator.share({
        title: `Join my room: ${roomId}`,
        text: "Hop into this Side Channel room",
        url: window.location.href,
      });
    } catch (error) {
       // Ignore abort errors
    }
  };

  const handleSpeakerToggle = () => {
    if (!audioOutputDevices || audioOutputDevices.length === 0) {
      toast("No output devices found", {
        description: "Please use system controls to switch audio output.",
      });
      return;
    }
    const currentIndex = audioOutputDevices.findIndex(d => d.deviceId === selectedOutputDeviceId);
    const nextIndex = (currentIndex + 1) % audioOutputDevices.length;
    const nextDevice = audioOutputDevices[nextIndex];
    
    if (nextDevice) {
      switchOutputDevice(nextDevice.deviceId);
      toast(`Switched to ${nextDevice.label || "Speaker"}`);
    }
  };

  const selectedDeviceLabel = audioDevices.find(d => d.deviceId === selectedDeviceId)?.label || "Default Mic";
  const selectedOutputLabel = audioOutputDevices.find(d => d.deviceId === selectedOutputDeviceId)?.label || "Default Speaker";
  const isSpeaker = selectedOutputLabel.toLowerCase().includes("speaker");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 font-sans selection:bg-primary/20">
      {/* Top Bar (Simplified) */}
      <header className="p-4 md:p-6 flex items-center justify-between pointer-events-none sticky top-0 z-10">
        <div className="flex items-center gap-3 pointer-events-auto bg-neutral-950/50 backdrop-blur-sm px-4 py-2 rounded-full border border-white/5">
            <div className={`w-2 h-2 rounded-full ${status === 'Connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
            <h1 className="text-sm font-medium text-neutral-400 font-mono tracking-tight">
              {roomId}
            </h1>
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-neutral-500 hover:text-white"
                onClick={handleCopyLink}
            >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
        </div>
        
        {/* Client ID Badge */}
        <div className="flex items-center gap-2 pointer-events-auto bg-neutral-950/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5">
            <div className="text-xs text-neutral-600 font-mono hidden sm:block">
                ID: {clientId?.slice(0, 8)}...
            </div>
            <div className="h-6 w-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold ring-1 ring-neutral-700">
                {clientId?.slice(0, 2).toUpperCase()}
            </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="p-4 md:p-8 pb-32 max-w-[1600px] mx-auto animate-in fade-in duration-500">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
            {/* Local User Card */}
            <PeerCard 
                id={clientId} 
                isLocal={true} 
                muted={isMuted}
                micLabel={selectedDeviceLabel}
            />

            {/* Remote Peers */}
            {peers.map((peer) => (
                <PeerCard 
                    key={peer.id}
                    id={peer.id}
                    muted={peer.muted}
                    stream={peer.stream}
                    outputDeviceId={selectedOutputDeviceId}
                />
            ))}
            
            {/* Empty State / Ghost Cards */}
            {peers.length === 0 && (
                <div className="border border-dashed border-neutral-800 rounded-xl bg-neutral-900/10 h-48 md:h-56 flex flex-col items-center justify-center text-neutral-700 gap-2 animate-in fade-in duration-700 delay-100">
                    <Users className="w-8 h-8 opacity-20" />
                    <span className="text-sm font-medium">Waiting for peers...</span>
                    <Button variant="link" className="text-neutral-500" onClick={handleCopyLink}>
                        Invite someone
                    </Button>
                </div>
            )}
        </div>
      </main>

      {/* Bottom Floating Control Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[90vw] animate-in slide-in-from-bottom-10 fade-in duration-500 delay-200">
        <div className="bg-neutral-900/90 backdrop-blur-md border border-white/10 shadow-2xl rounded-full px-4 h-16 flex items-center gap-2 md:gap-4 ring-1 ring-black/50">
            
            {/* Mute Toggle */}
            <Button
                size="icon"
                className={`rounded-full w-12 h-12 transition-all ${isMuted ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'}`}
                onClick={handleMuteToggle}
            >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            {/* Output Toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-12 h-12 text-neutral-400 hover:text-white hover:bg-neutral-800"
                onClick={handleSpeakerToggle}
            >
                {isSpeaker ? <Volume2 className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </Button>

             {/* Share Button (New) */}
            <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-12 h-12 text-neutral-400 hover:text-white hover:bg-neutral-800"
                onClick={handleShare}
            >
                <Share2 className="h-5 w-5" />
            </Button>

            {/* Settings Dialog */}
            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full w-12 h-12 text-neutral-400 hover:text-white hover:bg-neutral-800">
                        <Settings className="h-5 w-5" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="bg-neutral-900 border-neutral-800 text-neutral-100">
                <DialogHeader>
                    <DialogTitle>Audio Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-neutral-400">
                            Microphone
                        </label>
                        <Select
                            value={selectedDeviceId}
                            onValueChange={(value) => switchDevice(value)}
                        >
                            <SelectTrigger className="bg-neutral-950 border-neutral-800 text-neutral-200">
                                <SelectValue placeholder="Select a microphone">
                                    {selectedDeviceLabel}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-neutral-950 border-neutral-800 text-neutral-200">
                                {audioDevices.map((device) => (
                                    <SelectItem key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {audioOutputDevices.length > 0 && (
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-neutral-400">
                                Speaker / Output
                            </label>
                            <Select
                                value={selectedOutputDeviceId}
                                onValueChange={(value) => switchOutputDevice(value)}
                            >
                                <SelectTrigger className="bg-neutral-950 border-neutral-800 text-neutral-200">
                                    <SelectValue placeholder="Select output">
                                        {selectedOutputLabel}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="bg-neutral-950 border-neutral-800 text-neutral-200">
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

            {/* Mode Toggle */}
            <ModeToggle />

            <div className="w-px h-8 bg-white/10 mx-1 md:mx-2" />

             {/* Leave Button */}
            <Button
                variant="destructive"
                size="icon"
                className="rounded-full w-12 h-12 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20"
                onClick={handleLeave}
            >
                <LogOut className="h-5 w-5 pl-0.5" />
            </Button>
        </div>
      </div>
    </div>
  );
}
