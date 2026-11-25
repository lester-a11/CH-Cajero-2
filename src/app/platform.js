import { Capacitor, registerPlugin } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { strToU8 } from 'fflate';

const FilePicker = registerPlugin('FilePicker');

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function pickArchive() {
  if (!Capacitor.isNativePlatform() || !FilePicker) throw new Error('El selector de archivos requiere la APK Android.');
  return FilePicker.pickFile({ mimeType: '*/*' });
}

export async function takeProductPhoto() {
  if (!Capacitor.isNativePlatform()) throw new Error('La cámara requiere la APK Android.');
  const photo = await Camera.getPhoto({
    quality: 65,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: CameraSource.Prompt,
    correctOrientation: true
  });
  return await compressPhoto(photo.base64String, 30 * 1024);
}

async function compressPhoto(base64, maxBytes) {
  const image = new Image();
  image.src = `data:image/jpeg;base64,${base64}`;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  let width = Math.min(image.width, 800);
  let quality = 0.68;
  for (let attempt = 0; attempt < 12; attempt++) {
    const height = Math.round(image.height * width / image.width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const output = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (atob(output).length <= maxBytes) return output;
    if (quality > 0.38) quality -= 0.08;
    else width = Math.max(240, Math.round(width * 0.82));
  }
  const canvas = document.createElement('canvas');
  const widthFinal = Math.min(width, 360);
  canvas.width = widthFinal;
  canvas.height = Math.round(image.height * widthFinal / image.width);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.36).split(',')[1];
}

export async function saveAndShare(filename, bytes, title, text) {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return { exported: true, nativeShare: false };
  }
  const data = bytesToBase64(bytes);
  await Filesystem.writeFile({ path: filename, data, directory: Directory.Data, recursive: true });
  const saved = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title, text, files: [saved.uri], dialogTitle: 'Compartir mediante…' });
  return { exported: true, nativeShare: true, uri: saved.uri };
}

export async function shareExistingZip(filename, bytes, title, text) {
  return saveAndShare(filename, bytes, title, text);
}

export function downloadText(filename, value, mime = 'application/json') {
  const blob = new Blob([strToU8(value)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
