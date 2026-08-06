import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResponse, validResponse } from "../helpers";
import { listSaves } from "../saves";

const outputSchema = z.object({
	saves: z
		.array(
			z.object({
				path: z
					.string()
					.describe(
						"Absolute path to the save's .cdb file — pass it as `databasePath` to the other tools",
					),
				name: z.string().describe("File name, e.g. `MyCareer.cdb`"),
				lastModified: z
					.string()
					.describe(
						"Last modified timestamp in ISO 8601 format, e.g. `2024-06-01T12:34:56.789Z`",
					),
				sizeBytes: z.number().describe("File size in bytes"),
			}),
		)
		.describe("Discovered career saves, newest first"),
});

export function registerListSaves(server: McpServer): void {
	server.registerTool(
		"pcm_list_saves",
		{
			title: "List the player's PCM career saves",
			description:
				"Discover the player's own Pro Cycling Manager career saves on this machine by scanning the `Pro Cycling Manager <year>/Cloud` folders under %APPDATA%, across every installed edition (Windows only). Returns each save's absolute path, file name, last modified date and size (newest first). A save is stored as a `.cdb` database, so its path is what the other tools take as `databasePath` — use `pcm_validate_database` instead to point at any other `.cdb` (official release, community update).",
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			try {
				const saves = await listSaves();

				const output: z.infer<typeof outputSchema> = {
					saves,
				};

				return validResponse(output);
			} catch (error) {
				return errorResponse(
					error instanceof Error ? error.message : String(error),
				);
			}
		},
	);
}
