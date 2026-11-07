import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatClock,
  formatElapsed,
  isISODate,
  monthGrid,
  nowTimeInTimeZone,
  startOfWeek,
  todayInTimeZone,
  tzOffsetMinutes,
  zonedTimeToUtc,
  addMonths,
  formatDuration,
} from "@/lib/dates";

const NY = "America/New_York";

describe("plain dates", () => {
  it("validates and does arithmetic without host time-zone drift", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    // Across both 2026/27 DST transitions, a "day" is always one calendar day.
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2027-03-13", 1)).toBe("2027-03-14");
    expect(diffDays("2026-11-01", "2026-11-08")).toBe(7);
  });

  it("computes Monday-based weeks and month grids", () => {
    expect(startOfWeek("2026-11-07")).toBe("2026-11-02"); // Saturday → Monday
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
    const grid = monthGrid(2026, 11);
    expect(grid[0][0]).toBe("2026-10-26");
    expect(grid[grid.length - 1][6] >= "2026-11-30").toBe(true);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });
});

describe("time zones and daylight saving", () => {
  it("knows the New York offsets on both sides of the November 1, 2026 change", () => {
    expect(tzOffsetMinutes(new Date("2026-10-30T12:00:00Z"), NY)).toBe(-240); // EDT
    expect(tzOffsetMinutes(new Date("2026-11-03T12:00:00Z"), NY)).toBe(-300); // EST
  });

  it("keeps 3:30 PM local when the absolute instant shifts across DST", () => {
    expect(zonedTimeToUtc("2026-10-30", "15:30", NY).toISOString()).toBe("2026-10-30T19:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-02", "15:30", NY).toISOString()).toBe("2026-11-02T20:30:00.000Z");
    // Spring forward (March 14, 2027)
    expect(zonedTimeToUtc("2027-03-12", "15:30", NY).toISOString()).toBe("2027-03-12T20:30:00.000Z");
    expect(zonedTimeToUtc("2027-03-15", "15:30", NY).toISOString()).toBe("2027-03-15T19:30:00.000Z");
  });

  it("handles the repeated and skipped hours deterministically", () => {
    // 1:30 AM happens twice on Nov 1 2026 — resolves to a valid instant.
    const ambiguous = zonedTimeToUtc("2026-11-01", "01:30", NY);
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]).toContain(ambiguous.toISOString());
    // 2:30 AM does not exist on Mar 14 2027 — resolves to 3:30 EDT.
    expect(zonedTimeToUtc("2027-03-14", "02:30", NY).toISOString()).toBe("2027-03-14T07:30:00.000Z");
  });

  it("derives today's local date and time for the team time zone", () => {
    const instant = new Date("2026-11-08T03:30:00Z"); // 10:30 PM Nov 7 in New York
    expect(todayInTimeZone(NY, instant)).toBe("2026-11-07");
    expect(nowTimeInTimeZone(NY, instant)).toBe("22:30");
  });
});

describe("formatting", () => {
  it("formats clock times, elapsed time and durations", () => {
    expect(formatClock("15:30")).toBe("3:30 PM");
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(formatClock("12:00", { compact: true })).toBe("12p");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatDuration(150)).toBe("2 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
  });
});
