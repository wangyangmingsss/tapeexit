import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), length = Buffer.alloc(4), check = Buffer.alloc(4);
  length.writeUInt32BE(data.length); check.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([length, t, data, check]);
}
function bitmap(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('public', { recursive: true });
await writeFile('public/icon.png', bitmap(96, (x, y) => {
  const dark = [42,100,72,255], clear = [0,0,0,0];
  const doorway = x >= 15 && x <= 46 && y >= 15 && y <= 80 && (x <= 23 || y <= 23 || y >= 72);
  const shaft = x >= 38 && x <= 80 && y >= 43 && y <= 52;
  const arrow = x >= 61 && x <= 82 && Math.abs(y - 47.5) >= (x - 62) * .65 - 5 &&
    Math.abs(y - 47.5) <= (x - 62) * .65 + 4;
  return doorway || shaft || arrow ? dark : clear;
}));
await writeFile('public/xlayer.png', bitmap(64, (x, y) => {
  const pad = x >= 5 && x <= 58 && y >= 5 && y <= 58;
  const mark = x >= 16 && x <= 47 && y >= 16 && y <= 47 && (Math.abs(x-y) < 5 || Math.abs((63-x)-y) < 5);
  return mark ? [255,255,255,255] : pad ? [23,26,23,255] : [0,0,0,0];
}));
console.log('Local bitmap application and network marks generated.');
