export type VoiceCustomHeader = {
  name?: string;
  value?: string;
  header_name?: string;
  header_value?: string;
};

export type VoicePayload = {
  call_control_id?: string;
  call_session_id?: string;
  call_leg_id?: string;
  connection_id?: string;
  flow_destination?: string;
  client_state?: string;
  direction?: string;
  state?: string;
  custom_headers?: VoiceCustomHeader[];
  digits?: string;
  result?: string;
  status?: string;
  from?: string;
  to?: string;
  caller_id_name?: string;
  hangup_cause?: string;
  hangup_source?: string;
  telnyx_error?: {
    error_code?: string;
    error_description?: string;
    sip_code?: number;
  };
  recording_id?: string;
  recording_started_at?: string;
  recording_ended_at?: string;
  recording_urls?: { mp3?: string; wav?: string };
  public_recording_urls?: { mp3?: string; wav?: string };
};

export type VoiceEvent = {
  data?: {
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: VoicePayload;
  };
};
