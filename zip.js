'use strict';

/* A small ZIP writer and reader, so exports need no libraries.
   Images are already compressed, so files are stored as they are. */
const ZIP = (() => {
  const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
  const UTF8_FLAG = 0x0800;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  /* files: [{ name, blob }]. onProgress(done, total) is optional. */
  async function write(files, onProgress) {
    const parts = [], central = [];
    const { time, date } = dosDateTime(new Date());
    let offset = 0;
    for (let i = 0; i < files.length; i++) {
      const { name, blob } = files[i];
      const nameBytes = encoder.encode(name);
      const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, LOCAL, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, UTF8_FLAG, true);
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, blob.size, true);
      head.setUint32(22, blob.size, true);
      head.setUint16(26, nameBytes.length, true);
      parts.push(head.buffer, nameBytes, blob);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, CENTRAL, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, UTF8_FLAG, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, blob.size, true);
      entry.setUint32(24, blob.size, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry.buffer, nameBytes);

      offset += 30 + nameBytes.length + blob.size;
      if (offset >= 0xFFFFFFFF) throw new Error('too large');
      if (onProgress) onProgress(i + 1, files.length);
    }
    const centralSize = central.reduce((s, c) => s + c.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, END, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  /* Returns Map(name -> function returning a Promise of the file's Blob) */
  async function read(file) {
    const tailSize = Math.min(file.size, 22 + 65535);
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let endAt = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === END) { endAt = i; break; }
    }
    if (endAt < 0) throw new Error('not a zip');
    const count = tail.getUint16(endAt + 10, true);
    const size = tail.getUint32(endAt + 12, true);
    const start = tail.getUint32(endAt + 16, true);
    if (start + size > file.size) throw new Error('not a zip');
    const dir = new DataView(await file.slice(start, start + size).arrayBuffer());
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > size || dir.getUint32(p, true) !== CENTRAL) throw new Error('not a zip');
      const method = dir.getUint16(p + 10, true);
      const compressed = dir.getUint32(p + 20, true);
      const nameLen = dir.getUint16(p + 28, true);
      const extraLen = dir.getUint16(p + 30, true);
      const commentLen = dir.getUint16(p + 32, true);
      const local = dir.getUint32(p + 42, true);
      const name = decoder.decode(new Uint8Array(dir.buffer, p + 46, nameLen));
      entries.set(name, async () => {
        const head = new DataView(await file.slice(local, local + 30).arrayBuffer());
        if (head.getUint32(0, true) !== LOCAL) throw new Error('not a zip');
        const dataAt = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const data = file.slice(dataAt, dataAt + compressed);
        if (method === 0) return data;
        /* Someone may have zipped the folder again with compression */
        if (method === 8) return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        throw new Error('unsupported zip');
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  return { write, read };
})();
