import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTelnyxVoice } from '../../src/features/calling/hooks/useTelnyxVoice';

function Harness() {
  const [enabled, setEnabled] = useState(true);
  const voice = useTelnyxVoice('qa-account', enabled, { name: 'QA', extension: '2000' });
  window.testVoice = voice;
  window.testEnable = setEnabled;
  return React.createElement('output', null, JSON.stringify({ ready: voice.ready, state: voice.state, error: voice.error }));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
