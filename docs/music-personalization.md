# Rekomendasi musik privat: Home + Up Next

## Status

Implementasi terintegrasi dalam source aplikasi. **Migrasi rekomendasi belum diterapkan ke Supabase remote oleh pekerjaan ini.** Status deployment aplikasi perlu diperiksa terpisah: merge Git bukan konfirmasi deployment atau penerapan migrasi. Endpoint provider langsung dan dua akun produksi/perangkat Android fisik belum diuji dari sandbox ini (akses jaringan provider dibatasi). Pengujian browser menggunakan respons provider dan player terkontrol, bukan bukti playback YouTube langsung.

Sebelum mengaktifkan sinkronisasi akun pada release, terapkan hanya migrasi baru `supabase/migrations/20261127040000_private_recommendations.sql` melalui proses migrasi Supabase yang biasa. Jangan menerapkan ulang migrasi privacy/social sebelumnya. Migrasi baru bersifat aditif: satu tabel privat, satu policy SELECT owner, tiga RPC authenticated; tidak mengubah profil, likes, playlist, atau data Blend. Deploy web setelah migrasi, lalu build/sync Capacitor terhadap API web versi yang sama. Jangan mengirim service-role key ke frontend.

Jika migrasi/API belum tersedia, pemutaran tidak diblokir; guest tetap bekerja dan UI akun menampilkan kegagalan sinkronisasi, bukan keberhasilan penyimpanan cloud palsu.

## Alur dan sumber nyata

- `lib/recommendation/engine.ts`: normalisasi ID `youtube:<videoId>`, validasi metadata, sinyal, seed preferensi, scoring deterministik, filter, deduplikasi versi konservatif, dan diversifikasi bersama.
- `app/api/music/up-next/route.ts`: memakai `ytmusic-api` yang sudah ada: `getUpNexts`, fallback `getArtistSongs`, lalu track sungguhan dari `getHomeSections`. Metadata fitur audio/genre/mood/BPM tidak tersedia dan **tidak dikarang**. Related berarti hubungan dari provider, bukan hasil analisis audio lokal. Home provider tidak lagi mengembalikan SEED_TRACKS saat error.
- `lib/recommendation/client.ts`: cache per identitas 10 menit/24 pool, berbagi request in-flight, timeout 20 detik, maksimal tiga request aktif. Request konteks lagu baru mendapat prioritas dengan membatalkan request tertua ketika penuh; hasil lama tidak dapat mengganti queue baru. Cache yang masih relatif baru (maksimal 30 menit) boleh dipakai saat error, selain itu kosong secara jujur.
- Pool Up Next mixed: konteks saat ini + satu seed preferensi nyata + katalog untuk eksplorasi. Fallback artis/katalog dapat diperluas bila filter menghabiskan kandidat. Mode related tetap ketat. Mode library mengutamakan koleksi akun yang sedang aktif.
- Seed taste memadukan minat substansial terbaru dengan evidence jangka lebih panjang. Scoring memakai affinity track/artis yang benar-benar diketahui, urutan provider, recency half-life 21 hari, dan floor 0,18; autoplay hanya berbobot 25% dari aksi eksplisit. Semua bobot/limit ada di `RECOMMENDATION_CONFIG`. Tidak ada shuffle acak untuk membuat kesan personal.
- Diversifikasi mengenakan penalti artis berulang. Slot eksplorasi sekitar 1 dari 8 memilih kandidat katalog yang belum dikenal bila tersedia, tetap melewati semua filter. Tidak menjamin audio tersedia di semua wilayah/perangkat; provider/player tetap menjadi otoritas availability.

## Sinyal pemutaran

`ListeningSession` hanya mengkreditkan interval posisi player yang benar-benar maju sewajarnya ketika state player PLAYING, bukan buffering/paused. Lompatan seek dan gap timer >5 detik tidak mendapat kredit; playback rate diperhitungkan. Timer UI/fallback bukan sumber sinyal.

- Select sengaja: lemah (0,3).
- Listen: minimal 30 detik aktual, atau hampir selesai untuk track pendek; satu event awal dan tambahan maksimal sekali pada 120 detik.
- Complete: minimal 90% cakupan posisi konten unik yang terverifikasi, dengan minimum 10 detik waktu dengar. Playback rate tidak mengubah syarat cakupan; mengulang fragmen lewat seek tidak memalsukan completion. Durasi tidak diketahui tidak ditebak untuk completion; durasi player dapat dipakai jika benar-benar tersedia.
- Replay: baru setelah sesi ulang mencapai ambang listen, bukan sekadar menekan tombol play.
- Like / tambah playlist: dicatat **setelah** operasi cloud library terkonfirmasi.
- Quick skip: hanya perubahan eksplisit ketika sudah mendengar 1–<10 detik. Pause, buffering, seek, error player, penutupan aplikasi, atau auto-advance tidak menjadi dislike.
- Tidak tertarik / blok artis: pilihan eksplisit di menu track, menjadi hard filter rekomendasi; tidak menghapus track manual/playlist atau menghentikan lagu aktif.

Riwayat lama yang dihitung saat load tidak diimpor sebagai evidence rekomendasi. Shelf riwayat personal Home diturunkan dari sinyal listen baru yang terverifikasi. Filter menolak current, duplicate provider IDs, recent listen (1 jam), blok track/artis, VIDEO bila disembunyikan, metadata invalid, dan `available:false`. Identitas versi hanya digabung jika title/artis cocok setelah membersihkan label official audio/video dan durasi berbeda <=3 detik; live/remix tetap berbeda.

## Queue dan Home

`QueueState.automaticIds` menandai hanya segmen generated. Queue lama tanpa metadata diperlakukan sebagai eksplisit/protected. Play Next, Add to Queue, dan drag mempromosikan track menjadi protected. Add to Queue masuk sebelum segmen otomatis. Urutan album/playlist tidak ditimpa. Autoplay off menghapus hanya generated future entries dan membatalkan penerapan respons tertunda.

Refresh menjaga current dan immediate next. Update taste pasif didebounce 8 detik dan mengganti maksimal empat entry otomatis yang jauh; refresh manual boleh mengganti seluruh tail otomatis. Request gate, pemeriksaan seed, cancellation, dan instance per akun mencegah respons out-of-order/account lama diterapkan.

Home memakai engine yang sama tetapi bukan menyalin queue: queue dan shelf history/collection yang sudah dicadangkan dikecualikan dari kandidat section baru. Dua section rekomendasi saling disjoint: “Pilihan untukmu” dan related section dengan alasan provider. Heading “Karena kamu mendengarkan…” hanya dipakai bila seed memang memiliki evidence listen; like-only memakai label pilihan musik. Cold start/disabled memakai label katalog, bukan personalisasi palsu. Rebuild setelah tiga sinyal listen/replay/complete atau feedback eksplisit, bukan setiap detik. Ada skeleton, empty/error dan retry. Jalur editorial lama yang membungkus pool biasa menjadi “Top 100”, “viral”, “artist essentials” atau mix personal tanpa evidence provider tidak lagi dirender di Home; album/playlist/artis asli tetap muncul lewat shelf provider. Hasil pencarian genre diberi label jelajah dan tidak dipadankan dengan rekomendasi yang genrenya tidak diketahui.

## Privasi, guest, dan akun

- Guest: ID acak lokal, bukan fingerprint/PII; event maksimal 300/90 hari, memory fallback bila storage ditolak/penuh. Legacy riwayat device juga dibatasi 120 dan difilter umur 90 hari untuk guest. Tidak ada request Supabase untuk sinyal guest.
- Akun: cache/pending per user ID, maksimal 600 event/180 hari. Akun lain dan guest memiliki instance store, cache kandidat, dan state yang berbeda. Respons instance lama diabaikan setelah logout/account switch. Transport memeriksa owner session dan mengikat header Authorization pada snapshot token akun tersebut, sehingga batch A tidak pernah memakai token B saat pergantian akun. Sinkronisasi batch maksimal 30, debounce 15 detik; pending tersimpan lokal untuk retry. Refresh saat online/focus terbatasi dan tiap 2 menit saat terlihat menangkap perubahan perangkat lain.
- `recommendation_tastes`: RLS SELECT `auth.uid() = user_id`. Tidak ada direct INSERT/UPDATE/DELETE untuk authenticated/anon/public. RPC definer memakai search_path kosong, UID hanya dari auth session, whitelist metadata, validasi JSON/jenis event/angka/umur/ukuran, dedupe ID, retention, maksimal 180 event/menit/akun. Profil publik, admin frontend, follow, dan Blend tidak memperoleh akses ke tabel ini.
- Setiap perubahan preferensi/reset menaikkan epoch. Batch perangkat offline yang epoch-nya lama diabaikan sehingga reset tidak dihidupkan kembali. Reset dan toggle akun baru dinyatakan berhasil setelah RPC terkonfirmasi. Gagal/offline menampilkan error; tidak ada klaim tersimpan cloud.
- Banner Home setelah login dan Settings menawarkan persetujuan guest. Tanpa persetujuan **tidak ada upload otomatis**. Hanya ringkasan maksimal 30 track positif dengan jenis `import`, tanpa timestamp/durasi riwayat mentah, yang dikirim. Guest baru dihapus setelah server mengonfirmasi semua event ringkasan; perubahan epoch/disabled atau kegagalan mempertahankan data guest.
- Settings menyediakan disable dan reset/hapus riwayat + preferensi/blok. Disable menghentikan pencatatan dan hanya memakai konteks/katalog; blok eksplisit tetap menjadi safety filter sampai reset. Library/playlist tidak dihapus.
- Penyimpanan browser bukan enkripsi untuk perangkat bersama: isolasi aplikasi berbasis identitas, bukan perlindungan dari orang yang memiliki akses DevTools/disk profil browser yang sama.

## Verifikasi

- `npm test`: **108** unit tests keseluruhan (setelah integrasi perbaikan download/offline dari main), termasuk engine/session/store/candidate-client/queue.
- `npm run test:database`: **4** PostgreSQL/PGlite tests keseluruhan; migrasi rekomendasi diuji langsung untuk dua akun + anon, RLS, payload whitelist, dedupe, batch/rate limit, reset epoch, dan disabled ingestion.
- `npm run test:browser:recommendations`: cold guest, rapid selection dengan respons lama ditunda, playback clock nyata pada player fixture, substantial listen + complete, learning, feedback, bounded provider requests, viewport 390 dark/reduced motion, tanpa runtime error.
- `npm run test:browser:downloads`: regresi browser byte/decoder audio, dedupe, kegagalan sumber, persistence, offline playback, dan penghapusan; memakai audio fixture milik test.
- `npm run test:browser:library`: regresi skeleton di 320/390/1280, light/dark, dua preferensi motion.
- `npm run lint`: tidak ada error; 15 warning `<img>` yang sudah ada.
- `npm run typecheck`, `npm run build`, `npm run build:static`, dan `git diff --check`.

Browser di sandbox memerlukan Chromium yang tersedia di lingkungan penguji. Jalankan dev server dengan env Supabase fixture (bukan kredensial produksi) seperti test browser library. Fixture tidak pernah dimasukkan ke katalog produksi. Rekomendasi lintas dua perangkat produksi, kualitas ranking pada data nyata, live provider availability/region, serta APK fisik tetap perlu acceptance test setelah migrasi dan release staging.
