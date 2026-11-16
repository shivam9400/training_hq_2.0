import { ZipReader, Uint8ArrayReader } from "@zip.js/zip.js";
import { LIMITS, type InputFile } from "./model";
const supported = /\.(fit|tcx|csv|gpx|kml)$/i;
export function safePath(name: string): boolean {
  return (
    name.length <= 500 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !/^[a-z]:/i.test(name) &&
    !name.includes(String.fromCharCode(0)) &&
    !name.split("/").some((part) => part === ".." || part === ".")
  );
}
export async function expandFiles(
  inputs: InputFile[],
  signal?: AbortSignal,
): Promise<{ files: InputFile[]; ignored: number }> {
  if (!inputs.length || inputs.length > 50)
    throw new Error("Select 1–50 files.");
  let expanded = 0,
    entries = 0,
    ignored = 0,
    inputBytes = 0;
  const files: InputFile[] = [];
  const guard = () => {
    if (signal?.aborted) throw new Error("Cancelled");
  };
  for (const input of inputs) {
    guard();
    inputBytes += input.bytes.length;
    if (
      inputBytes > LIMITS.zip ||
      input.bytes.length >
        (input.name.toLowerCase().endsWith(".zip") ? LIMITS.zip : LIMITS.file)
    )
      throw new Error("Input file/selection size limit exceeded.");
    if (!input.name.toLowerCase().endsWith(".zip")) {
      if (!supported.test(input.name))
        throw new Error("Unsupported selected file format.");
      expanded += input.bytes.length;
      files.push(input);
      continue;
    }
    const reader = new ZipReader(new Uint8ArrayReader(input.bytes), {
      useWebWorkers: false,
      strictness: "strict",
      checkCrc32: true,
      checkOverlappingEntry: true,
    });
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        guard();
        if (
          ++entries > LIMITS.entries ||
          !safePath(entry.filename) ||
          entry.symlink ||
          entry.encrypted
        )
          throw new Error("Unsafe ZIP entry or archive entry limit.");
        if (entry.directory) continue;
        if (
          entry.uncompressedSize > LIMITS.file ||
          (entry.compressedSize === 0 && entry.uncompressedSize > 0) ||
          entry.uncompressedSize / Math.max(1, entry.compressedSize) >
            LIMITS.ratio
        )
          throw new Error("ZIP expansion ratio/file size rejected.");
        if (expanded + entry.uncompressedSize > LIMITS.expanded)
          throw new Error("ZIP total expansion budget exceeded.");
        if (/\.zip$/i.test(entry.filename))
          throw new Error("Nested ZIP archives are not supported.");
        if (
          !supported.test(entry.filename) ||
          entry.filename
            .split("/")
            .some((part) => part === "__MACOSX" || part.startsWith("."))
        ) {
          ignored++;
          continue;
        }
        let size = 0;
        const chunks: Uint8Array[] = [];
        const writable = new WritableStream<Uint8Array>({
          write(chunk) {
            guard();
            size += chunk.length;
            expanded += chunk.length;
            if (
              size > LIMITS.file ||
              expanded > LIMITS.expanded ||
              size > entry.uncompressedSize
            )
              throw new Error("ZIP actual expansion exceeded budget.");
            chunks.push(chunk.slice());
          },
        });
        await entry.getData(writable, { signal, checkCrc32: true });
        if (size !== entry.uncompressedSize)
          throw new Error("ZIP size mismatch.");
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        files.push({ name: entry.filename, bytes });
      }
    } finally {
      await reader.close();
    }
  }
  if (expanded > LIMITS.expanded || files.length > LIMITS.entries)
    throw new Error("Expanded selection limit.");
  return { files, ignored };
}
