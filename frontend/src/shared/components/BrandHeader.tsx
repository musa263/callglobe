import './brand-header.css';

export function BrandHeader() {
  return (
    <header className="vocivo-app-header" aria-label="Vocivo">
      <div className="vocivo-wordmark">
        <img src="/vocivo-icon-192.png" width="32" height="32" alt="" />
        <span>Vocivo</span>
      </div>
    </header>
  );
}
