export type AppTab = 'dial' | 'contacts' | 'recents' | 'messages' | 'settings';

export type ContactPhone = {
  id: string;
  name: string;
  number: string;
  label?: string;
  internal?: boolean;
  extension?: string;
  sipUsername?: string;
  photoUrl?: string;
};

export type NavigationTarget = {
  number: string;
  name?: string;
  internal?: boolean;
  nonce: number;
};

export type SmsMessage = {
  id: string;
  to: string;
  from?: string;
  contactName?: string;
  text: string;
  status: 'sending' | 'sent' | 'received' | 'failed';
  direction: 'inbound' | 'outbound';
  transport?: 'sms' | 'internal';
  createdAt: string;
  error?: string;
};

export type CallRate = {
  id: string;
  country_code: string;
  country_name: string;
  dial_code: string;
  flag: string | null;
  rate_per_min: number | null;
};

export type CallerNumber = {
  id: string;
  phone_number: string;
  label: string;
  country_code: string | null;
  status: string;
  receives_calls: boolean;
  messaging_enabled?: boolean;
  source?: 'owned' | 'verified';
};

export type CallLog = {
  id: string;
  destination_number: string;
  destination_name?: string | null;
  destination_country?: string | null;
  duration_seconds: number;
  total_cost: number;
  status: string;
  started_at: string;
  direction?: 'incoming' | 'outgoing';
  internal?: boolean;
};

export type VoicemailMessage = {
  id: string;
  recordingId: string;
  callerNumber: string;
  callerName?: string;
  durationSeconds?: number;
  createdAt: string;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  balance: number | null;
  can_call?: boolean;
  currency: string;
  extension?: string;
  organization_id?: string;
  role?: 'owner' | 'admin' | 'superadmin' | 'company_owner' | 'company_admin' | 'manager' | 'user' | 'individual';
  account_type?: 'platform' | 'business' | 'individual';
  organization_name?: string;
  organization_owner?: string;
  photo_url?: string;
  job_title?: string;
  department?: string;
  mobile?: string;
  location?: string;
  bio?: string;
  admin_only?: boolean;
};

export type CallPhase = 'idle' | 'connecting' | 'ringing' | 'active' | 'ended' | 'failed';

export type ActiveCall = {
  id?: string;
  number: string;
  displayName: string;
  destinationCountry?: string;
  countryCode?: string;
  ratePerMinute?: number;
  phase: CallPhase;
  startedAt: number;
  connectedAt?: number;
  muted: boolean;
  speaker: boolean;
  onHold: boolean;
  isIncoming?: boolean;
  photoUrl?: string;
  routeId?: string;
  callerId?: string;
};

export type MergedConference = {
  id: string;
  participants: ActiveCall[];
};
