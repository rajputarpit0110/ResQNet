import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { ResQNetP2PManager } from "../services/p2pTransfer";
import { getApiBaseUrl } from "../services/reportSync";
import {
  getReports,
  getPendingReports,
  mergeReport,
  markReportSynced,
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
  const [autoRelayEnabled, setAutoRelayEnabled] = useState(false); // Default false so prompt appears as requested
  const [localDeviceId, setLocalDeviceId] = useState("");
  const [localPendingCount, setLocalPendingCount] = useState(0);
  const [nearbyPeers, setNearbyPeers] = useState([]);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [relaySuccessData, setRelaySuccessData] = useState(null);
  const [isRelayingToCloud, setIsRelayingToCloud] = useState(false);
  const [bluetoothDevice, setBluetoothDevice] = useState(null);
  const [isScanningBluetooth, setIsScanningBluetooth] = useState(false);
  const [radarStatus, setRadarStatus] = useState("Scanning proximity...");

  const approvedPeerIdsRef = useRef(new Set());
  const dismissedPeerIdsRef = useRef(new Set());
  const isAutoSyncingRef = useRef(false);
  const meshChannelRef = useRef(null);

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

  // 1. Initialize Local Device ID & BroadcastChannel
  useEffect(() => {
    getOrCreateDeviceId().then((id) => setLocalDeviceId(id));
    getPendingReports().then((p) => setLocalPendingCount(p.length));

    // Setup local BroadcastChannel for zero-network cross-window/tab proximity mesh
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("resqnet-proximity-mesh");
      meshChannelRef.current = channel;

      channel.onmessage = async (event) => {
        const msg = event.data;
        if (!msg || msg.deviceId === localDeviceId) return;

        if (msg.type === "BEACON") {
          // Received nearby peer beacon via direct radio broadcast channel
          const peer = {
            deviceId: msg.deviceId,
            name: msg.name,
            pendingCount: msg.pendingCount || 0,
            pendingReports: msg.pendingReports || [],
            lastSeen: Date.now(),
          };

          setNearbyPeers((prev) => {
            const others = prev.filter((p) => p.deviceId !== peer.deviceId);
            return [peer, ...others];
          });

          // Check if peer has emergency reports and we haven't handled them yet
          if (
            peer.pendingReports.length > 0 &&
            !approvedPeerIdsRef.current.has(peer.deviceId) &&
            !dismissedPeerIdsRef.current.has(peer.deviceId)
          ) {
            setIncomingRequest(peer);
          }
        }
      };

      return () => {
        channel.close();
      };
    }
  }, [localDeviceId]);

  // 2. Load Local Reports
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

  // 4. Auto-Proximity Radar Heartbeat & Peer Detection Loop
  useEffect(() => {
    if (!localDeviceId) return;

    let isMounted = true;
    const apiUrl = getApiBaseUrl() || "http://localhost:4000/api";

    const pulseBeacon = async () => {
      try {
        const pending = await getPendingReports();
        if (isMounted) setLocalPendingCount(pending.length);

        // Compact pending reports payload for instant radio transmission
        const compactPending = pending.slice(0, 5).map((r) => ({
          id: r.id,
          type: r.type || "General Emergency",
          severity: r.severity || "Critical",
          contactName: r.contactName || "Victim",
          contactPhone: r.contactPhone || "",
          people: Number(r.people) || 1,
          description: r.description || "",
          latitude: r.latitude ? Number(Number(r.latitude).toFixed(6)) : null,
          longitude: r.longitude ? Number(Number(r.longitude).toFixed(6)) : null,
          accuracy: r.accuracy ? Number(Number(r.accuracy).toFixed(1)) : null,
          createdAt: r.createdAt || new Date().toISOString(),
          revision: r.revision || 1,
          relayHops: r.relayHops || 0,
        }));

        const beaconData = {
          deviceId: localDeviceId,
          name: `Victim Phone (${localDeviceId.slice(0, 6)})`,
          pendingCount: pending.length,
          pendingReports: compactPending,
        };

        // 1. Broadcast via local BroadcastChannel
        meshChannelRef.current?.postMessage({
          type: "BEACON",
          ...beaconData,
        });

        // 2. Broadcast via local network / Hotspot signaling server
        await fetch(`${apiUrl}/p2p/beacon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(beaconData),
        }).catch(() => {});

        // 3. Query active peers within radio proximity
        const res = await fetch(`${apiUrl}/p2p/peers?excludeId=${localDeviceId}`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const peers = Array.isArray(data.peers) ? data.peers : [];
          if (isMounted) {
            setNearbyPeers(peers);
            setRadarStatus(
              peers.length > 0
                ? `${peers.length} nearby peer(s) in range (~10–30m)`
                : "Active radar pulse • Listening for nearby peers (~10–30m)"
            );

            // 4. Check for incoming relay requests
            if (peers.length > 0) {
              for (const peer of peers) {
                if (
                  peer.pendingReports &&
                  peer.pendingReports.length > 0 &&
                  !approvedPeerIdsRef.current.has(peer.deviceId) &&
                  !dismissedPeerIdsRef.current.has(peer.deviceId)
                ) {
                  if (autoRelayEnabled && !isAutoSyncingRef.current) {
                    // Auto-relay silently without prompt if toggle is enabled
                    handleApproveAndUploadToCloud(peer);
                  } else {
                    // Trigger approval prompt on screen
                    setIncomingRequest(peer);
                  }
                  break;
                }
              }
            }
          }
        }
      } catch (err) {
        // Offline background loop
      }
    };

    pulseBeacon();
    const interval = setInterval(pulseBeacon, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [localDeviceId, autoRelayEnabled]);

  // 5. User Approves Relay Request & Uploads to Cloud via their connection
  const handleApproveAndUploadToCloud = async (peer) => {
    if (!peer || !peer.pendingReports || peer.pendingReports.length === 0) return;

    setIsRelayingToCloud(true);
    const apiUrl = getApiBaseUrl() || "http://localhost:4000/api";
    let relayedCount = 0;
    let uploadedCount = 0;

    setLogs((prev) => [
      `[Relay] 🚨 Approved relay request from ${peer.name}. Ingesting ${peer.pendingReports.length} report(s)...`,
      ...prev,
    ]);

    for (const report of peer.pendingReports) {
      try {
        // 1. Merge into local IndexedDB with incremented relay hop
        const mergeRes = await mergeReport({
          ...report,
          relayHops: (report.relayHops || 0) + 1,
        });
        relayedCount += 1;

        // 2. If this device has internet, upload directly to ResQNet Cloud API immediately!
        if (navigator.onLine) {
          const response = await fetch(`${apiUrl}/reports`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `${report.id}-r${report.revision || 1}`,
            },
            body: JSON.stringify(mergeRes.report),
          });

          if (response.ok) {
            const ack = await response.json().catch(() => ({}));
            await markReportSynced(report.id, ack);
            uploadedCount += 1;
            setLogs((prev) => [
              `[Cloud] ☁️ Uploaded victim report ${report.id} to ResQNet Cloud database!`,
              ...prev,
            ]);
          }
        }
      } catch (err) {
        setLogs((prev) => [`[Relay Error] ${err.message}`, ...prev]);
      }
    }

    // Mark peer as handled
    approvedPeerIdsRef.current.add(peer.deviceId);
    playSuccessBeep();
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 150]);
    }

    setRelaySuccessData({
      peerName: peer.name,
      reportsCount: relayedCount,
      uploadedCount,
      isOnline: navigator.onLine,
      firstReport: peer.pendingReports[0],
    });

    setIncomingRequest(null);
    setIsRelayingToCloud(false);
    window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));
  };

  const handleDismissRequest = () => {
    if (incomingRequest) {
      dismissedPeerIdsRef.current.add(incomingRequest.deviceId);
      setIncomingRequest(null);
    }
  };

  // Web Bluetooth Scan
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
        `[BLE] Discovered Bluetooth Device: ${device.name || "Nearby Bluetooth Node"} (${device.id.slice(0, 8)})`,
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
          Devices in range (~10–30m) automatically detect victims and request permission to relay reports to the cloud.
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
          🛰️ Auto Proximity Radar (~10m ⭐)
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
          MODE 1: AUTONOMOUS PROXIMITY RADAR (~10M RANGE)
          =================================================================== */}
      {activeMode === "radar" && (
        <div className="p2p-card proximity-radar-card">
          {/* Autonomous Relay Toggle */}
          <div className="auto-relay-header">
            <div className="auto-relay-info">
              <strong>⚡ Auto-Approve Relay</strong>
              <p>
                When enabled, data transfers <strong>automatically</strong> to any nearby phone. When disabled, you receive an <strong>approval prompt</strong> to permit upload.
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
              {/* Static Tactical Grid & Range Rings */}
              <div className="radar-axis axis-horizontal" />
              <div className="radar-axis axis-vertical" />
              <div className="radar-axis axis-diagonal-1" />
              <div className="radar-axis axis-diagonal-2" />
              <div className="radar-grid-ring ring-1"><span className="ring-label">10m</span></div>
              <div className="radar-grid-ring ring-2"><span className="ring-label">20m</span></div>
              <div className="radar-grid-ring ring-3"><span className="ring-label">30m</span></div>
              <div className="radar-grid-ring ring-4"><span className="ring-label">50m</span></div>

              {/* Ambient Expanding Sonar Echo */}
              <div className="sonar-ambient-wave" />

              {/* 360-degree phosphor sweep beam */}
              <div className="radar-sweep-beam">
                <div className="sweep-beam-lead" />
              </div>

              {/* Center Self-Blip */}
              <div className="radar-center-blip">
                <span className="blip-core" />
                <span className="blip-badge">You ({localDeviceId ? localDeviceId.slice(0, 6) : "Self"})</span>
              </div>

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
              <div className="radar-status-left">
                <span className="radar-pulse-dot" />
                <span className="radar-status-text">{radarStatus}</span>
              </div>
              <span className="radar-pending-pill">
                📦 {localPendingCount} report(s) on your device
              </span>
            </div>
          </div>

          {/* INCOMING RELAY PERMISSION REQUEST PROMPT (Appears on Device B) */}
          {incomingRequest && (
            <div className="incoming-request-modal">
              <div className="incoming-header-row">
                <div className="incoming-icon-alert">🚨</div>
                <div className="incoming-title-box">
                  <span className="incoming-badge-pill">NEARBY VICTIM IN RANGE (~10M)</span>
                  <h4>Emergency Relay Request</h4>
                </div>
              </div>

              <p className="incoming-desc">
                <strong>{incomingRequest.name}</strong> is offline with{" "}
                <strong className="text-danger">{incomingRequest.pendingCount} emergency report(s)</strong>.
                They need your connection to upload their emergency report to the ResQNet Cloud.
              </p>

              {incomingRequest.pendingReports?.[0] && (
                <div className="incoming-report-preview">
                  <div className="preview-field">
                    <span className="preview-label">INCIDENT:</span>
                    <strong>{incomingRequest.pendingReports[0].type}</strong>
                  </div>
                  <div className="preview-field">
                    <span className="preview-label">VICTIM NAME:</span>
                    <strong>{incomingRequest.pendingReports[0].contactName || "Anonymous"}</strong>
                  </div>
                  <div className="preview-field">
                    <span className="preview-label">PEOPLE IN DANGER:</span>
                    <strong className="text-danger">{incomingRequest.pendingReports[0].people} trapped</strong>
                  </div>
                  {incomingRequest.pendingReports[0].latitude && (
                    <div className="preview-field">
                      <span className="preview-label">GPS LOCATION:</span>
                      <strong>
                        {incomingRequest.pendingReports[0].latitude.toFixed(4)},{" "}
                        {incomingRequest.pendingReports[0].longitude.toFixed(4)}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              <div className="incoming-actions">
                <button
                  className="primary-button relay-approve-btn"
                  onClick={() => handleApproveAndUploadToCloud(incomingRequest)}
                  disabled={isRelayingToCloud}
                >
                  {isRelayingToCloud ? "Uploading to Cloud..." : "⚡ Approve & Upload to Cloud (Via My Data)"}
                </button>
                <button
                  className="choice"
                  onClick={handleDismissRequest}
                  disabled={isRelayingToCloud}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* RELAY SUCCESS CELEBRATION BANNER */}
          {relaySuccessData && (
            <div className="relay-success-banner">
              <div className="success-icon-badge">✅</div>
              <div className="success-content">
                <h4>Emergency Report Relayed & Uploaded!</h4>
                <p>
                  Successfully received report from <strong>{relaySuccessData.peerName}</strong>.
                  {relaySuccessData.uploadedCount > 0 ? (
                    <span className="text-success">
                      {" "}☁️ Uploaded directly to ResQNet Cloud Database via your mobile internet! Rescuers are now notified.
                    </span>
                  ) : (
                    <span>
                      {" "}💾 Saved to your phone's database. It will auto-upload the instant you get cellular data.
                    </span>
                  )}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setRelaySuccessData(null)}
                  style={{ marginTop: "8px" }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Discovered Peers Section */}
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
                    💡 <strong>How to test with 2 phones:</strong> Keep both phones within 10 meters on the same Wi-Fi / Hotspot.
                    When Phone A submits an SOS, Phone B will immediately receive the Permission Request to upload to the Cloud!
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
                      <span className="proximity-chip">🟢 In Range (~10m)</span>
                    </div>

                    <div className="peer-card-bottom">
                      <span className="peer-reports-status">
                        {peer.pendingCount > 0 ? (
                          <strong className="text-danger">🚨 {peer.pendingCount} pending report(s)</strong>
                        ) : (
                          <span className="text-success">✅ In Sync</span>
                        )}
                      </span>
                      {peer.pendingCount > 0 && (
                        <button
                          className="choice-small"
                          onClick={() => handleApproveAndUploadToCloud(peer)}
                          disabled={isRelayingToCloud}
                        >
                          Relay & Upload ⚡
                        </button>
                      )}
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
        <strong>🛡️ How 10-Meter Proximity Relay Works:</strong>
        <p>
          1. <strong>Passive Detection:</strong> Victim device broadcasts its emergency beacon over local radio (~10–30m).
          <br />
          2. <strong>Permission Prompt:</strong> Any nearby phone with internet receives an instant alert to approve relaying the victim's report.
          <br />
          3. <strong>Instant Cloud Ingestion:</strong> The moment the helper taps "Approve", the victim's emergency report is uploaded to the ResQNet Cloud & Rescuer Dashboard!
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
