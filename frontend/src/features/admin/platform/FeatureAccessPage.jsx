import { useEffect, useState } from "react";
import { BellRing, Building2, Save, ShieldCheck, Users } from "lucide-react";
import { Toggle, PageHeader, Empty } from '../components/ui.jsx';

export function FeatureAccessPage({ data, onSave, busy }) {
  const [selectedId, setSelectedId] = useState(data?.organizations?.[0]?.id || '');
  const company = data?.organizations?.find((item) => item.id === selectedId) || data?.organizations?.[0];
  const [draft, setDraft] = useState(null);
  useEffect(() => { if (company) setDraft({ ...company.entitlements }); }, [company?.id]);
  if (!company || !draft) return <div className="page"><Empty icon={Building2} title="No customers" copy="Create a customer before assigning feature access." /></div>;
  const grouped = data.featureCatalog.reduce((result, feature) => ({ ...result, [feature.group]: [...(result[feature.group] || []), feature] }), {});
  return <div className="page"><PageHeader eyebrow="ENTITLEMENT CONTROL" title="Feature access" subtitle="Vocivo decides which capabilities each customer administrator can see and use."><select className="company-select" value={company.id} onChange={(e) => setSelectedId(e.target.value)}>{data.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary" disabled={busy} onClick={() => onSave(company.id, draft)}><Save /> Apply access</button></PageHeader>
    <div className="entitlement-summary"><div><Building2 /><span>Customer</span><strong>{company.name}</strong></div><div><BellRing /><span>Plan</span><strong>{company.plan.name}</strong></div><div><Users /><span>Seat usage</span><strong>{company.usage.seats}/{company.plan.limits.seats}</strong></div><div><ShieldCheck /><span>Subscription</span><strong>{company.subscription.status}</strong></div></div>
    {Object.entries(grouped).map(([group, features]) => <section className="band" key={group}><div className="section-title"><div><h2>{group}</h2><p>Changes override the selected plan for this company only.</p></div></div><div className="feature-grid">{features.map((feature) => <div key={feature.id}><div><strong>{feature.name}</strong><span>{company.plan.features[feature.id] ? `Included in ${company.plan.name}` : `Not included in ${company.plan.name}`}</span></div><Toggle value={Boolean(draft[feature.id])} onChange={(enabled) => setDraft({ ...draft, [feature.id]: enabled })} /></div>)}</div></section>)}
  </div>;
}
