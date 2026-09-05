import { useState } from "react";
import { Search } from "lucide-react";

export function RatesView({ rates }) {
  const [search, setSearch] = useState('');
  const filtered = rates.filter((rate) => `${rate.country_name} ${rate.country_code} ${rate.dial_code}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">WORLDWIDE</p><h1>Country codes</h1></div><div className="view-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Country or code" /></div></header><div className="rates-list">{filtered.map((rate) => <article key={rate.id} className="rate-item"><span className="rate-code">{rate.country_code}</span><div><strong>{rate.country_name}</strong><small>International destination</small></div><strong>{rate.dial_code} {rate.rate_per_min ? <small>from ${rate.rate_per_min.toFixed(3)}/min</small> : <small>Vocivo live rate</small>}</strong></article>)}</div><p className="rate-note">Vocivo accepts complete international numbers in E.164 format. Final pricing varies by number type and destination network.</p></section>;
}
