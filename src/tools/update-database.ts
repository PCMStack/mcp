import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { explainQueryError, parseSingleStatement } from "../helpers";
import { withCdb, writeCdb } from "../cdb";

const outputSchema = z.object({
	outputPath: z
		.string()
		.describe("Absolute path of the modified .cdb database that was written"),
	rowsModified: z
		.number()
		.describe("Number of rows changed by the statement (INSERT/UPDATE/DELETE)"),
	statement: z.string().describe("The normalized statement that was executed"),
});

export function registerUpdateDatabase(server: McpServer): void {
	server.registerTool(
		"pcm_update_database",
		{
			title: "Update PCM database (writes a new .cdb)",
			description:
				"Run a single write statement (INSERT, UPDATE or DELETE) against a Pro Cycling Manager `.cdb` database and write the result to a NEW `.cdb` file. The source database is never modified: the edited database is serialized to `outputPath`, which must differ from `databasePath`. Only one data-mutating statement is allowed; SELECT, schema changes (DROP/CREATE/ALTER) and stacked statements are rejected. Use `pcm_query_database` to read, and `pcm_list_tables`/`pcm_get_table_schema` to discover tables and columns.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the source .cdb database file"),
				outputPath: z
					.string()
					.describe(
						"Absolute path of the .cdb file to write the modified database to. Must differ from databasePath, sit in an existing directory, and not already exist (existing files are never overwritten).",
					),
				statement: z
					.string()
					.describe(
						"A single write statement, e.g. `UPDATE DYN_cyclist SET gene_sprint = 80 WHERE IDcyclist = 42`",
					),
			},
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ databasePath, outputPath, statement }) =>
			withCdb(
				databasePath,
				async (db, file) => {
					const safe = assertWriteStatement(statement);

					try {
						db.run(safe);
					} catch (error) {
						throw explainQueryError(error);
					}

					const rowsModified = db.getRowsModified();
					const written = await writeCdb(db, outputPath, file.path);

					const output: z.infer<typeof outputSchema> = {
						outputPath: written,
						rowsModified,
						statement: safe,
					};
					return output;
				},
				{ queryOnly: false },
			),
	);
}

/** The only statement kinds this tool executes: plain data mutations. */
const WRITE_STATEMENT_TYPES = new Set(["INSERT", "UPDATE", "DELETE"]);

/**
 * Enforce that a statement is a single data-mutating write.
 *
 * Parsing is delegated to {@link parseSingleStatement}, which classifies the
 * statement by its leaf operation. Only `INSERT`/`UPDATE`/`DELETE` are allowed
 * (a `WITH … DELETE` CTE counts as a `DELETE`). Everything else is rejected:
 *  - reads (`SELECT`, `WITH … SELECT`) — those belong to `pcm_query_database`, and
 *  - DDL (`DROP`/`CREATE`/`ALTER`/…) and anything unknown (`PRAGMA`, `ATTACH`),
 *    which would alter the schema and break the `sqlToCdb` round-trip (it needs
 *    the table structure / `DB_STRUCTURE` intact to re-encode the `.cdb`).
 *
 * A `;` inside a string literal no longer trips the single-statement check.
 */
export function assertWriteStatement(rawStatement: string): string {
	const { text, statement } = parseSingleStatement(rawStatement, "Statement");

	if (!WRITE_STATEMENT_TYPES.has(statement.type)) {
		throw new Error(
			"Only a single INSERT, UPDATE or DELETE statement is allowed. " +
				"Use pcm_query_database to read; schema changes (DROP/CREATE/ALTER) are not supported.",
		);
	}

	return text;
}
