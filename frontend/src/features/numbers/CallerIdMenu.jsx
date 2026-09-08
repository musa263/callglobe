import { Check, ChevronDown, Phone } from "lucide-react";

export function CallerIdMenu({ numbers, selected, onSelect, open, onToggle, state }) {
  return (
    <div className="caller-picker">
      <button type="button" className="caller-trigger" onClick={onToggle} aria-expanded={open} aria-controls="caller-id-options" aria-haspopup="listbox">
        <span className="line-icon"><Phone size={15} /></span>
        <span><small>CALLING FROM</small><strong>{selected?.label || 'Choose a number'}</strong></span>
        <span className="caller-number">{selected?.phone_number || 'No number'}</span><ChevronDown size={16} />
      </button>
      {open && <div className="caller-menu" id="caller-id-options">
        {state?.busy && <p role="status">Refreshing company numbers…</p>}
        {state?.error && <p role="alert">{state.error}</p>}
        {!numbers.length && !state?.busy && !state?.error && <p>No calling numbers are assigned. Ask your company administrator to add a SIP trunk.</p>}
        <div role="listbox" aria-label="Outgoing caller ID">{numbers.map(number => (
          <button type="button" role="option" aria-selected={selected?.id === number.id} key={number.id} onClick={() => onSelect(number)}><span><strong>{number.label}</strong><small>{number.phone_number}{number.source === 'carrier' && number.status !== 'ready' ? ' · Pending activation' : ''}</small></span>{selected?.id === number.id && <Check size={17} />}</button>
        ))}</div>
        {state?.refresh && <button type="button" onClick={state.refresh} disabled={state.busy}>Refresh numbers</button>}
      </div>}
    </div>
  );
}
