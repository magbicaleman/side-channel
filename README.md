# SideChannel 🎙️

A disposable, serverless voice chat application built for low-latency gaming.
**Zero database. Zero accounts. Edge-native.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-live-green.svg)

## 🚀 The Problem
Gamers and remote teams often need a quick, low-friction way to talk. Discord and Zoom require accounts, downloads, or heavy client updates. **SideChannel** solves this by offering instant, ephemeral voice rooms that live on the Edge.

## 🛠️ Architecture

SideChannel leverages a **Mesh Topology** to ensure audio never touches a central server, minimizing latency and bandwidth costs.

- **Frontend:** [React Router v7](https://reactrouter.com) (Framework Mode) + Tailwind CSS v4.
- **Signaling:** [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) acting as a WebSocket relay.
- **Transport:** WebRTC (Peer-to-Peer) for high-fidelity, low-latency audio.
- **Infrastructure:** Cloudflare Workers (Serverless).

### How it works
1.  **Room Creation:** A user clicks "Create Room," generating a random UUID.
2.  **Signaling:** The client connects via WebSocket to a Durable Object specific to that Room ID.
3.  **Negotiation:** Clients exchange SDP Offers/Answers and ICE Candidates via the Signaling Server.
4.  **P2P Audio:** Once connected, audio streams directly between peers (UDP), bypassing the server entirely.

## ✨ Features

- **Ephemeral by Design:** Rooms exist only in-memory. When the last user leaves, the room state evaporates.
- **Real-Time Presence:** See who is in the room instantly via WebSocket events.
- **Mesh Networking:** Direct peer-to-peer audio for minimum latency.
- **Secure Signaling:** Zod-validated WebSocket messages to prevent malformed payloads.

## 💻 Local Development

**Prerequisites:**
- Node.js 20+
- Cloudflare Wrangler CLI installed

1.  **Install dependencies**
    ```bash
    npm install
    ```

2.  **Start the development server**
    ```bash
    npm run dev
    ```
    This starts the Remix dev server and the Cloudflare Worker proxy locally.

3.  **Open two browser tabs**
    Navigate to the local URL (e.g., `http://localhost:5173`). Create a room in one tab, and copy the URL to the second tab to test the connection.

## 📦 Deployment

This application is designed to run on Cloudflare Pages (or Workers).

1.  **Build the application**
    ```bash
    npm run build
    ```

2.  **Deploy to Cloudflare**
    ```bash
    npm run deploy
    ```

*Note: Ensure your Cloudflare account has Durable Objects enabled.*

---

**Built with ❤️ by magbicaleman**