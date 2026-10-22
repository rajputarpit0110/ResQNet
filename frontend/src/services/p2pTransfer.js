import {
  getReports,
  getReportManifest,
  mergeReport,
  getOrCreateDeviceId,
} from "./reportStorage.js";

// Configuration for WebRTC
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export class ResQNetP2PManager {
  constructor({ onStatusChange = () => {}, onLog = () => {} } = {}) {
    this.peerConnection = null;
    this.dataChannel = null;
    this.onStatusChange = onStatusChange;
    this.onLog = onLog;
    this.status = "idle"; // idle, connecting, connected, syncing, closed, error
    this.localDeviceId = null;
  }

  setStatus(newStatus, detail = "") {
    this.status = newStatus;
    this.onStatusChange({ status: newStatus, detail });
    this.onLog(`[P2P] Status: ${newStatus} ${detail ? `(${detail})` : ""}`);
  }

  async initPeerConnection() {
    this.close();
    this.localDeviceId = await getOrCreateDeviceId();
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      this.onLog(`[P2P] ICE state changed: ${state}`);
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.setStatus("closed", `ICE state: ${state}`);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.onLog("[P2P] Inbound DataChannel received");
      this.setupDataChannel(event.channel);
    };

    return this.peerConnection;
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.onopen = async () => {
      this.setStatus("connected", "Data channel open");
      this.onLog("[P2P] Connected to nearby peer. Initiating sync handshake...");
      // Send handshake
      this.sendMessage({
        type: "HANDSHAKE",
        deviceId: this.localDeviceId,
        protocol: "resqnet-v1",
      });
    };

    this.dataChannel.onclose = () => {
      this.setStatus("closed", "Data channel closed");
      this.onLog("[P2P] Channel closed");
    };

    this.dataChannel.onerror = (err) => {
      this.setStatus("error", err?.message || "Data channel error");
      this.onLog(`[P2P] Error: ${err?.message || "Unknown error"}`);
    };

    this.dataChannel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleMessage(message);
      } catch (err) {
        this.onLog(`[P2P] Failed to parse message: ${err.message}`);
      }
    };
  }

  sendMessage(obj) {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(JSON.stringify(obj));
    } else {
      this.onLog("[P2P] Cannot send: data channel is not open");
    }
  }

  async handleMessage(msg) {
    this.onLog(`[P2P] Received msg type: ${msg.type}`);

    switch (msg.type) {
      case "HANDSHAKE": {
        // Send ACK and request manifest
        this.sendMessage({
          type: "HANDSHAKE_ACK",
          deviceId: this.localDeviceId,
          protocol: "resqnet-v1",
        });
        const manifest = await getReportManifest();
        this.sendMessage({ type: "MANIFEST", manifest });
        break;
      }

      case "HANDSHAKE_ACK": {
        const manifest = await getReportManifest();
        this.sendMessage({ type: "MANIFEST", manifest });
        break;
      }

      case "MANIFEST": {
        // Peer sent manifest: see what we have that they need, and request what they have that we need
        this.setStatus("syncing", "Comparing report manifests");
        const peerManifest = Array.isArray(msg.manifest) ? msg.manifest : [];
        const localManifest = await getReportManifest();

        const localMap = new Map(localManifest.map((m) => [m.id, m]));
        const peerMap = new Map(peerManifest.map((m) => [m.id, m]));

        // Determine what peer is missing or has older revisions of
        const allLocalReports = await getReports();
        const reportsToSend = allLocalReports.filter((localR) => {
          const peerItem = peerMap.get(localR.id);
          if (!peerItem) return true; // Peer doesn't have it
          const localRev = localR.revision || 1;
          const peerRev = peerItem.revision || 1;
          return localRev > peerRev;
        });

        // Determine what reports we are missing or have older revisions of
        const neededIds = peerManifest
          .filter((peerItem) => {
            const localItem = localMap.get(peerItem.id);
            if (!localItem) return true;
            return (peerItem.revision || 1) > (localItem.revision || 1);
          })
          .map((item) => item.id);

        if (reportsToSend.length > 0) {
          this.onLog(`[P2P] Sending ${reportsToSend.length} reports to peer...`);
          this.sendMessage({
            type: "REPORTS_PAYLOAD",
            reports: reportsToSend,
          });
        }

        if (neededIds.length > 0) {
          this.onLog(`[P2P] Requesting ${neededIds.length} reports from peer...`);
          this.sendMessage({
            type: "REQUEST_REPORTS",
            reportIds: neededIds,
          });
        }

        if (reportsToSend.length === 0 && neededIds.length === 0) {
          this.setStatus("connected", "In sync (No pending changes)");
          this.onLog("[P2P] Both devices are fully synchronized.");
        }
        break;
      }

      case "REQUEST_REPORTS": {
        const requestedIds = new Set(msg.reportIds || []);
        const all = await getReports();
        const toSend = all.filter((r) => requestedIds.has(r.id));
        if (toSend.length > 0) {
          this.sendMessage({ type: "REPORTS_PAYLOAD", reports: toSend });
        }
        break;
      }

      case "REPORTS_PAYLOAD": {
        const incoming = Array.isArray(msg.reports) ? msg.reports : [];
        this.onLog(`[P2P] Ingesting ${incoming.length} relayed reports...`);
        let imported = 0;

        for (const report of incoming) {
          try {
            // Basic validation
            if (!report || !report.id || typeof report.id !== "string") continue;
            // Bound payload size: max 100KB per report
            if (JSON.stringify(report).length > 100000) continue;

            const res = await mergeReport(report);
            if (res.action === "inserted" || res.action === "updated") {
              imported += 1;
            }
          } catch (e) {
            this.onLog(`[P2P] Error merging report ${report?.id}: ${e.message}`);
          }
        }

        this.onLog(`[P2P] Successfully merged ${imported} reports.`);
        window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));

        this.sendMessage({
          type: "TRANSFER_ACK",
          count: imported,
        });

        this.setStatus("connected", `Sync complete (${imported} reports received)`);
        break;
      }

      case "TRANSFER_ACK": {
        this.onLog(`[P2P] Peer confirmed receipt of ${msg.count || 0} reports.`);
        this.setStatus("connected", `Peer received ${msg.count || 0} reports`);
        break;
      }

      default:
        this.onLog(`[P2P] Unknown message: ${msg.type}`);
    }
  }

  // --- Signaling Methods ---

  // 1. Create an Offer (Initiator)
  async createOffer() {
    await this.initPeerConnection();
    const channel = this.peerConnection.createDataChannel("resqnet-sync");
    this.setupDataChannel(channel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // Wait for ICE candidates gathering to finish so the offer is self-contained
    await this.waitForAllIceCandidates();

    this.setStatus("connecting", "Offer created, awaiting answer");
    return JSON.stringify(this.peerConnection.localDescription);
  }

  // 2. Accept an Offer & Create an Answer (Receiver)
  async acceptOfferAndCreateAnswer(offerJsonString) {
    await this.initPeerConnection();
    const offer = JSON.parse(offerJsonString);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await this.waitForAllIceCandidates();

    this.setStatus("connecting", "Answer created, awaiting connection");
    return JSON.stringify(this.peerConnection.localDescription);
  }

  // 3. Finalize with Answer (Initiator receives answer)
  async acceptAnswer(answerJsonString) {
    if (!this.peerConnection) throw new Error("No active peer connection");
    const answer = JSON.parse(answerJsonString);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    this.setStatus("connecting", "Remote answer set, establishing channel...");
  }

  // Helper to gather all ICE candidates for clean offline QR/SDP copy-paste exchange
  waitForAllIceCandidates() {
    return new Promise((resolve) => {
      if (!this.peerConnection || this.peerConnection.iceGatheringState === "complete") {
        resolve();
        return;
      }

      const check = () => {
        if (this.peerConnection.iceGatheringState === "complete") {
          this.peerConnection.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };

      this.peerConnection.addEventListener("icegatheringstatechange", check);
      // Fallback timeout in case some candidates take long
      setTimeout(() => {
        if (this.peerConnection) {
          this.peerConnection.removeEventListener("icegatheringstatechange", check);
        }
        resolve();
      }, 3000);
    });
  }

  // Optional: Connect via backend signaling room code
  async joinRoomWithSignaling(apiUrl, roomId, isHost = false) {
    this.setStatus("connecting", `Joining room ${roomId}...`);
    const cleanUrl = apiUrl.replace(/\/+$/, "");

    if (isHost) {
      const offerJson = await this.createOffer();
      // Post offer to signaling endpoint
      await fetch(`${cleanUrl}/p2p/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, type: "offer", sdp: offerJson }),
      });

      // Poll for answer
      const pollInterval = setInterval(async () => {
        if (this.status === "connected" || this.status === "closed") {
          clearInterval(pollInterval);
          return;
        }
        try {
          const resp = await fetch(`${cleanUrl}/p2p/signal/${roomId}?type=answer`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.sdp) {
              clearInterval(pollInterval);
              await this.acceptAnswer(data.sdp);
            }
          }
        } catch {}
      }, 1500);

      // Stop polling after 45s
      setTimeout(() => clearInterval(pollInterval), 45000);
    } else {
      // Peer: fetch offer from signaling endpoint
      const resp = await fetch(`${cleanUrl}/p2p/signal/${roomId}?type=offer`);
      if (!resp.ok) throw new Error("Could not find host offer in this room");
      const data = await resp.json();
      if (!data?.sdp) throw new Error("Room offer not available");

      const answerJson = await this.acceptOfferAndCreateAnswer(data.sdp);
      // Post answer
      await fetch(`${cleanUrl}/p2p/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, type: "answer", sdp: answerJson }),
      });
    }
  }

  close() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.status = "idle";
  }
}
