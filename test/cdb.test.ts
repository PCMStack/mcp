import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdbToSql } from "cdb-converter";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { getTableColumnNames, validateCdb, withCdb } from "../src/cdb";

// withCdb reads a real .cdb file but the cdb->SQL conversion needs the real
// binary format, so we stub it out and hand back a fake in-memory database.
vi.mock("cdb-converter", () => ({ cdbToSql: vi.fn() }));
vi.mock("sql.js", () => ({ default: vi.fn(() => ({})) }));

const cdbToSqlMock = cdbToSql as Mock;

let dir: string;
let databasePath: string;
/** A fake sql.js database; we only care that it gets closed and configured. */
const fakeDb = { close: vi.fn(), run: vi.fn() };

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "pcm-cdb-"));
	databasePath = join(dir, "Career.cdb");
	await writeFile(databasePath, "raw cdb bytes");

	cdbToSqlMock.mockReset();
	cdbToSqlMock.mockReturnValue(fakeDb);
	fakeDb.close.mockReset();
	fakeDb.run.mockReset();
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("withCdb", () => {
	it("wraps the callback's output in a valid response", async () => {
		const result = await withCdb(databasePath, () => ({ riders: 42 }));

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({ riders: 42 });
	});

	it("passes the open database and file metadata to the callback", async () => {
		const fn = vi.fn((_db: unknown, _file: { name: string; path: string }) => ({
			ok: true,
		}));

		await withCdb(databasePath, fn);

		const [db, file] = fn.mock.calls[0];
		expect(db).toBe(fakeDb);
		expect(file.name).toBe("Career.cdb");
		expect(file.path).toBe(databasePath);
	});

	it("puts the database in read-only mode before running the callback", async () => {
		const runOrder: string[] = [];
		fakeDb.run.mockImplementation((sql: string) => runOrder.push(sql));

		await withCdb(databasePath, () => {
			runOrder.push("callback");
			return {};
		});

		expect(fakeDb.run).toHaveBeenCalledWith("PRAGMA query_only = ON;");
		expect(runOrder).toEqual(["PRAGMA query_only = ON;", "callback"]);
	});

	it("supports async callbacks", async () => {
		const result = await withCdb(databasePath, async () => ({ async: true }));

		expect(result.structuredContent).toEqual({ async: true });
	});

	it("closes the database after a successful call", async () => {
		await withCdb(databasePath, () => ({}));

		expect(fakeDb.close).toHaveBeenCalledTimes(1);
	});

	it("closes the database even when the callback throws", async () => {
		const result = await withCdb(databasePath, () => {
			throw new Error("boom");
		});

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("boom");
		expect(fakeDb.close).toHaveBeenCalledTimes(1);
	});

	it("returns an error response for a non-.cdb path without opening a database", async () => {
		const result = await withCdb(join(dir, "notes.txt"), () => ({}));

		expect(result.isError).toBe(true);
		expect(cdbToSqlMock).not.toHaveBeenCalled();
		expect(fakeDb.close).not.toHaveBeenCalled();
	});
});

describe("validateCdb", () => {
	it("returns metadata for an existing .cdb file", async () => {
		const file = await validateCdb(databasePath);

		expect(file.name).toBe("Career.cdb");
		expect(file.path).toBe(databasePath);
		expect(file.sizeBytes).toBeGreaterThan(0);
		expect(file.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("rejects a path that is not a .cdb file", async () => {
		await expect(validateCdb(join(dir, "notes.txt"))).rejects.toThrow(
			"Not a .cdb file",
		);
	});

	it("rejects a .cdb path that does not exist", async () => {
		await expect(validateCdb(join(dir, "missing.cdb"))).rejects.toThrow(
			"Database file not found",
		);
	});
});

describe("getTableColumnNames", () => {
	// sql.js is mocked at module level for the withCdb tests; these tests
	// need a real in-memory database, so pull in the actual module.
	async function realDatabase() {
		const { default: initSqlJs } =
			await vi.importActual<typeof import("sql.js")>("sql.js");
		const SQL = await initSqlJs();
		return new SQL.Database();
	}

	it("returns the column names of a known table", async () => {
		const db = await realDatabase();
		try {
			db.run(
				"CREATE TABLE DYN_cyclist (IDcyclist INTEGER PRIMARY KEY, charac_i_sprint INTEGER)",
			);

			expect(getTableColumnNames(db, "DYN_cyclist")).toEqual(
				new Set(["IDcyclist", "charac_i_sprint"]),
			);
		} finally {
			db.close();
		}
	});

	it("returns an empty set for an unknown table", async () => {
		const db = await realDatabase();
		try {
			expect(getTableColumnNames(db, "not_a_table")).toEqual(new Set());
		} finally {
			db.close();
		}
	});
});
