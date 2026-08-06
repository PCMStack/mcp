import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { cdbToSql, sqlToCdb } from "cdb-converter";
import initSqlJs from "sql.js";
import { errorResponse, validResponse } from "./helpers";

/**
 * A Pro Cycling Manager `.cdb` database file on disk.
 *
 * `.cdb` is Cyanide's binary database format. The same format backs both a
 * player's career save (see `saves.ts`) and a standalone database such as an
 * official release or a community update — every tool here accepts either.
 */
export interface CdbFile {
	/** Absolute path to the `.cdb` file. */
	path: string;
	/** File name, e.g. `OfficialRelease-2025.cdb`. */
	name: string;
	/** Last modification time as an ISO 8601 string. */
	lastModified: string;
	/** File size in bytes. */
	sizeBytes: number;
}

/** An in-memory sql.js database decoded from a `.cdb` file by `cdbToSql`. */
export type CdbDatabase = ReturnType<typeof cdbToSql>;

/** Smallest plausible `YYYYMMDD` value (year 1000), used to reject sentinels. */
const MIN_YMD = 10000000;

/**
 * Validate that `databasePath` points to an existing `.cdb` file and return its
 * metadata. Performs no caching and mutates no state.
 *
 * @throws if the path does not end in `.cdb`, does not exist, or is not a file.
 */
export async function validateCdb(databasePath: string): Promise<CdbFile> {
	if (!databasePath.toLowerCase().endsWith(".cdb")) {
		throw new Error(`Not a .cdb file: ${databasePath}`);
	}

	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(databasePath);
	} catch {
		throw new Error(`Database file not found: ${databasePath}`);
	}

	if (!info.isFile()) {
		throw new Error(`Path is not a file: ${databasePath}`);
	}

	return {
		path: databasePath,
		name: basename(databasePath),
		lastModified: info.mtime.toISOString(),
		sizeBytes: info.size,
	};
}

/**
 * Read the current in-game date from a database as a `YYYYMMDD` integer
 * (e.g. `20260605`), or `null` when it can't be found or isn't a real date.
 *
 * PCM stores the career's current date in `GAM_config.gene_i_date`. It is the
 * reference point for any age- or season-relative computation, since a career
 * save advances as the career is played. Fresh official releases that haven't
 * started a career store `0` here; that sentinel is treated as "unknown"
 * (returns `null`) so callers don't derive nonsensical ages from it.
 */
export function getGameDate(db: CdbDatabase): number | null {
	try {
		const result = db.exec("SELECT gene_i_date FROM GAM_config LIMIT 1");
		const raw = result[0]?.values?.[0]?.[0];
		if (raw == null) {
			return null;
		}
		const value = Number(raw);
		return Number.isFinite(value) && value >= MIN_YMD ? value : null;
	} catch {
		return null;
	}
}

/**
 * Column names of `tableName` as a Set, via `PRAGMA table_info`.
 *
 * Some columns are absent from databases that pre-date them — check membership
 * with `.has()` so queries stay valid across PCM versions. Returns an empty set
 * for unknown tables.
 */
export function getTableColumnNames(
	db: CdbDatabase,
	tableName: string,
): Set<string> {
	const columnInfo = db.exec(
		`PRAGMA table_info("${tableName.replaceAll('"', '""')}")`,
	);
	return new Set((columnInfo[0]?.values ?? []).map((r) => String(r[1])));
}

/**
 * Open a Pro Cycling Manager `.cdb` database in memory, run `fn`, and wrap the
 * result in an MCP tool response.
 *
 * Centralises the boilerplate every database-reading tool needs:
 *  - validates that `databasePath` points to an existing `.cdb` file
 *    (via {@link validateCdb}),
 *  - re-reads and decodes the file on every call with `cdbToSql`, so the data
 *    is never stale — the on-disk `.cdb` is the single source of truth,
 *  - guarantees the database is closed afterwards, even on error,
 *  - turns thrown errors into an {@link errorResponse} and the returned value
 *    into a {@link validResponse}.
 *
 * `withCdb` itself never writes to `databasePath`: the on-disk source is only
 * ever read. A write-capable tool can pass `{ queryOnly: false }`, mutate the
 * in-memory database in `fn`, and serialize the result to a *separate* output
 * file via {@link writeCdb} — the source is never overwritten.
 *
 * @param databasePath - Absolute path to the `.cdb` file.
 * @param fn - Receives the open database and the validated file metadata, and
 *   returns the tool's structured output.
 */
export async function withCdb<T extends Record<string, unknown>>(
	databasePath: string,
	fn: (db: CdbDatabase, file: CdbFile) => T | Promise<T>,
	config: {
		queryOnly?: boolean;
	} = {},
): Promise<CallToolResult> {
	let db: CdbDatabase | undefined;
	try {
		const file = await validateCdb(databasePath);

		const SQL = await initSqlJs();
		const cdbBuffer = await readFile(file.path);
		db = cdbToSql(cdbBuffer, SQL);

		if (config.queryOnly ?? true) {
			db.run("PRAGMA query_only = ON;");
		}

		const output = await fn(db, file);

		return validResponse(output);
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		db?.close();
	}
}

/**
 * Serialize an edited in-memory database back to a `.cdb` file at `outputPath`.
 *
 * Writes only ever go to a new file: this refuses to overwrite the source
 * database (`sourcePath`), so the input `.cdb` is never modified. `sqlToCdb`
 * re-encodes the sql.js database into PCM's compressed `.cdb` binary format.
 *
 * @param db - The (edited) in-memory database to serialize.
 * @param outputPath - Absolute path of the `.cdb` file to write.
 * @param sourcePath - Absolute path of the source database, used only to guard
 *   against overwriting it.
 * @returns The absolute path written.
 * @throws if `outputPath` isn't a `.cdb` file, resolves to `sourcePath`, points
 *   into a missing directory, or would overwrite an existing file.
 */
export async function writeCdb(
	db: CdbDatabase,
	outputPath: string,
	sourcePath: string,
): Promise<string> {
	if (!outputPath.toLowerCase().endsWith(".cdb")) {
		throw new Error(`Output must be a .cdb file: ${outputPath}`);
	}

	const resolvedOutput = resolve(outputPath);
	if (resolvedOutput === resolve(sourcePath)) {
		throw new Error(
			"outputPath must differ from the source database — the input .cdb is never overwritten.",
		);
	}

	// Never clobber an existing file: writes only ever create a new `.cdb`.
	if (await pathExists(resolvedOutput)) {
		throw new Error(
			`outputPath already exists: ${resolvedOutput} — choose a new file name so no existing file is overwritten.`,
		);
	}

	// Fail early with an actionable message rather than a raw ENOENT from writeFile.
	const parent = dirname(resolvedOutput);
	if (!(await isDirectory(parent))) {
		throw new Error(
			`Output directory does not exist: ${parent} — create it first or point outputPath at an existing directory.`,
		);
	}

	const cdb = sqlToCdb(db);
	try {
		await writeFile(resolvedOutput, Buffer.from(cdb), { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(
				`outputPath already exists: ${resolvedOutput} — choose a new file name so no existing file is overwritten.`,
			);
		}
		throw error;
	}
	return resolvedOutput;
}

/** True if `path` exists (file or directory). */
async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

/** True if `path` exists and is a directory. */
async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}
