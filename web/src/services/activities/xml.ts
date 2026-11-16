import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeKind } from "../calculations";
import {
  LIMITS,
  number,
  raw,
  timestamp,
  validateRaw,
  type RawActivity,
} from "./model";
type Node = Record<string, unknown>;
const object = (v: unknown): Node =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : {};
const list = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v];
const child = (v: unknown, key: string): unknown => object(v)[key];
const nested = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce(child, v);
export function safeXml(text: string): Node {
  if (text.includes(String.fromCharCode(0)))
    throw new Error("Unsafe XML rejected.");
  if (
    /<!\s*(?:DOCTYPE|ENTITY)|<(?:\w+:)?(?:__proto__|constructor|prototype)(?:\s|>)/i.test(
      text,
    )
  )
    throw new Error("Unsafe XML rejected.");
  let depth = 0,
    tags = 0;
  for (const match of text.matchAll(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_](?:"[^"]*"|'[^']*'|[^'">])*?>/g,
  )) {
    if (match[0].startsWith("<!") || match[0].startsWith("<?")) continue;
    if (++tags > LIMITS.xmlTags) throw new Error("XML tag limit exceeded.");
    if (match[0].startsWith("</")) depth--;
    else if (!match[0].endsWith("/>")) depth++;
    if (depth > LIMITS.depth) throw new Error("XML nesting limit exceeded.");
  }
  if (XMLValidator.validate(text, { allowBooleanAttributes: false }) !== true)
    throw new Error("Malformed XML rejected.");
  return object(
    new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      processEntities: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    }).parse(text),
  );
}
function samples(
  activity: RawActivity,
  points: unknown[],
  format: "TCX" | "GPX",
  segment: number,
) {
  if (points.length + activity.fixes.length > LIMITS.samples)
    throw new Error("Sample limit exceeded.");
  for (const point of points) {
    const time = timestamp(child(point, format === "TCX" ? "Time" : "time"));
    if (time === null) {
      activity.notes.push(
        "A track sample lacks an absolute timestamp; it was excluded.",
      );
      continue;
    }
    const lat =
      format === "TCX"
        ? nested(point, "Position", "LatitudeDegrees")
        : child(point, "@_lat");
    const lon =
      format === "TCX"
        ? nested(point, "Position", "LongitudeDegrees")
        : child(point, "@_lon");
    if (lat !== undefined || lon !== undefined)
      activity.fixes.push({
        time,
        latitude: number(lat, -90, 90) ?? NaN,
        longitude: number(lon, -180, 180) ?? NaN,
        segment,
      });
    const hr = number(
      format === "TCX"
        ? nested(point, "HeartRateBpm", "Value")
        : nested(point, "extensions", "TrackPointExtension", "hr"),
      25,
      250,
    );
    if (hr !== null) activity.hrSamples.push({ time, value: hr });
    const elevation = number(
      child(point, format === "TCX" ? "AltitudeMeters" : "ele"),
      -1000,
      10000,
    );
    if (elevation !== null)
      activity.elevationSamples.push({ time, value: elevation });
  }
}
export function parseXml(
  text: string,
  format: "TCX" | "GPX" | "KML",
  fileHash: string,
): RawActivity[] {
  const root = safeXml(text);
  const output: RawActivity[] = [];
  if (format === "TCX") {
    for (const act of list(
      nested(root, "TrainingCenterDatabase", "Activities", "Activity"),
    )) {
      const laps = list(child(act, "Lap"));
      const tracks = laps.flatMap((lap) => list(child(lap, "Track")));
      const points = tracks.flatMap((track) =>
        list(child(track, "Trackpoint")),
      );
      const start =
        timestamp(child(act, "Id")) ?? timestamp(child(laps[0], "@_StartTime"));
      const elapsed = laps.map((lap) =>
        number(child(lap, "TotalTimeSeconds"), 0, 86400),
      );
      const total =
        elapsed.length && elapsed.every((v) => v !== null)
          ? elapsed.reduce<number>((a, b) => a + b!, 0)
          : null;
      const pointTimes = points
        .map((point) => timestamp(child(point, "Time")))
        .filter((v): v is number => v !== null);
      const lastPoint = pointTimes.length ? Math.max(...pointTimes) : null;
      const end =
        start !== null && total !== null && total > 0
          ? Math.max(start + total * 1000, lastPoint ?? 0)
          : lastPoint;
      if (start === null || end === null)
        throw new Error("TCX activity lacks reliable start/end.");
      const sport = String(child(act, "@_Sport") ?? "");
      const kind = /other/i.test(sport) ? "Training" : normalizeKind(sport);
      const item = raw(format, fileHash, start, end, kind);
      item.nativeId =
        typeof child(act, "Id") === "string"
          ? (child(act, "Id") as string)
          : null;
      item.reportedElapsedSeconds = total;
      const distances = laps.map((lap) =>
        number(child(lap, "DistanceMeters"), 0, 500000),
      );
      if (distances.length && distances.every((v) => v !== null))
        item.reportedMeters = distances.reduce<number>((a, b) => a + b!, 0);
      const calories = laps.map((lap) =>
        number(child(lap, "Calories"), 0, 30000),
      );
      if (calories.length && calories.every((v) => v !== null))
        item.calories = calories.reduce<number>((a, b) => a + b!, 0);
      const weighted = laps.map((lap, i) => ({
        hr: number(nested(lap, "AverageHeartRateBpm", "Value"), 25, 250),
        duration: elapsed[i],
      }));
      if (
        weighted.length &&
        weighted.every(
          (v) => v.hr !== null && v.duration !== null && v.duration > 0,
        )
      )
        item.averageHr =
          weighted.reduce((a, b) => a + b.hr! * b.duration!, 0) /
          weighted.reduce((a, b) => a + b.duration!, 0);
      const maxima = laps.map((lap) =>
        number(nested(lap, "MaximumHeartRateBpm", "Value"), 25, 250),
      );
      if (maxima.length && maxima.every((v) => v !== null))
        item.maxHr = Math.max(...(maxima as number[]));
      tracks.forEach((track, i) =>
        samples(item, list(child(track, "Trackpoint")), "TCX", i),
      );
      // TCX cadence is usually revolutions/cycles per minute; never double it into steps.
      const cadences = points
        .map((p) => number(child(p, "Cadence"), 0, 400))
        .filter((n): n is number => n !== null);
      if (cadences.length) {
        item.cadence = cadences.reduce((a, b) => a + b, 0) / cadences.length;
        item.cadenceUnit = "rpm";
        item.derived.push("cadence");
      }
      validateRaw(item);
      output.push(item);
    }
  } else if (format === "GPX") {
    for (const track of list(nested(root, "gpx", "trk"))) {
      const segments = list(child(track, "trkseg"));
      const times = segments
        .flatMap((seg) => list(child(seg, "trkpt")))
        .map((p) => timestamp(child(p, "time")))
        .filter((t): t is number => t !== null);
      if (times.length < 2)
        throw new Error(
          "GPX requires timestamped track points; untimed routes are not workouts.",
        );
      const item = raw(
        format,
        fileHash,
        Math.min(...times),
        Math.max(...times),
        normalizeKind(String(child(track, "type") ?? "")),
        typeof child(track, "name") === "string"
          ? (child(track, "name") as string)
          : undefined,
      );
      segments.forEach((seg, i) =>
        samples(item, list(child(seg, "trkpt")), "GPX", i),
      );
      item.notes.push(
        "Route-derived duration; moving time and source distance are missing unless supplied by a companion activity.",
      );
      validateRaw(item);
      output.push(item);
    }
  } else {
    const walk = (node: unknown): void => {
      for (const [key, value] of Object.entries(object(node))) {
        if (key === "Track") {
          for (const track of list(value)) {
            const times = list(child(track, "when")),
              coords = list(child(track, "coord"));
            if (
              times.length !== coords.length ||
              times.length < 2 ||
              times.length > LIMITS.samples
            )
              throw new Error(
                "KML fallback requires aligned gx:Track timestamps/coordinates.",
              );
            const parsed = times.map((t) => timestamp(t));
            if (parsed.some((t) => t === null))
              throw new Error("KML timestamp invalid.");
            const item = raw(
              format,
              fileHash,
              parsed[0]!,
              parsed.at(-1)!,
              "Other",
            );
            coords.forEach((c, i) => {
              const parts = String(c).trim().split(/\s+/);
              item.fixes.push({
                time: parsed[i]!,
                latitude: number(parts[1], -90, 90) ?? NaN,
                longitude: number(parts[0], -180, 180) ?? NaN,
                segment: 0,
              });
            });
            item.notes.push(
              "KML GPS fallback: type/moving time/source distance missing.",
            );
            validateRaw(item);
            output.push(item);
          }
        } else
          for (const childNode of list(value))
            if (typeof childNode === "object") walk(childNode);
      }
    };
    walk(root);
  }
  if (!output.length)
    throw new Error("No supported timestamped activities in XML.");
  return output;
}
