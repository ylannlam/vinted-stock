// Archive ZIP sans compression (méthode « stored »), lisible par Chrome, Edge et AdsPower.
// Fonctionne côté serveur comme dans le navigateur : entrées {name, data: string | Uint8Array}.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
export function zipFiles(entries, date = new Date('2026-11-06T12:00:00Z')) {
  const encoder = new TextEncoder(), parts = [], central = []
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name), data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data, crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true)
    local.setUint16(10, time, true); local.setUint16(12, day, true); local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true); head.setUint16(8, 0x0800, true); head.setUint16(10, 0, true)
    head.setUint16(12, time, true); head.setUint16(14, day, true); head.setUint32(16, crc, true); head.setUint32(20, data.length, true); head.setUint32(24, data.length, true)
    head.setUint16(28, name.length, true); head.setUint32(42, offset, true)
    central.push(new Uint8Array(head.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true)
  end.setUint32(12, size, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}
