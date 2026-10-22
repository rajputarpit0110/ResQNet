import { useState, useRef } from "react";

const CATEGORIES = [
  "Medical",
  "Trapped",
  "Fire",
  "Flood",
  "Structural Collapse",
  "Missing Person",
  "Injured",
  "Other",
];

const SEVERITIES = ["Critical", "High", "Medium", "Low"];

export default function ReportScreen({ onSubmit, isSubmitting, initialReport = null }) {
  const [type, setType] = useState(initialReport?.type || "Medical");
  const [severity, setSeverity] = useState(initialReport?.severity || "High");
  const [people, setPeople] = useState(String(initialReport?.people || "1"));
  const [description, setDescription] = useState(initialReport?.description || "");
  const [contactName, setContactName] = useState(initialReport?.contactName || "");
  const [contactPhone, setContactPhone] = useState(initialReport?.contactPhone || "");
  const [photoDataUrl, setPhotoDataUrl] = useState(initialReport?.photoDataUrl || null);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState(initialReport?.audioDataUrl || null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read and compress photo to lightweight thumbnail
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 800;
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", 0.7);
        setPhotoDataUrl(compressed);
      };
      img.src = event.target?.result;
    };
    reader.readAsDataURL(file);
  };

  const handleStartAudio = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Audio recording not supported by browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => setAudioUrl(reader.result);
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecordingAudio(true);
    } catch {
      alert("Microphone permission denied or unavailable.");
    }
  };

  const handleStopAudio = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const payload = {
      type,
      severity,
      people: Number(people),
      description: description.trim(),
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      photoDataUrl,
      audioDataUrl: audioUrl,
      ...(initialReport ? { id: initialReport.id, revision: (initialReport.revision || 1) + 1 } : {}),
    };

    const saved = await onSubmit(payload);

    if (saved && !initialReport) {
      setType("Medical");
      setSeverity("High");
      setPeople("1");
      setDescription("");
      setContactName("");
      setContactPhone("");
      setPhotoDataUrl(null);
      setAudioUrl(null);
    }
  };

  return (
    <div className="screen report-screen">
      <div className="screen-heading">
        <p className="eyebrow">{initialReport ? "UPDATE INCIDENT" : "EMERGENCY DETAILS"}</p>
        <h2>{initialReport ? `Edit Report #${initialReport.id}` : "Create a report"}</h2>
        <p className="subheading">
          {initialReport
            ? "Attach additional information to your existing SOS report."
            : "Share essential information with responders. Saves locally first."}
        </p>
      </div>

      <form className="report-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
        <label>Emergency Category</label>
        <div className="choice-grid">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              disabled={isSubmitting}
              aria-pressed={type === item}
              className={`choice ${type === item ? "selected" : ""}`}
              onClick={() => setType(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <label>Severity Level</label>
        <div className="severity-row">
          {SEVERITIES.map((item) => (
            <button
              key={item}
              type="button"
              disabled={isSubmitting}
              aria-pressed={severity === item}
              className={`severity-choice ${item.toLowerCase()} ${
                severity === item ? "selected" : ""
              }`}
              onClick={() => setSeverity(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <label htmlFor="people">People Affected</label>
        <select
          id="people"
          disabled={isSubmitting}
          value={people}
          onChange={(event) => setPeople(event.target.value)}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => (
            <option key={n} value={n}>
              {n}
              {n === "10" ? "+" : ""} people
            </option>
          ))}
        </select>

        <label htmlFor="description">Situation Description (Optional)</label>
        <textarea
          id="description"
          disabled={isSubmitting}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe condition, entrapment hazards, injuries, or landmarks..."
          maxLength={500}
          rows={3}
        />

        <div className="optional-fields-accordion">
          <label>Optional Identity & Media</label>
          <div className="two-col-inputs">
            <div>
              <label htmlFor="contact-name" className="sublabel">Your Name (Optional)</label>
              <input
                id="contact-name"
                type="text"
                placeholder="e.g. John Doe"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="contact-phone" className="sublabel">Phone / Radio ID</label>
              <input
                id="contact-phone"
                type="tel"
                placeholder="e.g. +1 555-0192"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Photo capture */}
          <div className="media-section">
            <label className="sublabel">Incident Photo (Optional)</label>
            <div className="photo-actions">
              <label className="choice file-label">
                📷 {photoDataUrl ? "Change Photo" : "Attach / Take Photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  style={{ display: "none" }}
                />
              </label>
              {photoDataUrl && (
                <button
                  type="button"
                  className="text-button remove-btn"
                  onClick={() => setPhotoDataUrl(null)}
                >
                  Remove Photo
                </button>
              )}
            </div>
            {photoDataUrl && (
              <div className="photo-preview">
                <img src={photoDataUrl} alt="Attached incident thumbnail" />
              </div>
            )}
          </div>

          {/* Voice note */}
          <div className="media-section">
            <label className="sublabel">Voice Note (Optional)</label>
            <div className="audio-actions">
              {!isRecordingAudio ? (
                <button
                  type="button"
                  className="choice"
                  onClick={handleStartAudio}
                  disabled={isSubmitting}
                >
                  🎙 Record Voice Note
                </button>
              ) : (
                <button
                  type="button"
                  className="choice recording-pulse"
                  onClick={handleStopAudio}
                >
                  ⏹ Stop Recording
                </button>
              )}
              {audioUrl && (
                <button
                  type="button"
                  className="text-button remove-btn"
                  onClick={() => setAudioUrl(null)}
                >
                  Remove Audio
                </button>
              )}
            </div>
            {audioUrl && (
              <audio controls src={audioUrl} className="audio-player">
                Your browser does not support audio playback.
              </audio>
            )}
          </div>
        </div>

        <button className="primary-button submit-button" type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? "Saving..."
            : initialReport
            ? "Update Emergency Record"
            : "Save Emergency Report"}
        </button>

        <p className="form-disclaimer">
          Saves locally on this device first. Transmitted when peer or cloud connectivity is
          detected.
        </p>
      </form>
    </div>
  );
}