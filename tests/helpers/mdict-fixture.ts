import { deflateSync } from "node:zlib";

function number(value: number, width = 8): Buffer {
  const bytes = Buffer.alloc(width);
  if (width === 8) bytes.writeBigUInt64BE(BigInt(value));
  else bytes.writeUIntBE(value, 0, width);
  return bytes;
}

function adler32(bytes: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function packed(bytes: Buffer, compressed: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([compressed ? 2 : 0, 0, 0, 0]),
    number(adler32(bytes), 4),
    compressed ? deflateSync(bytes) : bytes,
  ]);
}

/** Small, valid, generated MDict 2.0 files; no licensed dictionary data. */
export function mdictFixture(
  entries: Array<[string, string | Buffer]>,
  options: { mdd?: boolean; blockSize?: number; compressed?: boolean } = {},
): Buffer {
  const width = options.mdd ? 2 : 1;
  const encode = (text: string) =>
    Buffer.from(text, options.mdd ? "utf16le" : "utf8");
  const header = Buffer.from(
    `<Dictionary GeneratedByEngineVersion="2.0" RequiredEngineVersion="2.0" Encoding="${options.mdd ? "UTF-16" : "UTF-8"}" Encrypted="No" Title="Generated test fixture"/>\0`,
    "utf16le",
  );
  let recordOffset = 0;
  const records: Buffer[] = [];
  const keys = entries.map(([key, value]) => {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    const result = { key, offset: recordOffset };
    records.push(bytes);
    recordOffset += bytes.length;
    return result;
  });
  const keyBlocks: Buffer[] = [];
  const keyInfos: Buffer[] = [];
  const blockSize = options.blockSize || 2;
  for (let start = 0; start < keys.length; start += blockSize) {
    const group = keys.slice(start, start + blockSize);
    const raw = Buffer.concat(
      group.map((item) =>
        Buffer.concat([
          number(item.offset),
          encode(item.key),
          Buffer.alloc(width),
        ]),
      ),
    );
    const block = packed(raw, options.compressed !== false);
    keyBlocks.push(block);
    const first = encode(group[0].key);
    const last = encode(group.at(-1)!.key);
    keyInfos.push(
      Buffer.concat([
        number(group.length),
        number(first.length / width, 2),
        first,
        Buffer.alloc(width),
        number(last.length / width, 2),
        last,
        Buffer.alloc(width),
        number(block.length),
        number(raw.length),
      ]),
    );
  }
  const info = Buffer.concat(keyInfos);
  const infoPacked = packed(info, true);
  const keyBytes = Buffer.concat(keyBlocks);
  const keyHeader = Buffer.concat([
    number(keyBlocks.length),
    number(entries.length),
    number(info.length),
    number(infoPacked.length),
    number(keyBytes.length),
  ]);
  const record = Buffer.concat(records);
  const recordPacked = packed(record, options.compressed !== false);
  return Buffer.concat([
    number(header.length, 4),
    header,
    number(adler32(header), 4),
    keyHeader,
    number(adler32(keyHeader), 4),
    infoPacked,
    keyBytes,
    number(1),
    number(entries.length),
    number(16),
    number(recordPacked.length),
    number(recordPacked.length),
    number(record.length),
    recordPacked,
  ]);
}
