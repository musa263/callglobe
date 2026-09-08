import { Pencil, Server } from 'lucide-react';
import { Status } from '../components/ui.jsx';

export const authenticationLabels = {
  unconfirmed: 'Awaiting carrier confirmation',
  ip: 'IP authentication',
  registration: 'SIP registration',
};
const directionLabel = value => value == null ? 'Not specified' : value ? 'Allowed' : 'Disabled';

function Details({ entries }) {
  return <dl className="carrier-details-grid">{entries.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value || 'Not specified'}</dd></div>
  )}</dl>;
}

export function CarrierTrunkDetails({ trunk, companyName, targets, onEdit, onUseNumbers, busy }) {
  const destination = number => targets.find(([value]) => value === (number.destinationId ? `${number.destinationType}:${number.destinationId}` : number.destinationType))?.[1]
    || `Unavailable destination (${number.destinationType})`;
  return <article className="carrier-trunk-entry" aria-label={`${trunk.name} trunk details`}>
    <header className="carrier-entry-header">
      <span className="object-icon"><Server /></span>
      <div><h3>{trunk.name}</h3><p>{companyName} · {trunk.provider}</p></div>
      <Status good={trunk.connectionStatus === 'ready'} warn={trunk.connectionStatus !== 'ready'}>{trunk.connectionStatus === 'ready' ? 'Ready for call test' : 'Pending activation'}</Status>
      <button className="secondary" onClick={() => onEdit(trunk)}><Pencil /> Edit trunk</button>
    </header>
    <section aria-label="General trunk details">
      <h4>General</h4>
      <Details entries={[
        ['Account reference', trunk.accountReference], ['Main trunk number', trunk.mainNumber],
        ['Registrar / SIP server', trunk.server], ['SIP port', trunk.port], ['Transport', trunk.transport],
        ['Authentication', authenticationLabels[trunk.authentication]],
        ['SIP user ID', trunk.username || (trunk.authentication === 'ip' ? 'Not required for IP authentication' : 'Not configured')],
        ['SIP password', trunk.authentication === 'ip' ? 'Not required' : trunk.hasPassword ? 'Stored securely' : 'Not configured'],
        ['Public IP for allowlisting', trunk.publicIp], ['Hosting provider', trunk.hostingProvider],
        ['Outbound proxy', trunk.outboundProxy || 'Not configured'], ['Outbound proxy port', trunk.outboundProxyPort ?? 5060],
      ]} />
    </section>
    <section aria-label="Trunk call options">
      <h4>Options</h4>
      <Details entries={[
        ['Simultaneous call limit', trunk.channelLimit ?? 'Not specified'],
        ['Inbound calls', directionLabel(trunk.inboundEnabled)], ['Outbound calls', directionLabel(trunk.outboundEnabled)],
      ]} />
    </section>
    <section aria-label="Trunk DID numbers">
      <div className="carrier-subheading"><h4>DID numbers</h4><span>{trunk.numbers.length} numbers</span></div>
      <table className="carrier-did-table">
        <caption className="carrier-screen-reader">All DID numbers and destinations for {trunk.name}</caption>
        <thead><tr><th scope="col">DID number</th><th scope="col">Outbound caller ID</th><th scope="col">Route to</th></tr></thead>
        <tbody>{trunk.numbers.length ? trunk.numbers.map(number => <tr key={number.inboundNumber}>
          <td>{number.inboundNumber}{number.inboundNumber === trunk.mainNumber && <span className="carrier-main-number">Main</span>}</td>
          <td>{number.callerId}</td><td>{destination(number)}</td>
        </tr>) : <tr><td colSpan={3}>No DID numbers added.</td></tr>}</tbody>
      </table>
    </section>
    <section className="carrier-notes"><h4>Notes</h4><p>{trunk.notes || 'No notes added.'}</p></section>
    {onUseNumbers && <button className="primary" disabled={busy || !trunk.numbers.length} onClick={() => onUseNumbers(trunk)}>Use these carrier numbers</button>}
    <p className="carrier-activation-note">{trunk.connectionMessage || 'Saved configuration. Carrier activation is required before this trunk carries calls.'}</p>
  </article>;
}
