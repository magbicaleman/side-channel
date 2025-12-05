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
  
  // State: Simplistic array of peers
  // We use a Map internally for O(1) lookups during signaling, but sync to an array for the UI
  const [peersMap, setPeersMap] = useState<Map<string, PeerModel>>(new Map());

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
      setAudioDevices(audioInputs);
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  };

  const refreshLocalStream = async (deviceId?: string) => {
    const wasMuted = localStreamRef.current?.getAudioTracks()[0]?.enabled === false;
    
    try {
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

      // Restore mute state
      if (wasMuted) {
        stream.getAudioTracks().forEach((t) => (t.enabled = false));
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      // Update selected device if the browser gave us something specific
      const track = stream.getAudioTracks()[0];
      if (track) {
        const settings = track.getSettings();
        if (settings.deviceId) {
          setSelectedDeviceId(settings.deviceId);
        }
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
    } catch (err) {
      console.error("Failed to get user media:", err);
    }
  };

  const switchDevice = async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;
    setSelectedDeviceId(deviceId);
    await refreshLocalStream(deviceId);
  };

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return true;
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
    let mounted = true;
    refreshLocalStream().catch(console.error);

    return () => {
      mounted = false;
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
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      setPeersMap((prev) => {
        const next = new Map(prev);
        // Preserve muted state if we knew about it, default to false
        const existing = next.get(targetClientId);
        next.set(targetClientId, { 
          id: targetClientId, 
          stream: remoteStream, 
          muted: existing?.muted ?? false 
        });
        return next;
      });
    };

    peerConnections.current.set(targetClientId, pc);
    return pc;
  };

  const handleUserJoined = async (newClientId: string) => {
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
  };
}
