import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeDollarSign, Building2, CheckCircle2, CircleDollarSign, CreditCard,
  Landmark, Pencil, Plus, ReceiptText, Save, ShieldCheck, Trash2, WalletCards, X,
} from 'lucide-react';
import { buildDialingDirectory } from '../numbers/countries';

const countries = buildDialingDirectory();
const money = (minor, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor || 0) / 100);
const rate = (micros) => `$${(Number(micros || 0) / 1_000_000).toFixed(4)}`;
const amountMinor = (value) => Math.round(Number(value || 0) * 100);
const amountMicros = (value) => Math.round(Number(value || 0) * 1_000_000);
const amount = (minor) => Number(minor || 0) / 100;
const percent = (bps) => Number(bps || 0) / 100;

function PageHeader({ eyebrow, title, subtitle, children }) {
  return <header className="page-header"><div><p>{eyebrow}</p><h1>{title}</h1><span>{subtitle}</span></div><div className="page-actions">{children}</div></header>;
}

function Status({ good = false, warn = false, children }) {
  return <span className={`status-pill ${good ? 'good' : warn ? 'warn' : ''}`}><i />{children}</span>;
}

function Field({ label, children, help, wide = false }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

function Toggle({ value, onChange }) {
  return <button type="button" role="switch" aria-checked={value} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button>;
}

function Modal({ title, subtitle, onClose, children }) {
  return <div className="modal-layer"><section className="modal wallet-modal" role="dialog" aria-modal="true"><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} title="Close"><X /></button></header>{children}</section></div>;
}

function emptyPackage(order = 100) {
  return { id: '', label: '', amountMinor: 2500, creditMinor: 2500, active: true, sortOrder: order };
}

function emptyRule() {
  return { id: '', countryCode: 'US', destinationName: 'United States', wholesaleRateMicros: 10000, grossMarginBps: null, surchargeMicros: 0, active: true };
}

export default function WalletsPage({ data, busy, onAction }) {
  const [adjustment, setAdjustment] = useState(null);
  const [walletDraft, setWalletDraft] = useState(null);
  const [packageDraft, setPackageDraft] = useState(null);
  const [ruleDraft, setRuleDraft] = useState(null);
  const [settings, setSettings] = useState(data?.settings || null);
  const [query, setQuery] = useState('');
  useEffect(() => setSettings(data?.settings || null), [data?.settings]);

  const wallets = useMemo(() => (data?.wallets || []).filter((wallet) => `${wallet.organizationName} ${wallet.accountType}`.toLowerCase().includes(query.toLowerCase())), [data?.wallets, query]);
  const treasuryLow = data?.treasury?.balanceMinor !== null && data?.treasury?.balanceMinor < (data?.settings?.lowCarrierBalanceMinor || 0);
  const coverageLow = data?.summary?.coveragePercent !== null && data?.summary?.coveragePercent < 110;
  const draftRetail = ruleDraft && settings ? Math.ceil(
    ruleDraft.wholesaleRateMicros * (1 + settings.fxBufferBps / 10_000) /
    (1 - (ruleDraft.grossMarginBps ?? settings.grossMarginBps) / 10_000) + ruleDraft.surchargeMicros,
  ) : 0;

  if (!data || !settings) return <div className="page"><div className="wallet-loading"><WalletCards /><strong>Loading wallet operations</strong></div></div>;

  const submitAdjustment = async (event) => {
    event.preventDefault();
    const ok = await onAction({ ...adjustment, action: 'adjust_wallet', amountMinor: amountMinor(adjustment.amount), idempotencyKey: adjustment.idempotencyKey });
    if (ok) setAdjustment(null);
  };
  const submitWallet = async (event) => {
    event.preventDefault();
    const ok = await onAction({ action: 'save_wallet', wallet: { ...walletDraft, lowBalanceMinor: amountMinor(walletDraft.lowBalance), autoRechargeThresholdMinor: amountMinor(walletDraft.autoRechargeThreshold), autoRechargeAmountMinor: amountMinor(walletDraft.autoRechargeAmount) } });
    if (ok) setWalletDraft(null);
  };
  const submitPackage = async (event) => {
    event.preventDefault();
    const ok = await onAction({ action: 'save_package', package: { ...packageDraft, amountMinor: amountMinor(packageDraft.amount), creditMinor: amountMinor(packageDraft.credit) } });
    if (ok) setPackageDraft(null);
  };
  const submitRule = async (event) => {
    event.preventDefault();
    const ok = await onAction({ action: 'save_rate_rule', rule: ruleDraft });
    if (ok) setRuleDraft(null);
  };
  const submitSettings = async (event) => {
    event.preventDefault();
    await onAction({ action: 'save_settings', settings });
  };

  return <div className="page wallets-page"><PageHeader eyebrow="RETAIL BILLING" title="Wallets & pricing" subtitle="Manage Vocivo calling credit, carrier exposure, top-up products and retail margins."><button className="primary" onClick={() => setAdjustment({ organizationId: data.wallets[0]?.organizationId || '', entryType: 'topup', direction: 'credit', amount: 25, reference: '', description: '', idempotencyKey: `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}` })} disabled={!data.wallets.length}><Plus /> Add credit</button></PageHeader>
    <div className="metrics wallet-metrics">
      <div><Landmark /><span>Telnyx treasury</span><strong>{data.treasury.balanceMinor === null ? 'Unavailable' : money(data.treasury.balanceMinor, data.treasury.currency)}</strong><small>{data.treasury.status === 'available' ? `${money(data.treasury.availableCreditMinor, data.treasury.currency)} carrier credit line` : 'Carrier API could not be reached'}</small></div>
      <div><WalletCards /><span>Customer liability</span><strong>{money(data.summary.customerLiabilityMinor, settings.currency)}</strong><small>{money(data.summary.reservedMinor, settings.currency)} reserved</small></div>
      <div><ShieldCheck /><span>Treasury coverage</span><strong>{data.summary.coveragePercent === null ? 'Not available' : `${data.summary.coveragePercent}%`}</strong><small>Carrier funds against customer credit</small></div>
      <div><ReceiptText /><span>Credits, last 30 days</span><strong>{money(data.summary.credits30dMinor, settings.currency)}</strong><small>{money(data.summary.debits30dMinor, settings.currency)} debited</small></div>
    </div>

    {(treasuryLow || coverageLow) && <div className="wallet-alert"><AlertTriangle /><div><strong>Treasury attention required</strong><span>{treasuryLow ? 'The Telnyx balance is below your configured carrier threshold. ' : ''}{coverageLow ? 'Carrier coverage is below the recommended 110% of customer liabilities.' : ''}</span></div></div>}

    <section className="band"><div className="section-title"><div><h2>Customer wallets</h2><p>Each customer has an isolated balance and immutable transaction history.</p></div><label className="wallet-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers" /></label></div>
      <div className="table-shell wallet-table"><table><thead><tr><th>Customer</th><th>Available</th><th>Reserved</th><th>Low-balance alert</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>{wallets.map((wallet) => <tr key={wallet.organizationId}><td><strong>{wallet.organizationName}</strong><small>{wallet.accountType} customer</small></td><td><strong>{money(wallet.availableMinor, wallet.currency)}</strong></td><td>{money(wallet.reservedMinor, wallet.currency)}</td><td>{money(wallet.lowBalanceMinor, wallet.currency)}</td><td><Status good={wallet.status === 'active'} warn={wallet.status === 'frozen'}>{wallet.status}</Status></td><td>{new Date(wallet.updatedAt).toLocaleString()}</td><td><div className="row-actions"><button onClick={() => setAdjustment({ organizationId: wallet.organizationId, entryType: 'topup', direction: 'credit', amount: 25, reference: '', description: '', idempotencyKey: `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}` })}>Adjust</button><button onClick={() => setWalletDraft({ ...wallet, lowBalance: amount(wallet.lowBalanceMinor), autoRechargeThreshold: amount(wallet.autoRechargeThresholdMinor), autoRechargeAmount: amount(wallet.autoRechargeAmountMinor) })}><Pencil /></button></div></td></tr>)}</tbody></table></div>
    </section>

    <section className="band"><div className="section-title"><div><h2>Retail pricing policy</h2><p>Set the commercial guardrails used when creating destination-specific rates.</p></div><Status good>Central policy</Status></div>
      <form className="wallet-settings" onSubmit={submitSettings}><Field label="Settlement currency"><select value={settings.currency} onChange={(event) => setSettings({ ...settings, currency: event.target.value })}><option>USD</option><option>SAR</option><option>EUR</option><option>GBP</option></select></Field><Field label="Target gross margin"><div className="suffix-input"><input type="number" min="0" max="90" step="0.1" value={percent(settings.grossMarginBps)} onChange={(event) => setSettings({ ...settings, grossMarginBps: Math.round(Number(event.target.value) * 100) })} /><span>%</span></div></Field><Field label="FX protection buffer"><div className="suffix-input"><input type="number" min="0" max="50" step="0.1" value={percent(settings.fxBufferBps)} onChange={(event) => setSettings({ ...settings, fxBufferBps: Math.round(Number(event.target.value) * 100) })} /><span>%</span></div></Field><Field label="Payment cost allowance"><div className="suffix-input"><input type="number" min="0" max="50" step="0.1" value={percent(settings.paymentFeeBps)} onChange={(event) => setSettings({ ...settings, paymentFeeBps: Math.round(Number(event.target.value) * 100) })} /><span>%</span></div></Field><Field label="Minimum top-up"><div className="suffix-input"><input type="number" min="1" step="0.01" value={amount(settings.minimumTopupMinor)} onChange={(event) => setSettings({ ...settings, minimumTopupMinor: amountMinor(event.target.value) })} /><span>{settings.currency}</span></div></Field><Field label="Carrier low-balance alert"><div className="suffix-input"><input type="number" min="0" step="0.01" value={amount(settings.lowCarrierBalanceMinor)} onChange={(event) => setSettings({ ...settings, lowCarrierBalanceMinor: amountMinor(event.target.value) })} /><span>{settings.currency}</span></div></Field><button className="primary wallet-save" disabled={busy}><Save /> Save pricing policy</button></form>
    </section>

    <div className="wallet-columns">
      <section className="band"><div className="section-title"><div><h2>Top-up packages</h2><p>Products prepared for customer checkout.</p></div><button className="secondary" onClick={() => setPackageDraft({ ...emptyPackage(), amount: 25, credit: 25 })}><Plus /> Add</button></div><div className="wallet-products">{data.packages.map((item) => <div key={item.id}><div><strong>{item.label}</strong><span>Pay {money(item.amountMinor, settings.currency)} · receive {money(item.creditMinor, settings.currency)}</span></div><Status good={item.active}>{item.active ? 'Active' : 'Hidden'}</Status><button onClick={() => setPackageDraft({ ...item, amount: amount(item.amountMinor), credit: amount(item.creditMinor) })}><Pencil /></button><button className="danger" onClick={() => onAction({ action: 'delete_package', id: item.id }, 'DELETE')}><Trash2 /></button></div>)}</div></section>
      <section className="band"><div className="section-title"><div><h2>Payment activation</h2><p>Keep settlement honest and provider-neutral.</p></div></div><div className="payment-readiness"><div><CheckCircle2 /><div><strong>Vocivo wallet ledger</strong><span>Active and tenant isolated</span></div><Status good>Ready</Status></div><div><CreditCard /><div><strong>Customer checkout</strong><span>Connect an approved payment provider before enabling automatic collection.</span></div><Status warn>Not connected</Status></div><div><BadgeDollarSign /><div><strong>Usage settlement</strong><span>Carrier CDR ingestion is required before automatic per-call debits.</span></div><Status warn>Pending</Status></div></div></section>
    </div>

    <section className="band"><div className="section-title"><div><h2>Destination rate rules</h2><p>Wholesale cost stays private; customers receive only the calculated Vocivo retail rate.</p></div><button className="secondary" onClick={() => setRuleDraft(emptyRule())}><Plus /> Add rule</button></div><div className="table-shell wallet-table"><table><thead><tr><th>Destination</th><th>Wholesale / min</th><th>Margin</th><th>Surcharge</th><th>Retail / min</th><th>Status</th><th /></tr></thead><tbody>{data.rateRules.map((item) => <tr key={item.id}><td><strong>{item.destinationName}</strong><small>{item.countryCode}</small></td><td>{rate(item.wholesaleRateMicros)}</td><td>{percent(item.grossMarginBps ?? settings.grossMarginBps)}%</td><td>{rate(item.surchargeMicros)}</td><td><strong>{rate(item.retailRateMicros)}</strong></td><td><Status good={item.active}>{item.active ? 'Active' : 'Disabled'}</Status></td><td><div className="row-actions"><button onClick={() => setRuleDraft({ ...item })}><Pencil /></button><button className="danger" onClick={() => onAction({ action: 'delete_rate_rule', id: item.id }, 'DELETE')}><Trash2 /></button></div></td></tr>)}</tbody></table>{!data.rateRules.length && <div className="wallet-empty">No destination-specific pricing rules yet. Global policy remains the default.</div>}</div></section>

    <section className="band"><div className="section-title"><div><h2>Wallet ledger</h2><p>Append-only audit trail for every customer balance adjustment.</p></div></div><div className="table-shell wallet-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Entry</th><th>Reference</th><th>Amount</th><th>Balance after</th><th>Administrator</th></tr></thead><tbody>{data.entries.slice(0, 100).map((entry) => { const wallet = data.wallets.find((item) => item.organizationId === entry.organizationId); return <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td><strong>{wallet?.organizationName || entry.organizationId}</strong></td><td>{entry.type.replaceAll('_', ' ')}<small>{entry.description || 'No note'}</small></td><td>{entry.reference || 'Internal adjustment'}</td><td className={entry.direction === 'credit' ? 'wallet-credit' : 'wallet-debit'}>{entry.direction === 'credit' ? '+' : '-'}{money(entry.amountMinor, entry.currency)}</td><td>{money(entry.balanceAfterMinor, entry.currency)}</td><td>{entry.createdBy}</td></tr>; })}</tbody></table>{!data.entries.length && <div className="wallet-empty">No wallet transactions have been recorded.</div>}</div></section>

    {adjustment && <Modal title="Adjust customer credit" subtitle="Creates an immutable, traceable wallet entry" onClose={() => setAdjustment(null)}><form className="modal-form" onSubmit={submitAdjustment}><Field label="Customer" wide><select value={adjustment.organizationId} onChange={(event) => setAdjustment({ ...adjustment, organizationId: event.target.value })}>{data.wallets.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</select></Field><Field label="Entry type"><select value={adjustment.entryType} onChange={(event) => { const entryType = event.target.value; setAdjustment({ ...adjustment, entryType, direction: ['manual_debit', 'chargeback'].includes(entryType) ? 'debit' : 'credit' }); }}><option value="topup">Customer top-up</option><option value="manual_credit">Manual credit</option><option value="promotion">Promotional credit</option><option value="refund">Refund credit</option><option value="manual_debit">Manual debit</option><option value="chargeback">Chargeback</option></select></Field><Field label="Amount"><div className="suffix-input"><input type="number" min="0.01" max="1000000" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} required /><span>{settings.currency}</span></div></Field><Field label="External reference" wide help="Required for top-ups, refunds and chargebacks."><input value={adjustment.reference} onChange={(event) => setAdjustment({ ...adjustment, reference: event.target.value })} placeholder="Payment, bank or support reference" required={['topup', 'refund', 'chargeback'].includes(adjustment.entryType)} /></Field><Field label="Reason / note" wide><textarea rows="3" value={adjustment.description} onChange={(event) => setAdjustment({ ...adjustment, description: event.target.value })} placeholder="Why this adjustment is being made" /></Field><footer><button type="button" className="secondary" onClick={() => setAdjustment(null)}>Cancel</button><button className="primary" disabled={busy}><CircleDollarSign /> Apply {adjustment.direction}</button></footer></form></Modal>}

    {walletDraft && <Modal title={`${walletDraft.organizationName} wallet`} subtitle="Control availability, alerts and future automatic recharge policy" onClose={() => setWalletDraft(null)}><form className="modal-form" onSubmit={submitWallet}><Field label="Wallet status"><select value={walletDraft.status} onChange={(event) => setWalletDraft({ ...walletDraft, status: event.target.value })}><option value="active">Active</option><option value="frozen">Frozen</option></select></Field><Field label="Low-balance alert"><div className="suffix-input"><input type="number" min="0" step="0.01" value={walletDraft.lowBalance} onChange={(event) => setWalletDraft({ ...walletDraft, lowBalance: event.target.value })} /><span>{walletDraft.currency}</span></div></Field><div className="setting-line wide"><div><strong>Automatic recharge policy</strong><span>Stores the customer preference. Collection remains disabled until a payment provider is connected.</span></div><Toggle value={walletDraft.autoRechargeEnabled} onChange={(autoRechargeEnabled) => setWalletDraft({ ...walletDraft, autoRechargeEnabled })} /></div><Field label="Recharge below"><div className="suffix-input"><input type="number" min="0" step="0.01" value={walletDraft.autoRechargeThreshold} onChange={(event) => setWalletDraft({ ...walletDraft, autoRechargeThreshold: event.target.value })} /><span>{walletDraft.currency}</span></div></Field><Field label="Recharge amount"><div className="suffix-input"><input type="number" min="0" step="0.01" value={walletDraft.autoRechargeAmount} onChange={(event) => setWalletDraft({ ...walletDraft, autoRechargeAmount: event.target.value })} /><span>{walletDraft.currency}</span></div></Field><footer><button type="button" className="secondary" onClick={() => setWalletDraft(null)}>Cancel</button><button className="primary" disabled={busy}><Save /> Save controls</button></footer></form></Modal>}

    {packageDraft && <Modal title={packageDraft.id ? 'Edit top-up package' : 'Create top-up package'} subtitle="Define what the customer pays and the credit they receive" onClose={() => setPackageDraft(null)}><form className="modal-form" onSubmit={submitPackage}><Field label="Package name" wide><input value={packageDraft.label} onChange={(event) => setPackageDraft({ ...packageDraft, label: event.target.value })} required /></Field><Field label="Customer pays"><div className="suffix-input"><input type="number" min="0.01" step="0.01" value={packageDraft.amount} onChange={(event) => setPackageDraft({ ...packageDraft, amount: event.target.value })} /><span>{settings.currency}</span></div></Field><Field label="Calling credit"><div className="suffix-input"><input type="number" min="0.01" step="0.01" value={packageDraft.credit} onChange={(event) => setPackageDraft({ ...packageDraft, credit: event.target.value })} /><span>{settings.currency}</span></div></Field><Field label="Display order"><input type="number" min="0" value={packageDraft.sortOrder} onChange={(event) => setPackageDraft({ ...packageDraft, sortOrder: Number(event.target.value) })} /></Field><div className="setting-line"><div><strong>Available to customers</strong><span>Hidden packages remain in historical records.</span></div><Toggle value={packageDraft.active} onChange={(active) => setPackageDraft({ ...packageDraft, active })} /></div><footer><button type="button" className="secondary" onClick={() => setPackageDraft(null)}>Cancel</button><button className="primary" disabled={busy}><Save /> Save package</button></footer></form></Modal>}

    {ruleDraft && <Modal title={ruleDraft.id ? 'Edit destination rule' : 'Add destination rule'} subtitle="Calculate a retail rate from carrier cost and Vocivo policy" onClose={() => setRuleDraft(null)}><form className="modal-form" onSubmit={submitRule}><Field label="Destination" wide><select value={ruleDraft.countryCode} onChange={(event) => { const country = countries.find((item) => item.country_code === event.target.value); setRuleDraft({ ...ruleDraft, countryCode: event.target.value, destinationName: country?.country_name || event.target.value }); }}>{countries.map((item) => <option key={item.country_code} value={item.country_code}>{item.country_name} ({item.country_code})</option>)}</select></Field><Field label="Carrier wholesale / minute"><div className="suffix-input"><input type="number" min="0" step="0.0001" value={Number(ruleDraft.wholesaleRateMicros) / 1_000_000} onChange={(event) => setRuleDraft({ ...ruleDraft, wholesaleRateMicros: amountMicros(event.target.value) })} /><span>USD</span></div></Field><Field label="Margin override" help="Leave blank to use the global target."><div className="suffix-input"><input type="number" min="0" max="90" step="0.1" value={ruleDraft.grossMarginBps === null ? '' : percent(ruleDraft.grossMarginBps)} onChange={(event) => setRuleDraft({ ...ruleDraft, grossMarginBps: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) })} /><span>%</span></div></Field><Field label="Per-minute surcharge"><div className="suffix-input"><input type="number" min="0" step="0.0001" value={Number(ruleDraft.surchargeMicros) / 1_000_000} onChange={(event) => setRuleDraft({ ...ruleDraft, surchargeMicros: amountMicros(event.target.value) })} /><span>USD</span></div></Field><Field label="Calculated retail rate"><input value={`${rate(draftRetail)} / minute`} readOnly /></Field><div className="setting-line wide"><div><strong>Publish this rule</strong><span>Only active rules are eligible for customer rate presentation.</span></div><Toggle value={ruleDraft.active} onChange={(active) => setRuleDraft({ ...ruleDraft, active })} /></div><footer><button type="button" className="secondary" onClick={() => setRuleDraft(null)}>Cancel</button><button className="primary" disabled={busy}><Save /> Save rate rule</button></footer></form></Modal>}
  </div>;
}
