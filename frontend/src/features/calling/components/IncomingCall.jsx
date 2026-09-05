import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { describeIncoming } from "../engine/callIdentity";
import { formatPhone } from '../formatting.js';

export function IncomingCall({ call, onAnswer, onDecline }) {
  const identity = describeIncoming(call);
  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-modal incoming-modal">
        {identity.photoUrl ? <img className="ring-icon incoming-photo" src={identity.photoUrl} alt="" /> : <span className="ring-icon"><PhoneIncoming size={29} /></span>}<p className="eyebrow">INCOMING CALL</p><h2>{identity.name}</h2><p className="call-number">{identity.internal ? identity.number : formatPhone(identity.number)}</p>
        <div className="incoming-actions"><button className="round-action decline" onClick={onDecline} title="Decline call"><PhoneOff /></button><button className="round-action answer" onClick={onAnswer} title="Answer call"><Phone /></button></div>
        <div className="action-labels"><span>Decline</span><span>Answer</span></div>
      </div>
    </div>
  );
}
