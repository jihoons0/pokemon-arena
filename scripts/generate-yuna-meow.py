"""Render Yuna's original digitized meow using only the Python standard library."""
from pathlib import Path
import hashlib
import json
import math
import struct
import wave

RATE = 11025
DURATION = 0.82
OUT = Path(__file__).resolve().parent.parent / 'public/assets/audio/cries'


def curve(t, points):
    for (start, a), (end, b) in zip(points, points[1:]):
        if t <= end:
            p = max(0, (t - start) / (end - start))
            return a + (b - a) * (p * p * (3 - 2 * p))
    return points[-1][1]


def render():
    # A nasal "mi" rises into an open "a", then falls into a rounded "ow".
    # Moving vowel resonances keep the sound feline; seven-bit quantization
    # gives it the handheld-game character of the other selection cries.
    samples = []
    phase = 0
    for i in range(round(RATE * DURATION)):
        t = i / RATE
        pitch = curve(t, [(0, 510), (.12, 760), (.28, 820), (.55, 490), (.82, 290)])
        pitch *= 1 + .012 * math.sin(2 * math.pi * 13 * t)
        phase += pitch / RATE
        f1 = curve(t, [(0, 380), (.13, 600), (.3, 1000), (.55, 650), (.82, 350)])
        f2 = curve(t, [(0, 2600), (.13, 2200), (.3, 1850), (.55, 1150), (.82, 700)])
        value = 0
        for harmonic in range(1, 11):
            frequency = pitch * harmonic
            if frequency >= RATE / 2:
                continue
            resonance = .18 + 1.1 * math.exp(-((frequency - f1) / 360) ** 2)
            resonance += .7 * math.exp(-((frequency - f2) / 500) ** 2)
            value += resonance / harmonic ** .9 * math.sin(2 * math.pi * phase * harmonic)
        envelope = min(1, t / .035) * min(1, max(0, DURATION - t) / .13)
        envelope *= .8 + .2 * math.sin(math.pi * t / DURATION)
        samples.append(value * envelope)
    peak = max(abs(value) for value in samples)
    pcm = [round(round(value / peak * .78 * 63) / 63 * 32767) for value in samples]
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'yuna.wav'
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b''.join(struct.pack('<h', sample) for sample in pcm))
    credits = {
        'id': 'yuna',
        'name': '유나',
        'file': '/assets/audio/cries/yuna.wav',
        'source': 'Original procedural digitized cat meow',
        'generator': 'scripts/generate-yuna-meow.py',
        'note': 'Synthesized for Yuna; no recordings or Pokémon cries were sampled.',
        'format': 'Mono 16-bit PCM WAV with seven-bit amplitude quantization',
        'sampleRate': RATE,
        'durationSeconds': len(pcm) / RATE,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    (OUT / 'yuna-credits.json').write_text(json.dumps(credits, ensure_ascii=False, indent=2) + '\n')
    print(f'Rendered {path.name}: {len(pcm) / RATE:.2f}s, {path.stat().st_size} bytes')


if __name__ == '__main__':
    render()
