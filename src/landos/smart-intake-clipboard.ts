export const SMART_INTAKE_CLIENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SMART_INTAKE_CLIENT_MAX_BYTES = 10 * 1024 * 1024;

export type PendingImageSourceMethod = 'clipboard' | 'upload' | 'drop';

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function validatePendingIntakeImage(file: FileLike): string | null {
  const mimeType = file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type.toLowerCase();
  if (!SMART_INTAKE_CLIENT_IMAGE_TYPES.includes(mimeType as (typeof SMART_INTAKE_CLIENT_IMAGE_TYPES)[number])) {
    return 'Smart Intake accepts PNG, JPG/JPEG, and WEBP images.';
  }
  if (file.size === 0) return 'The image is empty.';
  if (file.size > SMART_INTAKE_CLIENT_MAX_BYTES) return 'The image is larger than the 10 MB limit.';
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const extensionMatches = mimeType === 'image/png' ? extension === '' || extension === 'png'
    : mimeType === 'image/jpeg' ? extension === '' || extension === 'jpg' || extension === 'jpeg'
      : extension === '' || extension === 'webp';
  return extensionMatches ? null : 'The image filename does not match its file type.';
}

export function insertClipboardPlainText(
  current: string,
  pasted: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, current.length));
  const end = Math.max(start, Math.min(selectionEnd, current.length));
  return {
    value: `${current.slice(0, start)}${pasted}${current.slice(end)}`,
    caret: start + pasted.length,
  };
}

export function pendingImageIdentity(file: FileLike): string {
  return `${file.name}\u0000${file.type}\u0000${file.size}`;
}
