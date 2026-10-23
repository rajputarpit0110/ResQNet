import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { ResQNetP2PManager } from "../services/p2pTransfer";
import { getApiBaseUrl } from "../services/reportSync";
import { getReports, mergeReport } from "../services/reportStorage";

// Tactile audio feedback on successful QR scan
function playSuccessBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

export default function PeerShareScreen() {
  // Modes: "qr", "hotspot", "manual"
  const [activeMode, setActiveMode] = useState("qr");
  
  // QR Submode: "show" (victim shows QR) or "scan" (helper scans QR)
  const [qrSubMode, setQrSubMode] = useState("show");
  
  // Reports list for QR display
  const [localReports, setLocalReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");

  // QR Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(null);
  const [scanError, setScanError] = useState("");
  const scannerRef = useRef(null);

  // Hotspot WebRTC Mode
  const [roomId, setRoomId] = useState("ROOM-101");
  const [isHost, setIsHost] = useState(false);
  const [status, setStatus] = useState("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [logs, setLogs] = useState([]);

  // Manual Offline Code Exchange
  const [offlineOffer, setOfflineOffer] = useState("");
  const [offlineAnswer, setOfflineAnswer] = useState("");
  const [inputCode, setInputCode] = useState("");

  const p2pRef = useRef(null);

  // 1. Load Local Reports for QR generator
  const loadReports = useCallback(async () => {
    try {
      const reports = await getReports();
      setLocalReports(reports);
      if (reports.length > 0 && !selectedReportId) {
        setSelectedReportId(reports[0].id);
      }
    } catch (err) {
      console.error("Could not load reports for QR:", err);
    }
  }, [selectedReportId]);

  useEffect(() => {
    loadReports();
    window.addEventListener("resqnet:reports-updated", loadReports);
    return () => window.removeEventListener("resqnet:reports-updated", loadReports);
  }, [loadReports]);

  // 2. Generate QR Code when selected report changes
  useEffect(() => {
    if (activeMode !== "qr" || qrSubMode !== "show") return;

    if (!selectedReportId && localReports.length > 0) {
      setSelectedReportId(localReports[0].id);
      return;
    }

    const currentReport = localReports.find((r) => r.id === selectedReportId);
    if (!currentReport) {
      setQrDataUrl("");
      return;
    }

    // Build ultra-compact, standardized payload for instant camera scan
    const compact = {
      resqnet: "v1",
      id: currentReport.id,
      type: currentReport.type || "General Emergency",
      severity: currentReport.severity || "Critical",
      contactName: currentReport.contactName || "",
      contactPhone: currentReport.contactPhone || "",
      people: Number(currentReport.people) || 1,
      description: (currentReport.description || "").slice(0, 280),
      latitude: currentReport.latitude ? Number(Number(currentReport.latitude).toFixed(6)) : null,
      longitude: currentReport.longitude ? Number(Number(currentReport.longitude).toFixed(6)) : null,
      accuracy: currentReport.accuracy ? Number(Number(currentReport.accuracy).toFixed(1)) : null,
      createdAt: currentReport.createdAt || new Date().toISOString(),
      revision: currentReport.revision || 1,
      relayHops: currentReport.relayHops || 0,
    };

    QRCode.toDataURL(JSON.stringify(compact), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#091e14",
        light: "#ffffff",
      },
    })
      .then((url) => {
        setQrDataUrl(url);
        setQrError("");
      })
      .catch((err) => {
        console.error("Failed to generate QR code:", err);
        setQrError("Could not generate QR code");
      });
  }, [selectedReportId, localReports, activeMode, qrSubMode]);

  // 3. Stop Scanner Helper
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        console.warn("Scanner stop cleanup error:", err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Clean up scanner on unmount or mode switch
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  // 4. Start Camera Scanner
  const startScanner = async () => {
    setScanError("");
    setScanSuccess(null);
    await stopScanner();

    try {
      const scanner = new Html5Qrcode("resqnet-qr-reader");
      scannerRef.current = scanner;
      setIsScanning(true);

      const config = {
        fps: 15,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0,
      };

      await scanner.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          try {
            const parsed = JSON.parse(decodedText);
            if (!parsed || parsed.resqnet !== "v1" || !parsed.id) {
              setScanError("Scanned QR is not a valid ResQNet emergency report.");
              return;
            }

            // Play beep & vibrate
            playSuccessBeep();
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate([100, 50, 100]);
            }

            // Merge into local storage
            const mergeResult = await mergeReport(parsed);
            window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));

            setScanSuccess(mergeResult.report);
            await stopScanner();
          } catch (e) {
            setScanError("Failed to parse QR data: " + e.message);
          }
        },
        () => {
          // Frame rejected (no QR in frame) - silence
        }
      );
    } catch (err) {
      console.error("Camera access failed:", err);
      setScanError(
        "Could not access camera. Please check camera permissions in your browser or try Hotspot Sync."
      );
      setIsScanning(false);
    }
  };

  // 5. Initialize WebRTC Manager for Hotspot & Manual modes
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

  const currentReport = localReports.find((r) => r.id === selectedReportId);

  return (
    <div className="screen peershare-screen">
      <div className="screen-heading">
        <p className="eyebrow">OFFLINE DEVICE-TO-DEVICE MESH</p>
        <h2>Nearby Emergency Transfer</h2>
        <p className="subheading">
          Relay emergency reports to nearby phones without towers, internet, or cables.
        </p>
      </div>

      {/* Main Mode Switcher */}
      <div className="p2p-mode-tabs">
        <button
          className={`mode-tab-btn ${activeMode === "qr" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("qr");
            stopScanner();
          }}
        >
          📷 QR Scanner (Easiest & Fastest ⭐)
        </button>
        <button
          className={`mode-tab-btn ${activeMode === "hotspot" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("hotspot");
            stopScanner();
          }}
        >
          📡 1-Click Hotspot Sync
        </button>
        <button
          className={`mode-tab-btn ${activeMode === "manual" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("manual");
            stopScanner();
          }}
        >
          📋 Manual Code
        </button>
      </div>

      {/* ===================================================================
          MODE 1: QR CODE TRANSFER (EASIEST & ZERO INTERNET)
          =================================================================== */}
      {activeMode === "qr" && (
        <div className="p2p-card qr-card-container">
          <div className="qr-submode-toggle">
            <button
              className={`qr-sub-btn ${qrSubMode === "show" ? "active" : ""}`}
              onClick={() => {
                setQrSubMode("show");
                stopScanner();
              }}
            >
              📲 Show My SOS QR Code (Victim)
            </button>
            <button
              className={`qr-sub-btn ${qrSubMode === "scan" ? "active" : ""}`}
              onClick={() => {
                setQrSubMode("scan");
                setScanSuccess(null);
                setScanError("");
              }}
            >
              📸 Scan Victim's QR (Helper/Rescuer)
            </button>
          </div>

          {/* Submode 1A: Victim Shows QR */}
          {qrSubMode === "show" && (
            <div className="qr-show-panel">
              {localReports.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">No emergency reports found on this device.</p>
                  <a href="#/report" className="primary-button" style={{ display: "inline-block", marginTop: "10px" }}>
                    Create SOS Report First
                  </a>
                </div>
              ) : (
                <>
                  <div className="report-selector-row">
                    <label htmlFor="qr-report-select">Select Report to Share:</label>
                    <select
                      id="qr-report-select"
                      value={selectedReportId}
                      onChange={(e) => setSelectedReportId(e.target.value)}
                      className="qr-select-input"
                    >
                      {localReports.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.type} - {r.contactName || "Anonymous"} ({new Date(r.createdAt).toLocaleTimeString()})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="qr-display-box">
                    {qrDataUrl ? (
                      <div className="qr-img-wrapper">
                        <img src={qrDataUrl} alt="ResQNet SOS QR Code" className="qr-code-img" />
                        <span className="qr-scan-badge">⚡ Instant 0.1s Camera Scan</span>
                      </div>
                    ) : (
                      <div className="qr-loading">Generating secure offline QR...</div>
                    )}
                    {qrError && <p className="text-warning">{qrError}</p>}
                  </div>

                  {currentReport && (
                    <div className="qr-summary-card">
                      <div className="qr-summary-header">
                        <strong>{currentReport.type}</strong>
                        <span className={`tag tag-${currentReport.severity.toLowerCase()}`}>
                          {currentReport.severity}
                        </span>
                      </div>
                      <div className="qr-summary-grid">
                        <div>
                          <span className="summary-label">Victim:</span>{" "}
                          <strong>{currentReport.contactName || "Not provided"}</strong>
                        </div>
                        <div>
                          <span className="summary-label">Phone:</span>{" "}
                          <strong>{currentReport.contactPhone || "None"}</strong>
                        </div>
                        <div>
                          <span className="summary-label">People:</span>{" "}
                          <strong className="text-danger">{currentReport.people || 1} trapped</strong>
                        </div>
                        <div>
                          <span className="summary-label">GPS:</span>{" "}
                          <strong>
                            {currentReport.latitude
                              ? `${currentReport.latitude.toFixed(4)}, ${currentReport.longitude.toFixed(4)}`
                              : "No lock"}
                          </strong>
                        </div>
                      </div>
                      <p className="qr-instruction-hint">
                        💡 <strong>How to use:</strong> Show this screen to any helper, rescuer, or neighbor.
                        They tap <strong>"Scan Victim's QR"</strong> on their phone to instantly copy this report.
                        Zero cellular network or Wi-Fi needed!
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Submode 1B: Helper Scans QR */}
          {qrSubMode === "scan" && (
            <div className="qr-scan-panel">
              {!isScanning && !scanSuccess && (
                <div className="scanner-start-box">
                  <div className="camera-icon-large">📷</div>
                  <h3>Ready to Scan Victim's QR</h3>
                  <p className="text-muted">
                    Point your camera at the victim's phone screen. The emergency report will be transferred
                    instantly and stored on your device to be relayed to rescuers.
                  </p>
                  <button className="primary-button scan-action-btn" onClick={startScanner}>
                    Start Camera Scanner
                  </button>
                </div>
              )}

              {isScanning && (
                <div className="scanner-active-view">
                  <div id="resqnet-qr-reader" className="qr-reader-target" />
                  <div className="scanner-overlay-hint">
                    <span>Align victim's QR code within the frame</span>
                    <button className="secondary-button" onClick={stopScanner} style={{ marginTop: "12px" }}>
                      Cancel Camera
                    </button>
                  </div>
                </div>
              )}

              {scanError && (
                <div className="scan-error-banner">
                  <span>⚠️ {scanError}</span>
                  <button className="text-button" onClick={startScanner} style={{ marginTop: "6px" }}>
                    Retry Camera
                  </button>
                </div>
              )}

              {scanSuccess && (
                <div className="scan-success-banner">
                  <div className="success-icon-badge">✅</div>
                  <div className="success-content">
                    <h4>Emergency Report Transferred!</h4>
                    <p className="success-id">Report ID: <strong>{scanSuccess.id}</strong></p>
                    <div className="success-meta-row">
                      <span>👤 {scanSuccess.contactName || "Victim"}</span>
                      <span>📞 {scanSuccess.contactPhone || "No Phone"}</span>
                      <span className="text-danger">👥 {scanSuccess.people || 1} trapped</span>
                      <span>📍 {scanSuccess.latitude ? `${scanSuccess.latitude.toFixed(4)}, ${scanSuccess.longitude.toFixed(4)}` : "No GPS"}</span>
                    </div>
                    <p className="success-status-note">
                      💾 Saved to your device's local database (Relay Hop: {scanSuccess.relayHops}).
                      <br />
                      🚀 As soon as your phone connects to internet, this report will automatically upload to the ResQNet cloud!
                    </p>
                    <div className="success-button-group">
                      <button className="primary-button" onClick={startScanner}>
                        Scan Another Victim QR
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          MODE 2: 1-CLICK LOCAL HOTSPOT SYNC
          =================================================================== */}
      {activeMode === "hotspot" && (
        <div className="p2p-card">
          <div className="hotspot-intro-box">
            <h3>📡 1-Click Hotspot / Local Wi-Fi Sync</h3>
            <p className="text-muted">
              Connect both phones to the same Mobile Hotspot or Wi-Fi (internet not required).
              One phone hosts, the other joins, and all reports synchronize automatically!
            </p>
          </div>

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

          <div className="hotspot-controls">
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
          </div>
        </div>
      )}

      {/* ===================================================================
          MODE 3: MANUAL ENCRYPTED CODE (BACKUP)
          =================================================================== */}
      {activeMode === "manual" && (
        <div className="p2p-card offline-exchange">
          <p className="text-muted" style={{ marginBottom: "14px" }}>
            Use this backup method only if your device camera is damaged or hotspot is unavailable.
          </p>

          <div className={`p2p-status-card status-${status}`}>
            <div className="status-indicator-row">
              <span className={`status-dot ${status === "connected" ? "online-dot" : ""}`} />
              <strong>Status: {status}</strong>
            </div>
            {statusDetail && <p className="p2p-status-sub">{statusDetail}</p>}
          </div>

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
        <strong>🛡️ How Disaster Store-and-Forward Works:</strong>
        <p>
          1. <strong>Zero Internet:</strong> Reports are safely transferred to nearby phones using QR camera scans or local hotspot.
          <br />
          2. <strong>Multi-Hop Muling:</strong> When helper phones walk towards a town, rescue station, or connectivity zone, reports leapfrog forward.
          <br />
          3. <strong>Instant Cloud Ingestion:</strong> The moment any carrier phone connects to internet, all relayed reports automatically push to the ResQNet cloud!
        </p>
      </div>

      {/* Activity Log (visible in hotspot/manual modes) */}
      {(activeMode === "hotspot" || activeMode === "manual") && (
        <div className="p2p-logs">
          <label>Transfer Activity Log</label>
          <div className="log-console">
            {logs.length === 0 ? (
              <span className="log-empty">No activity yet. Ready to connect.</span>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="log-line">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
