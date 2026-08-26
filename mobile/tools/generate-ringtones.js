const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const duration = 7;

const patterns = {
  vocivo_classic: [{ start: 0, end: 1.1, notes: [660, 880] }, { start: 2.1, end: 3.2, notes: [660, 880] }, { start: 4.2, end: 5.3, notes: [660, 880] }],
  vocivo_chime: [{ start: 0, end: 1.5, notes: [523.25, 659.25, 783.99] }, { start: 2.6, end: 4.1, notes: [523.25, 659.25, 783.99] }, { start: 5.2, end: 6.7, notes: [523.25, 659.25, 783.99] }],
  vocivo_pulse: Array.from({ length: 10 }, (_, index) => ({ start: index * 0.62, end: index * 0.62 + 0.3, notes: index % 2 ? [740] : [587] })),
  vocivo_wave: [{ start: 0, end: 1.4, notes: [440, 554.37] }, { start: 2.2, end: 3.6, notes: [493.88, 659.25] }, { start: 4.4, end: 5.8, notes: [440, 554.37] }],
  vocivo_signal: Array.from({ length: 8 }, (_, index) => ({ start: index * 0.78, end: index * 0.78 + 0.42, notes: index % 2 ? [698.46, 880] : [523.25, 698.46] })),
  vocivo_softbell: [{ start: 0, end: 1.8, notes: [392, 523.25, 659.25] }, { start: 2.7, end: 4.5, notes: [392, 523.25, 659.25] }, { start: 5.4, end: 7, notes: [392, 523.25, 659.25] }],
};

function writeWave(name, events) {
  const sampleCount = sampleRate * duration;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const event = events.find(({ start, end }) => time >= start && time < end);
    let value = 0;
    if (event) {
      const local = time - event.start;
      const length = event.end - event.start;
      const envelope = Math.min(local / 0.035, 1) * Math.min((length - local) / 0.12, 1);
      value = event.notes.reduce((sum, frequency, noteIndex) => sum + Math.sin(2 * Math.PI * frequency * time) * (noteIndex ? 0.22 : 0.42), 0) * envelope;
    }
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), 44 + index * 2);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'ringtones', `${name}.wav`), buffer);
}

fs.mkdirSync(path.join(__dirname, '..', 'assets', 'ringtones'), { recursive: true });
Object.entries(patterns).forEach(([name, events]) => writeWave(name, events));
