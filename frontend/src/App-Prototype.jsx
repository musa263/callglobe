import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// CALLGLOBE — Global VoIP Calling App
// ============================================================

// Country data with calling codes and per-minute rates (USD)
const COUNTRIES = [
  { code: "US", name: "United States", dial: "+1", flag: "🇺🇸", rate: 0.01 },
  { code: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧", rate: 0.012 },
  { code: "SA", name: "Saudi Arabia", dial: "+966", flag: "🇸🇦", rate: 0.015 },
  { code: "IN", name: "India", dial: "+91", flag: "🇮🇳", rate: 0.008 },
  { code: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰", rate: 0.02 },
  { code: "PH", name: "Philippines", dial: "+63", flag: "🇵🇭", rate: 0.015 },
  { code: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩", rate: 0.018 },
  { code: "EG", name: "Egypt", dial: "+20", flag: "🇪🇬", rate: 0.02 },
  { code: "AE", name: "UAE", dial: "+971", flag: "🇦🇪", rate: 0.012 },
  { code: "DE", name: "Germany", dial: "+49", flag: "🇩🇪", rate: 0.01 },
  { code: "FR", name: "France", dial: "+33", flag: "🇫🇷", rate: 0.01 },
  { code: "CN", name: "China", dial: "+86", flag: "🇨🇳", rate: 0.012 },
  { code: "JP", name: "Japan", dial: "+81", flag: "🇯🇵", rate: 0.015 },
  { code: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬", rate: 0.025 },
  { code: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪", rate: 0.022 },
  { code: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷", rate: 0.018 },
  { code: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽", rate: 0.015 },
  { code: "TR", name: "Turkey", dial: "+90", flag: "🇹🇷", rate: 0.02 },
  { code: "ID", name: "Indonesia", dial: "+62", flag: "🇮🇩", rate: 0.018 },
  { code: "TH", name: "Thailand", dial: "+66", flag: "🇹🇭", rate: 0.015 },
  { code: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵", rate: 0.025 },
  { code: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰", rate: 0.022 },
  { code: "ET", name: "Ethiopia", dial: "+251", flag: "🇪🇹", rate: 0.03 },
  { code: "GH", name: "Ghana", dial: "+233", flag: "🇬🇭", rate: 0.025 },
  { code: "CA", name: "Canada", dial: "+1", flag: "🇨🇦", rate: 0.01 },
  { code: "AU", name: "Australia", dial: "+61", flag: "🇦🇺", rate: 0.012 },
  { code: "KR", name: "South Korea", dial: "+82", flag: "🇰🇷", rate: 0.012 },
  { code: "JO", name: "Jordan", dial: "+962", flag: "🇯🇴", rate: 0.02 },
  { code: "LB", name: "Lebanon", dial: "+961", flag: "🇱🇧", rate: 0.025 },
  { code: "IQ", name: "Iraq", dial: "+964", flag: "🇮🇶", rate: 0.03 },
].sort((a, b) => a.name.localeCompare(b.name));

const RECHARGE_OPTIONS = [
  { amount: 10, bonus: 0, label: "$10" },
  { amount: 20, bonus: 5, label: "$20" },
  { amount: 30, bonus: 10, label: "$30" },
  { amount: 50, bonus: 20, label: "$50" },
  { amount: 100, bonus: 30, label: "$100" },
];

// Simulated call history
const INITIAL_HISTORY = [];

const formatDuration = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatTime = (date) => {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (date) => {
  const d = new Date(date);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// ============================================================
// MAIN APP
// ============================================================
export default function CallGlobeApp() {
  const [screen, setScreen] = useState("splash");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState({ name: "", email: "", phone: "" });
  const [balance, setBalance] = useState(0);
  const [callHistory, setCallHistory] = useState(INITIAL_HISTORY);
  const [activeTab, setActiveTab] = useState("dialer");

  // Referral states
  const [referralCode, setReferralCode] = useState("");
  const [referrals, setReferrals] = useState([]);
  const [referralEarnings, setReferralEarnings] = useState(0);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);

  // Auth states
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authName, setAuthName] = useState("");

  // Dialer states
  const [dialNumber, setDialNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES.find(c => c.code === "US"));
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  // Call states
  const [callActive, setCallActive] = useState(false);
  const [callConnected, setCallConnected] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callMuted, setCallMuted] = useState(false);
  const [callSpeaker, setCallSpeaker] = useState(false);
  const [callDirection, setCallDirection] = useState("outbound"); // "outbound" | "inbound"
  const callTimerRef = useRef(null);

  // Inbound call states
  const [incomingCall, setIncomingCall] = useState(null); // { from, fromName }
  const [myNumbers, setMyNumbers] = useState([]); // user's purchased numbers
  const [activeCallerId, setActiveCallerId] = useState(null); // selected number for outbound caller ID
  const [showMyNumber, setShowMyNumber] = useState(false);
  const [showNumberManager, setShowNumberManager] = useState(false);
  const [numberSearch, setNumberSearch] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState([
    { id: "us1", number: "+1 (213) 555-0147", country: "US", flag: "🇺🇸", monthly: 1.00 },
    { id: "us2", number: "+1 (347) 555-0192", country: "US", flag: "🇺🇸", monthly: 1.00 },
    { id: "us3", number: "+1 (786) 555-0284", country: "US", flag: "🇺🇸", monthly: 1.00 },
    { id: "uk1", number: "+44 20 7946 0958", country: "UK", flag: "🇬🇧", monthly: 1.50 },
    { id: "uk2", number: "+44 20 7946 0321", country: "UK", flag: "🇬🇧", monthly: 1.50 },
    { id: "ng1", number: "+234 805 123 4567", country: "NG", flag: "🇳🇬", monthly: 2.00 },
    { id: "ng2", number: "+234 705 987 6543", country: "NG", flag: "🇳🇬", monthly: 2.00 },
    { id: "ng3", number: "+234 812 345 6789", country: "NG", flag: "🇳🇬", monthly: 2.00 },
    { id: "de1", number: "+49 30 1234 5678", country: "DE", flag: "🇩🇪", monthly: 1.50 },
    { id: "fr1", number: "+33 1 23 45 67 89", country: "FR", flag: "🇫🇷", monthly: 1.50 },
    { id: "sa1", number: "+966 50 123 4567", country: "SA", flag: "🇸🇦", monthly: 2.50 },
    { id: "sa2", number: "+966 55 987 6543", country: "SA", flag: "🇸🇦", monthly: 2.50 },
    { id: "in1", number: "+91 98765 43210", country: "IN", flag: "🇮🇳", monthly: 1.00 },
    { id: "in2", number: "+91 87654 32109", country: "IN", flag: "🇮🇳", monthly: 1.00 },
    { id: "pk1", number: "+92 300 123 4567", country: "PK", flag: "🇵🇰", monthly: 1.50 },
    { id: "ph1", number: "+63 917 123 4567", country: "PH", flag: "🇵🇭", monthly: 1.50 },
    { id: "eg1", number: "+20 10 1234 5678", country: "EG", flag: "🇪🇬", monthly: 1.50 },
  ]);

  // Recharge states
  const [selectedRecharge, setSelectedRecharge] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Rates search
  const [ratesSearch, setRatesSearch] = useState("");

  // Splash screen
  useEffect(() => {
    if (screen === "splash") {
      const timer = setTimeout(() => setScreen("auth"), 2000);
      return () => clearTimeout(timer);
    }
  }, [screen]);

  // Call timer
  useEffect(() => {
    if (callConnected) {
      callTimerRef.current = setInterval(() => {
        setCallDuration((d) => {
          const newD = d + 1;
          // Deduct balance every 60 seconds
          if (newD % 60 === 0) {
            setBalance((b) => Math.max(0, +(b - selectedCountry.rate).toFixed(3)));
          }
          return newD;
        });
      }, 1000);
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [callConnected, selectedCountry]);

  // Check balance during call
  useEffect(() => {
    if (callActive && balance <= 0) {
      endCall();
    }
  }, [balance, callActive]);

  const handleLogin = () => {
    if (authEmail && authPass) {
      const userName = authEmail.split("@")[0];
      setUser({ name: userName, email: authEmail, phone: "" });
      setBalance(2.5); // Free welcome credit
      setReferralCode(("CG-" + userName.slice(0,4) + Math.random().toString(36).slice(2,6)).toUpperCase());
      setIsLoggedIn(true);
      setScreen("app");
    }
  };

  const handleSignup = () => {
    if (authName && authEmail && authPass) {
      setUser({ name: authName, email: authEmail, phone: "" });
      setBalance(2.5);
      setReferralCode(("CG-" + authName.replace(/\s/g,'').slice(0,4) + Math.random().toString(36).slice(2,6)).toUpperCase());
      setIsLoggedIn(true);
      setScreen("app");
    }
  };

  const handleCopyReferral = () => {
    const shareUrl = `https://callglobe.app/join?ref=${referralCode}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
    }
    setReferralCopied(true);
    setTimeout(() => setReferralCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const msg = encodeURIComponent(
      `I'm using CallGlobe to call Nigeria for just $0.06/min — half the price of other apps! Sign up with my link and we both get $2 free credit:\n\nhttps://callglobe.app/join?ref=${referralCode}`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const handleShareSMS = () => {
    const msg = encodeURIComponent(
      `Try CallGlobe — cheap international calls! Use my code ${referralCode} and we both get $2 free. https://callglobe.app/join?ref=${referralCode}`
    );
    window.open(`sms:?body=${msg}`, "_blank");
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "CallGlobe — Cheap International Calls",
          text: `I'm using CallGlobe to call Nigeria for just $0.06/min! Sign up with my code ${referralCode} and we both get $2 free credit.`,
          url: `https://callglobe.app/join?ref=${referralCode}`,
        });
      } catch (e) { /* user cancelled */ }
    } else {
      handleCopyReferral();
    }
  };

  // Simulate incoming call (in production, this comes via Telnyx WebRTC push notification)
  const simulateIncomingCall = (toNumber) => {
    const callers = [
      { from: "+234 805 111 2233", fromName: "Mum (Lagos)" },
      { from: "+234 701 444 5566", fromName: "Brother (Abuja)" },
      { from: "+966 55 987 6543", fromName: "Ahmed" },
      { from: "+44 7700 900123", fromName: "Unknown" },
    ];
    const caller = callers[Math.floor(Math.random() * callers.length)];
    setIncomingCall({ ...caller, toNumber: toNumber || myNumbers[0]?.number || "Unknown" });
  };

  const answerCall = () => {
    if (!incomingCall) return;
    setCallActive(true);
    setCallDirection("inbound");
    setCallDuration(0);
    setIncomingCall(null);
    setTimeout(() => setCallConnected(true), 500);
  };

  const declineCall = () => {
    setIncomingCall(null);
  };

  const purchaseNumber = (num) => {
    // In production: Telnyx API to provision number
    const purchased = { ...num, purchasedAt: new Date().toISOString(), active: true };
    setMyNumbers(prev => [...prev, purchased]);
    // Remove from available
    setAvailableNumbers(prev => prev.filter(n => n.id !== num.id));
    // Set as active caller ID if first number
    if (myNumbers.length === 0) {
      setActiveCallerId(num.id);
    }
    setShowMyNumber(false);
    setNumberSearch("");
  };

  const removeNumber = (numId) => {
    const num = myNumbers.find(n => n.id === numId);
    if (num) {
      setMyNumbers(prev => prev.filter(n => n.id !== numId));
      setAvailableNumbers(prev => [...prev, num].sort((a, b) => a.country.localeCompare(b.country)));
      if (activeCallerId === numId) {
        const remaining = myNumbers.filter(n => n.id !== numId);
        setActiveCallerId(remaining.length > 0 ? remaining[0].id : null);
      }
    }
  };

  const setActiveNumber = (numId) => {
    setActiveCallerId(numId);
    setShowNumberManager(false);
  };

  const getActiveNumber = () => myNumbers.find(n => n.id === activeCallerId) || myNumbers[0] || null;

  const startCall = () => {
    if (!dialNumber || balance <= 0) return;
    setCallActive(true);
    setCallDirection("outbound");
    setCallDuration(0);
    // Simulate connection delay
    setTimeout(() => setCallConnected(true), 2500);
  };

  const endCall = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (callDuration > 0 || callConnected) {
      const isInbound = callDirection === "inbound";
      const cost = isInbound ? 0 : +(Math.ceil(callDuration / 60) * selectedCountry.rate).toFixed(3);
      setCallHistory((prev) => [
        {
          id: Date.now(),
          number: isInbound ? (incomingCall?.from || "Unknown") : selectedCountry.dial + dialNumber,
          country: isInbound ? "Incoming" : selectedCountry.name,
          flag: isInbound ? "📥" : selectedCountry.flag,
          duration: callDuration,
          cost,
          date: new Date().toISOString(),
          type: isInbound ? "incoming" : "outgoing",
        },
        ...prev,
      ]);
    }
    setCallActive(false);
    setCallConnected(false);
    setCallDuration(0);
    setCallMuted(false);
    setCallSpeaker(false);
    setCallDirection("outbound");
  };

  const handleRecharge = () => {
    if (!selectedRecharge) return;
    setShowPayment(true);
  };

  const processPayment = () => {
    setPaymentProcessing(true);
    setTimeout(() => {
      const total = selectedRecharge.amount + (selectedRecharge.amount * selectedRecharge.bonus) / 100;
      setBalance((b) => +(b + total).toFixed(2));
      setPaymentProcessing(false);
      setPaymentSuccess(true);
      setTimeout(() => {
        setShowPayment(false);
        setPaymentSuccess(false);
        setSelectedRecharge(null);
      }, 2000);
    }, 2500);
  };

  const dialPad = (digit) => {
    if (dialNumber.length < 15) setDialNumber((n) => n + digit);
  };

  const filteredCountries = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.dial.includes(countrySearch) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const filteredRates = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(ratesSearch.toLowerCase()) ||
      c.dial.includes(ratesSearch)
  );

  const estimatedMinutes = selectedCountry ? Math.floor(balance / selectedCountry.rate) : 0;

  // ============================================================
  // SPLASH SCREEN
  // ============================================================
  if (screen === "splash") {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "linear-gradient(160deg, #0a0a0a 0%, #1a0a2e 40%, #0d1b3e 70%, #0a0a0a 100%)",
        fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 24,
          background: "linear-gradient(135deg, #00d4aa, #0099ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 60px rgba(0, 212, 170, 0.3)",
          animation: "pulse 2s ease-in-out infinite",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <h1 style={{
          marginTop: 24, fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em",
          background: "linear-gradient(135deg, #00d4aa, #0099ff)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>CallGlobe</h1>
        <p style={{ color: "#5a6a7a", fontSize: 14, marginTop: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Call anywhere. Pay less.
        </p>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }`}</style>
      </div>
    );
  }

  // ============================================================
  // AUTH SCREEN
  // ============================================================
  if (screen === "auth") {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column",
        background: "linear-gradient(160deg, #0a0a0a 0%, #1a0a2e 40%, #0d1b3e 70%, #0a0a0a 100%)",
        fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif",
        color: "#fff", padding: "60px 24px 24px",
      }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: "0 auto 16px",
            background: "linear-gradient(135deg, #00d4aa, #0099ff)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>CallGlobe</h1>
          <p style={{ color: "#6a7a8a", marginTop: 6, fontSize: 14 }}>Affordable calls worldwide</p>
        </div>

        {/* Tab toggle */}
        <div style={{
          display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 12,
          padding: 4, marginBottom: 28,
        }}>
          {["login", "signup"].map((m) => (
            <button key={m} onClick={() => setAuthMode(m)} style={{
              flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
              background: authMode === m ? "rgba(0,212,170,0.15)" : "transparent",
              color: authMode === m ? "#00d4aa" : "#6a7a8a",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s",
            }}>
              {m === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {authMode === "signup" && (
            <input
              placeholder="Full Name"
              value={authName}
              onChange={(e) => setAuthName(e.target.value)}
              style={{
                padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 15, outline: "none",
              }}
            />
          )}
          <input
            placeholder="Email"
            type="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            style={{
              padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 15, outline: "none",
            }}
          />
          <input
            placeholder="Password"
            type="password"
            value={authPass}
            onChange={(e) => setAuthPass(e.target.value)}
            style={{
              padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 15, outline: "none",
            }}
          />
        </div>

        <button
          onClick={authMode === "login" ? handleLogin : handleSignup}
          style={{
            marginTop: 24, padding: "16px 0", borderRadius: 14, border: "none",
            background: "linear-gradient(135deg, #00d4aa, #0099ff)",
            color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 4px 24px rgba(0,212,170,0.25)",
          }}
        >
          {authMode === "login" ? "Log In" : "Create Account"}
        </button>

        {authMode === "signup" && (
          <p style={{ textAlign: "center", marginTop: 16, color: "#5a6a7a", fontSize: 13 }}>
            Get $2.50 free credit on signup!
          </p>
        )}
      </div>
    );
  }

  // ============================================================
  // INCOMING CALL OVERLAY
  // ============================================================
  if (incomingCall) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "40px 24px",
        background: "linear-gradient(160deg, #0a0a0a 0%, #0a1a2e 50%, #0a0a0a 100%)",
        fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", color: "#fff",
      }}>
        <style>{`@keyframes ringPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0,212,170,0.4); } 50% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(0,212,170,0); } }`}</style>
        <p style={{ color: "#00d4aa", fontSize: 13, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 30 }}>
          Incoming Call
        </p>
        <div style={{
          width: 100, height: 100, borderRadius: "50%", marginBottom: 24,
          background: "linear-gradient(135deg, rgba(0,212,170,0.15), rgba(0,153,255,0.15))",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "2px solid rgba(0,212,170,0.3)",
          animation: "ringPulse 1.5s ease-in-out infinite",
        }}>
          <span style={{ fontSize: 44 }}>📞</span>
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{incomingCall.fromName}</h2>
        <p style={{ color: "#6a7a8a", fontSize: 16, marginBottom: 8 }}>{incomingCall.from}</p>
        {myNumbers.length > 0 && incomingCall?.toNumber && (
          <p style={{ color: "#4a5a6a", fontSize: 13, marginBottom: 40 }}>
            to your number: {incomingCall.toNumber}
          </p>
        )}

        <div style={{ display: "flex", gap: 40 }}>
          {/* Decline */}
          <div style={{ textAlign: "center" }}>
            <button onClick={declineCall} style={{
              width: 68, height: 68, borderRadius: "50%", border: "none",
              background: "#ff3b3b", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 24px rgba(255,59,59,0.3)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
            <p style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8, fontWeight: 500 }}>Decline</p>
          </div>
          {/* Answer */}
          <div style={{ textAlign: "center" }}>
            <button onClick={answerCall} style={{
              width: 68, height: 68, borderRadius: "50%", border: "none",
              background: "linear-gradient(135deg, #00d4aa, #00b894)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 24px rgba(0,212,170,0.3)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
              </svg>
            </button>
            <p style={{ color: "#00d4aa", fontSize: 12, marginTop: 8, fontWeight: 500 }}>Answer</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // ACTIVE CALL SCREEN
  // ============================================================
  if (callActive) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "space-between", padding: "60px 24px 50px",
        background: "linear-gradient(160deg, #0a0a0a 0%, #0a1a2e 50%, #0a0a0a 100%)",
        fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", color: "#fff",
      }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: callConnected ? "#00d4aa" : "#f0a030", fontSize: 13, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {callConnected ? "Connected" : "Connecting..."}
          </p>
          <div style={{
            width: 90, height: 90, borderRadius: "50%", margin: "24px auto",
            background: "linear-gradient(135deg, rgba(0,212,170,0.15), rgba(0,153,255,0.15))",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "2px solid rgba(0,212,170,0.2)",
          }}>
            <span style={{ fontSize: 40 }}>{selectedCountry.flag}</span>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em" }}>
            {selectedCountry.dial} {dialNumber}
          </h2>
          <p style={{ color: "#5a6a7a", marginTop: 4, fontSize: 14 }}>{selectedCountry.name}</p>
          <p style={{
            fontSize: 40, fontWeight: 300, marginTop: 20, letterSpacing: "0.05em",
            fontVariantNumeric: "tabular-nums",
          }}>
            {formatDuration(callDuration)}
          </p>
          <p style={{ color: "#5a6a7a", fontSize: 13, marginTop: 4 }}>
            ${selectedCountry.rate}/min · Balance: ${balance.toFixed(2)}
          </p>
        </div>

        <div>
          {/* Call controls */}
          <div style={{ display: "flex", gap: 24, marginBottom: 40, justifyContent: "center" }}>
            {[
              { icon: callMuted ? "🔇" : "🎤", label: callMuted ? "Unmute" : "Mute", action: () => setCallMuted(!callMuted), active: callMuted },
              { icon: "⌨️", label: "Keypad", action: () => {}, active: false },
              { icon: callSpeaker ? "🔊" : "🔈", label: "Speaker", action: () => setCallSpeaker(!callSpeaker), active: callSpeaker },
            ].map((btn) => (
              <button key={btn.label} onClick={btn.action} style={{
                width: 64, height: 64, borderRadius: "50%", border: "none",
                background: btn.active ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.06)",
                color: btn.active ? "#00d4aa" : "#fff",
                fontSize: 22, cursor: "pointer", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
              }}>
                <span>{btn.icon}</span>
              </button>
            ))}
          </div>

          {/* End call */}
          <button onClick={endCall} style={{
            width: 72, height: 72, borderRadius: "50%", border: "none",
            background: "#ff3b3b", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", margin: "0 auto",
            boxShadow: "0 4px 30px rgba(255,59,59,0.3)",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // MAIN APP TABS
  // ============================================================
  const renderContent = () => {
    switch (activeTab) {
      case "dialer":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            {/* My Numbers card */}
            <div style={{
              background: myNumbers.length > 0 ? "rgba(0,212,170,0.06)" : "rgba(255,165,0,0.06)",
              borderRadius: 14, padding: "14px 16px", marginBottom: 12,
              border: `1px solid ${myNumbers.length > 0 ? "rgba(0,212,170,0.12)" : "rgba(255,165,0,0.12)"}`,
            }}>
              {myNumbers.length > 0 ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <p style={{ color: "#6a7a8a", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Caller ID ({myNumbers.length} number{myNumbers.length > 1 ? "s" : ""})
                    </p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => simulateIncomingCall()} style={{
                        padding: "5px 10px", borderRadius: 6, border: "none",
                        background: "rgba(0,212,170,0.12)", color: "#00d4aa",
                        fontSize: 10, fontWeight: 600, cursor: "pointer",
                      }}>Test Call</button>
                      <button onClick={() => setShowMyNumber(true)} style={{
                        padding: "5px 10px", borderRadius: 6, border: "none",
                        background: "rgba(255,255,255,0.06)", color: "#fff",
                        fontSize: 10, fontWeight: 600, cursor: "pointer",
                      }}>+ Add</button>
                    </div>
                  </div>

                  {/* Active caller ID selector */}
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                    {myNumbers.map((num) => (
                      <button key={num.id} onClick={() => setActiveNumber(num.id)} style={{
                        padding: "8px 12px", borderRadius: 10, border: "1px solid",
                        borderColor: activeCallerId === num.id ? "rgba(0,212,170,0.4)" : "rgba(255,255,255,0.06)",
                        background: activeCallerId === num.id ? "rgba(0,212,170,0.1)" : "rgba(255,255,255,0.02)",
                        color: "#fff", cursor: "pointer", whiteSpace: "nowrap",
                        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                        transition: "all 0.2s",
                      }}>
                        <span style={{ fontSize: 16 }}>{num.flag}</span>
                        <div style={{ textAlign: "left" }}>
                          <p style={{
                            fontSize: 12, fontWeight: 600,
                            color: activeCallerId === num.id ? "#00d4aa" : "#ccc",
                          }}>{num.number}</p>
                          <p style={{ fontSize: 9, color: "#5a6a7a" }}>
                            {activeCallerId === num.id ? "Active caller ID" : "Tap to use"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Manage numbers link */}
                  <button onClick={() => setShowNumberManager(true)} style={{
                    background: "none", border: "none", color: "#5a6a7a",
                    fontSize: 11, cursor: "pointer", marginTop: 8, padding: 0,
                    textDecoration: "underline",
                  }}>Manage my numbers</button>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#FFA500" }}>Get your own number</p>
                    <p style={{ color: "#6a7a8a", fontSize: 12, marginTop: 2 }}>Receive calls & choose your caller ID</p>
                  </div>
                  <button onClick={() => setShowMyNumber(true)} style={{
                    padding: "8px 14px", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #FFA500, #FF6B00)",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>Get Number</button>
                </div>
              )}
            </div>

            {/* Balance card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(0,212,170,0.08), rgba(0,153,255,0.08))",
              borderRadius: 18, padding: "18px 20px", marginBottom: 20,
              border: "1px solid rgba(0,212,170,0.1)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ color: "#6a7a8a", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>Balance</p>
                  <p style={{ fontSize: 28, fontWeight: 700, marginTop: 2, background: "linear-gradient(135deg, #00d4aa, #0099ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    ${balance.toFixed(2)}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ color: "#6a7a8a", fontSize: 12 }}>~{estimatedMinutes} min</p>
                  <p style={{ color: "#5a6a7a", fontSize: 11 }}>to {selectedCountry.name}</p>
                </div>
              </div>
            </div>

            {/* Country selector + number display */}
            <div style={{
              background: "rgba(255,255,255,0.03)", borderRadius: 16,
              padding: "14px 16px", marginBottom: 16,
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setShowCountryPicker(true)} style={{
                  background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
                  padding: "8px 12px", color: "#fff", fontSize: 15, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                }}>
                  <span style={{ fontSize: 20 }}>{selectedCountry.flag}</span>
                  <span style={{ fontWeight: 600 }}>{selectedCountry.dial}</span>
                  <span style={{ color: "#5a6a7a", fontSize: 12 }}>▼</span>
                </button>
                <div style={{
                  flex: 1, fontSize: 22, fontWeight: 600, letterSpacing: "0.03em",
                  color: dialNumber ? "#fff" : "#3a4a5a", minHeight: 32,
                  display: "flex", alignItems: "center",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {dialNumber || "Enter number"}
                </div>
                {dialNumber && (
                  <button onClick={() => setDialNumber((n) => n.slice(0, -1))} style={{
                    background: "none", border: "none", color: "#6a7a8a", fontSize: 18,
                    cursor: "pointer", padding: "4px 8px",
                  }}>⌫</button>
                )}
              </div>
              {dialNumber && (
                <p style={{ color: "#5a6a7a", fontSize: 12, marginTop: 8, marginLeft: 4 }}>
                  Rate: ${selectedCountry.rate}/min to {selectedCountry.name}
                </p>
              )}
            </div>

            {/* Dial pad */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10, maxWidth: 300, margin: "0 auto",
            }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                <button key={d} onClick={() => dialPad(d)} style={{
                  height: 56, borderRadius: 16, border: "none",
                  background: "rgba(255,255,255,0.04)", color: "#fff",
                  fontSize: 22, fontWeight: 500, cursor: "pointer",
                  transition: "all 0.15s",
                }}
                  onMouseDown={(e) => e.currentTarget.style.background = "rgba(0,212,170,0.15)"}
                  onMouseUp={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                >
                  {d}
                </button>
              ))}
            </div>

            {/* Call button */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button
                onClick={startCall}
                disabled={!dialNumber || balance <= 0}
                style={{
                  width: 64, height: 64, borderRadius: "50%", border: "none",
                  background: dialNumber && balance > 0
                    ? "linear-gradient(135deg, #00d4aa, #00b894)"
                    : "rgba(255,255,255,0.06)",
                  cursor: dialNumber && balance > 0 ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: dialNumber && balance > 0 ? "0 4px 24px rgba(0,212,170,0.3)" : "none",
                  transition: "all 0.2s",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
              </button>
            </div>

            {/* Country Picker Modal */}
            {showCountryPicker && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.85)", zIndex: 100,
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ padding: "50px 20px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => { setShowCountryPicker(false); setCountrySearch(""); }}
                    style={{ background: "none", border: "none", color: "#00d4aa", fontSize: 16, cursor: "pointer" }}>
                    ← Back
                  </button>
                  <input
                    placeholder="Search country or code..."
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    autoFocus
                    style={{
                      flex: 1, padding: "10px 14px", borderRadius: 10,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#fff", fontSize: 14, outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
                  {filteredCountries.map((c) => (
                    <button key={c.code + c.dial} onClick={() => {
                      setSelectedCountry(c);
                      setShowCountryPicker(false);
                      setCountrySearch("");
                    }} style={{
                      display: "flex", alignItems: "center", gap: 14, width: "100%",
                      padding: "14px 8px", background: "none", border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      color: "#fff", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ fontSize: 24 }}>{c.flag}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 15, fontWeight: 500 }}>{c.name}</p>
                        <p style={{ color: "#5a6a7a", fontSize: 13 }}>{c.dial}</p>
                      </div>
                      <span style={{ color: "#00d4aa", fontSize: 13, fontWeight: 600 }}>
                        ${c.rate}/min
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Number Selection Modal */}
            {showMyNumber && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.92)", zIndex: 100,
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ padding: "50px 20px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => setShowMyNumber(false)}
                    style={{ background: "none", border: "none", color: "#00d4aa", fontSize: 16, cursor: "pointer" }}>
                    ← Back
                  </button>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 17 }}>Get a Phone Number</p>
                    <p style={{ color: "#5a6a7a", fontSize: 12 }}>Choose a number people can call you on</p>
                  </div>
                </div>

                <div style={{ padding: "0 20px 12px" }}>
                  <input
                    placeholder="Search by country..."
                    value={numberSearch}
                    onChange={(e) => setNumberSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ padding: "0 20px 8px" }}>
                  <div style={{
                    background: "rgba(0,212,170,0.06)", borderRadius: 10, padding: "10px 14px",
                    border: "1px solid rgba(0,212,170,0.1)",
                  }}>
                    <p style={{ color: "#00d4aa", fontSize: 12, fontWeight: 600 }}>How it works</p>
                    <p style={{ color: "#7a8a9a", fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                      Get a real phone number in any country. Anyone can call this number from a regular phone — it rings in your CallGlobe app over WiFi/data. Incoming calls are FREE.
                    </p>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
                  {availableNumbers
                    .filter(n => n.country.toLowerCase().includes(numberSearch.toLowerCase()) || n.number.includes(numberSearch))
                    .map((num, i) => (
                    <button key={i} onClick={() => purchaseNumber(num)} style={{
                      display: "flex", alignItems: "center", gap: 14, width: "100%",
                      padding: "16px 8px", background: "none", border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      color: "#fff", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ fontSize: 28 }}>{num.flag}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.02em" }}>{num.number}</p>
                        <p style={{ color: "#5a6a7a", fontSize: 12, marginTop: 2 }}>{num.country} · Incoming calls FREE</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ color: "#00d4aa", fontSize: 14, fontWeight: 700 }}>${num.monthly.toFixed(2)}</p>
                        <p style={{ color: "#4a5a6a", fontSize: 10 }}>per month</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Number Manager Modal */}
            {showNumberManager && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.92)", zIndex: 100,
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ padding: "50px 20px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => setShowNumberManager(false)}
                    style={{ background: "none", border: "none", color: "#00d4aa", fontSize: 16, cursor: "pointer" }}>
                    ← Back
                  </button>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 17 }}>My Numbers</p>
                    <p style={{ color: "#5a6a7a", fontSize: 12 }}>{myNumbers.length} active number{myNumbers.length !== 1 ? "s" : ""}</p>
                  </div>
                  <button onClick={() => { setShowNumberManager(false); setShowMyNumber(true); }} style={{
                    padding: "8px 14px", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #00d4aa, #0099ff)",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>+ Add Number</button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
                  {myNumbers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "60px 0", color: "#4a5a6a" }}>
                      <p style={{ fontSize: 40, marginBottom: 12 }}>📱</p>
                      <p style={{ fontSize: 15, fontWeight: 500 }}>No numbers yet</p>
                      <p style={{ fontSize: 13, marginTop: 4, color: "#3a4a5a" }}>Add a number to receive calls and set caller ID</p>
                    </div>
                  ) : (
                    myNumbers.map((num) => (
                      <div key={num.id} style={{
                        padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <span style={{ fontSize: 28 }}>{num.flag}</span>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 16, fontWeight: 600 }}>{num.number}</p>
                            <p style={{ color: "#5a6a7a", fontSize: 12 }}>
                              {num.country} · ${num.monthly.toFixed(2)}/mo
                              {activeCallerId === num.id && (
                                <span style={{ color: "#00d4aa", fontWeight: 600 }}> · Active Caller ID</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 10, marginLeft: 42 }}>
                          {activeCallerId !== num.id && (
                            <button onClick={() => setActiveNumber(num.id)} style={{
                              padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)",
                              background: "rgba(0,212,170,0.06)", color: "#00d4aa",
                              fontSize: 12, fontWeight: 600, cursor: "pointer",
                            }}>Set as Caller ID</button>
                          )}
                          <button onClick={() => simulateIncomingCall(num.number)} style={{
                            padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.03)", color: "#aaa",
                            fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}>Test Call</button>
                          <button onClick={() => removeNumber(num.id)} style={{
                            padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,59,59,0.15)",
                            background: "rgba(255,59,59,0.06)", color: "#ff6b6b",
                            fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}>Remove</button>
                        </div>
                      </div>
                    ))
                  )}

                  <div style={{
                    background: "rgba(255,255,255,0.02)", borderRadius: 12,
                    padding: "14px 16px", marginTop: 20,
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#6a7a8a", marginBottom: 6 }}>About your numbers</p>
                    <p style={{ fontSize: 11, color: "#4a5a6a", lineHeight: 1.5 }}>
                      Each number can receive calls from anywhere in the world — incoming calls are always FREE.
                      Your active Caller ID is the number that shows when you make outbound calls.
                      Numbers are billed monthly to your balance.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "history":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, letterSpacing: "-0.01em" }}>Call History</h2>
            {callHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#4a5a6a" }}>
                <p style={{ fontSize: 40, marginBottom: 12 }}>📞</p>
                <p style={{ fontSize: 15, fontWeight: 500 }}>No calls yet</p>
                <p style={{ fontSize: 13, marginTop: 4, color: "#3a4a5a" }}>Your call history will appear here</p>
              </div>
            ) : (
              callHistory.map((call) => (
                <div key={call.id} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <span style={{ fontSize: 28 }}>{call.flag}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 15, fontWeight: 600 }}>{call.number}</p>
                    <p style={{ color: "#5a6a7a", fontSize: 13 }}>
                      {call.country} · {formatDuration(call.duration)}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "#ff6b6b", fontSize: 14, fontWeight: 600 }}>-${call.cost.toFixed(2)}</p>
                    <p style={{ color: "#4a5a6a", fontSize: 12 }}>{formatDate(call.date)} {formatTime(call.date)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        );

      case "recharge":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.01em" }}>Recharge</h2>
            <p style={{ color: "#5a6a7a", fontSize: 14, marginBottom: 20 }}>
              Current balance: <span style={{ color: "#00d4aa", fontWeight: 700 }}>${balance.toFixed(2)}</span>
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {RECHARGE_OPTIONS.map((opt) => (
                <button key={opt.amount} onClick={() => setSelectedRecharge(opt)} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "16px 18px", borderRadius: 14, border: "1px solid",
                  borderColor: selectedRecharge?.amount === opt.amount
                    ? "rgba(0,212,170,0.4)" : "rgba(255,255,255,0.06)",
                  background: selectedRecharge?.amount === opt.amount
                    ? "rgba(0,212,170,0.08)" : "rgba(255,255,255,0.02)",
                  color: "#fff", cursor: "pointer", textAlign: "left",
                  transition: "all 0.2s",
                }}>
                  <div>
                    <p style={{ fontSize: 20, fontWeight: 700 }}>{opt.label}</p>
                    {opt.bonus > 0 && (
                      <p style={{ color: "#00d4aa", fontSize: 13, marginTop: 2 }}>
                        +{opt.bonus}% bonus credit
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 15, fontWeight: 600 }}>
                      ${(opt.amount + (opt.amount * opt.bonus) / 100).toFixed(2)}
                    </p>
                    <p style={{ color: "#5a6a7a", fontSize: 12 }}>total credit</p>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={handleRecharge} disabled={!selectedRecharge} style={{
              width: "100%", marginTop: 20, padding: "16px 0", borderRadius: 14,
              border: "none", fontSize: 16, fontWeight: 700, cursor: selectedRecharge ? "pointer" : "default",
              background: selectedRecharge
                ? "linear-gradient(135deg, #00d4aa, #0099ff)"
                : "rgba(255,255,255,0.06)",
              color: selectedRecharge ? "#fff" : "#4a5a6a",
              boxShadow: selectedRecharge ? "0 4px 24px rgba(0,212,170,0.25)" : "none",
              transition: "all 0.2s",
            }}>
              {selectedRecharge ? `Pay $${selectedRecharge.amount} with Stripe` : "Select an amount"}
            </button>

            {/* Payment Modal */}
            {showPayment && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.9)", zIndex: 100,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 24,
              }}>
                <div style={{
                  background: "#141420", borderRadius: 20, padding: 28,
                  width: "100%", maxWidth: 360,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  {paymentSuccess ? (
                    <div style={{ textAlign: "center", padding: "20px 0" }}>
                      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                      <h3 style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Payment Successful!</h3>
                      <p style={{ color: "#00d4aa", fontSize: 15, marginTop: 8 }}>
                        ${(selectedRecharge.amount + (selectedRecharge.amount * selectedRecharge.bonus) / 100).toFixed(2)} added to your balance
                      </p>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Payment</h3>
                        <button onClick={() => { setShowPayment(false); setPaymentProcessing(false); }}
                          style={{ background: "none", border: "none", color: "#6a7a8a", fontSize: 20, cursor: "pointer" }}>✕</button>
                      </div>
                      <div style={{
                        background: "rgba(255,255,255,0.04)", borderRadius: 12,
                        padding: "14px 16px", marginBottom: 20,
                      }}>
                        <p style={{ color: "#6a7a8a", fontSize: 12 }}>Amount</p>
                        <p style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>${selectedRecharge?.amount}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                        <input placeholder="Card Number" defaultValue="4242 4242 4242 4242" style={{
                          padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, outline: "none",
                        }} />
                        <div style={{ display: "flex", gap: 12 }}>
                          <input placeholder="MM/YY" defaultValue="12/28" style={{
                            flex: 1, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, outline: "none",
                          }} />
                          <input placeholder="CVC" defaultValue="123" style={{
                            flex: 1, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, outline: "none",
                          }} />
                        </div>
                      </div>
                      <button onClick={processPayment} disabled={paymentProcessing} style={{
                        width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
                        background: "linear-gradient(135deg, #00d4aa, #0099ff)",
                        color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
                      }}>
                        {paymentProcessing ? "Processing..." : `Pay $${selectedRecharge?.amount}`}
                      </button>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 }}>
                        <span style={{ fontSize: 12 }}>🔒</span>
                        <span style={{ color: "#4a5a6a", fontSize: 12 }}>Secured by Stripe</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case "rates":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, letterSpacing: "-0.01em" }}>Call Rates</h2>
            <input
              placeholder="Search country..."
              value={ratesSearch}
              onChange={(e) => setRatesSearch(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12, marginBottom: 16,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
            <div>
              {filteredRates.map((c) => (
                <div key={c.code + c.dial} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <span style={{ fontSize: 24 }}>{c.flag}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</p>
                    <p style={{ color: "#5a6a7a", fontSize: 12 }}>{c.dial}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "#00d4aa", fontSize: 15, fontWeight: 700 }}>${c.rate}</p>
                    <p style={{ color: "#4a5a6a", fontSize: 11 }}>per min</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "numbers":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>My Numbers</h2>
                <p style={{ color: "#5a6a7a", fontSize: 13, marginTop: 2 }}>
                  {myNumbers.length} active number{myNumbers.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button onClick={() => setShowMyNumber(true)} style={{
                padding: "10px 16px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #00d4aa, #0099ff)",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 16px rgba(0,212,170,0.2)",
              }}>+ Get Number</button>
            </div>

            {/* Info card if no numbers */}
            {myNumbers.length === 0 && (
              <div style={{
                background: "linear-gradient(135deg, rgba(255,165,0,0.08), rgba(255,100,0,0.08))",
                borderRadius: 18, padding: "28px 22px", marginBottom: 20,
                border: "1px solid rgba(255,165,0,0.12)", textAlign: "center",
              }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📱</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Get Your Own Phone Number</h3>
                <p style={{ color: "#8a9aaa", fontSize: 14, lineHeight: 1.6 }}>
                  Buy a real phone number in any country. People can call you from a regular phone — it rings right here in CallGlobe. <span style={{ color: "#00d4aa", fontWeight: 600 }}>Incoming calls are FREE.</span>
                </p>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 20,
                }}>
                  {[
                    { flag: "🇳🇬", label: "Nigeria", price: "$2/mo" },
                    { flag: "🇺🇸", label: "US", price: "$1/mo" },
                    { flag: "🇸🇦", label: "Saudi", price: "$2.50/mo" },
                  ].map((ex) => (
                    <div key={ex.label} style={{
                      background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 8px",
                    }}>
                      <p style={{ fontSize: 24 }}>{ex.flag}</p>
                      <p style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{ex.label}</p>
                      <p style={{ fontSize: 11, color: "#00d4aa", fontWeight: 600, marginTop: 2 }}>{ex.price}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowMyNumber(true)} style={{
                  marginTop: 20, padding: "14px 0", width: "100%", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg, #FFA500, #FF6B00)",
                  color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
                }}>Browse Numbers</button>
              </div>
            )}

            {/* My numbers list */}
            {myNumbers.length > 0 && (
              <>
                {/* Active caller ID highlight */}
                {getActiveNumber() && (
                  <div style={{
                    background: "linear-gradient(135deg, rgba(0,212,170,0.1), rgba(0,153,255,0.08))",
                    borderRadius: 16, padding: "16px 18px", marginBottom: 16,
                    border: "1px solid rgba(0,212,170,0.15)",
                  }}>
                    <p style={{ color: "#6a7a8a", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active Caller ID</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                      <span style={{ fontSize: 28 }}>{getActiveNumber().flag}</span>
                      <div>
                        <p style={{ fontSize: 18, fontWeight: 700, color: "#00d4aa" }}>{getActiveNumber().number}</p>
                        <p style={{ fontSize: 12, color: "#5a6a7a" }}>This number shows when you make calls</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* All numbers */}
                {myNumbers.map((num) => (
                  <div key={num.id} style={{
                    background: "rgba(255,255,255,0.02)", borderRadius: 14,
                    padding: "16px 18px", marginBottom: 10,
                    border: `1px solid ${activeCallerId === num.id ? "rgba(0,212,170,0.15)" : "rgba(255,255,255,0.04)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ fontSize: 28 }}>{num.flag}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{num.number}</p>
                        <p style={{ color: "#5a6a7a", fontSize: 12 }}>
                          {num.country} · ${num.monthly.toFixed(2)}/mo
                        </p>
                      </div>
                      {activeCallerId === num.id && (
                        <span style={{
                          padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                          background: "rgba(0,212,170,0.12)", color: "#00d4aa",
                        }}>ACTIVE</span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      {activeCallerId !== num.id && (
                        <button onClick={() => setActiveNumber(num.id)} style={{
                          flex: 1, padding: "10px 0", borderRadius: 10,
                          border: "1px solid rgba(0,212,170,0.2)",
                          background: "rgba(0,212,170,0.06)", color: "#00d4aa",
                          fontSize: 13, fontWeight: 600, cursor: "pointer",
                        }}>Set as Caller ID</button>
                      )}
                      <button onClick={() => simulateIncomingCall(num.number)} style={{
                        flex: 1, padding: "10px 0", borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.03)", color: "#aaa",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}>Test Incoming</button>
                      <button onClick={() => removeNumber(num.id)} style={{
                        padding: "10px 14px", borderRadius: 10,
                        border: "1px solid rgba(255,59,59,0.12)",
                        background: "rgba(255,59,59,0.04)", color: "#ff6b6b",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}>Remove</button>
                    </div>
                  </div>
                ))}

                {/* Call rates link */}
                <div style={{
                  background: "rgba(255,255,255,0.02)", borderRadius: 14,
                  padding: "16px 18px", marginTop: 10,
                  border: "1px solid rgba(255,255,255,0.04)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer",
                }} onClick={() => setActiveTab("dialer")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🌍</span>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600 }}>View Call Rates</p>
                      <p style={{ color: "#5a6a7a", fontSize: 12 }}>See per-minute rates by country</p>
                    </div>
                  </div>
                  <span style={{ color: "#5a6a7a" }}>→</span>
                </div>
              </>
            )}

            {/* How it works */}
            <div style={{
              background: "rgba(255,255,255,0.02)", borderRadius: 14,
              padding: "18px", marginTop: 20,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>How numbers work</p>
              {[
                { icon: "📥", text: "Incoming calls to all your numbers ring in this app — always FREE" },
                { icon: "📤", text: "Outbound calls show your active Caller ID to the person you're calling" },
                { icon: "🔄", text: "Switch Caller ID anytime — just tap the number you want to use" },
                { icon: "💰", text: "Numbers are billed monthly ($1-2.50/mo) from your balance" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                  <p style={{ fontSize: 13, color: "#8a9aaa", lineHeight: 1.4 }}>{item.text}</p>
                </div>
              ))}
            </div>

            {/* Number Selection Modal (shared) */}
            {showMyNumber && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.92)", zIndex: 100,
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ padding: "50px 20px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => { setShowMyNumber(false); setNumberSearch(""); }}
                    style={{ background: "none", border: "none", color: "#00d4aa", fontSize: 16, cursor: "pointer" }}>
                    ← Back
                  </button>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 17 }}>Buy a Phone Number</p>
                    <p style={{ color: "#5a6a7a", fontSize: 12 }}>{availableNumbers.length} numbers available</p>
                  </div>
                </div>

                <div style={{ padding: "0 20px 12px" }}>
                  <input
                    placeholder="Search by country..."
                    value={numberSearch}
                    onChange={(e) => setNumberSearch(e.target.value)}
                    autoFocus
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
                  {availableNumbers
                    .filter(n => n.country.toLowerCase().includes(numberSearch.toLowerCase()) || n.number.includes(numberSearch))
                    .map((num, i) => (
                    <button key={num.id} onClick={() => purchaseNumber(num)} style={{
                      display: "flex", alignItems: "center", gap: 14, width: "100%",
                      padding: "16px 8px", background: "none", border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      color: "#fff", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ fontSize: 28 }}>{num.flag}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.02em" }}>{num.number}</p>
                        <p style={{ color: "#5a6a7a", fontSize: 12, marginTop: 2 }}>{num.country} · Incoming calls FREE</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ color: "#00d4aa", fontSize: 14, fontWeight: 700 }}>${num.monthly.toFixed(2)}</p>
                        <p style={{ color: "#4a5a6a", fontSize: 10 }}>per month</p>
                      </div>
                    </button>
                  ))}
                  {availableNumbers.filter(n => n.country.toLowerCase().includes(numberSearch.toLowerCase()) || n.number.includes(numberSearch)).length === 0 && (
                    <p style={{ textAlign: "center", color: "#4a5a6a", padding: "40px 0", fontSize: 14 }}>No numbers found for that search</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case "invite":
        return (
          <div style={{ padding: "0 20px", paddingBottom: 100 }}>
            {/* Hero card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(0,212,170,0.12), rgba(0,153,255,0.12))",
              borderRadius: 20, padding: "28px 22px", marginBottom: 20,
              border: "1px solid rgba(0,212,170,0.15)", textAlign: "center",
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎁</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 8 }}>
                Give $2, Get $2
              </h2>
              <p style={{ color: "#8a9aaa", fontSize: 14, lineHeight: 1.5 }}>
                Invite friends to CallGlobe. When they sign up and make their first recharge, you both get <span style={{ color: "#00d4aa", fontWeight: 700 }}>$2 free credit</span>.
              </p>
            </div>

            {/* Referral code */}
            <div style={{
              background: "rgba(255,255,255,0.03)", borderRadius: 16,
              padding: "18px 20px", marginBottom: 16,
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <p style={{ color: "#6a7a8a", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Your referral code</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  flex: 1, padding: "12px 16px", borderRadius: 10,
                  background: "rgba(0,212,170,0.08)", border: "1px dashed rgba(0,212,170,0.3)",
                  fontSize: 20, fontWeight: 700, letterSpacing: "0.08em", color: "#00d4aa",
                  textAlign: "center", fontFamily: "monospace",
                }}>
                  {referralCode}
                </div>
                <button onClick={handleCopyReferral} style={{
                  padding: "12px 16px", borderRadius: 10, border: "none",
                  background: referralCopied ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.06)",
                  color: referralCopied ? "#00d4aa" : "#fff",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  transition: "all 0.2s",
                }}>
                  {referralCopied ? "Copied!" : "Copy Link"}
                </button>
              </div>
            </div>

            {/* Share buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              <button onClick={handleShareWhatsApp} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px", borderRadius: 14, border: "none",
                background: "rgba(37,211,102,0.1)", color: "#25D366",
                fontSize: 15, fontWeight: 600, cursor: "pointer", textAlign: "left",
                border: "1px solid rgba(37,211,102,0.2)",
              }}>
                <span style={{ fontSize: 24 }}>💬</span>
                <div>
                  <p>Share via WhatsApp</p>
                  <p style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>Best for reaching friends & family groups</p>
                </div>
              </button>

              <button onClick={handleShareSMS} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px", borderRadius: 14, border: "none",
                background: "rgba(0,153,255,0.08)", color: "#0099ff",
                fontSize: 15, fontWeight: 600, cursor: "pointer", textAlign: "left",
                border: "1px solid rgba(0,153,255,0.15)",
              }}>
                <span style={{ fontSize: 24 }}>📱</span>
                <div>
                  <p>Share via SMS</p>
                  <p style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>Send a text to contacts directly</p>
                </div>
              </button>

              <button onClick={handleNativeShare} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px", borderRadius: 14, border: "none",
                background: "rgba(255,255,255,0.04)", color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer", textAlign: "left",
                border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <span style={{ fontSize: 24 }}>📤</span>
                <div>
                  <p>More sharing options</p>
                  <p style={{ fontSize: 12, fontWeight: 400, color: "#5a6a7a", marginTop: 2 }}>Email, Telegram, Facebook, and more</p>
                </div>
              </button>
            </div>

            {/* How it works */}
            <div style={{
              background: "rgba(255,255,255,0.02)", borderRadius: 16,
              padding: "20px", marginBottom: 20,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#fff" }}>How it works</p>
              {[
                { step: "1", text: "Share your link with friends & family" },
                { step: "2", text: "They sign up and get $2.50 welcome credit" },
                { step: "3", text: "When they make their first $10+ recharge..." },
                { step: "4", text: "You BOTH get $2 bonus credit!" },
              ].map((item) => (
                <div key={item.step} style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 10,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "rgba(0,212,170,0.12)", color: "#00d4aa",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}>{item.step}</div>
                  <p style={{ fontSize: 13, color: "#8a9aaa" }}>{item.text}</p>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20,
            }}>
              <div style={{
                background: "rgba(255,255,255,0.03)", borderRadius: 14,
                padding: "16px", textAlign: "center",
                border: "1px solid rgba(255,255,255,0.04)",
              }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: "#00d4aa" }}>{referrals.length}</p>
                <p style={{ color: "#5a6a7a", fontSize: 12, marginTop: 2 }}>Friends invited</p>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.03)", borderRadius: 14,
                padding: "16px", textAlign: "center",
                border: "1px solid rgba(255,255,255,0.04)",
              }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: "#00d4aa" }}>${referralEarnings.toFixed(2)}</p>
                <p style={{ color: "#5a6a7a", fontSize: 12, marginTop: 2 }}>Credit earned</p>
              </div>
            </div>

            {/* Referral history */}
            {referrals.length > 0 && (
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#fff" }}>Your referrals</p>
                {referrals.map((ref, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "rgba(0,212,170,0.12)", color: "#00d4aa",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700,
                      }}>{ref.name?.charAt(0) || "?"}</div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500 }}>{ref.name}</p>
                        <p style={{ color: "#5a6a7a", fontSize: 12 }}>{ref.status}</p>
                      </div>
                    </div>
                    <span style={{
                      color: ref.earned > 0 ? "#00d4aa" : "#5a6a7a",
                      fontSize: 14, fontWeight: 600,
                    }}>
                      {ref.earned > 0 ? `+$${ref.earned.toFixed(2)}` : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Comparison promo */}
            <div style={{
              background: "linear-gradient(135deg, rgba(255,165,0,0.08), rgba(255,69,0,0.08))",
              borderRadius: 16, padding: "18px 20px", marginTop: 20,
              border: "1px solid rgba(255,165,0,0.12)",
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#FFA500", marginBottom: 6 }}>
                Tell your friends:
              </p>
              <p style={{ fontSize: 13, color: "#ccc", lineHeight: 1.5 }}>
                "Other apps charge <span style={{ color: "#ff6b6b", fontWeight: 700, textDecoration: "line-through" }}>$0.12/min</span> to call Nigeria. CallGlobe is just <span style={{ color: "#00d4aa", fontWeight: 700 }}>$0.06/min</span> — that's DOUBLE the talk time for the same money!"
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "#0a0a0f",
      fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif",
      color: "#fff", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "50px 20px 14px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, #00d4aa, #0099ff)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>CallGlobe</span>
        </div>
        <div style={{
          width: 34, height: 34, borderRadius: "50%",
          background: "linear-gradient(135deg, rgba(0,212,170,0.2), rgba(0,153,255,0.2))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#00d4aa",
        }}>
          {user.name?.charAt(0)?.toUpperCase() || "U"}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 16 }}>
        {renderContent()}
      </div>

      {/* Bottom Tab Bar */}
      <div style={{
        display: "flex", borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "8px 0 28px", background: "rgba(10,10,15,0.95)",
        backdropFilter: "blur(20px)",
      }}>
        {[
          { id: "dialer", icon: "📱", label: "Dialer" },
          { id: "history", icon: "🕐", label: "History" },
          { id: "numbers", icon: "📞", label: "Numbers" },
          { id: "recharge", icon: "💳", label: "Recharge" },
          { id: "invite", icon: "🎁", label: "Invite" },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: 1, background: "none", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            color: activeTab === tab.id ? "#00d4aa" : "#4a5a6a",
            transition: "color 0.2s",
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.02em" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
