import { fileURLToPath } from "node:url";

/**
 * Real `.cdb` databases, one per PCM edition, used to exercise the tools
 * against every schema variation they must tolerate.
 *
 * These are official releases, not career saves — which is exactly why the
 * tools take a `databasePath` rather than a `savePath`.
 */
export const databaseFixtures: [
	name: string,
	path: string,
	hasMediumMountain: boolean,
][] = [
	[
		"Pro cycling manager 2018",
		fileURLToPath(
			new URL("../fixtures/OfficialRelease-2018.cdb", import.meta.url),
		),
		false,
	],
	[
		"Pro cycling manager 2019",
		fileURLToPath(
			new URL("../fixtures/OfficialRelease-2019.cdb", import.meta.url),
		),
		false,
	],
	[
		"Pro cycling manager 2021",
		fileURLToPath(
			new URL("../fixtures/OfficialRelease-2021.cdb", import.meta.url),
		),
		false,
	],
	[
		"Pro cycling manager 2025",
		fileURLToPath(
			new URL("../fixtures/OfficialRelease-2025.cdb", import.meta.url),
		),
		true,
	],
];
