import { ArrowDownLeft, ArrowUpRight, Clock3, Phone } from "lucide-react";
import { formatPhone, formatDuration } from '../formatting.js';

export function HistoryView({ history, onCallAgain }) {
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">ACTIVITY</p><h1>Recent calls</h1></div></header><div className="history-list">{history.length === 0 ? <div className="empty-state"><Clock3 /><h2>No calls yet</h2><p>Your browser call history will appear here.</p></div> : history.map((item) => <article key={item.id} className="history-item"><span className={`history-direction ${item.direction}`}>{item.direction === 'incoming' ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{formatPhone(item.number)}</strong><small>{new Date(item.date).toLocaleString()}</small></div><span className="duration">{formatDuration(item.duration)}</span><button onClick={() => onCallAgain(item.number)} title="Call again"><Phone size={17} /></button></article>)}</div></section>;
}
