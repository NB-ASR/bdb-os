export type CustomerOption = {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
};

export type CatalogueOption = {
  id: string;
  type: "product" | "service";
  code: string;
  name: string;
  unitPrice: number | null;
  vatRate: number;
};

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";

export type DeliverySourceType = "manual" | "invoice" | "sale";
