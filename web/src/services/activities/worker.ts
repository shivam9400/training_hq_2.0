/// <reference lib="webworker" />
import { processActivities } from "./pipeline";
import type { InputFile } from "./model";
self.onmessage = async (
  event: MessageEvent<{
    inputs: InputFile[];
    offset: string;
    fallbackType: "Other" | "Walk" | "Run";
  }>,
) => {
  try {
    const result = await processActivities(
      event.data.inputs,
      event.data.offset,
      undefined,
      (done, total) => self.postMessage({ kind: "progress", done, total }),
      event.data.fallbackType,
    );
    self.postMessage({ kind: "result", result });
  } catch {
    self.postMessage({
      kind: "error",
      message:
        "Archive/selection rejected. Check safety limits, format and file integrity. No records were written.",
    });
  }
};
