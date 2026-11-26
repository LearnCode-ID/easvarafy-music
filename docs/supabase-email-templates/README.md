# Template Email Supabase Auth — Easvarafy

Template email auth Easvarafy dalam Bahasa Indonesia: tema gelap, aksen `#7C5CFF`, HTML responsif berbasis tabel (aman untuk Gmail, Outlook, dan Apple Mail).

| Template (Supabase)  | File                         | Subjek                                               | Variabel utama                          |
|----------------------|------------------------------|------------------------------------------------------|-----------------------------------------|
| Confirm signup       | `confirmation.html`          | Konfirmasi email kamu untuk Easvarafy                | `{{ .ConfirmationURL }}`, `{{ .Email }}` |
| Invite user          | `invite.html`                | Kamu diundang bergabung di Easvarafy                 | `{{ .ConfirmationURL }}`                |
| Magic link           | `magic_link.html`            | Link masuk Easvarafy kamu                            | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| Reauthentication     | `reauthentication.html`      | Kode verifikasi Easvarafy kamu                       | `{{ .Token }}` (kotak besar + masa berlaku) |
| Reset password       | `recovery.html`              | Reset password akun Easvarafy                        | `{{ .ConfirmationURL }}`                |
| Change email         | `email_change.html`          | Konfirmasi perubahan email akun Easvarafy            | `{{ .Email }}`, `{{ .NewEmail }}`       |
| Password changed     | `password_changed.html`      | Password akun Easvarafy kamu telah diubah            | `{{ .Email }}`                          |
| Email changed        | `email_changed.html`         | Email akun Easvarafy kamu telah diubah               | `{{ .OldEmail }}`, `{{ .Email }}`       |
| Identity linked      | `identity_linked.html`       | Metode masuk baru ditautkan ke akun Easvarafy        | `{{ .Provider }}`                       |
| Identity unlinked    | `identity_unlinked.html`     | Metode masuk dilepas dari akun Easvarafy             | `{{ .Provider }}`                       |
| MFA method added     | `mfa_factor_enrolled.html`   | Verifikasi dua langkah ditambahkan ke akun Easvarafy | `{{ .FactorType }}`                     |
| MFA method removed   | `mfa_factor_unenrolled.html` | Verifikasi dua langkah dihapus dari akun Easvarafy   | `{{ .FactorType }}`                     |

Enam template terakhir adalah **Security notifications**. Saat ini semuanya masih nonaktif di project ini; skrip di bawah akan mengaktifkannya.

## Cara menerapkan

Konektor Supabase yang dipakai saat pengembangan (`update_auth_config`) hanya bisa mengubah URL, signup, dan JWT. Konektor itu tidak bisa mengubah template email, jadi pilih salah satu cara berikut.

### A. GitHub Actions (sekali klik)
1. Buat personal access token di <https://supabase.com/dashboard/account/tokens>.
2. Simpan sebagai repository secret `SUPABASE_ACCESS_TOKEN` (Settings › Secrets › Actions).
3. Buka Actions › **Apply Supabase email templates** › *Run workflow*.

### B. Dari komputer sendiri
```bash
node scripts/apply-email-templates.mjs --check     # validasi saja
SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-email-templates.mjs
```
Skrip ini mengirim `PATCH /v1/projects/kxvckczujvwvfkykofzc/config/auth` dengan field berikut:
- `mailer_subjects_*` dan `mailer_templates_*_content`;
- `mailer_notifications_*_enabled`, `mailer_subjects_*_notification`, dan `mailer_templates_*_notification_content`.

### C. Manual lewat dashboard
Buka Supabase Dashboard › Authentication › **Emails**:
- Tab *Templates*: untuk tiap template, isi **Subject** sesuai tabel di atas dan tempel isi file `.html` ke **Message body**.
- Tab *Security notifications*: aktifkan tiap notifikasi, lalu isi subjek dan body yang sama.

Email dikirim lewat SMTP Resend dengan pengirim `Easvarafy <hello@easvarafy.learncode.web.id>`. OTP berisi 8 digit dan berlaku 60 menit; teks "60 menit" di template mengikuti pengaturan ini.
