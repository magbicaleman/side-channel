import { useEffect, useRef, useState } from "react";

const STUN_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
};

interface UseWebRTCProps {
  roomId: string;
  socket: WebSocket | null;
  clientId: string | null;
}

type PeerInfo = {
  stream: MediaStream | null;
  muted: boolean;
  speaking: boolean;
  volume: number;
};

export function useWebRTC({ roomId, socket, clientId }: UseWebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  // Map of remote clientId -> MediaStream
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  
  // Refs for mutable state that shouldn't trigger re-renders
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const lastBroadcastMuteState = useRef<boolean | null>(null);
  const joinedRef = useRef(false);
  const audioMonitors = useRef<
    Map<
      string,
      {
        audioContext: AudioContext;
        analyser: AnalyserNode;
        source: MediaStreamAudioSourceNode;
        rafId: number;
      }
    >
  >(new Map());

  // 1. Get User Media on Mount
  // 1. Get User Media on Mount
  useEffect(() => {
    let mounted = true;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          },
        });
        
        if (!mounted) {
          // If component unmounted while waiting for permission, stop the stream immediately
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);

        // Get initial device list after permission is granted
        await getAudioDevices();
        
        // Set initial selected device
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const settings = audioTrack.getSettings();
          if (settings.deviceId) {
            setSelectedDeviceId(settings.deviceId);
          }
        }
      } catch (err) {
        console.error("Failed to get user media:", err);
      }
    }
    initMedia();

    return () => {
      mounted = false;
      // Cleanup local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 2. Handle WebSocket Signaling
  const attemptJoin = () => {
    if (!socket || !clientId || joinedRef.current) return;
    if (!localStreamRef.current) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "join", clientId }));
      joinedRef.current = true;
    }
  };

  useEffect(() => {
    if (!socket || !clientId) return;

    const handleMessage = async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "user-joined":
            handleUserJoined(message.clientId);
            break;
          case "offer":
            handleOffer(message);
            break;
          case "answer":
            handleAnswer(message);
            break;
          case "ice-candidate":
            handleIceCandidate(message);
            break;
          case "user-left":
            handleUserLeft(message.clientId);
            break;
          case "mute-state":
            updatePeerMuteState(message.senderClientId, message.muted);
            break;
        }
      } catch (err) {
        console.error("Error handling signaling message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);

    const handleOpen = () => {
      attemptJoin();
    };
    socket.addEventListener("open", handleOpen);

    attemptJoin();

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("open", handleOpen);
      // Cleanup peer connections on unmount or socket change
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      stopAllMonitoring();
      setPeers(new Map());
      joinedRef.current = false;
    };
  }, [socket, clientId]); // Re-run if socket/clientId changes

  // If we get a local stream after socket is ready, try joining once.
  useEffect(() => {
    attemptJoin();
  }, [localStream]);

  // --- WebRTC Logic ---
  const sendMuteState = (muted: boolean) => {
    if (!socket || !clientId) return;
    const payload = JSON.stringify({ type: "mute-state", senderClientId: clientId, muted });

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else if (socket.readyState === WebSocket.CONNECTING) {
      const handleOpen = () => {
        socket.send(payload);
        socket.removeEventListener("open", handleOpen);
      };
      socket.addEventListener("open", handleOpen);
    }
  };

  // Let peers know our current mute state when our stream changes (e.g. join or device switch)
  useEffect(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    const muted = audioTrack ? !audioTrack.enabled : false;
    if (lastBroadcastMuteState.current !== muted) {
      lastBroadcastMuteState.current = muted;
      sendMuteState(muted);
    }
  }, [localStream, socket, clientId]);

  const createPeerConnection = (targetClientId: string) => {
    if (peerConnections.current.has(targetClientId)) {
      console.warn(`Peer connection already exists for ${targetClientId}`);
      return peerConnections.current.get(targetClientId)!;
    }

    const pc = new RTCPeerConnection(STUN_SERVERS);

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle ICE candidates
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

    // Handle Remote Stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setPeers((prev) => {
        const newPeers = new Map(prev);
        const existing = newPeers.get(targetClientId);
        newPeers.set(targetClientId, { stream: remoteStream, muted: existing?.muted ?? false, speaking: false, volume: existing?.volume ?? 1 });
        return newPeers;
      });
      startMonitoringLevel(targetClientId, remoteStream);
    };

    peerConnections.current.set(targetClientId, pc);
    return pc;
  };

  const handleUserJoined = async (newClientId: string) => {
    console.log(`Initiating connection to ${newClientId}`);
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

  const handleOffer = async (message: any) => {
    const { senderClientId, payload } = message;
    console.log(`Received offer from ${senderClientId}`);
    
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

  const handleAnswer = async (message: any) => {
    const { senderClientId, payload } = message;
    console.log(`Received answer from ${senderClientId}`);
    
    const pc = peerConnections.current.get(senderClientId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
    }
  };

  const handleIceCandidate = async (message: any) => {
    const { senderClientId, payload } = message;
    
    const pc = peerConnections.current.get(senderClientId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(payload));
    }
  };

  const handleUserLeft = (leftClientId: string) => {
    console.log(`User left: ${leftClientId}`);
    
    // Close peer connection
    const pc = peerConnections.current.get(leftClientId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(leftClientId);
    }
    stopMonitoringLevel(leftClientId);

    // Remove from peers list
    setPeers((prev) => {
      const newPeers = new Map(prev);
      newPeers.delete(leftClientId);
      return newPeers;
    });
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muted = !audioTrack.enabled;
      sendMuteState(muted);
      lastBroadcastMuteState.current = muted;
      return muted; // returns isMuted
    }
  }
  return true;
  };

  const leave = () => {
    // 1. Close all peer connections
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    stopAllMonitoring();
    joinedRef.current = false;

    // 2. Stop local media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // 3. Close WebSocket
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }

    // 4. Reset state
    setPeers(new Map());
  };

  const getAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      setAudioDevices(audioInputs);
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  };

  const switchDevice = async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;

    const wasMuted = localStreamRef.current?.getAudioTracks()[0]?.enabled === false;

    try {
      // 1. Get new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });

      // 2. Stop old tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      // 3. Update local state
      if (wasMuted) {
        const newTrack = newStream.getAudioTracks()[0];
        if (newTrack) {
          newTrack.enabled = false;
        }
      }
      localStreamRef.current = newStream;
      setLocalStream(newStream);
      setSelectedDeviceId(deviceId);

      // 4. Replace track in all peer connections
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (newAudioTrack) {
        peerConnections.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (sender) {
            sender.replaceTrack(newAudioTrack);
          }
        });
      }

      if (wasMuted !== undefined) {
        const muted = wasMuted ?? false;
        lastBroadcastMuteState.current = muted;
        sendMuteState(muted);
      }
    } catch (err) {
      console.error("Failed to switch device:", err);
    }
  };

  const updatePeerMuteState = (peerId: string, muted: boolean) => {
    setPeers((prev) => {
      const newPeers = new Map(prev);
      const existing = newPeers.get(peerId);
      newPeers.set(peerId, { stream: existing?.stream ?? null, muted, speaking: false, volume: existing?.volume ?? 1 });
      return newPeers;
    });
  };

  const startMonitoringLevel = (peerId: string, stream: MediaStream) => {
    stopMonitoringLevel(peerId);
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.fftSize);
      const threshold = 0.04; // tweakable speech threshold

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const speaking = rms > threshold;
        setPeers((prev) => {
          const updated = new Map(prev);
          const info = updated.get(peerId);
          if (info) {
            updated.set(peerId, { ...info, speaking });
          }
          return updated;
        });
        const monitor = audioMonitors.current.get(peerId);
        if (monitor) {
          monitor.rafId = requestAnimationFrame(tick);
        }
      };

      const rafId = requestAnimationFrame(tick);
      audioMonitors.current.set(peerId, { audioContext, analyser, source, rafId });
    } catch (err) {
      console.error("Failed to start audio monitor", err);
    }
  };

  const stopMonitoringLevel = (peerId: string) => {
    const monitor = audioMonitors.current.get(peerId);
    if (monitor) {
      cancelAnimationFrame(monitor.rafId);
      monitor.source.disconnect();
      monitor.audioContext.close();
      audioMonitors.current.delete(peerId);
    }
  };

  const stopAllMonitoring = () => {
    Array.from(audioMonitors.current.keys()).forEach(stopMonitoringLevel);
  };

  const setPeerVolume = (peerId: string, volume: number) => {
    const clamped = Math.min(1, Math.max(0, volume));
    setPeers((prev) => {
      const next = new Map(prev);
      const existing = next.get(peerId);
      if (existing) {
        next.set(peerId, { ...existing, volume: clamped });
      }
      return next;
    });
  };

  return {
    localStream,
    peers: Array.from(peers.entries()), // Convert Map to Array for rendering
    setPeerVolume,
    toggleMute,
    leave,
    audioDevices,
    selectedDeviceId,
    switchDevice,
  };
}
