---
trigger: always_on
---

# Project Architecture: SideChannel

## Goal
A disposable, peer-to-peer voice chat application running on Cloudflare Edge.

## Infrastructure
1.  **Signaling Server (Durable Objects):**
    - File: `app/durable-objects/SignalingServer.ts`
    - Logic: Acts as a WebSocket relay. It does not store audio. It only forwards WebRTC "Offer", "Answer", and "ICE Candidate" signals between peers.
    - State: Maintains a `Map<ClientId, WebSocket>` in memory.

2.  **Frontend (Remix):**
    - Route: `/r/$roomId` handles the connection logic.
    - Hook: `useWebRtcRoom` manages the `RTCPeerConnection`.

## Data Flow (Mesh Topology)
1.  User joins room -> Connects WebSocket to Durable Object.
2.  Durable Object broadcasts "User Joined".
3.  Existing users initiate `RTCPeerConnection` (Offer).
4.  New user responds (Answer).
5.  Audio flows Peer-to-Peer (WebRTC), bypassing the server.

## Constraints
- No database (No D1, No Postgres).
- No user accounts (Auth is anonymous/session-based).
- Use public STUN servers (Google).