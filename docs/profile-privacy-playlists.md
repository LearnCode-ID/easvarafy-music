# Profil, privasi, streak, dan playlist

## Status implementasi dan audit (27 November 2026)

Kode dan migration disiapkan di branch ini. **Migration belum diterapkan ke Supabase produksi, tidak ada deployment dan tidak ada playlist produksi yang dihapus.** Jangan menganggap fitur cloud sudah aktif sebelum langkah aktivasi di bawah selesai.

Audit read-only melalui koneksi Supabase pada project **Easvarafy** (`kxvckczujvwvfkykofzc`) menemukan:

- `profiles`: identitas, email, role, avatar, banned, tanggal bergabung. Belum ada banner, bio, atau pilihan privasi profil.
- `user_playlists`: primary key gabungan `user_id,id`; nama, deskripsi, tags, `tracks` JSONB, `is_public`, timestamps. **Tidak ada tabel item playlist terpisah.** Array `tracks` menyimpan metadata YouTube-compatible (`videoId`, title, artist, thumbnail, duration, dll.) dan urutan lagu. Implementasi mempertahankan model ini, bukan membuat katalog/FK lagu baru.
- `user_liked_tracks` adalah koleksi sistem yang dipertahankan, bukan dummy playlist.
- `monthly_listening_stats` berisi agregat dan metadata lagu terakhir. Metadata riwayat terakhir tidak diekspos publik oleh implementasi ini.
- Bucket `avatars` sebelumnya public. RPC komunitas lama menggunakan security definer dan tidak memeriksa pilihan privasi profil.
- Ada **10 playlist** dan **0 record dengan bukti penanda `is_demo=true` / `source=seed`**; kolom penanda tersebut juga tidak ada pada schema yang diaudit. Asal seed tidak dapat dibuktikan. Semua record dibiarkan utuh. Nama seperti “Favorit” tidak pernah digunakan sebagai alasan penghapusan.
- Frontend lama menggabungkan global localStorage ke akun, auto-seed koleksi, mengirim `is_public=true`, dan mengabaikan error cloud. Jalur-jalur tersebut sudah diganti.
- Trigger `handle_user_updated` lama menimpa avatar dari metadata autentikasi pada setiap update auth user. Migration mengubahnya untuk hanya menyinkronkan email; profil menjadi sumber kebenaran gambar.

## Aktivasi Supabase dan deployment

1. Buat backup database dan bucket. Uji pada staging/salinan schema terlebih dahulu. Migration ini menargetkan **schema lama yang sudah diaudit**, bukan bootstrap project kosong.
2. Terapkan **sekali**, melalui migration tooling Supabase/SQL editor yang biasa digunakan:

   `supabase/migrations/20261127010000_private_profiles_streak_playlists.sql`

   File memiliki transaksi. Jangan hanya menjalankan sebagian file. Bila schema/policy/RPC produksi telah berubah sejak audit, lakukan audit ulang terlebih dahulu (terutama tiga RPC komunitas yang dikeraskan menggunakan definisi existing).
3. Migration menambahkan:
   - `profiles.bio`, `banner_path`, `is_public`, `show_stats`, `show_streak`, `show_badges`;
   - `user_playlists.cover_url`, `version` (optimistic concurrency);
   - `user_streaks`, `user_activity_days`;
   - RPC `get_profile_page`, `read_profile_streak`, `record_daily_activity`, `save_user_playlist`, serta helper policy media;
   - bucket **private** `profile-media`, limit 5 MB, MIME JPG/PNG/WebP;
   - privatisasi bucket existing `avatars`, penggantian policy read, penguatan RPC komunitas dan pembacaan statistik/Lagu Disukai.
4. Akun baru default **privat**. Pada schema yang diaudit tidak ada pilihan privasi existing; akun lama juga mendapatkan privat. `ADD COLUMN IF NOT EXISTS` tidak menimpa flag existing jika sebelumnya sudah dibuat. Flag publik/privat playlist lama tidak diubah. Default playlist baru adalah privat.
5. Atur environment build web **dan** APK:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
   NEXT_PUBLIC_APP_URL=https://<domain-web-aplikasi>
   NEXT_PUBLIC_API_BASE=https://<domain-web-aplikasi>
   ```

   `NEXT_PUBLIC_APP_URL` adalah origin HTTPS canonical untuk Bagikan Profil. APK tidak membagikan `capacitor://localhost` / localhost. Jangan menaruh service-role key pada environment `NEXT_PUBLIC_*`.
6. Deploy web dan distribusikan APK yang diperbarui secara terkoordinasi. **Client lama yang memakai public URL avatar tidak kompatibel dengan bucket yang sudah diprivatkan**; gambar akan berhenti bekerja pada client tersebut sampai diperbarui. Jangan mengembalikan bucket menjadi public sebagai solusi.
7. Web mempertahankan route dinamis `/profile/{UUID}`. APK menggunakan halaman static bersama `/profile/?id={UUID}`. Build static mengecualikan hanya route web dinamis/API/callback lalu mengembalikannya, termasuk saat gagal. Layout player persisten agar iframe, mini-player, dan queue tidak di-remount saat navigasi.
8. Jalankan matriks staging dua akun nyata di bagian pengujian sebelum release. Belum ada pengujian login produksi/APK fisik dalam pekerjaan ini.

## Aturan akses dan privasi

- Raw `profiles` tetap owner/admin-only; tidak ada policy `SELECT true` untuk mengungkap email/setting akun. RPC halaman menggunakan allowlist field. Pengunjung profil privat mendapatkan **hanya** `{status:'private'}`; profil hilang `{status:'not_found'}`. UUID invalid ditolak client sebelum query.
- Pemilik dapat melihat dan mengedit datanya sendiri. Pembatasan role/banned existing pada update profil dipertahankan. Badge berasal dari role yang benar; badge publik perlu izin `show_badges`.
- Profil publik menampilkan informasi publik dan playlist publik. Statistik/streak/badge masing-masing opt-in. Timezone yang disimpan dan pilihan privasi tidak dikirim sebagai pengaturan akun ke pengunjung.
- Playlist dapat dibaca jika `user_id=auth.uid()` **atau** `playlist.is_public AND profile_is_public(owner)`. Semua item berada di `tracks` pada row yang sama; tidak ada endpoint item lain yang dapat melewati policy parent.
- Profil privat menyembunyikan juga playlist publik lewat query/API langsung. Mengubah profil tidak menulis ulang `is_public` pada playlist; mempublikasikan lagi hanya membuka playlist yang semula publik.
- Lagu Disukai dan raw riwayat/statistik tidak dibuka ke pengunjung. Top pendengar hanya memuat akun publik yang mengizinkan statistik; direktori publik tidak menampilkan agregat tanpa opt-in. RPC lama tidak lagi mengembalikan metadata lagu terakhir.
- `profile-media` dan `avatars` private. Pembacaan objek oleh pengunjung memeriksa profil publik **dan referensi objek aktif**. Pemilik hanya dapat mengunggah/menghapus pada folder UUID-nya sendiri. Tidak ada URL public baru atau signed URL panjang; gambar diunduh dengan RLS + `cache: no-store`, lalu ditampilkan sebagai object URL sementara.
- Banner/avatar baru: JPG/PNG/WebP, input maksimum 10 MB, decode nyata, batas 60 megapixel, crop 3:1 atau 1:1, resize 1600×533 / 512×512, WebP terkompresi ≤5 MB. Gambar yang gagal disimpan sebagai referensi dibersihkan best-effort. Gambar lama tidak dihapus massal; dapat ditambahkan pekerjaan garbage collection terpisah setelah audit.
- Halaman melakukan revalidasi setiap 30 detik, focus, online, dan setelah perubahan profil. Pergantian viewer membuang komponen/state profil lama. Saat revalidasi gagal, tampilan profil fail-closed (tidak mempertahankan data publik lama). Service worker tidak menyimpan dokumen `/profile*`; request Supabase tidak di-cache oleh SW.
- **Gambar/data yang telah diunduh, disalin, screenshot, atau di-cache client lama sebelum perubahan tidak bisa ditarik kembali.** Ini berlaku juga bagi URL avatar lama yang pernah public atau avatar eksternal OAuth. Permintaan storage terotorisasi baru dibatasi segera oleh policy; tampilan yang sudah menerima data direvalidasi berkala, bukan mekanisme penarikan data dari perangkat pihak lain.

## Streak

- Aktivitas foreground setelah login selama 10 detik dihitung; retry berkala setiap menit menangani pergantian tengah malam ketika aplikasi tetap terbuka. Tab tersembunyi tidak mencatat aktivitas baru.
- Client hanya mengirim nama zona IANA dari `Intl`. Zona disimpan pada aktivitas pertama dan **tidak diganti otomatis** saat perangkat lain atau perjalanan menggunakan zona berbeda. Saat ini tidak ada UI mengubah zona secara retroaktif.
- RPC menggunakan `auth.uid()`, `now()` server, tanggal kalender `now() AT TIME ZONE timezone`, row lock pada profil/streak, dan unique `(user_id,day)`. Tanggal/jumlah streak tidak dikirim client. Update raw tabel streak/activity tidak diberikan pada client.
- Hari yang sama idempoten; kemarin + hari ini menambah satu; melewatkan hari memulai satu pada aktivitas berikutnya. Sebelum aktif hari ini, streak kemarin tetap ditampilkan. Bila sudah terputus, pembacaan menampilkan nol sampai aktivitas berikutnya tercatat; rekor tetap ada.
- Status offline/error tidak dianggap sukses. Ada pesan dan tombol retry. Api hanya memakai animasi transform ringan; `prefers-reduced-motion` mematikannya.

## Playlist dan cache

- Supabase adalah sumber utama pengguna login. Tidak ada auto-merge localStorage, auto-seed personal, atau fallback playlist dummy. Data localStorage legacy **dibiarkan untuk pemulihan manual**, tidak dihapus/diimpor ke akun secara diam-diam.
- Create/edit/deskripsi/cover/visibilitas/tag/tambah-hapus lagu/reorder menggunakan penyimpanan yang ditunggu. State utama diganti **setelah** respons sukses, sehingga tidak perlu rollback optimistic palsu.
- Server `save_user_playlist` memvalidasi owner dan expected `version`, lalu mengunci transaksi. Konflik perangkat menghasilkan pesan untuk memuat ulang, bukan menimpa diam-diam. Payload menyertakan pemilik agar operasi lama tidak tersimpan ke akun lain ketika sesi berubah.
- Refresh saat focus/online/setiap 30 detik menangkap perubahan perangkat lain. Request lama diinvalidadi saat mutasi, dan state cloud dimask berdasarkan pemilik saat ganti akun/logout. Logout/pergantian akun juga menghentikan playback dan membersihkan queue sebelumnya. Local history/bookmark editorial menggunakan key per akun; bukan sumber playlist cloud.
- Lagu Disukai juga menunggu cloud dan tidak mengklaim sukses saat gagal. Koleksi editorial tetap terpisah dari playlist pribadi.
- Impor backup adalah tindakan eksplisit: playlist diimpor sebagai salinan ID baru dan privat, menunggu penyimpanan. Jika sebagian gagal, jumlah yang telah tersimpan dilaporkan; tidak menghapus playlist lama. Ini berbeda dari auto-seed/auto-merge lama.

## Cleanup yang aman

```bash
# Jalankan hanya di lingkungan operator tepercaya, bukan frontend/browser.
# SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY dibaca dari secret environment operator.
npm run playlists:cleanup                         # default: dry-run, tidak mengubah data
npm run playlists:cleanup -- --apply --confirm-project=<project-ref>
```

- Hanya `is_demo === true` atau `source === 'seed'` yang layak. Tidak ada heuristik judul atau tebakan ID.
- Output melaporkan ID/pemilik/judul/jumlah lagu/penanda/tindakan. Lindungi output karena berisi nama koleksi.
- Sebelum apply menghapus apa pun, backup row lengkap termasuk **semua embedded track beserta urutannya**, disimpan + `fsync`, mode file `0600` di `.private-backups/` (di-ignore Git). Salin ke penyimpanan operator yang durable dan terenkripsi sesuai kebijakan organisasi.
- Delete memakai owner/ID/marker/updated_at/version dari backup; record yang berubah dilewati. Error menghentikan run; backup tetap ada. Tidak ada penghapusan gambar storage.
- Pada audit saat ini tidak ada kandidat terbukti, sehingga apply juga tidak akan menghapus playlist. Jika ingin menargetkan record tanpa penanda, harus ada audit provenance dan konfirmasi pengguna/operator terlebih dahulu. Jangan menambahkan marker ke data asli hanya agar lolos cleanup.

## Pemeriksaan yang dijalankan

- `npm ci`: berhasil menggunakan lockfile.
- `npm run lint`: berhasil, **0 error, 15 warning** penggunaan `<img>` (sebagian existing, sebagian blob/preview gambar).
- `npm run typecheck`: berhasil.
- `npm test`: **70/70 lulus** (65 existing + validasi profil/file/URL dan penyimpanan per akun/no-seed).
- `npm run test:database`: **2/2 lulus**. Menjalankan migration nyata pada PostgreSQL WASM/PGlite dengan fixture schema lama, role `authenticated` untuk dua UUID dan `anon`. Mencakup RLS profil/playlist/embedded item/media/streak, private→public→private→public, pemilik tetap mengakses, legacy RPC, opt-in statistik, no email/timezone/settings leak, konflik versi, urutan tersimpan, tanggal kalender/DST, hari sama/kemarin/terlewat, timezone tetap, duplicate calls, dan cleanup non-destruktif. PGlite menserialisasi koneksi; ini **bukan** stress test transaksi multi-koneksi produksi.
- `npm run test:browser`: lulus dengan **fixture API terkendali**, Chromium headless, lebar 320/390/1280. Mencakup tab, gate login, editor owner menunggu simpan, validasi file, canvas crop, upload, banner setelah reload, gagal offline, reduced motion, revalidasi privat, posisi mini-player, dan DOM player persisten saat ganti route. Tidak ada browser page error. Screenshot temporer di `.cache/`, tidak masuk Git. Bukan pembuktian JWT/login atau persistensi Storage produksi.
- `npm run build`: berhasil, termasuk `/profile/[id_user]` dinamis.
- `npm run build:static`: berhasil; route publik dinamis tidak masuk APK, `/profile` static tersedia. Script juga membersihkan validator `.next/dev/types` agar dev→static tidak gagal akibat referensi route yang sementara dikeluarkan.
- Font yang sama (Plus Jakarta Sans, DM Sans, JetBrains Mono) sekarang self-hosted WOFF2 beserta lisensi OFL di `public/fonts/`, sehingga build tidak perlu akses Google Fonts.

### Mengulang browser smoke test

Siapkan Chromium Playwright (`npx playwright install chromium` pada lingkungan dengan akses download browser), lalu jalankan server fixture **khusus pengujian**:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ui-test-only \
NEXT_PUBLIC_APP_URL=https://easvarafy-music.vercel.app \
npm run dev -- --hostname 0.0.0.0 --port 3000
# Terminal lain:
npm run test:browser
```

URL/key di atas hanyalah fixture; test mengintersep request, tidak menyimpan data ke project Supabase nyata. Jangan deploy build fixture. `UI_TEST_BASE_URL` dan `CHROMIUM_EXECUTABLE_PATH` dapat dioverride. Dalam sandbox, Chromium disediakan sementara melalui paket browser dan library runtime; bukan dependency production.

### Matriks staging wajib sebelum release

Gunakan dua akun **nyata** A/B dan incognito tanpa login:

1. A baru: profil privat, playlist kosong, tidak ada dummy. A bisa edit, B/anon tidak mendapat informasi privat lewat route, RPC, REST, atau URL objek.
2. A upload avatar/banner, ubah crop, simpan, refresh, logout-login, dan buka di perangkat lain. Verifikasi byte/referensi memang tersimpan. Uji file invalid, offline, dan kegagalan storage/database.
3. A publik: hanya playlist publik terlihat oleh B/anon; playlist privat beserta `tracks` tetap tidak terbaca via REST langsung. Uji statistik/streak/badge opt-in secara terpisah.
4. A publik→privat→publik: query baru dan download baru langsung mengikuti policy; flag tiap playlist tidak berubah. B/anon yang sedang membuka halaman direvalidasi ≤30 detik/focus. Pemilik tetap bisa edit seluruh koleksinya.
5. Coba create/update/delete profil/playlist A menggunakan token B; harus ditolak/tidak mengubah row. Jangan memasukkan token ke chat, log, atau commit.
6. Dua perangkat A: catat aktivitas bersamaan, hari sama, sebelum/sesudah tengah malam zona tersimpan, lewati satu hari; periksa count/rekor. Jalankan juga uji concurrent RPC multi-koneksi pada staging.
7. Create/edit/hapus/tambah-hapus/reorder playlist; refresh dan perangkat kedua harus sama. Ubah bersamaan untuk membuktikan konflik versi tidak menimpa perubahan.
8. Build APK, uji safe area/notch, tema terang/gelap/AMOLED/aksen/dock Liquid Glass, player saat navigasi, serta URL berbagi membuka domain web.
