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

  // 1. Get User Media on Mount
  // 1. Get User Media on Mount
  useEffect(() => {
    let mounted = true;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
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
  useEffect(() => {
    if (!socket || !clientId || !localStream) return;

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

    // Send join message when ready
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "join", clientId }));
    } else {
      const handleOpen = () => {
        socket.send(JSON.stringify({ type: "join", clientId }));
        socket.removeEventListener("open", handleOpen);
      };
      socket.addEventListener("open", handleOpen);
    }


    return () => {
      socket.removeEventListener("message", handleMessage);
      // Cleanup peer connections on unmount or socket change
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      setPeers(new Map());
    };
  }, [socket, clientId, localStream]); // Re-run if socket/clientId/stream changes

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
        newPeers.set(targetClientId, { stream: remoteStream, muted: existing?.muted ?? false });
        return newPeers;
      });
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
      newPeers.set(peerId, { stream: existing?.stream ?? null, muted });
      return newPeers;
    });
  };

  return {
    localStream,
    peers: Array.from(peers.entries()), // Convert Map to Array for rendering
    toggleMute,
    leave,
    audioDevices,
    selectedDeviceId,
    switchDevice,
  };
}
