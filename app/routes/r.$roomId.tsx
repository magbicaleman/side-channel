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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { 
  Settings, 
  Mic, 
  MicOff, 
  Share2, 
  Volume2, 
  Phone, 
  Copy, 
  Check, 
  PhoneOff,
  Users,
  Loader2,
  Play
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // 1. Critical: Handle Stream & Playback
  useEffect(() => {
    const el = audioRef.current;
    if (el && stream) {
      el.srcObject = stream;
      // Force playback immediately, regardless of device settings
      el.play()
        .then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        })
        .catch((e) => {
          console.warn("Autoplay blocked:", e);
          setAutoplayBlocked(true);
          setIsPlaying(false);
        });
    }
  }, [stream]);

  // 2. Optional: Handle Device Switching
  useEffect(() => {
    const el = audioRef.current;
    if (el && outputDeviceId) {
      // Feature detection first
      if ('setSinkId' in el && typeof (el as any).setSinkId === 'function') {
        (el as any).setSinkId(outputDeviceId)
          .catch((err: unknown) => {
             console.warn("Failed to set sinkId:", err);
             // Verify playback is still active after failed switch
             if (el.paused) {
                el.play().catch(e => console.warn("Recovery play failed:", e));
             }
          });
      }
    }
  }, [outputDeviceId]);

  const handleManualPlay = () => {
    if (audioRef.current) {
      audioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        })
        .catch(console.error);
    }
  };

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline controls={false} />
      {autoplayBlocked && (
        <div 
          className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm cursor-pointer group"
          onClick={handleManualPlay}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-primary text-primary-foreground rounded-full p-4 shadow-2xl transition-transform group-hover:scale-110 active:scale-95">
                  <Play className="w-8 h-8 fill-current" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Click to hear this peer (Autoplay blocked)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </>
  );
}

function PeerCard({ 
  id, 
  muted, 
  stream, 
  isLocal = false, 
  micLabel,
  outputDeviceId,
  permissionError,
  onRetry,
  isRequesting
}: { 
  id: string; 
  muted?: boolean; 
  stream?: MediaStream; 
  isLocal?: boolean; 
  micLabel?: string;
  outputDeviceId?: string;
  permissionError?: boolean;
  onRetry?: () => void;
  isRequesting?: boolean;
}) {
  return (
    <Card className={`bg-card border-border relative overflow-hidden h-48 md:h-56 flex flex-col items-center justify-center transition-all hover:border-primary/50 animate-in fade-in zoom-in-95 duration-500 ${permissionError ? 'border-destructive/50' : ''}`}>
      {/* Status Overlay */}
      <div className="absolute top-3 right-3 flex gap-2">
        {muted || !stream ? (
          <div className={`rounded-full p-1.5 backdrop-blur-sm ${!stream && !permissionError ? 'bg-muted/50 text-muted-foreground' : 'bg-destructive/20 text-destructive'}`}>
            <MicOff className="w-4 h-4" />
          </div>
        ) : (
          <div className="bg-green-500/20 text-green-500 rounded-full p-1.5 backdrop-blur-sm">
            <Mic className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Avatar Circle */}
      <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-2xl md:text-3xl font-bold mb-4 shadow-xl ${isLocal ? 'bg-primary/20 text-primary border-2 border-primary/30' : 'bg-muted text-muted-foreground border-2 border-border'}`}>
        {id.slice(0, 2).toUpperCase()}
      </div>

      {/* User Info */}
      <div className="text-center px-4 w-full">
        <h3 className="font-semibold text-card-foreground truncate w-full">
          {isLocal ? "You" : `Peer ${id.slice(0, 4)}`}
        </h3>
        {permissionError ? (
             <Button variant="destructive" size="sm" className="mt-2 h-7 text-xs" onClick={onRetry} disabled={isRequesting}>
                {isRequesting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                {isRequesting ? "Waiting..." : "Enable Mic"}
             </Button>
        ) : micLabel ? (
          <p className="text-xs text-neutral-500 mt-1 truncate max-w-full">
            {micLabel}
          </p>
        ) : null}
      </div>

      {/* Viz/Pulse Effect (Simple CSS animation for active mic could go here) */}
      {!muted && !permissionError && (
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
  const [supportsSetSinkId, setSupportsSetSinkId] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

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
    setSupportsSetSinkId(typeof window !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype);
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
    switchOutputDevice,
    permissionState,
    retryMedia
  } = useWebRTC({
    roomId,
    socket,
    clientId,
  });

  const handleRetryMic = async () => {
    setIsRequesting(true);
    const timer = setTimeout(() => {
        toast.warning("Browser suppressed the prompt?", {
            description: "Check the 🔒 or 🔇 icon in your address bar.",
            duration: 5000,
        });
    }, 2000);

    try {
        await retryMedia();
    } catch (err: any) {
        if (err.message === "PERM_DENIED") {
            toast.error("Microphone access is blocked.", {
                description: "Please allow access in your browser settings.",
                duration: 5000,
            });
        }
    } finally {
        clearTimeout(timer);
        setIsRequesting(false);
    }
  };

  const handleMuteToggle = async () => {
    if (permissionState === 'denied') {
        await handleRetryMic();
        return;
    }
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

  /* Smart Share Logic */
  const handleHeaderShare = async () => {
    try {
        if (typeof navigator !== 'undefined' && navigator.share) {
            await navigator.share({
                title: 'Join SideChannel', 
                text: 'Join my voice room', 
                url: window.location.href 
            });
        } else {
            throw new Error("Generic Share Fallback");
        }
    } catch (error) {
        // Ignore user cancellation
        if (error instanceof Error && error.name === 'AbortError') return;
        // Fallback to clipboard if share fails (e.g. not supported)
        handleCopyLink();
    }
  };

  // Keep legacy handleShare for other buttons if needed, or alias it
  const handleShare = handleHeaderShare;

  const handleSpeakerToggle = () => {
    if (!audioOutputDevices || audioOutputDevices.length === 0) {
      toast("No output devices found", {
        description: "Please use system controls to switch audio output.",
      });
      return;
    }

    if (!supportsSetSinkId) {
        toast("System audio control required", {
            description: "Please use your device's Control Center or AirPlay menu to switch speakers.",
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
  
  // Speaker is only "Active" if we have explicitly selected a non-default output AND the browser supports switching
  const isSpeakerActive = supportsSetSinkId && 
                          selectedOutputDeviceId !== "" && 
                          selectedOutputDeviceId !== "default" &&
                          audioOutputDevices.some(d => d.deviceId === selectedOutputDeviceId);
  


  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
      {/* Top Bar (Simplified) */}
      <header className="p-4 md:p-6 flex items-center justify-between pointer-events-none sticky top-0 z-10">
        <div className="flex items-center gap-3 pointer-events-auto bg-background/50 backdrop-blur-sm px-4 py-2 rounded-full border border-border">
            <div className={`w-2 h-2 rounded-full ${status === 'Connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
            <h1 className="text-sm font-medium text-neutral-400 font-mono tracking-tight">
              {roomId}
            </h1>
           {/* Smart Share Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-neutral-500 hover:text-white hover:bg-white/10 transition-colors"
                    onClick={handleHeaderShare}
                >
                    {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Share Room Link</p>
              </TooltipContent>
            </Tooltip>
        </div>
        
        {/* Client ID Badge */}
        <div className="flex items-center gap-2 pointer-events-auto bg-background/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border">
            <div className="text-xs text-muted-foreground font-mono hidden sm:block">
                ID: {clientId?.slice(0, 8)}...
            </div>
            <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold ring-1 ring-border">
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
                stream={localStream || undefined}
                micLabel={selectedDeviceLabel}

                permissionError={permissionState === 'denied' || !localStream}
                onRetry={handleRetryMic}
                isRequesting={isRequesting}
            />

            {/* Remote Peers */}
            {peers.map((peer) => (
                <PeerCard 
                    key={peer.id}
                    id={peer.id}
                    muted={peer.muted}
                    stream={peer.stream}
                    outputDeviceId={selectedOutputDeviceId}
                    permissionError={permissionState === 'denied'}
                    onRetry={handleRetryMic}
                />
            ))}
            
            {/* Empty State / Ghost Cards */}
            {peers.length === 0 && (
                <div className="border border-dashed border-border rounded-xl bg-muted/30 h-48 md:h-56 flex flex-col items-center justify-center text-muted-foreground gap-2 animate-in fade-in duration-700 delay-100">
                    <Users className="w-8 h-8 opacity-20" />
                    <span className="text-sm font-medium text-muted-foreground/90">Waiting for peers...</span>
                    <Button variant="link" className="text-muted-foreground" onClick={handleShare}>
                        Invite someone
                    </Button>
                </div>
            )}
        </div>
      </main>

      {/* Bottom Floating Control Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[90vw] animate-in slide-in-from-bottom-10 fade-in duration-500 delay-200">
        <TooltipProvider delayDuration={0}>
          <div className="bg-background/80 backdrop-blur-md border border-border shadow-2xl rounded-full px-4 h-16 flex items-center gap-2 md:gap-4 ring-1 ring-black/5">
            
            {/* Mute Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={isMuted || permissionState === 'denied' || !localStream ? "default" : "ghost"}
                  disabled={!localStream && permissionState !== 'denied' && !isRequesting} 
                  className={`rounded-full w-12 h-12 transition-all ${
                    permissionState === 'denied' || !localStream
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-2 border-destructive/50' 
                    : isMuted 
                        ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg shadow-destructive/20' 
                        : 'hover:bg-neutral-200 dark:hover:bg-white/10 text-foreground'
                  }`}
                  onClick={handleMuteToggle}
                >
                  {isMuted || permissionState === 'denied' || !localStream ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{permissionState === 'denied' || !localStream ? "Enable Mic" : isMuted ? "Unmute" : "Mute"}</p>
              </TooltipContent>
            </Tooltip>

            {/* Output Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`rounded-full w-12 h-12 transition-all ${isSpeakerActive ? 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90' : 'text-muted-foreground hover:bg-neutral-200 dark:hover:bg-white/10 hover:text-foreground'}`}
                  onClick={handleSpeakerToggle}
                >
                  {isSpeakerActive ? <Volume2 className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle Speaker</p>
              </TooltipContent>
            </Tooltip>

             {/* Share Button (New) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full w-12 h-12 text-muted-foreground hover:text-foreground hover:bg-neutral-200 dark:hover:bg-white/10 transition-transform duration-300 hover:scale-110 active:scale-95"
                  onClick={handleShare}
                >
                  <Share2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Share Room</p>
              </TooltipContent>
            </Tooltip>

            {/* Settings Dialog */}
            <Dialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="rounded-full w-12 h-12 text-muted-foreground hover:text-foreground hover:bg-neutral-200 dark:hover:bg-white/10">
                          <Settings className="h-5 w-5" />
                      </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Audio Settings</p>
                </TooltipContent>
              </Tooltip>
                <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Audio Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-muted-foreground">
                            Microphone
                        </label>
                        <Select
                            value={selectedDeviceId}
                            onValueChange={(value) => switchDevice(value)}
                        >
                            <SelectTrigger className="bg-background border-border text-foreground">
                                <SelectValue placeholder="Select a microphone">
                                    {selectedDeviceLabel}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-background border-border text-foreground">
                                {audioDevices.map((device) => (
                                    <SelectItem key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                        {/* Output Selection (Conditional) */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-neutral-400">
                                Speaker / Output
                            </label>
                            {supportsSetSinkId && audioOutputDevices.length > 0 ? (
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
                            ) : (
                                <div className="text-sm text-neutral-500 italic bg-neutral-900/50 p-3 rounded border border-neutral-800">
                                    {!supportsSetSinkId ? (
                                        <span>
                                            To switch to Speaker/Earpiece, use the AirPlay / Control Center controls on your device.
                                        </span>
                                    ) : (
                                       <span>System Default (Controlled by OS)</span>
                                    )}
                                </div>
                            )}
                        </div>
                </div>
                </DialogContent>
            </Dialog>

            {/* Mode Toggle */}
            <ModeToggle />

            <div className="w-px h-6 bg-border mx-2" />

             {/* Leave Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full w-12 h-12 text-red-500 hover:bg-red-100 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300 transition-all duration-200"
                  onClick={handleLeave}
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Disconnect</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
