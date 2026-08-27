interface FileDescriptor {
  binary: nsIBinaryInputStream;
  seekable: nsISeekableStream;
  closed: boolean;
}

interface ReadSyncOptions {
  offset?: number;
  length?: number;
  position?: number | bigint | null;
}

export function openSync(path: string, _flags: string): FileDescriptor {
  const fileStream = Cc[
    "@mozilla.org/network/file-input-stream;1"
  ].createInstance(Ci.nsIFileInputStream);
  fileStream.init(Zotero.File.pathToFile(path), 0x01, 0o444, 0);

  const binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream,
  );
  binary.setInputStream(fileStream);
  return {
    binary,
    seekable: fileStream.QueryInterface!(Ci.nsISeekableStream),
    closed: false,
  };
}

export function readSync(
  descriptor: FileDescriptor,
  buffer: Uint8Array | DataView,
  options: ReadSyncOptions = {},
): number {
  if (descriptor.closed) {
    throw new Error("Cannot read a closed dictionary file");
  }
  const offset = options.offset || 0;
  const available = buffer.byteLength - offset;
  const length = Math.min(options.length ?? available, available);
  const position = Number(options.position ?? 0);
  descriptor.seekable.seek(0, position);
  const bytes = descriptor.binary.readByteArray(length);
  const target = new Uint8Array(
    buffer.buffer as ArrayBuffer,
    buffer.byteOffset + offset,
    length,
  );
  target.set(bytes);
  return bytes.length;
}

export function closeSync(descriptor: FileDescriptor): void {
  if (descriptor.closed) return;
  descriptor.closed = true;
  descriptor.binary.close();
}
