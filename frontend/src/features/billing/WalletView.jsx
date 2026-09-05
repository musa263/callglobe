import { CreditCard, Check, CircleDollarSign, ShieldCheck, WalletCards } from "lucide-react";

export function WalletView({ balance }) {
  return <section className="content-view wallet-view">
    <header className="workspace-header"><div><p className="eyebrow">CALLING CREDIT</p><h1>Top up balance</h1></div></header>
    <div className="wallet-layout">
      <div className="wallet-balance"><span className="balance-icon"><CircleDollarSign size={21} /></span><div><small>AVAILABLE VOCIVO CREDIT</small><strong>{Number.isFinite(balance) ? `$${balance.toFixed(2)}` : 'Organization managed'}</strong><p>Eligible call charges are deducted from your Vocivo wallet.</p></div><span>USD</span></div>
      <div className="payment-panel">
        <div className="payment-heading"><span><CreditCard size={20} /></span><div><h2>Vocivo billing</h2><p>Calling credit and subscription payments are managed by Vocivo without exposing the underlying carrier account.</p></div></div>
        <div className="payment-facts"><span><Check size={16} /><strong>Account</strong><small>Vocivo calling credit</small></span><span><ShieldCheck size={16} /><strong>Payment security</strong><small>Secure billing support</small></span><span><WalletCards size={16} /><strong>Currency</strong><small>USD</small></span></div>
        <button className="topup-button" onClick={() => window.location.href = 'mailto:billing@vocivo.app?subject=Vocivo%20calling%20credit'}><CreditCard size={19} /> Contact Vocivo billing</button>
        <p className="payment-note">Online self-service payment processing will be enabled when the Vocivo billing provider is connected.</p>
      </div>
    </div>
  </section>;
}
