export const DISCOVERY_PLANS = ["not-sure", "starter", "growth", "solo-operator", "pro"] as const;
export const DISCOVERY_SECTORS = ["general", "healthcare", "wellness", "legal", "accounting", "other"] as const;
export const DISCOVERY_TEAM_SIZES = ["solo", "2-5", "6-15", "16-50", "50-plus"] as const;
export const DISCOVERY_TERMS = ["3-months", "6-months", "open"] as const;

export type DiscoveryEnquiry = {
  name: string;
  businessName: string;
  email: string;
  startingPlan: (typeof DISCOVERY_PLANS)[number];
  sector: (typeof DISCOVERY_SECTORS)[number];
  challenge: string;
  teamSize: (typeof DISCOVERY_TEAM_SIZES)[number];
  preferredTerm: (typeof DISCOVERY_TERMS)[number];
  website: string;
};

type ParseResult =
  | { ok: true; value: DiscoveryEnquiry }
  | { ok: false; error: string };

function field(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

function allowed<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

export function parseDiscoveryEnquiry(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Please complete the enquiry form." };
  }

  const record = input as Record<string, unknown>;
  const name = field(record, "name");
  const businessName = field(record, "businessName");
  const email = field(record, "email").toLowerCase();
  const startingPlan = field(record, "startingPlan");
  const sector = field(record, "sector");
  const challenge = field(record, "challenge");
  const teamSize = field(record, "teamSize");
  const preferredTerm = field(record, "preferredTerm");
  const website = field(record, "website");

  if (name.length < 2 || name.length > 120) return { ok: false, error: "Please enter your name." };
  if (businessName.length < 2 || businessName.length > 160) return { ok: false, error: "Please enter your business name." };
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid work email." };
  }
  if (!allowed(DISCOVERY_PLANS, startingPlan)) return { ok: false, error: "Please choose the kind of help you need." };
  if (!allowed(DISCOVERY_SECTORS, sector)) return { ok: false, error: "Please choose your sector." };
  if (challenge.length < 20 || challenge.length > 4000) {
    return { ok: false, error: "Please tell us a little more about the outcome you need." };
  }
  if (!allowed(DISCOVERY_TEAM_SIZES, teamSize)) return { ok: false, error: "Please choose your team size." };
  if (!allowed(DISCOVERY_TERMS, preferredTerm)) return { ok: false, error: "Please choose a support term." };

  return {
    ok: true,
    value: { name, businessName, email, startingPlan, sector, challenge, teamSize, preferredTerm, website },
  };
}

