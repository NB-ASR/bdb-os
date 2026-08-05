export function extractVanitaClients(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") {
    throw new Error("The selected file is not a Vanita JSON snapshot.");
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.clients)) return record.clients;

  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    const data = record.data as Record<string, unknown>;
    if (Array.isArray(data.clients)) return data.clients;
  }

  throw new Error("The selected file does not contain a clients array.");
}
