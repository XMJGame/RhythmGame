const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const duration = 22;
const firstBeat = 2;
const bpm = 120;
const beatSeconds = 60 / bpm;
const samples = new Float64Array(sampleRate * duration);
let seed = 0x5eed1234;

function noise() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0xffffffff * 2 - 1;
}

function mix(at, length, voice) {
  const start = Math.max(0, Math.floor(at * sampleRate));
  const count = Math.floor(length * sampleRate);
  for (let i = 0; i < count && start + i < samples.length; i++) {
    samples[start + i] += voice(i / sampleRate, i);
  }
}

function kick(at, accent = false) {
  mix(at, .28, t => {
    const env = Math.exp(-t * 17);
    const phase = 2 * Math.PI * (48 * t + 85 * (1 - Math.exp(-t * 22)) / 22);
    const click = t < .012 ? (1 - t / .012) * .18 : 0;
    return Math.sin(phase) * env * (accent ? .95 : .72) + click;
  });
}

function snare(at) {
  let previous = 0;
  mix(at, .2, t => {
    const current = noise();
    const high = current - previous * .72;
    previous = current;
    return high * Math.exp(-t * 24) * .34 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 18) * .16;
  });
}

function hat(at, strong = false) {
  let previous = 0;
  mix(at, .07, t => {
    const current = noise();
    const high = current - previous;
    previous = current;
    return high * Math.exp(-t * 62) * (strong ? .13 : .075);
  });
}

function bass(at, frequency) {
  mix(at, .42, t => {
    const attack = Math.min(1, t / .012);
    const release = Math.exp(-t * 5.4);
    return (Math.sin(2 * Math.PI * frequency * t) + .28 * Math.sin(2 * Math.PI * frequency * 2 * t)) * attack * release * .18;
  });
}

function pluck(at, frequency) {
  mix(at, .22, t => {
    const env = Math.exp(-t * 13);
    return (Math.sin(2 * Math.PI * frequency * t) + .22 * Math.sin(2 * Math.PI * frequency * 3 * t)) * env * .075;
  });
}

// A quiet, smooth two-second intro. It has no sharp transient, so the first
// reliable rhythmic onset remains exactly at 2.000 seconds.
mix(0, firstBeat, t => {
  const fade = Math.sin(Math.PI * t / firstBeat) ** 2;
  return (Math.sin(2 * Math.PI * 110 * t) + .35 * Math.sin(2 * Math.PI * 165 * t)) * fade * .025;
});

const bassNotes = [55, 65.406, 73.416, 49];
const melody = [440, 523.251, 659.255, 587.33, 523.251, 440, 392, 493.883];
const beatCount = Math.floor((20 - firstBeat) / beatSeconds);

for (let beat = 0; beat < beatCount; beat++) {
  const at = firstBeat + beat * beatSeconds;
  const inBar = beat % 4;
  kick(at, inBar === 0);
  if (inBar === 1 || inBar === 3) snare(at);
  hat(at, inBar === 0);
  hat(at + beatSeconds / 2, false);
  bass(at, bassNotes[Math.floor(beat / 4) % bassNotes.length]);
  pluck(at + beatSeconds / 2, melody[beat % melody.length]);
}

// Gentle fade-out after the last full rhythmic section.
for (let i = 0; i < samples.length; i++) {
  const time = i / sampleRate;
  const fadeOut = time > 19.5 ? Math.max(0, 1 - (time - 19.5) / 2.5) : 1;
  samples[i] = Math.tanh(samples[i] * 1.15) * fadeOut * .88;
}

const dataBytes = samples.length * 2;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataBytes, 40);

for (let i = 0; i < samples.length; i++) {
  const value = Math.max(-1, Math.min(1, samples[i]));
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}

const output = path.join(__dirname, '节拍测试曲-120BPM-第一拍2秒.wav');
fs.writeFileSync(output, wav);
console.log(output);

