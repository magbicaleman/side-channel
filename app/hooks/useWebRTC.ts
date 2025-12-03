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

export function useWebRTC({ roomId, socket, clientId }: UseWebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // Map of remote clientId -> MediaStream
  const [peers, setPeers] = useState<Map<string, MediaStream>>(new Map());
  
  // Refs for mutable state that shouldn't trigger re-renders
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  // 1. Get User Media on Mount
  useEffect(() => {
    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        console.error("Failed to get user media:", err);
      }
    }
    initMedia();

    return () => {
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
        newPeers.set(targetClientId, remoteStream);
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
        // Force update to reflect state if needed, but track.enabled is mutable
        // We might want to return isMuted state
        return !audioTrack.enabled; // returns isMuted
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

  return {
    localStream,
    peers: Array.from(peers.entries()), // Convert Map to Array for rendering
    toggleMute,
    leave,
  };
}
