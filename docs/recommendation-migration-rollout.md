# Penerapan migrasi rekomendasi privat

## Sasaran dan perubahan

- User meminta penerapan migrasi serta merge ke `main`.
- Project Supabase yang diverifikasi dari `list_projects`: **Easvarafy**, `kxvckczujvwvfkykofzc`, `ap-southeast-1`, `ACTIVE_HEALTHY`.
- Kode fitur sudah di-merge melalui [PR #11](https://github.com/LearnCode-ID/easvarafy-music/pull/11), merge commit `56572e4a2636fde987edbdcbfc7ce7a113d4024e`.
- Satu migrasi baru diterapkan melalui connector `create_migration`, yang transactional/rollback-on-failure. Migrasi privacy/social lama tidak diterapkan ulang.
- Sumber lokal: `supabase/migrations/20261127040000_private_recommendations.sql`.
- SHA-256 sumber: `5539b56449c0966b149674570894634c37b56d9b245636ab65dffa0731c35ec8`.
- Riwayat Supabase setelah penerapan: **`20261128005552` / `private_recommendations`**. Nama versi remote berasal dari connector, bukan nama file lokal. Jangan menjalankan ulang file tersebut hanya karena timestamp berbeda; rekonsiliasi mapping ini sebelum memakai migration-history tooling Supabase CLI.

Migrasi menambah tabel `public.recommendation_tastes`, policy owner SELECT, serta RPC `get_recommendation_taste()`, `ingest_recommendation_signals(jsonb,integer)`, dan `set_recommendation_preferences(boolean,boolean)`. Tidak ada edit atau penghapusan profil, playlist, likes, Storage, kredensial, atau konfigurasi deployment. Perubahan bersifat aditif dan tabel rekomendasi belum ada saat preflight; tidak diperlukan salinan data rekomendasi lama karena belum ada. Ini bukan klaim adanya backup eksternal database produksi.

## Pemeriksaan preflight dan setelah penerapan

Timestamp berasal dari respons database, dalam UTC:

| Pemeriksaan | Preflight `2026-11-28 00:55:11.665458+00` | Setelah QA rollback `2026-11-28 00:56:57.284930+00` |
| --- | ---: | ---: |
| Profil | 6 | 6 |
| Playlist | 7 | 7 |
| Likes | 22 | 22 |
| Tabel rekomendasi | belum ada | ada, 0 row |

Angka tersebut adalah snapshot pada saat pekerjaan ini, bukan perbandingan dengan rollout lain atau janji bahwa hitungan tidak dapat berubah karena aktivitas pengguna berikutnya.

Metadata yang diverifikasi langsung:

- RLS aktif pada `recommendation_tastes`.
- Satu policy SELECT authenticated dengan kondisi `auth.uid() = user_id`.
- `anon` tidak memiliki SELECT tabel maupun EXECUTE ketiga RPC.
- `authenticated` boleh SELECT dengan RLS, tetapi tidak boleh direct INSERT, UPDATE, atau DELETE.
- Ketiga RPC memakai SECURITY DEFINER dengan `search_path` kosong dan EXECUTE hanya untuk role yang sesuai; UID berasal dari session server, bukan argumen pemilik yang dikirim frontend.

## QA langsung di database remote

Satu transaksi `BEGIN ... ROLLBACK` memakai dua UID yang diambil dari `auth.users` dan pengaturan role/claim PostgreSQL, tanpa membuat akun atau mengirim fixture musik ke katalog. Assertion berikut lulus:

1. Role anonim tidak dapat memanggil ketiga RPC.
2. Authenticated owner dapat membaca bentuk respons RPC yang valid.
3. Disable menaikkan epoch dan ingestion pada akun disabled tetap nonaktif.
4. Reset mengosongkan event dan menaikkan epoch lagi.
5. Batch dengan epoch lama tidak mengembalikan epoch/data sebelum reset.
6. Payload signal malformed ditolak sebagai `Invalid signal`.
7. Akun B tidak dapat membaca row akun A, dan tidak melihat row milik akun lain.
8. Direct UPDATE oleh authenticated ditolak.

Semua perubahan preferensi/row dari QA di-rollback; pemeriksaan terpisah mengonfirmasi tabel rekomendasi masih 0 row dan jumlah data library tetap sama. Ini adalah pengujian database dengan role/claim, **bukan** login dua akun melalui UI/JWT HTTP atau uji lintas perangkat fisik.

## Verifikasi repository dan batasan

- Test migrasi lokal `node --test tests/recommendations.test.mjs` dijalankan ulang sebelum penerapan dan lulus. Test ini mencakup validasi payload, dua owner/anon, whitelist, dedupe, batch/rate limit, reset epoch, serta disabled ingestion.
- Validasi integrasi saat merge fitur PR #11: 108 unit tests, 4 database tests, browser rekomendasi/Library/downloads, build web/static, typecheck lulus; lint 0 error dan 15 warning `<img>` yang sudah ada.
- Pekerjaan migrasi ini tidak memicu deployment secara eksplisit dan tidak mengubah environment variables. Deployment otomatis dari merge Git harus dicek statusnya tersendiri.
- Live provider availability, login dua akun lewat UI produksi, sinkronisasi lintas perangkat nyata, dan APK fisik masih memerlukan acceptance test.

## Operasional

Jangan DROP tabel sebagai rollback pertama: setelah pengguna mulai merekam preferensi, tabel berisi data privat. Bila aplikasi perlu ditarik kembali, pertahankan tabel/RLS dan rollback kode melalui proses release yang biasa; audit/backup data serta persetujuan diperlukan sebelum penghapusan. Jika di masa depan perlu mengubah schema/RPC, buat migrasi incremental baru, bukan mengulang migrasi yang sudah tercatat ini.
