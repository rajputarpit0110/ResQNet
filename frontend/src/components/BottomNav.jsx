const navItems = [
  { id: "home", label: "Home", symbol: "⌂" },
  { id: "report", label: "Report", symbol: "+" },
  { id: "location", label: "Location", symbol: "◎" },
  { id: "reports", label: "Reports", symbol: "▤" },
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
        >
          <span className="nav-symbol">{item.symbol}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}