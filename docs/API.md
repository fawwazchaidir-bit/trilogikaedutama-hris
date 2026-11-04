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
| Absensi | `GET /attendance/today` `POST /attendance/check-in` `POST /attendance/check-out` (JSON: `note`, `location{lat,lng,accuracy,timestamp,clientNow,mocked?}`; dengan foto absensi: `multipart/form-data` berisi `payload` = JSON itu dan `photo` = berkas kamera — waktu & lokasi dicetak server, bidang waktu dari klien diabaikan; foto dibuka lewat `GET /files/{id}`; 404 bila sudah dihapus retensi). `PUT /settings/attendance` menerima `attendancePhotoMode`, `attendancePhotoRequireLocation`, `attendancePhotoRetentionMonths` (0–120; bawaan 6 `POST /attendance/correct` (`checkOutNextDay` untuk shift malam) `GET /attendance/corrections` |
| Lokasi | `GET /location?status=OPEN\|CLEARED\|CONFIRMED\|ALL` `POST /location/:id/review` |
| Rekap | `GET /recap` `GET /recap/detail` `GET /recap/export?format=csv\|xlsx\|pdf` |
| Pengajuan | `GET,POST /leaves` (`dayPart`: `FULL`\|`MORNING`\|`AFTERNOON`) `GET /leaves/mine` `POST /leaves/:id/{review,cancel}` `POST /leaves/attachment` `GET,POST /leave-balance` `POST /leave-balance/grant-quota` |
| Lembur | `GET,POST /overtime` `GET /overtime/mine` `POST /overtime/:id/{review,cancel}` (`review`: `decision`, `approvedMinutes`, `note`) |
| Laporan | `GET /reports/export?kind=kehadiran\|cuti-lembur\|biaya\|kepatuhan\|karyawan&format=csv\|xlsx\|pdf&month=\|from=&to=\|year=` (tampilan di halaman `/laporan`) |
| Gaji | `GET,POST /components` `PUT /components/:id` `POST /components/:id/active` · `GET,POST /payroll` `GET /payroll/:id` `POST /payroll/:id/{calculate,submit,return,approve,issue,cancel,revision}` `GET /payroll/:id/slips?format=pdf\|zip` `GET /payroll/items/:id` `POST /payroll/items/:id/{adjustments,note}` `DELETE /payroll/lines/:id` |
| Slip | `GET /payslips` `GET /payslips/:id/pdf` |
| Cuti per karyawan | `GET,PUT /employees/:id/leave-policy` — `PUT` body `{quotaDays\|null, eligibleFrom\|null, allowNegative\|null, note}`; `null` = ikut bawaan lembaga; kebijakan khusus **wajib** `note` (≥ 5 karakter). `POST /leave-balance/grant-quota` menerima `{year, employeeId?}` (tanpa `employeeId` = semua karyawan aktif menurut kebijakan masing-masing) dan mengembalikan `{granted, skipped, notEntitled, notEntitledNames, quota}`. `PUT /settings/attendance` menerima `leaveMinTenureMonths` (0–120) |
| Dokumen | `GET /documents?view=&kind=&q=&employeeId=` · `POST /documents` (**multipart**: `file` = PDF ≤ `MAX_DOCUMENT_UPLOAD_MB` + `employeeId, kind(CONTRACT\|OTHER), title, documentNo?, startDate, endDate?, note?, renewsDocumentId?`) · `GET /documents/:id` · `GET /documents/:id/file` (PDF **inline**; `?download=1` = unduh; pembukaan oleh pengelola diaudit) · `POST /documents/:id/decision` (`{decision: CONTINUE\|DISCONTINUE, note}` — Super Admin) · `POST /documents/:id/archive` (`{reason}`) |
| Surat Tugas & Uang Harian | `GET,POST /assignments` (`POST`: `{purpose, destination, startDate, endDate, details?, issueDate?, assignees:[{employeeId, dailyRate, days?}]}`) · `POST /assignments/:id/cancel` · `GET /assignments/:id/pdf` · `POST /allowance-receipts` (`{assigneeId, paidDate?, method: CASH\|TRANSFER, note?}`) · `POST /allowance-receipts/:id/void` (Super Admin) · `GET /allowance-receipts/:id/pdf` |
| Lainnya | `GET,PUT /settings` `PUT /settings/attendance` `PUT /settings/payroll-rules` `PUT /settings/statutory` `PUT /settings/security` `POST /settings/payroll-rules/confirm` `POST /settings/logo` `GET,POST /settings/deliveries` `GET /notifications` `POST /notifications/read` `GET /audit-logs` `GET /dashboard` `GET /files/:id` |
| Mesin-ke-mesin | `POST /internal/deliveries` — `Authorization: Bearer $CRON_SECRET`; memproses antrean email/WhatsApp (404 bila `CRON_SECRET` tidak diatur) · `POST /internal/retention` — sama; menghapus foto absensi lebih tua dari masa simpan, mengembalikan `{purged, held, months, cutoff}` · `POST /internal/contract-reminders` — sama; mengirim pengingat kontrak berakhir (H-3 bulan, H-1 bulan, H-14 hari) ke pimpinan, idempoten, mengembalikan `{checked, sent, today}` |

Izin tiap endpoint mengikuti matriks di `src/lib/permissions.ts`.

## Training & Operations (`/api/training/*`)

Modul **mati secara bawaan** (`TRAINING_MODULE_ENABLED=false`) → seluruh endpoint di bawah menjawab **404**. Proyek di luar lingkup akses pemanggil juga menjawab **404** (bukan 403). Ringkasan: [TRAINING-OPS.md](TRAINING-OPS.md), hak akses: [TRAINING-PERAN.md](TRAINING-PERAN.md).

| Area | Endpoint |
|---|---|
| Dashboard & direktori | `GET /training/dashboard` · `GET /training/directory` (karyawan aktif, data minimal: nama, no. induk, jabatan, divisi) |
| Akses modul (Super Admin) | `GET,POST,DELETE /training/access` (`POST {userId, level, note?}` · `DELETE {userId}`) |
| Program | `GET,POST /training/programs` `PATCH /training/programs/:id` |
| Proyek | `GET,POST /training/projects` (filter: `q status kind programId picId from to attention active sort page`) `GET,PATCH /training/projects/:id` `POST /training/projects/:id/{status,close,cancel,reopen}` `GET /training/projects/:id/{closure,activity}` |
| Tim | `GET,POST /training/projects/:id/members` `PATCH,DELETE /training/projects/:id/members/:memberId` (DELETE = akhiri penugasan) |
| Tugas | `GET,POST /training/projects/:id/tasks` `GET /training/tasks/mine?filter=` `GET,PATCH /training/tasks/:id` `POST /training/tasks/:id/status` `GET,POST /training/tasks/:id/comments` |
| Checklist | `GET,POST /training/projects/:id/checklist` `POST /training/projects/:id/checklist/template` `PATCH,DELETE /training/checklist-items/:id` |
| Template | `GET,POST /training/checklist-templates` `PUT /training/checklist-templates/:id` `POST /training/checklist-templates/default` |
| Jadwal | `GET,POST /training/projects/:id/schedules` `PATCH /training/schedules/:id` `GET /training/calendar?from=&to=` (maks. 93 hari; balasan memuat `warnings` bentrok) |
| Peserta | `GET,POST /training/projects/:id/participants` `PATCH /training/participants/:id` `GET /training/participants` (lintas proyek) |
| Instruktur | `GET,POST /training/instructors` `PATCH /training/instructors/:id` `GET,POST /training/projects/:id/instructors` `PATCH,DELETE /training/projects/:id/instructors/:assignmentId` |
| Dokumen | `GET,POST /training/projects/:id/documents` (`POST` multipart: `file`, `category`, `title`, `note?`; izin diperiksa **sebelum** badan dibaca) `GET /training/documents` `DELETE /training/documents/:id` · unduh via `GET /files/:id` (izin per proyek, `attachment`, `no-store`) |
| Referensi | `GET,POST /training/projects/:id/assignments` `DELETE …/assignments/:linkId` (surat tugas, hanya referensi) · `GET /training/assignment-letters?q=` · `GET,POST /training/projects/:id/references` `DELETE …/references/:refId` (manual, bukan integrasi) |
| Pemantauan (indikator) | `GET /training/indicators/programs` (kartu semua program yang boleh dilihat) · `GET /training/indicators/heatmap?weeks=` (peta beban; seluruh tim hanya bagi yang melihat semua proyek, lainnya baris sendiri) · `GET /training/indicators/density?from=&days=` (kepadatan kelas; `restricted` bagi anggota biasa) · `GET /training/projects/:id/indicators` · `POST /training/projects/:id/indicators/apply` (terapkan template, sekali) · `POST /training/projects/:id/indicators/workload` (hitung ulang jam kerja dari template) |
| Milestone & kesiapan | `GET,POST /training/projects/:id/milestones` `PATCH /training/milestones/:id` `POST /training/milestones/:id/{complete,reopen}` (selesai wajib `evidence` bila konfigurasi mewajibkan; tidak boleh tanggal masa depan) · `GET,POST /training/projects/:id/readiness` `PATCH,DELETE /training/readiness/:id` · `GET,POST /training/projects/:id/workload` `PATCH /training/workload/:id` |
| Rumus indikator | `GET,PUT /training/indicators/config` (`PUT {config, note?}` → versi baru; **hanya Super Admin**; 422 untuk galat semantik, `warnings` dikembalikan) · `POST /training/indicators/config/reset` (kembali ke bawaan dokumen = versi baru) · `GET /training/capacity` `PUT,DELETE /training/capacity/:employeeId` (kapasitas per staf; Manajer Program/Super Admin) |
| Laporan | `GET /training/reports` · `GET /training/reports/export?format=csv\|xlsx\|pdf` |
