import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { explainQueryError, parseSingleStatement } from "../helpers";
import { withCdb } from "../cdb";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const outputSchema = z.object({
	columns: z.array(z.string()).describe("Column names returned by the query"),
	rows: z
		.array(z.record(z.string(), z.unknown()))
		.describe("Result rows, one object per row keyed by column name"),
	rowCount: z.number().describe("Number of rows returned"),
	limit: z.number().describe("Maximum number of rows applied to the query"),
	truncated: z
		.boolean()
		.describe("Whether the result was capped at `limit` rows"),
});

export function registerQueryDatabase(server: McpServer): void {
	server.registerTool(
		"pcm_query_database",
		{
			title: "Query PCM database (read-only)",
			description:
				"Run a read-only SQL query against any table in a Pro Cycling Manager `.cdb` database. Only a single SELECT (or WITH … SELECT) statement is allowed; write/DDL statements are rejected and the database is never modified. Results are capped (default 100, max 1000 rows). Use `pcm_list_tables` to discover table names and `pcm_get_table_schema` to inspect their columns.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				query: z
					.string()
					.describe(
						"A single read-only SQL SELECT statement, e.g. `SELECT * FROM DYN_cyclist WHERE gene_sprint > 70`",
					),
				limit: z
					.number()
					.int()
					.positive()
					.max(MAX_LIMIT)
					.optional()
					.describe(
						`Maximum number of rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
					),
			},
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ databasePath, query, limit }) =>
			withCdb(databasePath, (db) => {
				const safeQuery = assertReadOnlyQuery(query);
				const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

				let stmt: ReturnType<typeof db.prepare> | undefined;
				let columns: string[] = [];
				const rows: Record<string, unknown>[] = [];
				let truncated = false;

				try {
					stmt = db.prepare(safeQuery);
					columns = stmt.getColumnNames();

					while (stmt.step()) {
						if (rows.length >= effectiveLimit) {
							truncated = true;
							break;
						}
						rows.push(stmt.getAsObject());
					}
				} catch (error) {
					throw explainQueryError(error);
				} finally {
					stmt?.free();
				}
				const output: z.infer<typeof outputSchema> = {
					columns,
					rows,
					rowCount: rows.length,
					limit: effectiveLimit,
					truncated,
				};

				return output;
			}),
	);
}

/**
 * Enforce that a query is a single read-only statement.
 *
 * Parsing is delegated to {@link parseSingleStatement}, so a `;` inside a string
 * literal, comment or quoted identifier is not mistaken for a statement
 * separator. CTEs are classified by their leaf operation, so `WITH … SELECT`
 * reads (`LISTING`) while `WITH … DELETE` writes (`MODIFICATION`) — only the
 * former is accepted. `PRAGMA query_only = ON` (see {@link withCdb}) stays as
 * the engine-level backstop.
 */
export function assertReadOnlyQuery(rawQuery: string): string {
	const { text, statement } = parseSingleStatement(rawQuery, "Query");

	if (statement.executionType !== "LISTING") {
		throw new Error(
			"Only read-only SELECT (or WITH … SELECT) queries are allowed.",
		);
	}

	return text;
}
