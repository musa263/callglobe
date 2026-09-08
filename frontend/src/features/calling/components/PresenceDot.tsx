export function PresenceDot({ presence }: { presence?: string }) {
  const state = presence === 'online' || presence === 'busy' ? presence : 'offline';
  const label = state === 'online' ? 'Online' : state === 'busy' ? 'Busy' : 'Offline';
  return <span className={`presence-dot ${state}`} role="img" title={label} aria-label={label} />;
}
