import { expandFiles } from "./files";
import { parseFit } from "./fit";
import { parseActivityCsv } from "./csv";
import { parseXml } from "./xml";
import { normalizeActivity } from "./normalize";
import { LIMITS, type InputFile, type ParsedFiles } from "./model";
export async function processActivities(
  inputs: InputFile[],
  offset = "",
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  fallbackType: "Other" | "Walk" | "Run" = "Other",
): Promise<ParsedFiles> {
  const { files, ignored } = await expandFiles(inputs, signal);
  const result: ParsedFiles = {
    activities: [],
    notices: ignored ? [`${ignored} unrelated metadata file(s) ignored.`] : [],
    rejected: 0,
    inspected: files.length,
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new Error("Cancelled");
    const file = files[i];
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        file.bytes.slice().buffer as ArrayBuffer,
      );
      const fileHash = Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      const ext = file.name.split(".").at(-1)?.toUpperCase();
      let activities;
      if (ext === "FIT") activities = await parseFit(file.bytes, fileHash);
      else if (ext === "CSV") {
        const csv = parseActivityCsv(
          decoder.decode(file.bytes),
          fileHash,
          offset,
        );
        activities = csv.activities;
        if (csv.notice) result.notices.push(`File ${i + 1}: ${csv.notice}`);
      } else if (ext === "TCX" || ext === "GPX" || ext === "KML")
        activities = parseXml(decoder.decode(file.bytes), ext, fileHash);
      else throw new Error("Unsupported");
      const staged = [];
      if (result.activities.length + activities.length > LIMITS.activities)
        throw new Error("Activity limit");
      for (const activity of activities) {
        if (result.activities.length >= LIMITS.activities)
          throw new Error("Activity limit");
        if (
          activity.kind === "Other" &&
          ["GPX", "KML"].includes(activity.format) &&
          fallbackType !== "Other"
        ) {
          activity.kind = fallbackType;
          activity.userType = true;
          activity.notes.push(
            "GPX/KML type explicitly selected by the user, not inferred from GPS.",
          );
        }
        staged.push(await normalizeActivity(activity));
      }
      result.activities.push(...staged);
    } catch {
      result.rejected++;
      result.notices.push(
        `File ${i + 1} rejected: unsupported, malformed, incomplete, unsafe, timezone missing or over a validation limit. No raw file data was logged.`,
      );
    }
    onProgress?.(i + 1, files.length);
  }
  return result;
}
