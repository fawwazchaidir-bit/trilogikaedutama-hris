/** DTO yang melintasi batas server → browser. Semua nominal adalah `number` Rupiah bulat; tanggal DATE = "YYYY-MM-DD". */

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
