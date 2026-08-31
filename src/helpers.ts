import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Result as IdentifyResult, identify } from "sql-query-identifier";
import { type CdbDatabase, getTableColumnNames, MIN_YMD } from "./cdb";

export function validResponse(
	structured:
		| {
				[x: string]: unknown;
		  }
		| undefined,
): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: structured ? JSON.stringify(structured, null, 2) : "",
			},
		],
		structuredContent: structured,
	};
}

export function errorResponse(error: string): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: error,
			},
		],
		isError: true,
	};
}

export interface StartlistTeam {
	id: number;
	cyclists: number[];
}

/**
 * Build a Pro Cycling Manager startlist XML document from a list of teams and
 * their cyclist rosters. The output mirrors PCM's expected format: a
 * `<startlist>` root, `<team id="N">` children (4-space indent) and
 * self-closing `<cyclist id="N" />` elements (8-space indent).
 */
export function buildStartlistXml(teams: StartlistTeam[]): string {
	if (teams.length === 0) {
		throw new Error("Provide at least one team.");
	}
	const lines: string[] = ["<startlist>"];
	for (const team of teams) {
		if (team.cyclists.length === 0) {
			throw new Error(`Team ${team.id} has no cyclists.`);
		}
		lines.push(`    <team id="${team.id}">`);
		for (const cyclistId of team.cyclists) {
			lines.push(`        <cyclist id="${cyclistId}" />`);
		}
		lines.push("    </team>");
	}
	lines.push("</startlist>");
	return `${lines.join("\n")}\n`;
}

/**
 * Translate sql.js "no such table/column" errors into actionable messages that
 * point the caller at the schema-discovery tools. Other errors pass through.
 *
 * Shared by the read (`pcm_query_database`) and write (`pcm_update_database`) tools.
 */
export function explainQueryError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);

	const missingTable = /no such table:\s*(\S+)/i.exec(message);
	if (missingTable) {
		return new Error(
			`Table "${missingTable[1]}" does not exist in this database — use pcm_list_tables to list available tables.`,
		);
	}

	const missingColumn = /no such column:\s*(\S+)/i.exec(message);
	if (missingColumn) {
		return new Error(
			`Column "${missingColumn[1]}" does not exist — use pcm_get_table_schema to inspect the table's columns.`,
		);
	}

	// Raised by `PRAGMA query_only = ON` when a statement tries to write.
	if (/readonly database|not authorized/i.test(message)) {
		return new Error(
			"This tool is read-only — the query attempted to modify the database, which is not allowed.",
		);
	}

	return error instanceof Error ? error : new Error(message);
}

/**
 * Normalize `raw` to a single SQL statement and parse it with
 * `sql-query-identifier`.
 *
 * Strips one trailing `;`, then rejects empty input and stacked statements
 * (`label` — e.g. "Query" or "Statement" — is used in the empty-input message).
 * Because the parser tokenizes SQL properly, a `;` inside a string literal,
 * comment or quoted identifier is not mistaken for a statement separator.
 *
 * Returns the normalized text (safe to prepare/run) and the parsed statement;
 * callers decide which statement kinds they allow (via `type`/`executionType`).
 *
 */
export function parseSingleStatement(
	raw: string,
	label: string,
): { text: string; statement: IdentifyResult } {
	const text = raw.trim().replace(/;\s*$/, "");

	if (text.length === 0) {
		throw new Error(`${label} is empty.`);
	}

	const statements = identify(text, { strict: false, dialect: "sqlite" });

	if (statements.length === 0) {
		throw new Error(`${label} is empty.`);
	}

	if (statements.length > 1) {
		throw new Error(
			"Only a single statement is allowed — remove extra semicolons.",
		);
	}

	return { text, statement: statements[0] };
}

/** Compute age in whole years from two YYYYMMDD integers (e.g. 20030503). */
export function ageFromYmd(currentYmd: number, birthYmd: number): number {
	let age = Math.floor(currentYmd / 10000) - Math.floor(birthYmd / 10000);
	// Decrement if this year's birthday (MMDD) has not occurred yet.
	if (currentYmd % 10000 < birthYmd % 10000) {
		age--;
	}
	return age;
}

/**
 * A stage date as `YYYY-MM-DD`, or null when the stage is unknown.
 *
 * A played career stamps the resolved date on `STA_stage.gene_i_computed_date`
 * (`YYYYMMDD`); it is `0` on databases the game has never advanced, where the
 * day and month are still the only calendar the stage carries — those are then
 * combined with the current season.
 */
export function stageDate(
	computedDate: unknown,
	day: unknown,
	month: unknown,
	season: number | null,
): string | null {
	const pad = (value: number) => String(value).padStart(2, "0");

	const computed = computedDate != null ? Number(computedDate) : 0;
	if (computed >= MIN_YMD) {
		return `${Math.floor(computed / 10000)}-${pad(
			Math.floor(computed / 100) % 100,
		)}-${pad(computed % 100)}`;
	}

	const dayNumber = day != null ? Number(day) : 0;
	const monthNumber = month != null ? Number(month) : 0;
	if (season == null || dayNumber < 1 || monthNumber < 1) {
		return null;
	}
	return `${season}-${pad(monthNumber)}-${pad(dayNumber)}`;
}

/**
 * Value of a `GAM_career_data` key, or null when the key or the table's
 * key/value shape is missing — PCM 2014 stores career data in named columns
 * instead, and the season objective keys only exist in recent editions.
 */
export function getCareerValue(
	db: CdbDatabase,
	constant: string,
): number | null {
	if (!getTableColumnNames(db, "GAM_career_data").has("CONSTANT")) {
		return null;
	}
	const result = db.exec(
		"SELECT value FROM GAM_career_data WHERE CONSTANT = $constant LIMIT 1",
		{ $constant: constant },
	);
	const raw = result[0]?.values?.[0]?.[0];
	if (raw == null) {
		return null;
	}
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}
