import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { VoicePnBridge } from '@telnyx/react-voice-commons-sdk';

export const ringtoneOptions = [
  { id: 'vocivo_classic', label: 'Vocivo Classic', description: 'Clear two-note office ring' },
  { id: 'vocivo_chime', label: 'Bright Chime', description: 'Warm three-note chime' },
  { id: 'vocivo_pulse', label: 'Digital Pulse', description: 'Modern repeating pulse' },
  { id: 'vocivo_wave', label: 'Blue Wave', description: 'Calm rising business tone' },
  { id: 'vocivo_signal', label: 'Signal', description: 'Bright alternating alert' },
  { id: 'vocivo_softbell', label: 'Soft Bell', description: 'Gentle layered bell' },
] as const;

export type RingtoneId = typeof ringtoneOptions[number]['id'];

const storageKey = 'vocivo:incoming-ringtone';
export const defaultRingtone: RingtoneId = 'vocivo_classic';

export const ringtoneAssets: Record<RingtoneId, number> = {
  vocivo_classic: require('../../assets/ringtones/vocivo_classic.wav'),
  vocivo_chime: require('../../assets/ringtones/vocivo_chime.wav'),
  vocivo_pulse: require('../../assets/ringtones/vocivo_pulse.wav'),
  vocivo_wave: require('../../assets/ringtones/vocivo_wave.wav'),
  vocivo_signal: require('../../assets/ringtones/vocivo_signal.wav'),
  vocivo_softbell: require('../../assets/ringtones/vocivo_softbell.wav'),
};

export async function loadIncomingRingtone(): Promise<RingtoneId> {
  const saved = await AsyncStorage.getItem(storageKey);
  return ringtoneOptions.some((option) => option.id === saved) ? saved as RingtoneId : defaultRingtone;
}

export async function applyIncomingRingtone(ringtone: RingtoneId): Promise<void> {
  await AsyncStorage.setItem(storageKey, ringtone);
  if (Platform.OS === 'ios') {
    const applied = await NativeModules.VoicePnBridge?.setIncomingCallRingtone?.(ringtone);
    if (applied === false) throw new Error('The iPhone ringtone could not be updated.');
    return;
  }
  const applied = await VoicePnBridge.setIncomingCallRingtone(ringtone);
  if (!applied) throw new Error('The ringtone could not be updated.');
}
