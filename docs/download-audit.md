# Audit dan perbaikan unduhan Easvarafy

Tanggal audit: 28 November 2026. Perubahan ada di branch sesi; belum dideploy dan belum diterbitkan sebagai APK baru.

## Temuan yang dibuktikan dari kode awal

1. **Tidak ada unduhan resmi dari player YouTube.** `MusicProvider.tsx` memakai YouTube IFrame untuk streaming. `offlineAudio.resolveSource` justru meminta `/api/music/audio`, lalu `audioSource.ts` mencari file pada URL template operator atau bucket publik Supabase (`offline-audio/<videoId>.*`). Tidak ada mekanisme untuk mengubah semua lagu katalog menjadi file unduhan. Ini batas kemampuan provider, bukan masalah yang boleh diselesaikan dengan ekstraksi YouTube. Konfigurasi/file sumber produksi dan kegagalan perangkat pengguna **belum diverifikasi**.
2. **Transfer APK bukan transfer native.** `runJob → fetch → ReadableStream → nativeBackend.createWriter` mengonversi potongan audio menjadi base64 dan memakai `Filesystem.appendFile`. Transfer bergantung pada JS/WebView dan akses API/CORS; bukan background Android.
3. **Validasi terlalu longgar.** Implementasi awal hanya menolak MIME teks/JSON dan file kosong. Tidak mengecek signature, ukuran lengkap, decoder, atau hash; default MIME MP3 bisa memberi ekstensi salah. `nativeBackend.resolveUrl` hanya melakukan `convertFileSrc`, tanpa memastikan file ada.
4. **Metadata dapat tertinggal/bertubrukan.** Pemuatan indeks tidak mencocokkan file. Dua job selesai dapat menghitung indeks dari snapshot lama sebelum `saveIndex`, sehingga salah satu catatan tertimpa. Pembatalan sesudah finalisasi dan penghapusan semua saat job aktif berpotensi meninggalkan file atau metadata kembali muncul.
5. **Identitas hanya ID lagu**, belum provider + ID. Player juga otomatis streaming saat file lokal gagal dan melompati lagu yang tidak diunduh saat offline.
6. **Backend mengikuti redirect** sumber. Walaupun URL awal berasal dari konfigurasi operator (bukan parameter URL bebas), tujuan redirect/DNS belum divalidasi terhadap jaringan privat.

Tidak ada bukti pengujian produksi yang menyatakan izin Android, URL kedaluwarsa, CORS, atau autentikasi merupakan satu-satunya akar masalah pada perangkat pengguna. Semua ini dipisahkan dari cacat yang dapat dibuktikan pada kode.

## Implementasi sekarang

### Sumber dan keamanan

- `/api/music/audio` hanya mengizinkan adaptor katalog `youtube` yang dipetakan operator ke **file terpisah berizin**, bukan audio YouTube hasil ekstraksi. Provider lain mendapat HTTP 422. Streaming IFrame tidak diubah.
- Operator harus mengaktifkan `AUDIO_DOWNLOADS_ENABLED=true` setelah memastikan hak unduh/distribusi. Default tertutup; akses tetap berlaku untuk guest maupun akun, tanpa login baru. Flag ini adalah konfirmasi sumber berizin, bukan paket/langganan baru.
- Sumber hanya konfigurasi server; parameter `url` tidak dapat memilih target. Placeholder ID/judul/artis hanya di path/query, bukan origin/host. HTTPS port standar, tanpa kredensial URL. DNS dipastikan publik dan koneksi diikat ke IP hasil validasi. Loopback/private/link-local/reserved/mapped IPv6 ditolak. Redirect ditolak; gunakan URL final. URL lengkap bertanda tangan tidak dikirim ke klien atau dicatat di log.
- Resolver memberi kemampuan/ukuran/tipe, bukan URL streaming untuk disimpan. Setiap percobaan transfer menyelesaikan sumber lagi. Tidak ada loop retry otomatis: tombol coba lagi melakukan permintaan baru. Adaptor saat ini **tidak memiliki API pembaruan signed URL**; jangan konfigurasi signed URL statis yang akan kedaluwarsa. Jika provider memerlukannya, implementasikan adaptor resmi pembaru URL/izin dahulu, bukan mengakali 403.
- MP3, WAV, Ogg, FLAC, MP4/M4A, WebM dikenali dari isi. Manifest HLS/DASH, JSON/HTML, format tidak dikenal, dan sumber non-file ditolak. Codec tetap harus didukung decoder platform. AAC mentah sengaja belum didukung. Native menolak DRM init data yang terdeteksi dan memeriksa ketersediaan decoder audio; tidak ada bypass DRM.
- Batas file 250 MiB; timeout native connect 20 detik/read idle 30 detik, batas total job 10 menit. Proxy dibatasi timeout 55 detik (batas deployment mungkin lebih ketat), resolver 30 detik. File sangat besar/lambat bisa gagal; tidak dijanjikan background/resume.

### APK Android

`EasvarafyDownloadPlugin.java` adalah plugin Capacitor lokal yang didaftarkan oleh `scripts/configure-android.mjs`:

- `HttpURLConnection → buffer 64 KiB → FileOutputStream` langsung ke `Context.getFilesDir()/offline/audio/*.part`; audio tidak masuk ke JS/base64.
- URL transfer dibatasi ke origin API yang dikompilasi ke APK dan path `/api/music/audio`. Tidak mengikuti redirect. Bukan plugin pengunduh URL arbitrer.
- Maksimum dua transfer. Native mengirim jumlah byte aktual dan total hanya jika diketahui. Pembatalan memutus koneksi dan menghapus bagian sementara. Tidak ada pause/resume palsu.
- Memeriksa HTTP 200, tipe respons, batas ruang, jumlah byte, keberadaan/ukuran file, signature, metadata durasi/audio, decoder dan hash SHA-256. File baru difinalisasi dengan rename setelah validasi dan fsync.
- Indeks JSON ditulis memakai Android `AtomicFile` (pemulihan backup saat startup). Catatan baru ditambahkan setelah validasi file dan commit indeks. Jika commit/batal gagal, file job dibersihkan.
- File `.part` dan audio/art tanpa referensi dibersihkan saat startup, sebelum job baru dapat dimulai. Indeks dicocokkan dengan ukuran, hash dan kemampuan baca/metadata file. File hilang/rusak tidak ditandai selesai.
- Playback memakai `Capacitor.convertFileSrc`; `OfflineWebViewClient` yang sudah ada tetap melayani file lokal dan HTTP Range untuk seeking. Transfer unduhan sendiri tidak mendukung Range/resume.
- Tidak menambah izin penyimpanan publik atau akses seluruh penyimpanan. **Tidak ada ekspor ke folder Downloads**; hanya simpan offline privat aplikasi. APK lama tanpa plugin masih dapat membaca unduhan lamanya melalui filesystem, tetapi unduhan baru meminta pembaruan APK.
- Unduhan harus dilakukan ketika aplikasi terbuka. Tidak memakai DownloadManager/WorkManager foreground/background transfer; tidak menjanjikan transfer bertahan setelah aplikasi ditutup. Sediakan uji foreground/background saat QA, bukan asumsi.

### Web

- Web benar-benar menyimpan **Blob audio** di IndexedDB, bukan URL sementara. File diperiksa signature/ukuran dan metadata decoder browser, diberi MIME aktual dan hash; baru kemudian metadata disimpan.
- Blob URL dipakai untuk playback. Reload membaca indeks dan memvalidasi blob; file hilang/rusak atau blob sisa tanpa indeks direkonsiliasi. Transaksi yang gagal di-abort, tidak membiarkan `clear()` indeks ter-commit sebagian.
- Menggunakan proxy yang tervalidasi agar transfer tidak bergantung pada CORS CDN langsung. Tidak membuat proxy terbuka. Penyimpanan persisten browser diminta jika tersedia, tanpa jaminan browser menyetujuinya.
- Ini **simpan offline di aplikasi**, bukan ekspor browser ke Downloads. Audio berada dalam IndexedDB. App shell Service Worker lama tetap digunakan; cold-open web tanpa internet bergantung pada shell/aset yang sudah tercache. Uji browser unduhan memverifikasi storage/decoder dan playback offline, bukan seluruh lifecycle Service Worker.
- Web masih menampung file dalam memori saat transfer/validasi. Batas ukuran dan paralelisme berlaku; Android tidak memakai jalur ini.

### UI, player, akun

- Status: menunggu, mengunduh, menyimpan/validasi, selesai (catatan file), gagal, dibatalkan; persentase dari byte, indikator tak tentu bila ukuran tidak diketahui. Deduplikasi menggunakan `provider:videoId`, termasuk migrasi indeks lama sebagai provider `youtube`.
- Pembatalan, coba lagi manual, hapus per lagu, penggunaan ruang dan hapus semua dengan konfirmasi. Hapus semua menunggu job aktif berhenti dan menyelesaikan promise job antrean sebelum membersihkan penyimpanan.
- Android mempunyai opsi hanya Wi-Fi yang memeriksa network transport saat mulai dan selama membaca. Tidak otomatis melanjutkan setelah jaringan berubah; pengguna mencoba lagi.
- File lokal diprioritaskan. Jika lokal gagal, player berhenti dengan pesan, bukan otomatis membebankan streaming. Lagu yang tidak diunduh tidak dilewati diam-diam; pemilihan lagu tidak tersedia saat offline tidak mengganti antrean. Playlist campuran menampilkan `Belum diunduh` saat offline.
- Lirik lokal dipakai tanpa request saat offline. Auto-radio tidak diprefetch saat offline. Artwork remote tidak diperlukan: placeholder lokal digunakan bila tidak ada artwork lokal lama. Cover baru **tidak diunduh** karena adaptor belum menyediakan izin cover; audio tetap dapat diputar tanpa cover/lirik.
- Perilaku produk sebelumnya dipertahankan: unduhan adalah **pustaka perangkat bersama**, tidak dikaitkan ke akun Supabase. Guest dan akun lain pada perangkat yang sama dapat mengaksesnya. Logout tidak menghapus file. Ini dijelaskan di UI. Tidak menyinkronkan metadata/file audio ke Supabase dan tidak mengunggah audio otomatis.
- Uninstall APK biasanya menghapus file privat; browser bisa menghapus IndexedDB. UI menjelaskan batas ini dan perbedaan dengan ekspor publik.

## File utama

- `native/android/java/com/easvarafy/app/EasvarafyDownloadPlugin.java`: transfer, validasi, pembatalan, indeks atomic, inspeksi, Wi-Fi, pembersihan.
- `lib/native/downloads.ts`, `scripts/configure-android.mjs`: kontrak bridge, pesan error, konfigurasi origin/registrasi.
- `lib/metrolist/offlineAudio.ts`: storage backend, lifecycle, commit serial, integrity, dedupe/cancel/delete.
- `lib/metrolist/offlineQueue.ts`, `types.ts`, `useOfflineLibrary.ts`: identitas provider, status dan migrasi.
- `lib/metrolist/audioValidation.ts`: signature/ukuran/MIME.
- `lib/server/audioSource.ts`, `downloadFetch.ts`, `app/api/music/audio/route.ts`: entitlement sumber, HTTPS/DNS pinning/SSRF dan validasi respons.
- `components/DownloadButton.tsx`, `OfflineDownloadsSection.tsx`, `SettingsView.tsx`, `DetailView.tsx`, `ArtworkImage.tsx`, `MusicProvider.tsx`: status, penjelasan, Wi-Fi dan integrasi offline.
- `.env.example`: konfigurasi sumber berizin. `eslint.config.mjs`: mengecualikan hasil generate APK dari lint.
- Unit/integration tests: `offlineAudio.test.ts`, `audioValidation.test.ts`, `offlineQueue.test.ts`, `app/api/music/audio/audio.test.ts`; browser: `tests/browser-downloads.mjs`. Dependensi dev `fake-indexeddb` dan `esbuild`.

## Mengaktifkan sumber yang sah

1. Sediakan file yang benar-benar Anda miliki hak unduh/distribusinya, dipetakan ke ID katalog; ini tidak menambahkan lagu berlisensi secara otomatis.
2. Atur server, misalnya:
   ```dotenv
   AUDIO_DOWNLOADS_ENABLED=true
   AUDIO_SOURCE_URL_TEMPLATE=https://cdn-anda.example/audio/{videoId}.mp3
   AUDIO_STORAGE_DISABLED=true
   ```
   Ganti contoh dengan host HTTPS final milik Anda, tanpa redirect. Jangan memakai host privat, manifest, URL streaming YouTube atau signed URL statis. Alternatif: bucket publik yang memang diizinkan didistribusikan dengan `AUDIO_STORAGE_DISABLED=false` dan `AUDIO_STORAGE_BUCKET` yang sesuai. Jangan membuat bucket publik untuk konten tanpa hak.
3. Deploy web/backend; buat ulang static bundle dan APK agar plugin native tersedia:
   ```sh
   npm ci
   npm run build:static
   npx cap sync android
   npm run android:configure
   npm run apk:debug
   ```
   Pertama kali: `npx cap add android` setelah static build. `NEXT_PUBLIC_API_BASE` dan/atau `CAPACITOR_SERVER_URL` harus konsisten dengan origin API di build APK. Domain baru membutuhkan APK baru untuk allowlist native.
4. Uji satu file berizin sungguhan di perangkat, termasuk mode pesawat. Build web baru saja tidak menambahkan plugin ke APK lama.

## Hasil pengujian dan batas klaim

Data audio tes adalah PCM WAV yang dibuat sendiri oleh tes, bukan hasil download katalog/provider. Mock respons dipakai untuk kondisi error; penyimpanan IndexedDB dan decoder/playback browser benar-benar dijalankan. Tidak ada progress sintetis di implementasi produksi.

- `npm run typecheck`: lulus.
- `npm run lint`: 0 error; 15 warning penggunaan `<img>` yang sudah ada.
- `npm test`: 83 tes lulus, termasuk lifecycle storage, duplikasi/paralelisme, 403 expired/streaming-only, respons non-audio, ukuran tidak lengkap, koneksi putus, batal/coba lagi, quota penuh, kegagalan commit indeks, hash file rusak, file hilang, hapus serta clear saat empat job aktif/antre.
- `npm run test:database`: 3 tes lulus.
- `npm run test:browser:downloads`: lulus dengan Chromium: byte file/Blob nyata, generic MIME, decoder menolak container palsu, duplikasi, 403/non-audio, reload modul dari IndexedDB, playback Blob saat context offline (`currentTime` bertambah) tanpa request streaming, hapus/storage usage.
- `npm run test:browser` dan `npm run test:browser:social`: lulus fixture 320/390/1280 px, termasuk persistent player stage/mini-player dan regresi UI yang tercakup suite tersebut. Bukan uji streaming YouTube produksi.
- `npm run build`: lulus build web.
- `npm run build:static`: lulus bundle untuk APK.
- `cap add/sync android` dan `android:configure`: berhasil menghasilkan proyek, menyalin plugin dan mendaftarkannya. Folder generated `android/` dan `out/` diabaikan Git.
- `npm run apk:debug`: **belum dapat membangun APK**: `JAVA_HOME is not set and no java command ...`. Tidak ada JDK, Android SDK, emulator/perangkat di lingkungan ini. Plugin Java **belum terkompilasi/diuji native** di sini. Keberhasilan static export/sync bukan bukti APK bekerja.

### QA native yang masih wajib sebelum rilis

Gunakan JDK 21/SDK sesuai workflow repository dan file berizin, lalu catat hasil nyata:

- Build Java/Gradle dan instal APK baru; transfer sungguhan dengan ukuran diketahui/tidak diketahui; validasi MP3/M4A/Ogg/WebM/WAV/FLAC yang didukung decoder perangkat.
- HTTP 401/403/404/429/5xx, redirect, token kedaluwarsa dengan mekanisme resmi provider (jika nanti tersedia), manifest, DRM dan format tak didukung.
- Mode pesawat saat transfer, timeout, batal di awal/akhir transfer, retry manual, empat unduhan/deduplikasi, hanya Wi-Fi dan perubahan jaringan.
- Storage Android benar-benar penuh/izin ditolak; tidak ada file parsial/status selesai palsu.
- Kill proses ketika `.part` aktif dan ketika finalisasi/commit indeks; buka ulang, periksa cleanup/AtomicFile dan jumlah storage.
- Hapus/ubah file via fasilitas debug; buka ulang dan periksa integritas, unduh ulang, hapus satu/semua. Verifikasi tidak ada orphan.
- Cold-open APK di mode pesawat dengan auth/guest, playlist campuran, pemutaran/seek/mini-player/lock-screen tanpa API streaming dan cover remote. Periksa penghentian pada file rusak tanpa fallback/skip otomatis.
- Pergantian akun/logout mempertahankan pustaka perangkat bersama sesuai penjelasan UI; uninstall menjelaskan hilangnya file privat.

**Kesimpulan:** jalur kode nyata telah diperbaiki dan storage/playback web dibuktikan. Keberhasilan unduh/offline pada APK produksi belum boleh dinyatakan lulus sampai build dan QA native di atas dilakukan serta sumber berizin produksi benar-benar tersedia.
