import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Globe2,
  Headphones,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Network,
  Phone,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import './landing.css';

const capabilities = [
  { icon: PhoneCall, title: 'Global voice', copy: 'Personal and business calling across mobile, web and desk-phone environments.' },
  { icon: Network, title: 'Company extensions', copy: 'Private extension calling, transfer, hold, call waiting and free colleague-to-colleague calls.' },
  { icon: Users, title: 'Meetings and conferences', copy: 'Add, merge and manage participants with clear controls for every active line.' },
  { icon: Bot, title: 'Intelligent reception', copy: 'Create greetings, voice menus, call routing and AI-assisted customer conversations.' },
  { icon: MessageSquareText, title: 'Business messaging', copy: 'Keep customer and team conversations organized across dedicated threads.' },
  { icon: Video, title: 'Video collaboration', copy: 'Move naturally from voice to face-to-face conversations on supported devices.' },
];

const operatingPoints = [
  'One identity across iPhone, Android and web',
  'Tenant controls for companies, teams and roles',
  'Programmable SIP trunks and business numbers',
  'Call queues, IVR, voicemail and office hours',
];

function Brand() {
  return <a className="landing-brand" href="#top" aria-label="Vocivo home"><img src="/vocivo-icon-192.png" alt="" /><span>Vocivo</span></a>;
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="landing-page" id="top">
      <header className="landing-header">
        <Brand />
        <nav className={menuOpen ? 'landing-nav open' : 'landing-nav'} aria-label="Primary navigation">
          <a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a>
          <a href="#business" onClick={() => setMenuOpen(false)}>Business</a>
          <a href="#security" onClick={() => setMenuOpen(false)}>Security</a>
          <a className="nav-login" href="/">Sign in</a>
          <a className="nav-cta" href="/#preview">Explore Vocivo <ArrowRight size={16} /></a>
        </nav>
        <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-kicker"><span /> CLOUD COMMUNICATIONS, SIMPLIFIED</p>
            <h1 id="hero-title">Vocivo</h1>
            <p className="hero-slogan">Connect. Talk. Anywhere.</p>
            <p className="hero-summary">A secure calling platform that brings personal voice, company extensions, messaging, conferences and intelligent reception into one beautifully simple workspace.</p>
            <div className="hero-actions">
              <a className="primary-action" href="/">Open web phone <ArrowRight size={18} /></a>
              <a className="secondary-action" href="#platform">See the platform <ChevronRight size={18} /></a>
            </div>
            <div className="hero-proof" aria-label="Platform availability">
              <span><Check size={15} /> iOS and Android</span>
              <span><Check size={15} /> Browser calling</span>
              <span><Check size={15} /> Business PBX</span>
            </div>
          </div>
        </section>

        <section className="signal-band" aria-label="Vocivo platform highlights">
          <div><strong>200+</strong><span>destinations supported</span></div>
          <div><strong>5</strong><span>devices per extension</span></div>
          <div><strong>24/7</strong><span>business availability</span></div>
          <div><strong>One</strong><span>communications workspace</span></div>
        </section>

        <section className="platform-section" id="platform">
          <div className="section-intro">
            <p className="section-label">THE VOCIVO PLATFORM</p>
            <h2>Serious communications, without the complexity.</h2>
            <p>Vocivo gives individuals, growing teams and international companies the controls they expect from an enterprise phone system, presented in a calm, modern interface.</p>
          </div>
          <div className="capability-grid">
            {capabilities.map(({ icon: Icon, title, copy }) => <article key={title} className="capability-item"><span><Icon /></span><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <section className="workspace-section" id="business">
          <div className="workspace-copy">
            <p className="section-label">BUILT FOR BUSINESS</p>
            <h2>Your company phone system, wherever your people work.</h2>
            <p>Give every employee an extension and professional identity. Route one company number across teams, devices and locations, while administrators stay in control.</p>
            <ul>{operatingPoints.map((point) => <li key={point}><Check /> <span>{point}</span></li>)}</ul>
            <a href="/admin">Open administration <ArrowRight size={17} /></a>
          </div>
          <div className="product-stage" aria-label="Vocivo active call interface preview">
            <div className="product-topbar"><span><img src="/vocivo-icon-192.png" alt="" /> VOCIVO VOICE</span><em>HD</em></div>
            <div className="product-call">
              <span className="call-avatar"><Building2 /></span>
              <p>Global Heritage</p>
              <h3>Mousa · Extension 2000</h3>
              <strong>CONNECTED</strong>
              <time>08:42</time>
            </div>
            <div className="product-controls">
              <button title="Mute"><Headphones /><span>Audio</span></button>
              <button title="Add caller"><Users /><span>Add</span></button>
              <button title="Messages"><MessageSquareText /><span>Message</span></button>
              <button title="Video"><Video /><span>Video</span></button>
            </div>
            <div className="active-device"><span><Phone size={17} /></span><div><strong>Ringing everywhere you work</strong><small>iPhone · Web · Desk phone</small></div><em>3 devices</em></div>
          </div>
        </section>

        <section className="control-section">
          <div className="section-intro compact">
            <p className="section-label">ONE PLATFORM, CLEAR CONTROL</p>
            <h2>Personal when you need it. Powerful when business calls.</h2>
          </div>
          <div className="control-columns">
            <article><Globe2 /><p>PERSONAL</p><h3>Call the world with confidence.</h3><span>Select your identity, see destination pricing and keep your contacts and recent calls close.</span></article>
            <article><Building2 /><p>BUSINESS</p><h3>Operate as one connected company.</h3><span>Extensions, departments, transfer, queues, voicemail, conference calling and role-based administration.</span></article>
            <article><Sparkles /><p>INTELLIGENCE</p><h3>Make every incoming call useful.</h3><span>Welcome prompts, voice menus and configurable AI reception help customers reach the right answer faster.</span></article>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="security-heading"><ShieldCheck /><div><p className="section-label">SECURITY AND RELIABILITY</p><h2>Built with business trust in mind.</h2></div></div>
          <div className="security-points">
            <div><LockKeyhole /><span><strong>Tenant isolation</strong><small>Company data, users and permissions remain scoped to their organization.</small></span></div>
            <div><ShieldCheck /><span><strong>Controlled access</strong><small>Superadmin, company admin and employee roles receive the right level of control.</small></span></div>
            <div><Network /><span><strong>Carrier-ready architecture</strong><small>Programmable voice, SIP interoperability and resilient device registration.</small></span></div>
          </div>
        </section>

        <section className="closing-section">
          <p className="section-label">COMMUNICATION SHOULD MOVE WITH YOU</p>
          <h2>Bring every conversation into Vocivo.</h2>
          <p>Connect your people, customers and calling infrastructure through one modern platform.</p>
          <a href="/">Launch Vocivo <ArrowRight size={18} /></a>
        </section>
      </main>

      <footer className="landing-footer"><Brand /><p>Connect. Talk. Anywhere.</p><div><a href="/">Web phone</a><a href="/admin">Administration</a><a href="#security">Security</a></div><small>© {new Date().getFullYear()} Vocivo. All rights reserved.</small></footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('landing-root')).render(<React.StrictMode><LandingPage /></React.StrictMode>);
