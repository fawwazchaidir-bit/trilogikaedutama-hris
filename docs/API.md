# API

Semua endpoint di `/api/*`; JSON `{ "data": … }` atau `{ "error": { code, message, fieldErrors } }`. Autentikasi: cookie sesi. Permintaan yang mengubah data wajib membawa `Origin` yang sama dengan host.
Kode: 400 permintaan salah · 401 belum masuk · 403 tidak berizin · 404 tidak ditemukan · 409 konflik/terkunci · 422 validasi · 429 dibatasi.

| Area | Endpoint |
|---|---|
| Auth | `POST /auth/login` `POST /auth/logout` `POST /auth/password` `GET /me` `GET /health` |
| Akun | `GET,POST /users` `PATCH /users/:id` `POST /users/:id/password` |
| Karyawan | `GET,POST /employees` `GET,PUT /employees/:id` `POST /employees/:id/{deactivate,reactivate,reveal-bank,photo}` `GET /employees/options` `GET /employees/export` `POST /employees/import` (+`/template`) `GET,POST /divisions` `PATCH /divisions/:id` |
| Jadwal | `GET,POST /schedules` `PUT /schedules/:id` `GET,POST /schedule-assignments` `DELETE /schedule-assignments/:id` `GET,POST /calendar` `DELETE /calendar/:id` |
| Absensi | `GET /attendance/today` `POST /attendance/check-in` `POST /attendance/check-out` `POST /attendance/correct` `GET /attendance/corrections` |
| Rekap | `GET /recap` `GET /recap/detail` `GET /recap/export?format=csv\|xlsx\|pdf` |
| Pengajuan | `GET,POST /leaves` `GET /leaves/mine` `POST /leaves/:id/{review,cancel}` `POST /leaves/attachment` `GET,POST /leave-balance` `POST /leave-balance/grant-quota` |
| Gaji | `GET,POST /components` `PUT /components/:id` `POST /components/:id/active` · `GET,POST /payroll` `GET /payroll/:id` `POST /payroll/:id/{calculate,submit,return,approve,issue,cancel,revision}` `GET /payroll/:id/slips?format=pdf\|zip` `GET /payroll/items/:id` `POST /payroll/items/:id/{adjustments,note}` `DELETE /payroll/lines/:id` |
| Slip | `GET /payslips` `GET /payslips/:id/pdf` |
| Lainnya | `GET,PUT /settings` `PUT /settings/attendance` `PUT /settings/payroll-rules` `POST /settings/payroll-rules/confirm` `POST /settings/logo` `GET /notifications` `POST /notifications/read` `GET /audit-logs` `GET /dashboard` `GET /files/:id` |

Izin tiap endpoint mengikuti matriks di `src/lib/permissions.ts`.
