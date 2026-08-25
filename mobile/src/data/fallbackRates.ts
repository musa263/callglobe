import type { CallRate } from '../types';

export const fallbackRates: CallRate[] = [
  { id: 'us', country_code: 'US', country_name: 'United States', dial_code: '+1', flag: 'US', rate_per_min: 0.02 },
  { id: 'gb', country_code: 'GB', country_name: 'United Kingdom', dial_code: '+44', flag: 'GB', rate_per_min: 0.025 },
  { id: 'sa', country_code: 'SA', country_name: 'Saudi Arabia', dial_code: '+966', flag: 'SA', rate_per_min: 0.04 },
  { id: 'ae', country_code: 'AE', country_name: 'United Arab Emirates', dial_code: '+971', flag: 'AE', rate_per_min: 0.03 },
  { id: 'pk', country_code: 'PK', country_name: 'Pakistan', dial_code: '+92', flag: 'PK', rate_per_min: 0.04 },
  { id: 'in', country_code: 'IN', country_name: 'India', dial_code: '+91', flag: 'IN', rate_per_min: 0.015 },
  { id: 'ph', country_code: 'PH', country_name: 'Philippines', dial_code: '+63', flag: 'PH', rate_per_min: 0.035 },
  { id: 'ng', country_code: 'NG', country_name: 'Nigeria', dial_code: '+234', flag: 'NG', rate_per_min: 0.06 },
  { id: 'eg', country_code: 'EG', country_name: 'Egypt', dial_code: '+20', flag: 'EG', rate_per_min: 0.045 },
  { id: 'bd', country_code: 'BD', country_name: 'Bangladesh', dial_code: '+880', flag: 'BD', rate_per_min: 0.04 },
];

export const flagFromCode = (code: string) => {
  const normalized = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌐';
  return normalized.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
};
