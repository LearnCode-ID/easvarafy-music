import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface NativeDownloads {
  readIndex(): Promise<{ json: string }>;
  writeIndex(options: { json: string }): Promise<void>;
  transfer(options: { id: string; url: string; wifiOnly: boolean }): Promise<{ localUri: string; size: number; mimeType: string; sha256: string }>;
  cancel(options: { id: string }): Promise<void>;
  inspect(options: { uri: string; size: number; sha256?: string }): Promise<{ valid: boolean; sha256?: string }>;
  cleanupParts(): Promise<void>;
  prune(options: { uris: string[] }): Promise<void>;
  network(): Promise<{ wifi: boolean }>;
  addListener(event: 'progress', listener: (event: { id: string; received: number; total: number | null }) => void): Promise<PluginListenerHandle>;
}
export const NativeDownload = registerPlugin<NativeDownloads>('EasvarafyDownload');
export function hasNativeDownloads() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('EasvarafyDownload');
}
const WIFI_KEY = 'easvarafy.download.wifiOnly';
export function getWifiOnly() { try { return typeof localStorage !== 'undefined' && localStorage.getItem(WIFI_KEY) === 'true'; } catch { return false; } }
export function setWifiOnly(value: boolean) { localStorage.setItem(WIFI_KEY, String(value)); }

export function transferError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'PERMISSION_DENIED': return 'Akses penyimpanan privat aplikasi ditolak. Periksa pengaturan aplikasi; izin seluruh penyimpanan tidak diperlukan.';
    case 'NO_SPACE': return 'Penyimpanan perangkat penuh. Kosongkan ruang lalu coba lagi.';
    case 'WIFI_REQUIRED': return 'Unduh hanya lewat Wi-Fi aktif. Sambungkan Wi-Fi lalu coba lagi.';
    case 'TIMEOUT': return 'Koneksi audio melewati batas waktu. Coba lagi saat koneksi stabil.';
    case 'HTTP_401': case 'HTTP_403': return 'Sumber menolak akses unduhan. Periksa izin atau URL provider.';
    case 'HTTP_404': return 'File unduhan tidak tersedia. Lagu mungkin hanya mendukung streaming.';
    case 'DRM_UNSUPPORTED': return 'Audio dilindungi DRM dan tidak didukung untuk unduhan di aplikasi ini.';
    case 'INVALID_AUDIO': case 'INCOMPLETE': return 'File audio rusak, tidak lengkap, atau format tidak didukung perangkat.';
    case 'INVALID_SOURCE': return 'Alamat API tidak sesuai APK. Perbarui APK atau konfigurasi API.';
    case 'TOO_LARGE': return 'File audio melebihi batas 250 MB.';
    default: return 'Transfer native gagal. Periksa koneksi, izin aplikasi, dan ruang penyimpanan lalu coba lagi.';
  }
}
