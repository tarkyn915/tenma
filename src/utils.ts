export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function md5(input: string) {
  // Small dependency-free MD5 implementation for Subsonic's token authentication.
  const rotate = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const bufferLength = (((bytes.length + 8) >>> 6) + 1) * 64;
  const buffer = new Uint8Array(bufferLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(bufferLength - 8, bitLength >>> 0, true);
  view.setUint32(bufferLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

  for (let offset = 0; offset < bufferLength; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number; let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const next = (a + f + k[i] + m[g]) | 0;
      const shift = s[(Math.floor(i / 16) * 4) + (i % 4)];
      const oldD = d;
      d = c; c = b; b = (b + rotate(next, shift)) | 0; a = oldD;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map((value) => Array.from({ length: 4 }, (_, i) => ((value >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

export function coverFallback(seed: string) {
  const palette = ['#273a42', '#49383f', '#314843', '#423b55', '#5a443d'];
  return palette[seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
}
