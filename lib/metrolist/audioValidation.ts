/** Conservative single-file formats. Manifests/DRM/unknown containers are not downloads. */
export function detectAudioFormat(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 12) return null;
  if (text(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0))
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return { mimeType: 'audio/wav', extension: 'wav' };
  if (text(0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (text(0, 4) === 'fLaC') return { mimeType: 'audio/flac', extension: 'flac' };
  if (text(4, 8) === 'ftyp') return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { mimeType: 'audio/webm', extension: 'webm' };
  return null;
}

export const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
export function validateAudioTransfer(head: Uint8Array, size: number, expected: number | null, contentType: string | null) {
  if (/text\/|json|mpegurl|dash\+xml/i.test(contentType ?? ''))
    throw new Error('Sumber mengirim halaman error atau manifest, bukan file audio yang didukung.');
  if (size < 128 || size > MAX_AUDIO_BYTES) throw new Error('Ukuran file audio kosong, terlalu kecil, atau melebihi batas 250 MB.');
  if (expected && size !== expected) throw new Error('File audio tidak lengkap. Periksa koneksi lalu coba lagi.');
  const format = detectAudioFormat(head);
  if (!format) throw new Error('Isi file bukan audio yang didukung atau file rusak.');
  return format;
}
