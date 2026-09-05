import { X } from "lucide-react";

export function Status({ good = false, warn = false, children }) { return <span className={`status-pill ${good ? 'good' : warn ? 'warn' : ''}`}><i />{children}</span>; }

export function Toggle({ value, onChange, label }) { return <button type="button" role="switch" aria-checked={value} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i />{label && <span>{label}</span>}</button>; }

export function PageHeader({ eyebrow, title, subtitle, children }) { return <header className="page-header"><div><p>{eyebrow}</p><h1>{title}</h1><span>{subtitle}</span></div><div className="page-actions">{children}</div></header>; }

export function Field({ label, children, wide = false, help }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{help && <small>{help}</small>}</label>; }

export function Modal({ title, subtitle, onClose, wide = false, children }) { return <div className="modal-layer"><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} title="Close"><X /></button></header>{children}</section></div>; }

export function Empty({ icon: Icon, title, copy }) { return <div className="empty"><Icon /><strong>{title}</strong><span>{copy}</span></div>; }
