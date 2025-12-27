import { useEffect, useRef, useState, useCallback } from "react";
import type { SignalMessage } from "~/types/signaling";

const STUN_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
};

const MEDIA_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // Google-specific constraint for mobile earpiece switching
    googEchoCancellation: true,
  },
  video: false,
};

interface UseWebRTCProps {
  roomId: string;
  socket: WebSocket | null;
  clientId: string | null;
}

export type PeerModel = {
  id: string;
  stream: MediaStream;
  muted: boolean;
};

export function useWebRTC({ roomId, socket, clientId }: UseWebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>("");

  const redactId = (id: string | null | undefined) => (id ? `${id.slice(0, 6)}…` : null);

  const debug = (...args: unknown[]) => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const enabled =
        params.get("debug") === "1" || window.localStorage.getItem("sidechannel_debug") === "1";
      if (enabled) console.debug("[useWebRTC]", ...args);
    } catch {
      // ignore
    }
  };
  
  // State: Simplistic array of peers
  // We use a Map internally for O(1) lookups during signaling, but sync to an array for the UI
  const [peersMap, setPeersMap] = useState<Map<string, PeerModel>>(new Map());
  const [permissionState, setPermissionState] = useState<'initial' | 'granted' | 'denied'>('initial');

  // Refs
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const lastBroadcastMuteState = useRef<boolean | null>(null);
  const joinedRef = useRef(false);

  // --- 1. Audio Device Management ---

  const getAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
      
      setAudioDevices(audioInputs);
      setAudioOutputDevices(audioOutputs);
      debug("devices", {
        audioInputs: audioInputs.length,
        audioOutputs: audioOutputs.length,
        hasSelectedDeviceId: Boolean(selectedDeviceId),
        hasSelectedOutputDeviceId: Boolean(selectedOutputDeviceId),
        labelsAvailable:
          audioInputs.some((d) => Boolean(d.label)) || audioOutputs.some((d) => Boolean(d.label)),
      });

      // If we have devices but no labels, it usually means permissions weren't fully granted yet
      // or the browser is protecting labels before first use.
      // We don't need to do anything special here as getUserMedia will eventually fix this.
      
      // Smart Fallback: Input
      // If currently selected mic is gone, we must refresh stream to default
      if (selectedDeviceId) {
         const stillExists = audioInputs.some(d => d.deviceId === selectedDeviceId);
         if (!stillExists) {
             console.log("Selected mic disconnected, reverting to default");
             setSelectedDeviceId(""); // Clear selection
             // We need to refresh the stream because the old track is likely dead/ended
             // Calling refreshLocalStream() without arg uses default constraints
             refreshLocalStream().catch(console.warn);
             return; // refreshLocalStream will call getAudioDevices again, so we can stop here
         }
      }

      // Smart Fallback: Output
      if (selectedOutputDeviceId) {
        const stillExists = audioOutputs.some(d => d.deviceId === selectedOutputDeviceId);
        if (!stillExists) {
             console.log("Selected speaker disconnected, reverting to default");
             const defaultDevice = audioOutputs.find(d => d.deviceId === 'default');
             setSelectedOutputDeviceId(defaultDevice ? defaultDevice.deviceId : (audioOutputs[0]?.deviceId || ""));
        }
      } else if (audioOutputs.length > 0) {
        // Auto-select if nothing selected yet
        const defaultDevice = audioOutputs.find(d => d.deviceId === 'default');
        if (defaultDevice) {
             setSelectedOutputDeviceId(defaultDevice.deviceId);
        } else {
             setSelectedOutputDeviceId(audioOutputs[0].deviceId);
        }
      }
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  };

  
  const checkPermissions = async () => {
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as any });
        return status.state; // 'granted', 'denied', 'prompt'
      } catch (e) {
        // Firefox/Safari might throw on 'microphone' query if not supported
        return 'prompt';
      }
    }
    return 'prompt';
  };

  const refreshLocalStream = async (deviceId?: string, throwOnError = false) => {
    const wasMuted = localStreamRef.current?.getAudioTracks()[0]?.enabled === false;
    
    try {
      debug("refreshLocalStream:start", { hasRequestedDeviceId: Boolean(deviceId) });
      const constraints = { ...MEDIA_CONSTRAINTS };
      if (deviceId) {
        // @ts-expect-error - deviceId is valid in constraints
        constraints.audio = { ...constraints.audio, deviceId: { exact: deviceId } };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Cleanup old tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      // Restore mute state
      const track = stream.getAudioTracks()[0];
      if (track && wasMuted) {
        track.enabled = false;
      }

      // Update selected device if the browser gave us something specific
      if (track) {
        const settings = track.getSettings();
        if (settings.deviceId) {
          setSelectedDeviceId(settings.deviceId);
        }
        debug("refreshLocalStream:track", {
          hasLabel: Boolean(track.label),
          hasDeviceId: Boolean(settings.deviceId),
          sampleRate: typeof settings.sampleRate === "number" ? settings.sampleRate : undefined,
          channelCount:
            typeof settings.channelCount === "number" ? settings.channelCount : undefined,
          echoCancellation:
            typeof settings.echoCancellation === "boolean" ? settings.echoCancellation : undefined,
          noiseSuppression:
            typeof settings.noiseSuppression === "boolean" ? settings.noiseSuppression : undefined,
          autoGainControl:
            typeof settings.autoGainControl === "boolean" ? settings.autoGainControl : undefined,
        });
      }

      // Sync mute state
      const muted = wasMuted ?? false;
      if (lastBroadcastMuteState.current !== muted) {
        lastBroadcastMuteState.current = muted;
        sendMuteState(muted);
      }

      // Hot-swap track for existing peers
      const newTrack = stream.getAudioTracks()[0];
      if (newTrack) {
        const replacePromises: Promise<void>[] = [];
        peerConnections.current.forEach((pc) => {
          if (pc.signalingState !== "closed") {
            const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
            if (sender) {
              replacePromises.push(sender.replaceTrack(newTrack).catch(console.warn));
            }
          }
        });
        await Promise.allSettled(replacePromises);
      }

      await getAudioDevices();
      setPermissionState('granted');
    } catch (err: any) {
      console.error("Failed to get user media:", err);
      debug("refreshLocalStream:error", { name: err?.name, message: err?.message });
      
      // Critical: Ensure we clear the stream on error so the UI shows "Enable Mic"
      localStreamRef.current = null;
      setLocalStream(null);

      let errorToThrow = err;
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        const isDismissed = err.message && err.message.toLowerCase().includes('dismissed');
        
        if (isDismissed) {
             setPermissionState('initial'); // Or 'prompt', but 'initial' works for our UI
             errorToThrow = null; // Don't throw for dismissed
        } else {
             setPermissionState('denied');
             // Check if it's a hard block
             const status = await checkPermissions();
             if (status === 'denied') {
                 errorToThrow = new Error("PERM_DENIED");
             }
        }
      } else {
          // Any other error (e.g. Device in use, NotFound) also effectively "denies" access for now
          setPermissionState('denied');
      }

      if (throwOnError && errorToThrow) throw errorToThrow;
    }
  };

  const retryMedia = async () => {
    // Fail fast if we know it's a hard block
    const status = await checkPermissions();
    if (status === 'denied') {
        setPermissionState('denied');
        throw new Error("PERM_DENIED");
    }
    
    setPermissionState('initial');
    await refreshLocalStream(undefined, true);
  };

  const switchDevice = async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;
    setSelectedDeviceId(deviceId);
    await refreshLocalStream(deviceId);
  };
  
  const switchOutputDevice = (deviceId: string) => {
    if (!deviceId) return;
    setSelectedOutputDeviceId(deviceId);
  };

  const toggleMute = useCallback(() => {
    // Auto-recovery: If no stream, try to start one
    if (!localStreamRef.current) {
        refreshLocalStream();
        return false; // Assume unmuted attempt
    }

    const track = localStreamRef.current.getAudioTracks()[0];
    if (!track) return true;

    track.enabled = !track.enabled;
    const isMuted = !track.enabled;
    
    sendMuteState(isMuted);
    lastBroadcastMuteState.current = isMuted;
    
    return isMuted;
  }, [socket, clientId]);

  // Init Audio
  useEffect(() => {
    refreshLocalStream().catch(console.error);

    // devicechange listener
    const handleDeviceChange = () => {
        getAudioDevices();
    };
    const mediaDevices = navigator.mediaDevices;
    const previousOnDeviceChange = (mediaDevices as any)?.ondevicechange;
    if (mediaDevices?.addEventListener) {
      mediaDevices.addEventListener("devicechange", handleDeviceChange);
    } else if (mediaDevices) {
      (mediaDevices as any).ondevicechange = handleDeviceChange;
    }

    return () => {
      if (mediaDevices?.removeEventListener) {
        mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      } else if (mediaDevices) {
        (mediaDevices as any).ondevicechange = previousOnDeviceChange ?? null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // --- 2. Signaling & WebRTC ---

  const sendMuteState = (muted: boolean) => {
    if (!socket || !clientId || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "mute-state", senderClientId: clientId, muted }));
  };

  const createPeerConnection = (targetClientId: string) => {
    if (peerConnections.current.has(targetClientId)) {
      return peerConnections.current.get(targetClientId)!;
    }

    const pc = new RTCPeerConnection(STUN_SERVERS);
    debug("pc:create", { targetClientId: redactId(targetClientId) });

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "ice-candidate",
          targetClientId,
          payload: event.candidate,
          senderClientId: clientId,
        }));
      }
    };

    // Remote Track
    pc.ontrack = (event) => {
      setPeersMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(targetClientId);
        const streamFromEvent = event.streams?.[0];
        debug("pc:ontrack", {
          targetClientId: redactId(targetClientId),
          hasStreams: Boolean(streamFromEvent),
          trackKind: event.track?.kind,
        });

        let stream = streamFromEvent ?? existing?.stream;
        if (!stream) {
          stream = new MediaStream();
        }

        // Some browsers (or some track/negotiation paths) may not populate `event.streams`.
        // Ensure we still attach the track so remote audio plays.
        if (!streamFromEvent && event.track) {
          const hasTrack = stream.getTracks().some((t) => t.id === event.track.id);
          if (!hasTrack) stream.addTrack(event.track);
        }

        next.set(targetClientId, {
          id: targetClientId,
          stream,
          muted: existing?.muted ?? false,
        });
        return next;
      });
    };

    peerConnections.current.set(targetClientId, pc);
    return pc;
  };

  const handleUserJoined = async (newClientId: string) => {
    // Fix: Clean up "ghost" peers if they rejoin without sending a leave event first
    if (peerConnections.current.has(newClientId)) {
      console.warn(`[useWebRTC] Cleaning up ghost peer: ${newClientId}`);
      const oldPc = peerConnections.current.get(newClientId);
      oldPc?.close();
      peerConnections.current.delete(newClientId);

      // Force UI update to remove the dead stream immediately
      setPeersMap((prev) => {
        const next = new Map(prev);
        next.delete(newClientId);
        return next;
      });
    }

    const pc = createPeerConnection(newClientId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "offer",
        targetClientId: newClientId,
        payload: offer,
        senderClientId: clientId,
      }));
    }
  };

  const handleOffer = async (senderClientId: string, payload: any) => {
    const pc = createPeerConnection(senderClientId);
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "answer",
        targetClientId: senderClientId,
        payload: answer,
        senderClientId: clientId,
      }));
    }
  };

  const handleAnswer = async (senderClientId: string, payload: any) => {
    const pc = peerConnections.current.get(senderClientId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
    }
  };

  const handleIceCandidate = async (senderClientId: string, payload: any) => {
    const pc = peerConnections.current.get(senderClientId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(payload));
    }
  };

  const handleUserLeft = (leftClientId: string) => {
    const pc = peerConnections.current.get(leftClientId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(leftClientId);
    }
    setPeersMap((prev) => {
      const next = new Map(prev);
      next.delete(leftClientId);
      return next;
    });
  };

  const updatePeerMuteState = (peerId: string, muted: boolean) => {
    setPeersMap((prev) => {
      const next = new Map(prev);
      const peer = next.get(peerId);
      if (peer) {
        next.set(peerId, { ...peer, muted });
      }
      return next;
    });
  };

  // Socket Logic
  useEffect(() => {
    if (!socket || !clientId) return;

    // Join if we have stream
    if (localStreamRef.current && !joinedRef.current && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "join", clientId }));
      joinedRef.current = true;
      debug("socket:join");
    }

    const handleMessage = async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as SignalMessage;
        
        switch (message.type) {
          case "user-joined":
            handleUserJoined(message.clientId);
            break;
          case "offer":
            handleOffer(message.senderClientId, message.payload);
            break;
          case "answer":
            handleAnswer(message.senderClientId, message.payload);
            break;
          case "ice-candidate":
            handleIceCandidate(message.senderClientId, message.payload);
            break;
          case "user-left":
            handleUserLeft(message.clientId);
            break;
          case "mute-state":
            updatePeerMuteState(message.senderClientId, message.muted);
            break;
        }
      } catch (err) {
        console.error("Signaling error:", err);
      }
    };

    socket.addEventListener("message", handleMessage);

    const onOpen = () => {
       if (localStreamRef.current && !joinedRef.current) {
          socket.send(JSON.stringify({ type: "join", clientId }));
          joinedRef.current = true;
          debug("socket:join:onOpen");
       }
    };
    socket.addEventListener("open", onOpen);

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("open", onOpen);
    };
  }, [socket, clientId, localStream]);

  const leave = useCallback(() => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setPeersMap(new Map());
    joinedRef.current = false;
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }, [socket]);

  return {
    localStream,
    peers: Array.from(peersMap.values()),
    leave,
    toggleMute,
    audioDevices,
    selectedDeviceId,
    switchDevice,
    audioOutputDevices,
    selectedOutputDeviceId,
    switchOutputDevice,
    permissionState,
    retryMedia,
  };
}
