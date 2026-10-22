import { useState } from "react";

export default function ReportScreen({ onSubmit, isSubmitting }) {
  const [type, setType] = useState("Medical");
  const [severity, setSeverity] = useState("High");
  const [people, setPeople] = useState("1");
  const [description, setDescription] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();

    const saved = await onSubmit({
      type,
      severity,
      people: Number(people),
      description: description.trim(),
    });

    if (saved) {
      setType("Medical");
      setSeverity("High");
      setPeople("1");
      setDescription("");
    }
  };

  return (
    <div className="screen report-screen">
      <div className="screen-heading">
        <p className="eyebrow">EMERGENCY DETAILS</p>
        <h2>Create a report</h2>
        <p className="subheading">Share essential information with responders.</p>
      </div>

      <form className="report-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
        <label>Emergency type</label>
        <div className="choice-grid">
          {["Medical", "Fire", "Trapped", "Other"].map((item) => (
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

        <label>Severity</label>
        <div className="severity-row">
          {["Low", "Medium", "High"].map((item) => (
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

        <label htmlFor="people">People affected</label>
        <select
          id="people"
          disabled={isSubmitting}
          value={people}
          onChange={(event) => setPeople(event.target.value)}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => (
            <option key={n} value={n}>{n}{n === "10" ? "+" : ""} people</option>
          ))}
        </select>

        <label htmlFor="description">Short description</label>
        <textarea
          id="description"
          disabled={isSubmitting}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What happened? Any urgent details?"
          maxLength={240}
        />

        <button className="primary-button submit-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving report..." : "Save emergency report"}
        </button>
        <p className="form-disclaimer">
          This saves a report locally. It does not contact emergency services.
        </p>
      </form>
    </div>
  );
}