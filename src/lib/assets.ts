/** Aset perusahaan: label & urutan untuk UI dan validasi (murni, tanpa server). */
export const ASSET_CATEGORIES = ["LAPTOP", "PHONE", "ACCESS_CARD", "KEY", "UNIFORM", "VEHICLE", "OTHER"] as const;
export type AssetCategoryValue = (typeof ASSET_CATEGORIES)[number];
export const ASSET_STATUSES = ["AVAILABLE", "ASSIGNED", "LOST", "RETIRED"] as const;
export type AssetStatusValue = (typeof ASSET_STATUSES)[number];
export const ASSET_CONDITIONS = ["GOOD", "DAMAGED", "LOST"] as const;
export type AssetConditionValue = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CATEGORY_LABEL: Record<AssetCategoryValue, string> = {
  LAPTOP: "Laptop / komputer", PHONE: "Ponsel / tablet", ACCESS_CARD: "Kartu akses / ID", KEY: "Kunci", UNIFORM: "Seragam / atribut", VEHICLE: "Kendaraan", OTHER: "Lainnya",
};
export const ASSET_STATUS_LABEL: Record<AssetStatusValue, string> = { AVAILABLE: "Tersedia", ASSIGNED: "Dipinjam", LOST: "Hilang", RETIRED: "Dinonaktifkan" };
export const ASSET_CONDITION_LABEL: Record<AssetConditionValue, string> = { GOOD: "Baik", DAMAGED: "Rusak", LOST: "Hilang" };
