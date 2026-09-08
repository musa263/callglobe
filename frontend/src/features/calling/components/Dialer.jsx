import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Delete, ChevronDown, Phone, PhoneOff, Search, Wifi, WifiOff } from "lucide-react";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { cleanCallInput, resolveCallDestination } from "../engine/callDestination";
import { useCallingDirectory } from "../hooks/useCallingDirectory";
import { formatPhone } from '../formatting.js';
import { CallerIdMenu } from '../../numbers/CallerIdMenu.jsx';

export const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', ''],
];

export function Dialer({ balance, rates, numbers, selectedNumber, setSelectedNumber, voice, accountType, initialNumber, profile, numberState }) {
  const [number, setNumber] = useState(initialNumber || '');
  const [countryOverride, setCountry] = useState(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [callerOpen, setCallerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [callError, setCallError] = useState('');
  const businessAccount = accountType === 'business';
  const directory = useCallingDirectory(businessAccount && profile?.organization_id ? JSON.stringify([profile.organization_id, profile.id]) : '');
  useEffect(() => { if (initialNumber) setNumber(cleanCallInput(initialNumber)); }, [initialNumber]);
  const inferredRegion = parsePhoneNumberFromString(profile?.mobile || selectedNumber?.phone_number || '')?.country || navigator.language.split('-').at(-1)?.toUpperCase();
  const country = countryOverride || rates.find(rate => rate.country_code === inferredRegion) || rates.find(rate => rate.country_code === 'US') || rates[0];
  const route = resolveCallDestination(number, { business: businessAccount, ownExtension: profile?.extension, directory: directory.users, countryCode: country?.country_code, dialCode: country?.dial_code });
  const internal = route.kind === 'internal';
  const shortNumber = internal || route.kind === 'self' || route.kind === 'unknown-extension';
  const filteredRates = rates.filter((rate) => `${rate.country_name} ${rate.dial_code}`.toLowerCase().includes(search.toLowerCase()));
  const fullNumber = route.number;
  const minutes = country?.rate_per_min && Number.isFinite(balance) ? Math.floor(balance / country.rate_per_min) : null;
  const destinationCountry = parsePhoneNumberFromString(fullNumber)?.country || country?.country_code;
  const callerCountry = selectedNumber?.country_code || parsePhoneNumberFromString(selectedNumber?.phone_number || '')?.country;
  const routeRisk = selectedNumber?.source === 'verified' && callerCountry === destinationCountry && !['US', 'CA'].includes(destinationCountry || '');
  const carrierPending = !shortNumber && selectedNumber?.source === 'carrier' && selectedNumber.status !== 'ready';
  const ownedFallback = numbers.find((item) => item.source === 'owned' && item.phone_number !== selectedNumber?.phone_number);
  const zeroHoldRef = useRef({ timer: null, fired: false });
  function startZeroHold() {
    zeroHoldRef.current.fired = false;
    zeroHoldRef.current.timer = window.setTimeout(() => {
      zeroHoldRef.current.fired = true;
      setNumber(current => cleanCallInput(`+${current}`));
    }, 550);
  }
  useEffect(() => () => window.clearTimeout(zeroHoldRef.current.timer), []);
  function endZeroHold() {
    window.clearTimeout(zeroHoldRef.current.timer);
    zeroHoldRef.current.timer = null;
  }
  function pressKey(value) {
    if (value === '0' && zeroHoldRef.current.fired) { zeroHoldRef.current.fired = false; return; }
    setNumber((current) => cleanCallInput(`${current}${value}`));
  }
  async function call() {
    if (!number || voice.callStarting || voice.active || carrierPending || !['internal', 'external'].includes(route.kind)) return;
    if (internal) {
      setCallError('');
      try {
        await voice.startInternalCall('', route.input, route.colleague?.name || `Extension ${route.input}`);
      } catch (extensionError) { setCallError(extensionError.message || 'The extension call could not be started.'); }
      return;
    }
    if (routeRisk) {
      setCallError(`Local carriers may not ring when ${selectedNumber.phone_number} is used for this same-country call. Switch to your Vocivo number.`);
      return;
    }
    if (!internal && !selectedNumber?.phone_number) {
      setCallError('Choose a caller ID before placing an external call.');
      return;
    }
    setCallError('');
    try { await voice.startCall(fullNumber, selectedNumber?.phone_number); }
    catch (outboundError) { setCallError(outboundError.message || 'The call could not be started.'); }
  }
  return (
    <section className="dialer-workspace">
      <header className="workspace-header"><div><p className="eyebrow">WEB PHONE</p><h1>Make a call</h1></div><div className={`status-badge ${voice.ready ? 'online' : ''}`}>{voice.ready ? <Wifi size={15} /> : <WifiOff size={15} />}{voice.ready ? 'Ready for calls' : voice.statusLabel}</div></header>
      <div className="dialer-layout">
        <div className="dialer-panel">
          {!shortNumber && <CallerIdMenu state={numberState} numbers={numbers} selected={selectedNumber} onSelect={(value) => { setSelectedNumber(value); setCallerOpen(false); }} open={callerOpen} onToggle={() => { if (!callerOpen) numberState?.refresh?.(); setCallerOpen(value => !value); }} />}
          <div className="destination-field">
            {!shortNumber ? <button className="country-trigger" onClick={() => setCountryOpen((value) => !value)} aria-label="Choose destination country"><span>{country?.country_code || '--'}</span><ChevronDown size={15} /></button> : <span className="extension-prefix">EXT</span>}
            <input value={number} onChange={event => { setNumber(cleanCallInput(event.target.value)); setCallError(''); }} placeholder={businessAccount ? 'Number or company extension' : 'Phone number'} inputMode="tel" aria-label="Number to call" />
            <button className="erase-button" onClick={() => setNumber((value) => value.slice(0, -1))} disabled={!number} title="Delete digit"><Delete size={19} /></button>
            {!shortNumber && countryOpen && <div className="country-menu"><div className="country-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search country" autoFocus /></div><div className="country-list">{filteredRates.map((rate) => (
              <button key={rate.id} onClick={() => { setCountry(rate); setCountryOpen(false); setSearch(''); }}><span className="country-code">{rate.country_code}</span><span><strong>{rate.country_name}</strong><small>{rate.dial_code}</small></span><em>{rate.rate_per_min ? `$${rate.rate_per_min.toFixed(3)}/min` : 'Available'}</em></button>
            ))}</div></div>}
          </div>
          {!shortNumber ? <><div className="rate-strip"><span><small>DESTINATION</small><strong>{country?.country_name || 'Select country'}</strong></span><span><small>COUNTRY CODE</small><strong>{country?.dial_code || '-'}</strong></span><span><small>ESTIMATED TIME</small><strong>{minutes ? `${minutes.toLocaleString()} min` : 'See live rate'}</strong></span></div>{routeRisk && <div className="route-warning"><AlertTriangle size={18} /><div><strong>This caller ID may not ring locally</strong><small>Some countries filter verified same-country caller IDs arriving through international routes. An owned international number is usually more compatible.</small></div>{ownedFallback && <button onClick={() => { setSelectedNumber(ownedFallback); setCallError(''); }}>Use {formatPhone(ownedFallback.phone_number)}</button>}</div>}</> : <div className="rate-strip extension-strip"><span><small>ROUTE</small><strong>{internal ? `${route.colleague?.name} · Extension ${route.input}` : route.kind === 'self' ? 'This is your extension' : directory.status === 'loading' ? 'Finding colleague...' : directory.status === 'failed' ? 'Company directory unavailable' : 'No matching company extension'}</strong></span><span><small>COST</small><strong>{internal ? 'Free internal call' : 'Call unavailable'}</strong></span><span><small>PHONE NUMBER</small><strong>Not required</strong></span></div>}
          {shortNumber && directory.status === 'failed' && <button className="secondary" onClick={directory.retry}>Retry company directory</button>}
          <div className="keypad" aria-label="Phone keypad">{KEYS.map(([key, letters]) => <button key={key} onClick={() => pressKey(key)} onPointerDown={key === '0' ? startZeroHold : undefined} onPointerUp={key === '0' ? endZeroHold : undefined} onPointerLeave={key === '0' ? endZeroHold : undefined}><strong>{key}</strong><small>{letters}</small></button>)}</div>
          {(callError || voice.error) ? <div className="inline-error" role="alert">{callError || voice.error}</div> : voice.notice && <div className="call-notice" role="status"><PhoneOff size={18} /><span>{voice.notice}</span></div>}
          {carrierPending && <p className="call-notice" role="status">This carrier line is pending activation. Contact your company administrator to enable external calls.</p>}
          <button className="call-button" onClick={call} disabled={voice.active || voice.callStarting || !['internal', 'external'].includes(route.kind) || carrierPending || (!internal && !selectedNumber?.phone_number) || !voice.ready}><Phone size={22} /> {voice.ready ? (internal ? 'Call extension' : 'Call now') : 'Connecting phone...'} </button>
        </div>
      </div>
    </section>
  );
}
