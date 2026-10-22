import { useEffect, useState } from "react";

export default function AppHeader() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <h1>ResQNet</h1>
          <p>Emergency response</p>
        </div>
      </div>

      <div className={`network-status ${isOnline ? "online" : "offline"}`}>
        <span className="status-dot" />
        {isOnline ? "Online" : "Offline"}
      </div>
    </header>
  );
}