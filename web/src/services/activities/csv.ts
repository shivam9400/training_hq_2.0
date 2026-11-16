import Papa from "papaparse";
import { normalizeKind } from "../calculations";
import { normalizeHeader } from "../planImport";
import {
  LIMITS,
  number,
  raw,
  timestamp,
  validateRaw,
  type RawActivity,
} from "./model";
export function parseActivityCsv(
  text: string,
  fileHash: string,
  offset: string,
): { activities: RawActivity[]; notice?: string } {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (parsed.errors.length) throw new Error("Malformed CSV.");
  const [headers, ...rows] = parsed.data;
  if (!headers || rows.length > 5000)
    throw new Error("CSV row limit or missing headers.");
  const names = headers.map(normalizeHeader);
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate CSV headers.");
  const columns = (aliases: string[]) =>
    aliases
      .map(normalizeHeader)
      .map((a) => names.indexOf(a))
      .find((i) => i >= 0);
  const sportCol = columns([
    "sport",
    "sporttype",
    "activitytype",
    "exercisetype",
    "workouttype",
    "type",
  ]);
  const durationCol = columns([
    "durationminutes",
    "durationseconds",
    "durationmin",
    "durationsec",
    "activetime",
    "elapsedtime",
    "movingmin",
    "elapsedminutes",
    "duration",
  ]);
  if (
    sportCol === undefined ||
    (durationCol === undefined &&
      columns(["enddatetime", "endtimestamp", "endtime", "end"]) === undefined)
  )
    return {
      activities: [],
      notice: names.some((n) => /heartrate|restinghr|hrv/.test(n))
        ? "Continuous/daily HR CSV is not a workout file. Separate health-series ingestion is pending; no rows were uploaded or merged."
        : "CSV is not a supported workout summary. No records imported.",
    };
  if (rows.length > LIMITS.activities)
    throw new Error("Workout CSV row limit exceeded.");
  const activities = rows.map((row) => {
    if (row.length !== headers.length)
      throw new Error("CSV row width mismatch.");
    const get = (...aliases: string[]) => {
      const index = columns(aliases);
      return index === undefined ? undefined : row[index].trim();
    };
    const absolute = get(
      "startdatetime",
      "starttimestamp",
      "datetime",
      "timestamp",
      "startdate",
    );
    const date = get("date", "day");
    const clockTime = get("starttime", "time", "start");
    const base = absolute ?? date;
    const startValue =
      base && !/T|\s\d\d:/.test(base) && clockTime
        ? `${base}T${clockTime}`
        : (absolute ??
          (clockTime && /^\d{4}[./-]/.test(clockTime)
            ? clockTime
            : (date ?? clockTime)));
    const start = timestamp(startValue, offset);
    const minutes = number(
      get("durationminutes", "durationmin", "elapsedminutes"),
      0,
      1440,
    );
    const seconds = number(get("durationseconds", "durationsec"), 0, 86400);
    const clock = get("duration", "elapsedtime", "activetime");
    const hms = clock?.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
    const elapsed =
      minutes !== null
        ? minutes * 60
        : (seconds ??
          (hms
            ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
            : null));
    const rawEnd = get("enddatetime", "endtimestamp", "endtime", "end");
    const endValue =
      rawEnd && /^\d{2}:/.test(rawEnd) && startValue
        ? `${startValue.slice(0, 10)}T${rawEnd}`
        : rawEnd;
    const end =
      timestamp(endValue, offset) ??
      (start !== null && elapsed !== null ? start + elapsed * 1000 : null);
    if (start === null || end === null)
      throw new Error(
        "CSV requires reliable timestamps. Supply an explicit UTC offset for zone-less times.",
      );
    const kind = normalizeKind(String(row[sportCol]));
    const item = raw(
      "CSV",
      fileHash,
      start,
      end,
      kind,
      get("name", "title", "activityname", "workoutname"),
    );
    item.nativeId = get("activityid", "workoutid", "sourceid", "id") || null;
    item.reportedElapsedSeconds = elapsed;
    item.movingSeconds =
      number(get("movingseconds", "movingtimeseconds"), 0, 86400) ??
      (number(get("movingmin", "movingminutes"), 0, 1440) === null
        ? null
        : number(get("movingmin", "movingminutes"), 0, 1440)! * 60);
    const km = number(get("distancekm", "distancekilometers"), 0, 500);
    item.reportedMeters =
      km !== null
        ? km * 1000
        : number(get("distancem", "distancemeters"), 0, 500000);
    if (item.reportedMeters === null && get("distance") !== undefined)
      item.notes.push(
        "Ambiguous distance units ignored; use an explicit km/m header.",
      );
    item.averageHr = number(
      get("averageheartrate", "avghr", "avgheartrate"),
      25,
      250,
    );
    item.maxHr = number(
      get("maxheartrate", "maximumheartrate", "maxhr"),
      25,
      250,
    );
    item.calories = number(get("calorieskcal", "calories"), 0, 30000);
    item.steps = number(get("steps", "stepcount"), 0, 200000);
    item.cadence = number(get("cadencerpm", "averagecadencerpm"), 0, 400);
    item.cadenceUnit = item.cadence === null ? null : "rpm";
    if (item.cadence === null) {
      item.cadence = number(get("cadencestepsperminute"), 0, 400);
      if (item.cadence !== null) item.cadenceUnit = "steps/min";
    }
    item.elevationGainMeters = number(
      get("elevationgainm", "ascentmeters", "totalascentm"),
      0,
      30000,
    );
    validateRaw(item);
    return item;
  });
  return { activities };
}
