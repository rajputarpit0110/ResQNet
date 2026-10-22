const navItems = [
  { id: "home", label: "Home", symbol: "⌂" },
  { id: "report", label: "Report", symbol: "+" },
  { id: "location", label: "Location", symbol: "◎" },
  { id: "reports", label: "My Reports", symbol: "▤" },
  { id: "mesh", label: "P2P Relay", symbol: "☍" },
  { id: "rescuer", label: "Rescuer", symbol: "🛡" },
];

export default function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${activeTab === item.id ? "active" : ""}`}
          onClick={() => onChange(item.id)}
          aria-current={activeTab === item.id ? "page" : undefined}
          title={item.label}
        >
          <span className="nav-symbol">{item.symbol}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}