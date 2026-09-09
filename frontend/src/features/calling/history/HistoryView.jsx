import { ArrowDownLeft, ArrowUpRight, Clock3, Phone } from "lucide-react";
import { formatPhone, formatDuration } from '../formatting.js';
import { describeHistory } from './historyIdentity.js';
import { useCallingDirectory } from '../hooks/useCallingDirectory';

export function HistoryView({ history, onCallAgain, profile }) {
  const directory = useCallingDirectory(profile?.account_type === 'business'
    ? JSON.stringify([profile.organization_id, profile.id]) : '');
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">ACTIVITY</p><h1>Recent calls</h1></div></header><div className="history-list">{history.length === 0 ? <div className="empty-state"><Clock3 /><h2>No calls yet</h2></div> : history.map((item) => {
    const peer = describeHistory(item, directory.users);
    return <article key={item.id} className="history-item"><span className={`history-direction ${item.direction}`}>{item.direction === 'incoming' ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{peer.label}</strong>{peer.number && <small>{peer.internal ? `Extension ${peer.number}` : formatPhone(peer.number)}</small>}<small>{new Date(item.date).toLocaleString()}</small></div><span className="duration">{item.answered || item.duration > 0 ? formatDuration(item.duration) : item.direction === 'incoming' ? 'Missed' : 'No answer'}</span><button disabled={!peer.canRedial} onClick={() => onCallAgain(peer.number)} title={peer.canRedial ? `Call ${peer.label}` : 'Caller number unavailable'} aria-label={peer.canRedial ? `Call ${peer.label}` : 'Caller number unavailable'}><Phone size={17} /></button></article>;
  })}</div></section>;
}
