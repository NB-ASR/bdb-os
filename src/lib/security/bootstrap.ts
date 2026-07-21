import { timingSafeEqual } from "node:crypto";

const MINIMUM_CONTROL_VALUE_LENGTH = 32;

export function isFounderBootstrapEnabled(value = process.env.BDB_FOUNDER_BOOTSTRAP_ENABLED) {
  return value === "true";
}

export function matchesFounderBootstrapControl(expected: string | undefined, supplied: string | null) {
  if (!expected || expected.length < MINIMUM_CONTROL_VALUE_LENGTH || !supplied) return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length) return false;

  return timingSafeEqual(expectedBytes, suppliedBytes);
}
