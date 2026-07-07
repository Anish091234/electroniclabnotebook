interface ZipEntryInput {
  path: string;
  data: string | Blob | ArrayBuffer;
}

interface PreparedEntry {
  path: string;
  nameBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc: number;
}

const encoder = new TextEncoder();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function dosTimestamp() {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
}

async function toBytes(data: ZipEntryInput["data"]) {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

function localHeader(entry: PreparedEntry) {
  const { time, date } = dosTimestamp();
  const buffer = new ArrayBuffer(30 + entry.nameBytes.length);
  const view = new DataView(buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, time);
  writeUint16(view, 12, date);
  writeUint32(view, 14, entry.crc);
  writeUint32(view, 18, entry.dataBytes.length);
  writeUint32(view, 22, entry.dataBytes.length);
  writeUint16(view, 26, entry.nameBytes.length);
  writeUint16(view, 28, 0);
  const bytes = new Uint8Array(buffer);
  bytes.set(entry.nameBytes, 30);
  return bytes;
}

function centralHeader(entry: PreparedEntry, offset: number) {
  const { time, date } = dosTimestamp();
  const buffer = new ArrayBuffer(46 + entry.nameBytes.length);
  const view = new DataView(buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, time);
  writeUint16(view, 14, date);
  writeUint32(view, 16, entry.crc);
  writeUint32(view, 20, entry.dataBytes.length);
  writeUint32(view, 24, entry.dataBytes.length);
  writeUint16(view, 28, entry.nameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, offset);
  const bytes = new Uint8Array(buffer);
  bytes.set(entry.nameBytes, 46);
  return bytes;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number) {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  writeUint16(view, 20, 0);
  return new Uint8Array(buffer);
}

function toBlobPart(chunk: Uint8Array) {
  const copy = new ArrayBuffer(chunk.byteLength);
  new Uint8Array(copy).set(chunk);
  return copy;
}

export async function createZip(entries: ZipEntryInput[]) {
  const preparedEntries: PreparedEntry[] = [];
  for (const entry of entries) {
    const dataBytes = await toBytes(entry.data);
    preparedEntries.push({
      path: entry.path.replaceAll("\\", "/"),
      nameBytes: encoder.encode(entry.path.replaceAll("\\", "/")),
      dataBytes,
      crc: crc32(dataBytes),
    });
  }

  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  preparedEntries.forEach((entry) => {
    const header = localHeader(entry);
    chunks.push(header, entry.dataBytes);
    centralChunks.push(centralHeader(entry, offset));
    offset += header.length + entry.dataBytes.length;
  });

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const end = endOfCentralDirectory(preparedEntries.length, centralSize, centralOffset);
  return new Blob([...chunks, ...centralChunks, end].map(toBlobPart), { type: "application/zip" });
}
