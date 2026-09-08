// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { BrandHeader } from './shared/components/BrandHeader';
import './styles/global.css';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrandHeader />
    <div className="application-frame"><App /></div>
  </React.StrictMode>
);
