# Android App Links + Signing — Easvarafy

Dokumen pendamping [`AUTH_SETUP.md`](./AUTH_SETUP.md). Deep link custom scheme
`com.easvarafy.app://auth/callback` (OAuth) sudah jalan. Dokumen ini menambahkan
**Android App Links**: link `https://` domain web yang membuka APK langsung,
dengan verifikasi sertifikat.

| Link | Sebelum | Sesudah (App Links aktif) |
| --- | --- | --- |
| `https://easvarafy-music.vercel.app/profile/<id>` (share) | Buka browser | Langsung buka APK |
| `https://easvarafy-music.vercel.app/playlist/<id>` (share) | Buka browser | Langsung buka APK |
| `https://easvarafy-music.vercel.app/auth/callback?code=…` | — (belum dipakai) | Langsung buka APK (alternatif redirect OAuth yang lebih aman) |

---

## Kenapa butuh konfigurasi sertifikat/signing

App Links terverifikasi (buka tanpa dialog "buka dengan") mensyaratkan Android
memeriksa `https://<host>/.well-known/assetlinks.json`. File itu berisi **SHA-256
fingerprint sertifikat** yang menandatangani APK. Android mencocokkan fingerprint
APK terpasang dengan file tersebut.

Masalah default-nya:

1. **Template Capacitor 8 tidak punya signing config release.** `assembleRelease`
   menghasilkan APK unsigned, dan `assembleDebug` ditandatangani debug keystore
   yang **di-generate ulang di setiap mesin/runner** → fingerprint berubah tiap
   build → `assetlinks.json` tidak akan pernah cocok, dan pembaruan APK juga
   menuntut uninstall-install ulang (signature berubah).
2. **Solusi: satu release keystore yang stabil**, dijaga sebagai GitHub secret,
   dipakai CI untuk menandatangani `assembleRelease`. Fingerprint-nya yang
   dicatat di `assetlinks.json` dan di-commit.

> ⚠️ Jangan pernah commit file keystore (.jks/.keystore). Fingerprint SHA-256
> boleh publik (dipublish di assetlinks.json), tapi **file keystore-nya tidak**.

---

## Ringkasan alur

```
release.keystore (GitHub secret, base64)
        │  decode di CI → gradle signingConfigs.easvarafyRelease
        ▼
assembleRelease → app-release.apk (fingerprint SHA-256 X)
        ▲                                              │
        │ cocok                                        │
public/.well-known/assetlinks.json ── deploy Vercel ──▶ https://<host>/.well-known/assetlinks.json
(commit di repo)                                        ▼
                                        Android memverifikasi → App Links aktif
```

Semua langkah 3-7 di-otomatisasi oleh `npm run app-links`
(`scripts/app-links.ts` + `lib/app/app-links.ts`).

---

## 1. Buat release keystore (sekali saja, simpan selamanya)

Jalankan di mesin lokal, buat **satu** keystore dan jangan pernah dibuat ulang:

```bash
keytool -genkeypair -v \
  -keystore easvarafy-release.keystore -alias easvarafy \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass '<PASSWORD>' -keypass '<PASSWORD>'
```

Lihat fingerprint-nya:

```bash
keytool -list -v -keystore easvarafy-release.keystore -storepass '<PASSWORD>' \
  | grep 'SHA256:'
```

Kehilangan keystore ini = identitas APK baru (pengguna harus uninstall-install,
App Links harus di-update). Simpan backup di password manager/vault.

## 2. Pasang GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Isi |
| --- | --- |
| `EASVARAFY_ANDROID_KEYSTORE_BASE64` | `base64 -w0 easvarafy-release.keystore` (Linux) / `base64 -i easvarafy-release.keystore` (macOS) |
| `EASVARAFY_ANDROID_KEYSTORE_PASSWORD` | Password keystore |
| `EASVARAFY_ANDROID_KEY_ALIAS` | `easvarafy` |
| `EASVARAFY_ANDROID_KEY_PASSWORD` | (opsional; default = password keystore) |

Workflow `.github/workflows/build-apk.yml` otomatis:

- decode keystore ke `$RUNNER_TEMP` (tidak pernah ditulis ke repo);
- jalankan `npx tsx scripts/app-links.ts` → intent-filter `autoVerify` + signing
  config disuntik ke project Android hasil `cap add/sync`;
- build `assembleRelease` (bila secrets ada) dan publish itu sebagai
  `easvarafy-music.apk`; tanpa secrets jatuh kembali ke `assembleDebug`.

## 3. Generate assetlinks.json (lokal)

```bash
EASVARAFY_ANDROID_KEYSTORE_PATH=/absolut/path/easvarafy-release.keystore \
EASVARAFY_ANDROID_KEYSTORE_PASSWORD='<PASSWORD>' \
EASVARAFY_ANDROID_KEY_ALIAS=easvarafy \
npm run app-links
```

Hasilnya `public/.well-known/assetlinks.json` (host diambil dari
`NEXT_PUBLIC_APP_URL`; fingerprint keystore diekstrak via `keytool`). **Commit
file ini** — deploy Vercel yang membawanya ke URL verifikasi. Untuk cek tanpa
menulis: `npm run app-links -- --check`.

Bila rilis juga lewat **Play Store (Play App Signing)**, tambahkan fingerprint
sertifikat yang ditampilkan Play Console (Release → Setup → App signing key) ke
`EASVARAFY_ANDROID_CERT_SHA256` sebelum menjalankan `npm run app-links` — file
mendukung banyak fingerprint sekaligus.

## 4. Deploy web & cek URL verifikasi

```bash
curl -sI https://easvarafy-music.vercel.app/.well-known/assetlinks.json | head -5
# Harus: HTTP 200, Content-Type: application/json, TANPA redirect.
```

Syarat Android: file dilayani HTTP 200 `application/json`, tidak diarahkan
(redirect 301/308 membatalkan verifikasi), dan dapat diakses crawler Google
(tanpa auth). `trailingSlash: false` pada `next.config.ts` membuat URL ini
dilayani langsung dari `public/`.

## 5. Build APK & install

```bash
gh workflow run build-apk.yml          # CI → release asset easvarafy-music.apk
adb install -r easvarafy-music.apk
```

## 6. Verifikasi di perangkat

```bash
adb shell pm verify-app-links --re-verify com.easvarafy.app
adb shell pm get-app-links com.easvarafy.app
# domain harus: legacy=none, verified=easvarafy-music.vercel.app
adb logcat -s Verifier:V IntentFilterVerifier:V | grep -i easvarafy
```

Uji dari luar: kirim link share profil/playlist via WhatsApp/chrome → harus
membuka APK langsung (tanpa disambiguation). Juga tersedia
[Statement List Generator & Tester](https://developers.google.com/digitalassetlinks/tools/statement-list-generator)
untuk cek dari sisi Google.

## 7. (Opsional) Pindahkan redirect OAuth ke https

Custom scheme `com.easvarafy.app://` bisa "dibajak" aplikasi lain; App Links
https terverifikasi tidak. Supabase → Authentication → URL Configuration:

1. tambahkan `https://easvarafy-music.vercel.app/auth/callback` ke Redirect URLs
   (jangan hapus yang lama sampai semua APK baru terpasang);
2. ganti `NATIVE_OAUTH_REDIRECT` di `lib/auth/native.ts` bila ingin memakai
   https sebagai redirect default. Handler `appUrlOpen` sudah mengenali URL
   `…/auth/callback` untuk kedua scheme.

---

## Konfigurasi (env / secrets)

| Variabel | Fungsi | Default |
| --- | --- | --- |
| `EASVARAFY_APP_LINKS_HOST` | Host yang diklaim | Host dari `NEXT_PUBLIC_APP_URL` → `NEXT_PUBLIC_API_BASE` → `CAPACITOR_SERVER_URL` (host lokal di-skip) |
| `EASVARAFY_APP_LINKS_PATHS` | Path prefix, dipisah koma | `/auth/callback,/profile,/playlist` |
| `EASVARAFY_APP_PACKAGE` | Override package name | `com.easvarafy.app` |
| `EASVARAFY_ANDROID_KEYSTORE_PATH` | Keystore release (lokal/CI) | — |
| `EASVARAFY_ANDROID_KEYSTORE_PASSWORD` | Password keystore | — |
| `EASVARAFY_ANDROID_KEY_ALIAS` | Alias key | — |
| `EASVARAFY_ANDROID_KEY_PASSWORD` | Password key | = password keystore |
| `EASVARAFY_ANDROID_CERT_SHA256` | Fingerprint tambahan (Play App Signing), koma | — |
| `EASVARAFY_ANDROID_DEBUG_CERT_SHA256` | Fingerprint sertifikat debug lokal | — |

Debug keystore yang ditemukan otomatis (`~/.android/debug.keystore` dan
`android/app/debug.keystore`, password `android`) ikut ditulis ke
assetlinks.json agar build debug juga terverifikasi — hanya untuk development;
rilis publik harus release keystore.

## File yang terlibat

| File | Peran |
| --- | --- |
| `lib/app/app-links.ts` | Logika murni (normalisasi SHA256, assetlinks.json, snippet manifest/gradle) + test |
| `scripts/app-links.ts` | CLI: keytool → assetlinks.json → patch manifest & build.gradle |
| `public/.well-known/assetlinks.json` | Dicommit, disajikan Vercel di URL verifikasi |
| `scripts/configure-android.mjs` | `cap add/sync` post-config (dijalankan sebelum `npm run app-links`, lihat `npm run android:configure`) |
| `.github/workflows/build-apk.yml` | Decode secret keystore, build `assembleRelease`, publish |

## Troubleshooting

| Gejala | Penyebab umum |
| --- | --- |
| `pm get-app-links` tetap `none` | `assetlinks.json` belum deploy / fingerprint salah / APK yang terpasang signed debug keystore berbeda → pastikan APK dari workflow dengan keystore secrets |
| Dialog "Buka dengan" muncul tiap klik link | Verifikasi belum sukses — cek URL 200 JSON tanpa redirect, cek fingerprint `keytool -list` vs file |
| APK gagal update ("App not installed") | Signature berubah antar build (APK debug lama) → uninstall dulu |
| Link terbuka di browser, bukan APK | Path belum diklaim → tambah ke `EASVARAFY_APP_LINKS_PATHS` lalu jalankan ulang `npm run app-links` + commit |
| `npm run app-links`: `SHA256 tidak ditemukan di output keytool` | keytool JDK 9+ dibutuhkan (JDK 21 di CI) atau password/alias salah |
| Verifikasi gagal hanya di Play Store build | Tambahkan fingerprint **Play App Signing** ke `EASVARAFY_ANDROID_CERT_SHA256` |
