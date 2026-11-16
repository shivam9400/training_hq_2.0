// Independently generated fixtures only. No real routes, device IDs, files or health records.
import { FitEncoder, FitBaseType as B } from "fit-file-parser/encoder";
import { getFitSportId } from "fit-file-parser/profile";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
export const START = Date.parse("2028-02-07T07:00:00Z");
export const wire = (text: string) => new TextEncoder().encode(text);
const fitTime = (ms: number) => FitEncoder.toFitTimestamp(new Date(ms));
export function syntheticFixes() {
  return Array.from({ length: 301 }, (_, i) => ({
    time: START + i * 10000,
    latitude: 1,
    longitude: 1 + (4260 / (111194.9266 * Math.cos(Math.PI / 180))) * (i / 300),
  }));
}
export function syntheticFit(gps = true, invalid = 300): Uint8Array {
  const encoder = new FitEncoder();
  encoder.writeMessage(
    18,
    [
      {
        number: 253,
        size: 4,
        baseType: B.Uint32,
        value: fitTime(START + 3000000),
      },
      { number: 2, size: 4, baseType: B.Uint32, value: fitTime(START) },
      {
        number: 5,
        size: 1,
        baseType: B.Enum,
        value: getFitSportId(gps ? "walking" : "fitness_equipment")!,
      },
      { number: 7, size: 4, baseType: B.Uint32, value: 3000000 },
      { number: 8, size: 4, baseType: B.Uint32, value: 2900000 },
      { number: 9, size: 4, baseType: B.Uint32, value: gps ? 832000 : 0 },
      { number: 16, size: 1, baseType: B.Uint8, value: 120 },
      { number: 17, size: 1, baseType: B.Uint8, value: 140 },
      { number: 11, size: 2, baseType: B.Uint16, value: 220 },
    ],
    0,
  );
  const records = [
    ...syntheticFixes().map((f) => ({ ...f, invalid: false })),
    ...Array.from({ length: invalid }, (_, i) => ({
      time: START + (i + 0.5) * 10000,
      latitude: 0,
      longitude: 0,
      invalid: true,
    })),
  ].sort((a, b) => a.time - b.time);
  for (const point of records) {
    const fields = [
      { number: 253, size: 4, baseType: B.Uint32, value: fitTime(point.time) },
      { number: 3, size: 1, baseType: B.Uint8, value: 125 },
    ];
    if (gps)
      fields.push(
        {
          number: 0,
          size: 4,
          baseType: B.Sint32,
          value: point.invalid
            ? 0x7fffffff
            : Math.round((point.latitude * 2 ** 31) / 180),
        },
        {
          number: 1,
          size: 4,
          baseType: B.Sint32,
          value: point.invalid
            ? 0x7fffffff
            : Math.round((point.longitude * 2 ** 31) / 180),
        },
      );
    encoder.writeMessage(20, fields, 1);
  }
  return encoder.close();
}
export function syntheticTcx(gps = true): string {
  const points = syntheticFixes()
    .map(
      (f) =>
        `<Trackpoint><Time>${new Date(f.time).toISOString()}</Time>${gps ? `<Position><LatitudeDegrees>${f.latitude}</LatitudeDegrees><LongitudeDegrees>${f.longitude}</LongitudeDegrees></Position>` : ""}<HeartRateBpm><Value>125</Value></HeartRateBpm><AltitudeMeters>20</AltitudeMeters><Cadence>60</Cadence></Trackpoint>`,
    )
    .join("");
  return `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="${gps ? "Walking" : "Other"}"><Id>${new Date(START).toISOString()}</Id><Lap StartTime="${new Date(START).toISOString()}"><TotalTimeSeconds>3000</TotalTimeSeconds>${gps ? "<DistanceMeters>8320</DistanceMeters>" : ""}<Calories>220</Calories><AverageHeartRateBpm><Value>120</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>140</Value></MaximumHeartRateBpm><Track>${points}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
}
export function syntheticCsv(
  type = "Walking",
  start = new Date(START).toISOString(),
  id = "synthetic-workout",
): string {
  return `Start datetime,Activity type,Duration minutes,Distance km,Average heart rate,Calories kcal,Steps,Activity ID,Name\n${start},${type},50,8.32,120,220,6000,${id},"Synthetic workout, not a personal record"`;
}
export function syntheticGpx(): string {
  return `<gpx version="1.1"><trk><name>Synthetic track</name><type>walking</type><trkseg>${syntheticFixes()
    .map(
      (f) =>
        `<trkpt lat="${f.latitude}" lon="${f.longitude}"><time>${new Date(f.time).toISOString()}</time><ele>20</ele></trkpt>`,
    )
    .join("")}</trkseg></trk></gpx>`;
}
export async function syntheticZip(
  files: { name: string; bytes: Uint8Array }[],
  level = 6,
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  for (const file of files)
    await writer.add(file.name, new Uint8ArrayReader(file.bytes), { level });
  return writer.close();
}
