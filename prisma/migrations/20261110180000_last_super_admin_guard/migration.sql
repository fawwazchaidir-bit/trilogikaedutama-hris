-- Penjaga di database: selalu harus ada minimal satu Super Admin AKTIF. Melengkapi pemeriksaan service (modul Akun Pengguna) agar tidak ada jalur lain
-- (mis. nonaktifkan karyawan, skrip, atau dua permintaan bersamaan) yang bisa mengunci pimpinan dari sistem.
-- Pengurutan: kunci penasihat (advisory lock) per transaksi menyerialkan dua penonaktifan Super Admin yang berbarengan.
CREATE FUNCTION trg_users_last_super_admin_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."role" = 'SUPER_ADMIN' AND OLD."isActive" AND (TG_OP = 'DELETE' OR NEW."role" <> 'SUPER_ADMIN' OR NEW."isActive" = false) THEN
    PERFORM pg_advisory_xact_lock(hashtext('hris:last_super_admin'));
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "role" = 'SUPER_ADMIN' AND "isActive" AND "id" <> OLD."id") THEN
      RAISE EXCEPTION 'HRIS-GUARD: Harus ada minimal satu Super Admin aktif' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER users_last_super_admin_guard BEFORE UPDATE OF "role", "isActive" OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION trg_users_last_super_admin_guard();
