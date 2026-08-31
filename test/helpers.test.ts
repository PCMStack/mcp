import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import {
	ageFromYmd,
	errorResponse,
	getCareerValue,
	stageDate,
	validResponse,
} from "../src/helpers";

/** A real in-memory sql.js database, for the helpers that read one. */
async function realDatabase() {
	const SQL = await initSqlJs();
	return new SQL.Database();
}

describe("validResponse", () => {
	it("wraps structured content as pretty-printed JSON text", () => {
		const result = validResponse({ name: "Tadej", wins: 3 });

		expect(result.structuredContent).toEqual({ name: "Tadej", wins: 3 });
		expect(result.content).toEqual([
			{
				type: "text",
				text: JSON.stringify({ name: "Tadej", wins: 3 }, null, 2),
			},
		]);
		expect(result.isError).toBeUndefined();
	});

	it("returns empty text when there is no structured content", () => {
		const result = validResponse(undefined);

		expect(result.structuredContent).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: "" }]);
	});
});

describe("ageFromYmd", () => {
	it("computes age when this year's birthday has already passed", () => {
		// born 2003-05-03, current 2026-06-05 → 23rd birthday already passed
		expect(ageFromYmd(20260605, 20030503)).toBe(23);
	});

	it("subtracts a year when this year's birthday has not occurred yet", () => {
		// born 2003-07-20, current 2026-06-05 → still 22 until July
		expect(ageFromYmd(20260605, 20030720)).toBe(22);
	});

	it("counts the birthday itself as a full year", () => {
		// born 2003-06-05, current 2026-06-05 → exactly 23 on the day
		expect(ageFromYmd(20260605, 20030605)).toBe(23);
	});

	it("treats the day before the birthday as the younger age", () => {
		// born 2003-06-05, current 2026-06-04 → still 22, one day short
		expect(ageFromYmd(20260604, 20030605)).toBe(22);
	});
});

describe("stageDate", () => {
	it("formats the date a played career stamped on the stage", () => {
		expect(stageDate(20260704, 4, 7, 2026)).toBe("2026-07-04");
	});

	it("pads single-digit months and days", () => {
		expect(stageDate(20260102, 2, 1, 2026)).toBe("2026-01-02");
	});

	// The computed date is the game's own resolution of the calendar, so it
	// wins over the day/month the static calendar carries.
	it("prefers the computed date over the day and month", () => {
		expect(stageDate(20260704, 13, 4, 2026)).toBe("2026-07-04");
	});

	it("falls back to the day and month in the current season", () => {
		// 0 is the sentinel on a database the game has never advanced.
		expect(stageDate(0, 13, 4, 2026)).toBe("2026-04-13");
		expect(stageDate(null, 13, 4, 2026)).toBe("2026-04-13");
	});

	// Anything below year 1000 is a sentinel, not a date.
	it("rejects an implausible computed date and falls back", () => {
		expect(stageDate(412, 13, 4, 2026)).toBe("2026-04-13");
	});

	it("returns null without a season to place the day and month in", () => {
		expect(stageDate(0, 13, 4, null)).toBeNull();
	});

	it("returns null when the stage carries no day or month", () => {
		expect(stageDate(0, 0, 0, 2026)).toBeNull();
		expect(stageDate(null, null, null, 2026)).toBeNull();
	});

	// sql.js hands back numbers, but the column type is not guaranteed.
	it("accepts numeric strings", () => {
		expect(stageDate("20260704", "4", "7", 2026)).toBe("2026-07-04");
	});
});

describe("errorResponse", () => {
	it("flags the response as an error and echoes the message", () => {
		const result = errorResponse("Save file not found");

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "Save file not found" },
		]);
	});
});

describe("getCareerValue", () => {
	/** A GAM_career_data laid out the way recent editions store it. */
	async function careerDatabase(rows: [string, number][]) {
		const db = await realDatabase();
		db.run(
			"CREATE TABLE GAM_career_data (UID INTEGER, CONSTANT TEXT, value REAL)",
		);
		for (const [constant, value] of rows) {
			db.run("INSERT INTO GAM_career_data VALUES (1, $constant, $value)", {
				$constant: constant,
				$value: value,
			});
		}
		return db;
	}

	it("reads the value of a key", async () => {
		const db = await careerDatabase([
			["SPONSOR_OBJECTIVE_WIN", 12],
			["SPONSOR_OBJECTIVE_RANKING", 5],
		]);
		try {
			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_WIN")).toBe(12);
			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_RANKING")).toBe(5);
		} finally {
			db.close();
		}
	});

	it("returns null for a key the database does not carry", async () => {
		const db = await careerDatabase([["DOTATION", 0]]);
		try {
			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_WIN")).toBeNull();
		} finally {
			db.close();
		}
	});

	// PCM 2014 stores career data as one row of named columns, with no
	// key/value pair to look up.
	it("returns null when the table pre-dates the key/value shape", async () => {
		const db = await realDatabase();
		try {
			db.run(
				"CREATE TABLE GAM_career_data (UID INTEGER, value_i_dotation INTEGER)",
			);

			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_WIN")).toBeNull();
		} finally {
			db.close();
		}
	});

	it("returns null when the table is missing altogether", async () => {
		const db = await realDatabase();
		try {
			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_WIN")).toBeNull();
		} finally {
			db.close();
		}
	});

	it("returns null for a value that is not a number", async () => {
		const db = await realDatabase();
		try {
			db.run(
				"CREATE TABLE GAM_career_data (UID INTEGER, CONSTANT TEXT, value TEXT)",
			);
			db.run(
				"INSERT INTO GAM_career_data VALUES (1, 'SPONSOR_OBJECTIVE_WIN', 'many')",
			);

			expect(getCareerValue(db, "SPONSOR_OBJECTIVE_WIN")).toBeNull();
		} finally {
			db.close();
		}
	});
});
