import { ATTACHMENT_MIME_TYPES, LIMITS, type Attachment, type AttachmentMimeType } from '../../shared/types';

/**
 * Turns a user-picked file into composer input:
 *  - plain text → read here and put into the textarea (user can see/edit it)
 *  - PDF / image → base64 attachment sent to the model, which reads it natively
 * Throws Error with a user-facing message for anything else.
 */

export type FileInput =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'attachment'; attachment: Attachment; size: number };

export const ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,text/plain,text/markdown,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif';

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json)$/i;

// Some browsers (notably for HEIC on Windows/Android) report an empty type.
const MIME_BY_EXT: Record<string, AttachmentMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function attachmentMime(file: File): AttachmentMimeType | null {
  if ((ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) return file.type as AttachmentMimeType;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const comma = url.indexOf(',');
      resolve(comma === -1 ? '' : url.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Couldn’t read that file.'));
    reader.readAsDataURL(file);
  });
}

export async function readFileForComposer(file: File): Promise<FileInput> {
  if (file.size === 0) throw new Error('That file is empty.');

  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
    if (file.size > LIMITS.textFileMaxBytes) {
      throw new Error(`That text file is too large (max ${formatBytes(LIMITS.textFileMaxBytes)}).`);
    }
    const raw = (await file.text()).replace(/\r\n/g, '\n').trim();
    if (!raw) throw new Error('That file has no text in it.');
    const truncated = raw.length > LIMITS.textMax;
    return { kind: 'text', text: truncated ? raw.slice(0, LIMITS.textMax) : raw, truncated };
  }

  const mimeType = attachmentMime(file);
  if (!mimeType) throw new Error('Unsupported file type. Use a PDF, an image (PNG, JPG, WebP, HEIC), or a text file.');
  if (file.size > LIMITS.attachmentMaxBytes) {
    throw new Error(`That file is ${formatBytes(file.size)} — the limit is ${formatBytes(LIMITS.attachmentMaxBytes)}.`);
  }
  const data = await readAsBase64(file);
  if (!data) throw new Error('Couldn’t read that file.');
  return { kind: 'attachment', attachment: { name: file.name, mimeType, data }, size: file.size };
}
