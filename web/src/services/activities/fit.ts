import FitParser from "fit-file-parser";
import {
  readFitMessages,
  fitTimestampToUnixMilliseconds,
} from "fit-file-parser/raw";
import { normalizeKind } from "../calculations";
import {
  LIMITS,
  number,
  raw,
  timestamp,
  validateRaw,
  type RawActivity,
} from "./model";
/** Allocation preflight only, not a replacement decoder. Strict maintained readers still validate framing and CRC. */
export function fitBudget(bytes: Uint8Array): void {
  if (bytes.length < 14 || bytes.length > 4 * 1024 * 1024)
    throw new Error("FIT size limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    end = bytes[0] + view.getUint32(4, true);
  if (![12, 14].includes(bytes[0]) || end + 2 !== bytes.length)
    throw new Error("Invalid FIT framing.");
  const definitions = new Map<number, { size: number; time: number }>();
  let offset = bytes[0],
    count = 0;
  while (offset < end) {
    if (++count > 30000) throw new Error("FIT message limit exceeded.");
    const header = bytes[offset++];
    if (!(header & 128) && header & 64) {
      if (offset + 5 > end) throw new Error("Truncated FIT definition.");
      const fields = bytes[offset + 4];
      offset += 5;
      if (fields > 64 || offset + fields * 3 > end)
        throw new Error("FIT field budget exceeded.");
      let size = 0,
        time = 0;
      for (let i = 0; i < fields; i++) {
        if (i === 0 && bytes[offset] === 253) time = bytes[offset + 1];
        size += bytes[offset + 1];
        offset += 3;
      }
      if (header & 32) {
        const developer = bytes[offset++];
        if (developer > 32 || offset + developer * 3 > end)
          throw new Error("FIT developer field budget.");
        for (let i = 0; i < developer; i++) {
          size += bytes[offset + 1];
          offset += 3;
        }
      }
      definitions.set(header & 15, { size, time });
    } else {
      const compressed = Boolean(header & 128),
        def = definitions.get(compressed ? (header >> 5) & 3 : header & 15);
      if (!def || def.size <= 0)
        throw new Error("Invalid FIT definition reference.");
      offset += def.size - (compressed ? def.time : 0);
    }
    if (offset > end) throw new Error("Truncated FIT record.");
  }
}
export async function parseFit(
  bytes: Uint8Array,
  fileHash: string,
): Promise<RawActivity[]> {
  fitBudget(bytes);
  const rawMessages = readFitMessages(bytes, {
    messageNumbers: [20],
    maxInputBytes: 4 * 1024 * 1024,
  });
  const data = await new FitParser({
    force: false,
    strict: true,
    mode: "list",
    lengthUnit: "m",
    speedUnit: "m/s",
  }).parseAsync(bytes.slice().buffer as ArrayBuffer);
  const sessions = data.sessions ?? [],
    records = data.records ?? [];
  if (
    !sessions.length ||
    sessions.length > LIMITS.activities ||
    records.length > LIMITS.samples
  )
    throw new Error("FIT session/sample limits or missing sessions.");
  const invalidFixes = rawMessages.messages.flatMap((message) => {
    const coords = message.fields.filter(
      (f) => f.fieldNumber === 0 || f.fieldNumber === 1,
    );
    const invalid = coords.some(
      (f) =>
        f.bytes.length === 4 &&
        new DataView(f.bytes.buffer, f.bytes.byteOffset, 4).getInt32(
          0,
          message.littleEndian,
        ) === 0x7fffffff,
    );
    return invalid && message.timestamp !== undefined
      ? [
          {
            time: fitTimestampToUnixMilliseconds(message.timestamp),
            latitude: NaN,
            longitude: NaN,
            segment: 0,
          },
        ]
      : [];
  });
  return sessions.map((session) => {
    const start = timestamp(session.start_time),
      elapsed = number(session.total_elapsed_time, 0, 86400);
    const finish = timestamp(session.timestamp);
    const end =
      finish !== null && start !== null && finish > start
        ? finish
        : start !== null && elapsed !== null && elapsed > 0
          ? start + elapsed * 1000
          : null;
    if (start === null || end === null)
      throw new Error("FIT session lacks reliable timestamps.");
    const sport = String(session.sport ?? ""),
      subtype = String(session.sub_sport ?? "");
    const explicitSubtype = /strength|yoga/.test(subtype) ? subtype : sport;
    const kind = /strength|yoga/.test(subtype)
      ? normalizeKind(subtype.replace(/_/g, " "))
      : sport === "generic"
        ? "Training"
        : normalizeKind(explicitSubtype.replace(/_/g, " "));
    const item = raw("FIT", fileHash, start, end, kind);
    item.nativeId = `${start}|${kind}`;
    item.reportedElapsedSeconds = elapsed;
    item.movingSeconds = number(session.total_moving_time, 0, 86400);
    item.reportedMeters = number(session.total_distance, 0, 500000);
    item.averageHr = number(session.avg_heart_rate, 25, 250);
    item.maxHr = number(session.max_heart_rate, 25, 250);
    item.calories = number(session.total_calories, 0, 30000);
    item.elevationGainMeters = number(session.total_ascent, 0, 30000);
    item.cadence = number(session.avg_cadence, 0, 400);
    item.cadenceUnit = item.cadence === null ? null : "rpm";
    for (const record of records) {
      const time = timestamp(record.timestamp);
      if (time === null || time < start || time > end) continue;
      if (
        record.position_lat !== undefined &&
        record.position_long !== undefined
      )
        item.fixes.push({
          time,
          latitude: record.position_lat,
          longitude: record.position_long,
          segment: 0,
        });
      const hr = number(record.heart_rate, 25, 250);
      if (hr !== null) item.hrSamples.push({ time, value: hr });
      const elevation = number(
        record.enhanced_altitude ?? record.altitude,
        -1000,
        10000,
      );
      if (elevation !== null)
        item.elevationSamples.push({ time, value: elevation });
    }
    item.fixes.push(
      ...invalidFixes.filter((f) => f.time >= start && f.time <= end),
    );
    if (session.total_timer_time !== undefined && item.movingSeconds === null)
      item.notes.push("FIT timer time is not assumed to be moving time.");
    validateRaw(item);
    return item;
  });
}
