import { useState, useEffect, useRef } from "react";
import { ResQNetP2PManager } from "../services/p2pTransfer";
import { getApiBaseUrl } from "../services/reportSync";

export default function PeerShareScreen() {
  const [connectionMode, setConnectionMode] = useState("network"); // "network" or "offline"
  const [roomId, setRoomId] = useState("ROOM-101");
  const [status, setStatus] = useState("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [logs, setLogs] = useState([]);
  
  // Offline manual fields
  const [offlineOffer, setOfflineOffer] = useState("");
  const [offlineAnswer, setOfflineAnswer] = useState("");
  const [inputCode, setInputCode] = useState("");

  const p2pRef = useRef(null);

  useEffect(() => {
    p2pRef.current = new ResQNetP2PManager({
      onStatusChange: ({ status: s, detail }) => {
        setStatus(s);
        setStatusDetail(detail);
      },
      onLog: (msg) => {
        setLogs((prev) => [msg, ...prev.slice(0, 40)]);
      },
    });

    return () => {
      p2pRef.current?.close();
    };
  }, []);

  const handleStartNetworkSync = async (asHost) => {
    setIsHost(asHost);
    const apiUrl = getApiBaseUrl() || "http://localhost:4000/api";
    try {
      await p2pRef.current.joinRoomWithSignaling(apiUrl, roomId.trim(), asHost);
    } catch (err) {
      setLogs((prev) => [`[Error] ${err.message}`, ...prev]);
    }
  };

  const handleCreateOfflineOffer = async () => {
    try {
      const offer = await p2pRef.current.createOffer();
      setOfflineOffer(offer);
    } catch (err) {
      setLogs((prev) => [`[Error] ${err.message}`, ...prev]);
    }
  };

  const handleAcceptOfflineOffer = async () => {
    try {
      const answer = await p2pRef.current.acceptOfferAndCreateAnswer(inputCode.trim());
      setOfflineAnswer(answer);
    } catch (err) {
      setLogs((prev) => [`[Error] Invalid offer code: ${err.message}`, ...prev]);
    }
  };

  const handleFinalizeOfflineAnswer = async () => {
    try {
      await p2pRef.current.acceptAnswer(inputCode.trim());
    } catch (err) {
      setLogs((prev) => [`[Error] Invalid answer code: ${err.message}`, ...prev]);
    }
  };

  const handleDisconnect = () => {
    p2pRef.current?.close();
    setStatus("idle");
    setStatusDetail("Disconnected");
    setOfflineOffer("");
    setOfflineAnswer("");
  };

  return (
    <div className="screen peershare-screen">
      <div className="screen-heading">
        <p className="eyebrow">DEVICE-TO-DEVICE SHARING</p>
        <h2>Nearby mesh transfer</h2>
        <p className="subheading">
          Relay emergency reports between nearby devices without cellular towers.
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="tab-switcher">
        <button
          className={`tab-btn ${connectionMode === "network" ? "active" : ""}`}
          onClick={() => setConnectionMode("network")}
        >
          Local Wi-Fi / Hotspot Room
        </button>
        <button
          className={`tab-btn ${connectionMode === "offline" ? "active" : ""}`}
          onClick={() => setConnectionMode("offline")}
        >
          Serverless Offline Code
        </button>
      </div>

      {/* Status banner */}
      <div className={`p2p-status-card status-${status}`}>
        <div className="status-indicator-row">
          <span className={`status-dot ${status === "connected" ? "online-dot" : ""}`} />
          <strong>
            {status === "idle" && "Ready to Pair"}
            {status === "connecting" && "Establishing WebRTC Connection..."}
            {status === "connected" && "Connected & Synchronized"}
            {status === "syncing" && "Exchanging Incident Reports..."}
            {status === "closed" && "Connection Closed"}
            {status === "error" && "Connection Error"}
          </strong>
        </div>
        {statusDetail && <p className="p2p-status-sub">{statusDetail}</p>}
        {status !== "idle" && (
          <button className="text-button disconnect-btn" onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      {/* Mode A: Local Network / Hotspot Room Code */}
      {connectionMode === "network" && (
        <div className="p2p-card">
          <label htmlFor="room-id">Shared Room Code</label>
          <input
            id="room-id"
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="e.g. ROOM-101"
            disabled={status !== "idle"}
          />
          <div className="p2p-button-row">
            <button
              className="primary-button"
              onClick={() => handleStartNetworkSync(true)}
              disabled={status !== "idle" || !roomId.trim()}
            >
              Host Room (Share My Reports)
            </button>
            <button
              className="choice"
              onClick={() => handleStartNetworkSync(false)}
              disabled={status !== "idle" || !roomId.trim()}
            >
              Join Room (Receive & Relay)
            </button>
          </div>
          <p className="form-disclaimer">
            Use when both devices are on the same Wi-Fi, mobile hotspot, or local network.
          </p>
        </div>
      )}

      {/* Mode B: Fully Serverless Offline Manual SDP */}
      {connectionMode === "offline" && (
        <div className="p2p-card offline-exchange">
          <div className="step-box">
            <h4>Step 1: Host creates offer</h4>
            <button
              className="text-button"
              onClick={handleCreateOfflineOffer}
              disabled={status !== "idle"}
            >
              Generate Offline Code
            </button>
            {offlineOffer && (
              <div className="code-display">
                <textarea readOnly value={offlineOffer} rows={3} />
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard?.writeText(offlineOffer)}
                >
                  Copy Offer Code
                </button>
              </div>
            )}
          </div>

          <div className="step-box">
            <h4>Step 2: Peer pastes offer to create answer</h4>
            <textarea
              placeholder="Paste Host Offer Code here..."
              rows={2}
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
            />
            <div className="button-group">
              <button
                className="choice"
                onClick={handleAcceptOfflineOffer}
                disabled={!inputCode.trim()}
              >
                Accept Offer & Generate Answer
              </button>
              <button
                className="choice"
                onClick={handleFinalizeOfflineAnswer}
                disabled={!inputCode.trim()}
              >
                Host Finalize with Answer
              </button>
            </div>
            {offlineAnswer && (
              <div className="code-display">
                <textarea readOnly value={offlineAnswer} rows={3} />
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard?.writeText(offlineAnswer)}
                >
                  Copy Answer Code
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Store and Forward Explainer */}
      <div className="relay-explainer-card">
        <strong>How Store-and-Forward Works:</strong>
        <p>
          1. Devices exchange manifests to find missing emergency reports.
          <br />
          2. Reports are encrypted and transferred directly via WebRTC DataChannel.
          <br />
          3. When any device later connects to internet or a responder station, all relayed reports are automatically uploaded to the cloud!
        </p>
      </div>

      {/* Activity Log */}
      <div className="p2p-logs">
        <label>Transfer Activity Log</label>
        <div className="log-console">
          {logs.length === 0 ? (
            <span className="log-empty">No activity yet. Ready to connect.</span>
          ) : (
            logs.map((log, idx) => <div key={idx} className="log-line">{log}</div>)
          )}
        </div>
      </div>
    </div>
  );
}
