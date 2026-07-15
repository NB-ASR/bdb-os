import { readFileSync, writeFileSync } from "node:fs";

function replaceRequired(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text was not found in ${path}`);
  }
  writeFileSync(path, source.replace(before, after));
}

replaceRequired(
  "src/app/admin/page.tsx",
  "  CircleDollarSign,\n",
  "",
);
replaceRequired(
  "src/app/admin/page.tsx",
  "  useEffect(() => { void load(); }, [load]);",
  "  useEffect(() => {\n    const timer = window.setTimeout(() => void load(), 0);\n    return () => window.clearTimeout(timer);\n  }, [load]);",
);
replaceRequired(
  "src/app/team/page.tsx",
  "  useEffect(() => { void load(); }, [load]);",
  "  useEffect(() => {\n    const timer = window.setTimeout(() => void load(), 0);\n    return () => window.clearTimeout(timer);\n  }, [load]);",
);
replaceRequired(
  "src/app/team/page.tsx",
  `  useEffect(() => {
    if (!selected || !data) return;
    setDraftProfile(selected.access_profile);
    setDraftStatus(selected.status === "invited" ? "active" : selected.status);
    setPermissionDraft(makeDraft(selected, data.features, data.permissions));
  }, [selected, data]);`,
  `  useEffect(() => {
    if (!selected || !data) return;
    const timer = window.setTimeout(() => {
      setDraftProfile(selected.access_profile);
      setDraftStatus(selected.status === "invited" ? "active" : selected.status);
      setPermissionDraft(makeDraft(selected, data.features, data.permissions));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected, data]);`,
);
replaceRequired(
  "src/app/api/workspace/team/route.ts",
  "const actions = [\"view\", \"create\", \"edit\", \"delete\", \"approve\", \"export\"] as const;\ntype PermissionAction = (typeof actions)[number];",
  "type PermissionAction = \"view\" | \"create\" | \"edit\" | \"delete\" | \"approve\" | \"export\";",
);

console.log("Applied the five validated ESLint corrections.");
