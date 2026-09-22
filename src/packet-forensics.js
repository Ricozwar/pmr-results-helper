"use strict";

/**
 * Live UDP forensics for PMR — samples unique (type,version,size) packets.
 * Attach via server; exposes getReport().
 */
class PacketForensics {
  constructor(limit = 24) {
    this.limit = limit;
    this.byKey = new Map();
    this.total = 0;
  }

  ingest(buf) {
    if (!buf || buf.length < 12) return;
    this.total += 1;
    const type = buf[10];
    const version = buf[11];
    const size = buf.length;
    const key = `${type}:${version}:${size}`;
    let row = this.byKey.get(key);
    if (!row) {
      if (this.byKey.size >= this.limit) return;
      row = {
        type,
        version,
        size,
        count: 0,
        hexHead: buf.subarray(0, Math.min(64, buf.length)).toString("hex"),
        asciiGuess: guessAscii(buf),
        floatsAt16: sampleFloats(buf, 16, 8),
        u16At12: sampleU16(buf, 12, 8),
      };
      this.byKey.set(key, row);
    }
    row.count += 1;
    if (row.count % 50 === 1) {
      row.hexHead = buf.subarray(0, Math.min(96, buf.length)).toString("hex");
      row.asciiGuess = guessAscii(buf);
      row.sample = Buffer.from(buf);
    }
  }

  report() {
    return {
      total: this.total,
      samples: [...this.byKey.values()]
        .sort((a, b) => b.count - a.count)
        .map((row) => ({
          type: row.type,
          version: row.version,
          size: row.size,
          count: row.count,
          hexHead: row.hexHead,
          asciiGuess: row.asciiGuess,
          floatsAt16: row.floatsAt16,
          u16At12: row.u16At12,
        })),
    };
  }
}

function guessAscii(buf) {
  const findings = [];
  let start = -1;
  for (let i = 12; i < buf.length; i++) {
    const c = buf[i];
    const ok = (c >= 32 && c < 127) || c === 0;
    if (c >= 32 && c < 127) {
      if (start < 0) start = i;
    } else if (c === 0) {
      if (start >= 0 && i - start >= 3) {
        findings.push({ at: start, text: buf.toString("ascii", start, i) });
        if (findings.length >= 8) break;
      }
      start = -1;
    } else {
      start = -1;
    }
  }
  return findings;
}

function sampleFloats(buf, offset, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = offset + i * 4;
    if (at + 4 > buf.length) break;
    out.push(Number(buf.readFloatLE(at).toFixed(4)));
  }
  return out;
}

function sampleU16(buf, offset, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = offset + i * 2;
    if (at + 2 > buf.length) break;
    out.push(buf.readUInt16LE(at));
  }
  return out;
}

module.exports = { PacketForensics };
