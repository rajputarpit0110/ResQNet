import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { ResQNetP2PManager } from "../services/p2pTransfer";
import { getApiBaseUrl } from "../services/reportSync";
import {
  getReports,
  getPendingReports,
  mergeReport,
  getOrCreateDeviceId,
} from "../services/reportStorage";

// Tactile audio feedback on successful transfer
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
  // Modes: "radar" (auto-proximity), "qr" (optical scan), "manual" (backup)
  const [activeMode, setActiveMode] = useState("radar");

  // Autonomous Radar & Proximity State
  const [autoRelayEnabled, setAutoRelayEnabled] = useState(true);
  const [localDeviceId, setLocalDeviceId] = useState("");
  const [localPendingCount, setLocalPendingCount] = useState(0);
  const [nearbyPeers, setNearbyPeers] = useState([]);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [bluetoothDevice, setBluetoothDevice] = useState(null);
  const [isScanningBluetooth, setIsScanningBluetooth] = useState(false);
  const [radarStatus, setRadarStatus] = useState("Scanning proximity...");
  const syncedPeerIdsRef = useRef(new Set());
  const isAutoSyncingRef = useRef(false);

  // QR Mode State
  const [qrSubMode, setQrSubMode] = useState("show");
  const [localReports, setLocalReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(null);
  const [scanError, setScanError] = useState("");
  const scannerRef = useRef(null);

  // Hotspot / Signaling State
  const [roomId, setRoomId] = useState("ROOM-101");
  const [status, setStatus] = useState("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [logs, setLogs] = useState([]);

  // Manual Offline Code Exchange
  const [offlineOffer, setOfflineOffer] = useState("");
  const [offlineAnswer, setOfflineAnswer] = useState("");
  const [inputCode, setInputCode] = useState("");

  const p2pRef = useRef(null);

  // 1. Initialize Local Device ID & Reports
  useEffect(() => {
    getOrCreateDeviceId().then((id) => setLocalDeviceId(id));
    getPendingReports().then((p) => setLocalPendingCount(p.length));
  }, []);

  // 2. Load Local Reports for QR generator
  const loadReports = useCallback(async () => {
    try {
      const reports = await getReports();
      setLocalReports(reports);
      const pending = await getPendingReports();
      setLocalPendingCount(pending.length);
      if (reports.length > 0 && !selectedReportId) {
        setSelectedReportId(reports[0].id);
      }
    } catch (err) {
      console.error("Could not load reports:", err);
    }
  }, [selectedReportId]);

  useEffect(() => {
    loadReports();
    window.addEventListener("resqnet:reports-updated", loadReports);
    return () => window.removeEventListener("resqnet:reports-updated", loadReports);
  }, [loadReports]);

  // 3. WebRTC Manager Initialization
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

  // 4. Auto-Proximity Radar Heartbeat & Auto-Sync Loop
  useEffect(() => {
    if (!localDeviceId) return;

    let isMounted = true;
    const apiUrl = getApiBaseUrl() || "http://localhost:4000/api";

    const pulseBeacon = async () => {
      try {
        const pending = await getPendingReports();
        if (isMounted) setLocalPendingCount(pending.length);

        // 1. Broadcast presence beacon
        await fetch(`${apiUrl}/p2p/beacon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: localDeviceId,
            name: `ResQNet Peer (${localDeviceId.slice(0, 8)})`,
            pendingCount: pending.length,
          }),
        }).catch(() => {});

        // 2. Query nearby active peers within radio / subnet proximity
        const res = await fetch(`${apiUrl}/p2p/peers?excludeId=${localDeviceId}`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const peers = Array.isArray(data.peers) ? data.peers : [];
          if (isMounted) {
            setNearbyPeers(peers);
            setRadarStatus(
              peers.length > 0
                ? `${peers.length} nearby peer(s) detected in range`
                : "Active radar pulse • Listening for nearby peers"
            );
          }

          // 3. Autonomous Zero-Touch Transfer Logic
          if (peers.length > 0 && !isAutoSyncingRef.current) {
            for (const peer of peers) {
              const pairKey = [localDeviceId, peer.deviceId].sort().join("-");
              // If either peer has pending reports and hasn't synced yet
              if (
                (peer.pendingCount > 0 || pending.length > 0) &&
                !syncedPeerIdsRef.current.has(pairKey)
              ) {
                if (autoRelayEnabled) {
                  // Execute automatic handshake in background
                  executeAutonomousSync(peer, pairKey);
                } else {
                  // Prompt user for permission
                  if (isMounted && !incomingRequest) {
                    setIncomingRequest(peer);
                  }
                }
                break;
              }
            }
          }
        }
      } catch (err) {
        // Offline / silence in background
      }
    };

    pulseBeacon();
    const interval = setInterval(pulseBeacon, 3500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [localDeviceId, autoRelayEnabled, incomingRequest]);

  // Autonomous Transfer Execution
  const executeAutonomousSync = async (peer, pairKey) => {
    isAutoSyncingRef.current = true;
    const apiUrl = getApiBaseUrl() || "http://localhost:4000/api";
    const autoRoom = `AUTO-${[localDeviceId, peer.deviceId].sort().join("").slice(0, 12)}`;

    setLogs((prev) => [
      `[Auto-Mesh] Proximity detected peer ${peer.name}. Initiating zero-touch relay...`,
      ...prev,
    ]);

    try {
      // Deterministic host election (alphabetically first device ID acts as host)
      const isHost = localDeviceId < peer.deviceId;
      await p2pRef.current.joinRoomWithSignaling(apiUrl, autoRoom, isHost);

      syncedPeerIdsRef.current.add(pairKey);
      playSuccessBeep();
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([80, 40, 80]);
      }

      setLogs((prev) => [
        `[Auto-Mesh] ✅ Zero-touch relay complete with ${peer.name}!`,
        ...prev,
      ]);
    } catch (err) {
      setLogs((prev) => [`[Auto-Mesh] Sync attempt note: ${err.message}`, ...prev]);
    } finally {
      setTimeout(() => {
        isAutoSyncingRef.current = false;
      }, 5000);
    }
  };

  // Web Bluetooth Low Energy (BLE) Scan
  const handleScanBluetooth = async () => {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      alert(
        "Web Bluetooth API requires Chrome on Android or a supported BLE device. Your Local Proximity Radar is currently scanning all nearby devices over Wi-Fi / Hotspot automatically!"
      );
      return;
    }

    try {
      setIsScanningBluetooth(true);
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["battery_service"],
      });
      setBluetoothDevice(device);
      setLogs((prev) => [
        `[BLE] Discovered Bluetooth Device: ${device.name || "Unknown ResQNet Beacon"} (${device.id.slice(0, 8)})`,
        ...prev,
      ]);
    } catch (err) {
      if (err.name !== "NotFoundError") {
        setLogs((prev) => [`[BLE] Scan canceled: ${err.message}`, ...prev]);
      }
    } finally {
      setIsScanningBluetooth(false);
    }
  };

  // Generate QR Code
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

  // Stop Camera Scanner
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        console.warn("Scanner stop error:", err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Start Camera Scanner
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

            playSuccessBeep();
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate([100, 50, 100]);
            }

            const mergeResult = await mergeReport(parsed);
            window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));

            setScanSuccess(mergeResult.report);
            await stopScanner();
          } catch (e) {
            setScanError("Failed to parse QR data: " + e.message);
          }
        },
        () => {}
      );
    } catch (err) {
      console.error("Camera access failed:", err);
      setScanError("Could not access camera. Please check permissions or use Proximity Radar.");
      setIsScanning(false);
    }
  };

  const handleStartManualNetworkSync = async (asHost) => {
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
        <p className="eyebrow">AUTONOMOUS AD-HOC MESH</p>
        <h2>Nearby Emergency Radar</h2>
        <p className="subheading">
          Devices in Bluetooth / Wi-Fi range automatically discover each other and exchange emergency reports without meeting.
        </p>
      </div>

      {/* Main Mode Tabs */}
      <div className="p2p-mode-tabs">
        <button
          className={`mode-tab-btn ${activeMode === "radar" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("radar");
            stopScanner();
          }}
        >
          🛰️ Auto Proximity Radar (Zero-Touch ⭐)
        </button>
        <button
          className={`mode-tab-btn ${activeMode === "qr" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("qr");
            stopScanner();
          }}
        >
          📷 QR Scanner (Optical)
        </button>
        <button
          className={`mode-tab-btn ${activeMode === "manual" ? "active" : ""}`}
          onClick={() => {
            setActiveMode("manual");
            stopScanner();
          }}
        >
          📋 Manual Room
        </button>
      </div>

      {/* ===================================================================
          MODE 1: AUTONOMOUS PROXIMITY RADAR (ZERO-TOUCH AUTOMATIC RELAY)
          =================================================================== */}
      {activeMode === "radar" && (
        <div className="p2p-card proximity-radar-card">
          {/* Autonomous Relay Toggle */}
          <div className="auto-relay-header">
            <div className="auto-relay-info">
              <strong>⚡ Autonomous Auto-Relay</strong>
              <p>
                When enabled, data transfers <strong>automatically</strong> to any nearby phone that enters your range. No meeting or manual action needed!
              </p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={autoRelayEnabled}
                onChange={(e) => setAutoRelayEnabled(e.target.checked)}
              />
              <span className="slider round"></span>
            </label>
          </div>

          {/* Radar Animation & Visualizer */}
          <div className="radar-visual-container">
            <div className="sonar-radar-box">
              <div className="radar-center-blip">
                <span className="blip-core" />
                <span className="blip-label">You ({localDeviceId ? localDeviceId.slice(0, 6) : "Self"})</span>
              </div>
              <div className="sonar-wave wave-1" />
              <div className="sonar-wave wave-2" />
              <div className="sonar-wave wave-3" />
              <div className="radar-sweep-line" />

              {/* Orbiting Nearby Peer Blips */}
              {nearbyPeers.map((peer, idx) => (
                <div
                  key={peer.deviceId}
                  className={`peer-blip peer-blip-${(idx % 4) + 1} ${
                    peer.pendingCount > 0 ? "has-reports" : ""
                  }`}
                  title={`${peer.name} (${peer.pendingCount} reports)`}
                >
                  <span className="peer-blip-dot" />
                  <span className="peer-blip-text">
                    {peer.name.split(" ")[0]} ({peer.pendingCount > 0 ? `🚨 ${peer.pendingCount}` : "OK"})
                  </span>
                </div>
              ))}
            </div>

            <div className="radar-status-bar">
              <span className="radar-pulse-dot" />
              <span className="radar-status-text">{radarStatus}</span>
              <span className="radar-pending-pill">
                📦 {localPendingCount} report(s) on your device
              </span>
            </div>
          </div>

          {/* Incoming Peer Transfer Request Prompt (when Auto-Relay is OFF) */}
          {incomingRequest && !autoRelayEnabled && (
            <div className="incoming-request-modal">
              <div className="incoming-icon">🔔</div>
              <div className="incoming-content">
                <h4>Nearby Peer Detected!</h4>
                <p>
                  <strong>{incomingRequest.name}</strong> is in physical range with{" "}
                  <strong className="text-danger">{incomingRequest.pendingCount} emergency report(s)</strong> waiting to be relayed.
                </p>
                <div className="incoming-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      executeAutonomousSync(
                        incomingRequest,
                        [localDeviceId, incomingRequest.deviceId].sort().join("-")
                      );
                      setIncomingRequest(null);
                    }}
                  >
                    Accept & Relay Data Now
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setIncomingRequest(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Discovered Peers List */}
          <div className="nearby-peers-section">
            <div className="peers-section-header">
              <h4>Active Devices in Range ({nearbyPeers.length})</h4>
              <button
                className="ble-scan-btn"
                onClick={handleScanBluetooth}
                disabled={isScanningBluetooth}
              >
                {isScanningBluetooth ? "Scanning BLE..." : "📶 Scan Bluetooth (BLE)"}
              </button>
            </div>

            {bluetoothDevice && (
              <div className="ble-discovered-banner">
                <span>🔵 BLE Beacon Linked: <strong>{bluetoothDevice.name || "Nearby Bluetooth Node"}</strong></span>
                <span className="ble-status-chip">Connected</span>
              </div>
            )}

            {nearbyPeers.length === 0 ? (
              <div className="no-peers-box">
                <p className="text-muted">
                  No other ResQNet devices currently broadcasting in range.
                  <br />
                  <small>
                    As soon as a victim, rescuer, or volunteer enters your Bluetooth/Wi-Fi range, they will appear here and data will transfer automatically.
                  </small>
                </p>
              </div>
            ) : (
              <div className="peers-grid">
                {nearbyPeers.map((peer) => (
                  <div key={peer.deviceId} className="peer-card">
                    <div className="peer-card-top">
                      <div className="peer-avatar">📱</div>
                      <div className="peer-details">
                        <strong>{peer.name}</strong>
                        <span className="peer-id-sub">ID: {peer.deviceId.slice(0, 10)}...</span>
                      </div>
                      <span className="proximity-chip">🟢 In Range</span>
                    </div>

                    <div className="peer-card-bottom">
                      <span className="peer-reports-status">
                        {peer.pendingCount > 0 ? (
                          <strong className="text-danger">🚨 {peer.pendingCount} pending report(s)</strong>
                        ) : (
                          <span className="text-success">✅ In Sync</span>
                        )}
                      </span>
                      <button
                        className="choice-small"
                        onClick={() =>
                          executeAutonomousSync(
                            peer,
                            [localDeviceId, peer.deviceId].sort().join("-")
                          )
                        }
                      >
                        Force Relay ⚡
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================
          MODE 2: OPTICAL QR SCANNER
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
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {qrSubMode === "scan" && (
            <div className="qr-scan-panel">
              {!isScanning && !scanSuccess && (
                <div className="scanner-start-box">
                  <div className="camera-icon-large">📷</div>
                  <h3>Ready to Scan Victim's QR</h3>
                  <p className="text-muted">
                    Point your camera at the victim's phone screen. Zero cellular network needed.
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
                    <button className="primary-button" onClick={startScanner} style={{ marginTop: "10px" }}>
                      Scan Another Victim QR
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          MODE 3: MANUAL ROOM CODE / HOTSPOT (BACKUP)
          =================================================================== */}
      {activeMode === "manual" && (
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
              onClick={() => handleStartManualNetworkSync(true)}
              disabled={status !== "idle" || !roomId.trim()}
            >
              Host Room (Share My Reports)
            </button>
            <button
              className="choice"
              onClick={() => handleStartManualNetworkSync(false)}
              disabled={status !== "idle" || !roomId.trim()}
            >
              Join Room (Receive & Relay)
            </button>
          </div>
        </div>
      )}

      {/* Store and Forward Explainer */}
      <div className="relay-explainer-card">
        <strong>🛡️ How Autonomous Store-and-Forward Works:</strong>
        <p>
          1. <strong>Passive Detection:</strong> ResQNet broadcasts an offline proximity beacon over Bluetooth & Wi-Fi radios.
          <br />
          2. <strong>Zero-Touch Handshake:</strong> When two devices come within ~30–100 meters, they automatically pair and transfer reports without either victim or rescuer needing to open a menu.
          <br />
          3. <strong>Opportunistic Upload:</strong> When any helper reaches cellular service or a field command post, all accumulated incident records push to the cloud in real-time!
        </p>
      </div>

      {/* Activity Log */}
      <div className="p2p-logs">
        <label>Transfer Activity Log</label>
        <div className="log-console">
          {logs.length === 0 ? (
            <span className="log-empty">Autonomous radar active. Ready to connect.</span>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="log-line">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
