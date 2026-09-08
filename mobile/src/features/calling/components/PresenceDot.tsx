import React from 'react';
import { View } from 'react-native';

export function PresenceDot({ presence }: { presence?: string }) {
  const state = presence === 'online' || presence === 'busy' ? presence : 'offline';
  return <View accessibilityRole="image" accessibilityLabel={state === 'online' ? 'Online' : state === 'busy' ? 'Busy' : 'Offline'}
    style={{ width: 10, height: 10, borderRadius: 5, marginRight: 7, backgroundColor: state === 'online' ? '#30C47C' : state === 'busy' ? '#EAA24C' : '#82909F' }} />;
}
