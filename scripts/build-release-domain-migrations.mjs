import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  domainMigrationHeader,
  domainMigrations,
  releaseSourceDirectory,
} from "./release-domain-plan.mjs";

const sourceFiles = (await readdir(releaseSourceDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const assignedSources = [];

for (const group of domainMigrations) {
  const firstIndex = sourceFiles.indexOf(group.firstSource);
  const lastIndex = sourceFiles.indexOf(group.lastSource);

  assert.notEqual(firstIndex, -1, `Missing first source ${group.firstSource}.`);
  assert.notEqual(lastIndex, -1, `Missing last source ${group.lastSource}.`);
  assert.ok(lastIndex >= firstIndex, `Invalid source range for ${group.file}.`);

  const groupSources = sourceFiles.slice(firstIndex, lastIndex + 1);
  assignedSources.push(...groupSources);
  const sourceSql = await Promise.all(
    groupSources.map((name) =>
      readFile(path.join(releaseSourceDirectory, name), "utf8"),
    ),
  );
  const output =
    domainMigrationHeader(group, groupSources) + sourceSql.join("\n\n");

  await writeFile(path.join("supabase/migrations", group.file), output, "utf8");
}

assert.deepEqual(
  assignedSources,
  sourceFiles,
  "Every preserved release source must be assigned once in chronological order.",
);

console.log(`Built ${domainMigrations.length} ordered release-domain migrations.`);
