import { Check, ChevronDown, Phone } from "lucide-react";

export function CallerIdMenu({ numbers, selected, onSelect, open, onToggle }) {
  return (
    <div className="caller-picker">
      <button className="caller-trigger" onClick={onToggle} aria-expanded={open}>
        <span className="line-icon"><Phone size={15} /></span>
        <span><small>CALLING FROM</small><strong>{selected?.label || 'Choose a number'}</strong></span>
        <span className="caller-number">{selected?.phone_number || 'No number'}</span><ChevronDown size={16} />
      </button>
      {open && <div className="caller-menu">{numbers.map((number) => (
        <button key={number.id} onClick={() => onSelect(number)}><span><strong>{number.label}</strong><small>{number.phone_number}{number.source === 'carrier' && number.status !== 'ready' ? ' · Pending activation' : ''}</small></span>{selected?.id === number.id && <Check size={17} />}</button>
      ))}</div>}
    </div>
  );
}
