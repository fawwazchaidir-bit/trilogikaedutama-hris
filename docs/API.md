# API

Semua endpoint di `/api/*`; JSON `{ "data": … }` atau `{ "error": { code, message, fieldErrors } }`. Autentikasi: cookie sesi. Permintaan yang mengubah data wajib membawa `Origin` yang sama dengan host.
Kode: 400 permintaan salah · 401 belum masuk · 403 tidak berizin · 404 tidak ditemukan · 409 konflik/terkunci · 422 validasi · 429 dibatasi.

| Area | Endpoint |
|---|---|
| Auth | `POST /auth/login` (balasan `requiresTwoFactor` + `challenge` bila akun ber-2FA) `POST /auth/2fa` `POST /auth/logout` `POST /auth/password` `POST /auth/forgot` `GET,POST /auth/reset` `GET /me` `GET /health` |
| Akun saya | `GET /account` `PUT /account/notifications` `POST /account/notifications/test` `POST /account/2fa/{setup,enable,disable,recovery}` |
| Akun | `GET,POST /users` `PATCH /users/:id` `POST /users/:id/password` `POST /users/:id/reset-2fa` |
| Karyawan | `GET,POST /employees` `GET,PUT /employees/:id` `POST /employees/:id/{deactivate,reactivate,reveal-bank,photo}` `GET /employees/options` `GET /employees/export` `POST /employees/import` (+`/template`) `GET,POST /divisions` `PATCH /divisions/:id` |
| Jadwal | `GET,POST /schedules` `PUT /schedules/:id` `GET,POST /schedule-assignments` `DELETE /schedule-assignments/:id` `GET,POST /calendar` `DELETE /calendar/:id` |
| Absensi | `GET /attendance/today` `POST /attendance/check-in` `POST /attendance/check-out` (JSON: `note`, `location{lat,lng,accuracy,timestamp,clientNow,mocked?}`; dengan foto absensi: `multipart/form-data` berisi `payload` = JSON itu dan `photo` = berkas kamera — waktu & lokasi dicetak server, bidang waktu dari klien diabaikan; foto dibuka lewat `GET /files/{id}`) `POST /attendance/correct` (`checkOutNextDay` untuk shift malam) `GET /attendance/corrections` |
| Lokasi | `GET /location?status=OPEN\|CLEARED\|CONFIRMED\|ALL` `POST /location/:id/review` |
| Rekap | `GET /recap` `GET /recap/detail` `GET /recap/export?format=csv\|xlsx\|pdf` |
| Pengajuan | `GET,POST /leaves` (`dayPart`: `FULL`\|`MORNING`\|`AFTERNOON`) `GET /leaves/mine` `POST /leaves/:id/{review,cancel}` `POST /leaves/attachment` `GET,POST /leave-balance` `POST /leave-balance/grant-quota` |
| Lembur | `GET,POST /overtime` `GET /overtime/mine` `POST /overtime/:id/{review,cancel}` (`review`: `decision`, `approvedMinutes`, `note`) |
| Laporan | `GET /reports/export?kind=kehadiran\|cuti-lembur\|biaya\|kepatuhan\|karyawan&format=csv\|xlsx\|pdf&month=\|from=&to=\|year=` (tampilan di halaman `/laporan`) |
| Gaji | `GET,POST /components` `PUT /components/:id` `POST /components/:id/active` · `GET,POST /payroll` `GET /payroll/:id` `POST /payroll/:id/{calculate,submit,return,approve,issue,cancel,revision}` `GET /payroll/:id/slips?format=pdf\|zip` `GET /payroll/items/:id` `POST /payroll/items/:id/{adjustments,note}` `DELETE /payroll/lines/:id` |
| Slip | `GET /payslips` `GET /payslips/:id/pdf` |
| Lainnya | `GET,PUT /settings` `PUT /settings/attendance` `PUT /settings/payroll-rules` `PUT /settings/statutory` `PUT /settings/security` `POST /settings/payroll-rules/confirm` `POST /settings/logo` `GET,POST /settings/deliveries` `GET /notifications` `POST /notifications/read` `GET /audit-logs` `GET /dashboard` `GET /files/:id` |
| Mesin-ke-mesin | `POST /internal/deliveries` — `Authorization: Bearer $CRON_SECRET`; memproses antrean email/WhatsApp (404 bila `CRON_SECRET` tidak diatur) |

Izin tiap endpoint mengikuti matriks di `src/lib/permissions.ts`.
