import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";

/** The files inside a zip, by path. */
export type ZipFiles = Record<string, Uint8Array>;

/** How much of a zip file Kizuki unpacks, so a small file that unpacks to gigabytes can't use up the computer's memory. */
export interface ZipLimits {
  /** The most bytes one part may unpack to. */
  maxEntryBytes: number;
  /** The most bytes all the parts Kizuki reads may unpack to together. */
  maxTotalBytes: number;
  /** The most parts the file may have. */
  maxEntries: number;
}

/** Limits far above any real slide deck, document, or workbook's text. */
export const ZIP_LIMITS: ZipLimits = { maxEntryBytes: 100_000_000, maxTotalBytes: 300_000_000, maxEntries: 20_000 };

/**
 * Opens a zip file (docx, pptx, and xlsx are zips of XML files). Only the XML parts are
 * unpacked; pictures and other files are skipped. A file over the {@link ZipLimits} is refused.
 */
export function openZip(bytes: Uint8Array, kind: string, limits: ZipLimits = ZIP_LIMITS): ZipFiles {
  let entries = 0;
  let total = 0;
  let refused: string | undefined;
  const filter = (file: { name: string; originalSize: number }) => {
    entries += 1;
    if (entries > limits.maxEntries) refused ??= `this ${kind} file has too many parts (over ${limits.maxEntries}) to be a real ${kind} file`;
    if (!/\.(xml|rels)$/i.test(file.name)) return false;
    total += file.originalSize;
    if (file.originalSize > limits.maxEntryBytes || total > limits.maxTotalBytes) {
      refused ??= `this ${kind} file is too big to read safely: its text parts unpack to over ${Math.round(Math.max(total, file.originalSize) / 1e6)} MB`;
    }
    return !refused;
  };
  let files: ZipFiles;
  try {
    files = unzipSync(bytes, { filter });
  } catch (error) {
    throw new Error(`not a valid ${kind} file: ${(error as Error).message}`, { cause: error });
  }
  if (refused) throw new Error(`${refused}. Save it again from its app, or split it into smaller files.`);
  return files;
}

/** The text of one file in the zip, or `undefined` if it is not there. */
export function zipText(files: ZipFiles, path: string): string | undefined {
  const bytes = files[path];
  return bytes ? strFromU8(bytes) : undefined;
}

/** Resolves a relationship target (such as `../notesSlides/notesSlide1.xml`) against the folder it was found in. */
export function resolveTarget(fromDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(fromDir, target));
}
