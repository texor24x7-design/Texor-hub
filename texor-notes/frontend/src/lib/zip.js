/**
 * A minimal ZIP writer.
 *
 * `.docx` is a ZIP of XML files, so producing one means being able to write a
 * ZIP. This writes them *stored* — no compression — which costs a few tens of
 * kilobytes on a note and removes the only part of the format that would need
 * a deflate implementation to be correct.
 *
 * Kept separate from the exporter, and pure, so it can be checked against the
 * one authority that matters: whether `unzip` and Word will open the result.
 *
 * Only what a document needs is implemented — no directories, no encryption,
 * no Zip64. A note that needed Zip64 would be four gigabytes of text.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = (text) => new TextEncoder().encode(text);

/**
 * MS-DOS date and time, which is what the format stores.
 *
 * Fixed rather than "now", so the same note exports to byte-identical files.
 * A download that differs every time cannot be compared, and the timestamp
 * inside a document nobody reads is not worth that.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/**
 * @param {{name: string, data: Uint8Array|string}[]} files
 * @returns {Uint8Array}
 */
export function zip(files) {
  const entries = files.map((file) => ({
    nameBytes: utf8(file.name),
    data: typeof file.data === 'string' ? utf8(file.data) : file.data,
  }));

  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (value) => [value & 0xff, (value >>> 8) & 0xff];
  const u32 = (value) => [
    value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff,
  ];

  for (const entry of entries) {
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = [
      ...u32(0x04034b50),
      ...u16(20),            // version needed
      ...u16(0x0800),        // flags: names are UTF-8
      ...u16(0),             // method: stored
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(entry.nameBytes.length), ...u16(0),
    ];

    chunks.push(new Uint8Array(local), entry.nameBytes, entry.data);

    central.push([
      ...u32(0x02014b50),
      ...u16(20), ...u16(20),
      ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(entry.nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
    ]);

    offset += local.length + entry.nameBytes.length + size;
  }

  const directoryStart = offset;
  let directoryLength = 0;

  for (let index = 0; index < central.length; index += 1) {
    const header = new Uint8Array(central[index]);
    chunks.push(header, entries[index].nameBytes);
    directoryLength += header.length + entries[index].nameBytes.length;
  }

  chunks.push(new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(directoryLength), ...u32(directoryStart),
    ...u16(0),
  ]));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }

  return out;
}

export default { zip, crc32 };
