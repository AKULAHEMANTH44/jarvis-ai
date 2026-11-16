import {
  FileInspectionResult,
  PermissionRequest,
  SelectedFileMetadata,
  SupportedFileKind
} from '../types/assistant';
import { PermissionManager, permissionManager as defaultPermissionManager } from './permissionManager';

const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'ps1',
  'sh',
  'vbs',
  'vbe',
  'jsfl',
  'scr',
  'dll',
  'sys',
  'com',
  'app',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'jar',
  'apk'
]);

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'html',
  'css',
  'yml',
  'yaml',
  'xml',
  'ini',
  'env'
]);

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const MODEL_3D_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'stl']);

const MAX_TEXT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_MODEL_SIZE_BYTES = 100 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function extractExtension(filename: string): string {
  const parts = filename.trim().split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

export function classifyFile(file: Pick<File, 'name' | 'size' | 'type'>): Omit<SelectedFileMetadata, 'fileId' | 'selectedAt'> {
  const ext = extractExtension(file.name);
  const sizeFormatted = formatBytes(file.size);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'BLOCKED',
      intendedOperation: 'Execution blocked for security safety',
      supported: false,
      reasonIfUnsupported: `Executable or script format (.${ext}) is blocked and cannot be opened or executed.`
    };
  }

  if (MODEL_3D_EXTENSIONS.has(ext)) {
    const withinLimit = file.size <= MAX_MEDIA_MODEL_SIZE_BYTES;
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || 'model/gltf-binary',
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'MODEL_3D',
      intendedOperation: 'Import 3D geometry into Holographic Object Lab',
      supported: withinLimit,
      reasonIfUnsupported: withinLimit ? undefined : `3D model exceeds 100 MB browser safety limit (${sizeFormatted}).`
    };
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    const withinLimit = file.size <= MAX_MEDIA_MODEL_SIZE_BYTES;
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || `audio/${ext}`,
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'AUDIO',
      intendedOperation: 'Load selected local audio track for playback',
      supported: withinLimit,
      reasonIfUnsupported: withinLimit ? undefined : `Audio file exceeds 100 MB safety limit (${sizeFormatted}).`
    };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const withinLimit = file.size <= MAX_MEDIA_MODEL_SIZE_BYTES;
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || `image/${ext}`,
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'IMAGE',
      intendedOperation: 'Open and preview selected image safely in workspace',
      supported: withinLimit,
      reasonIfUnsupported: withinLimit ? undefined : `Image file exceeds 100 MB safety limit (${sizeFormatted}).`
    };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const withinLimit = file.size <= MAX_TEXT_SIZE_BYTES;
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || 'text/plain',
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'TEXT',
      intendedOperation: 'Read and preview text/structured content in workspace',
      supported: withinLimit,
      reasonIfUnsupported: withinLimit ? undefined : `Text file exceeds 10 MB inspection cap (${sizeFormatted}).`
    };
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    const isPdfOrRtf = ext === 'pdf' || ext === 'rtf';
    const withinLimit = file.size <= MAX_TEXT_SIZE_BYTES * 2;
    if (!isPdfOrRtf) {
      return {
        name: file.name,
        extension: ext,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        sizeFormatted,
        kind: 'UNSUPPORTED',
        intendedOperation: 'Document parsing unavailable',
        supported: false,
        reasonIfUnsupported: `Binary .${ext} word-processing files do not have a built-in client parser. Export to .pdf, .txt, or .md to read in-app.`
      };
    }
    return {
      name: file.name,
      extension: ext,
      mimeType: file.type || 'application/pdf',
      sizeBytes: file.size,
      sizeFormatted,
      kind: 'DOCUMENT',
      intendedOperation: 'Open document preview and extract readable text where available',
      supported: withinLimit,
      reasonIfUnsupported: withinLimit ? undefined : `Document exceeds 20 MB browser limit (${sizeFormatted}).`
    };
  }

  return {
    name: file.name,
    extension: ext || 'unknown',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    sizeFormatted,
    kind: 'UNSUPPORTED',
    intendedOperation: 'Unsupported format',
    supported: false,
    reasonIfUnsupported: `Format ".${ext || 'unknown'}" is not supported by any built-in viewer or parser.`
  };
}

function extractReadablePdfText(buffer: ArrayBuffer): string {
  try {
    const decoder = new TextDecoder('latin1');
    const raw = decoder.decode(buffer.slice(0, 512_000));
    const chunks: string[] = [];
    const literalRegex = /\(([^()\\]{3,160})\)/g;
    let m: RegExpExecArray | null;
    while ((m = literalRegex.exec(raw)) !== null && chunks.length < 180) {
      const cleaned = m[1].replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 3 && /[a-zA-Z0-9]/.test(cleaned)) {
        chunks.push(cleaned);
      }
    }
    const joined = chunks.join(' ').trim();
    return joined.length >= 12 ? joined : '';
  } catch {
    return '';
  }
}

export interface FileAccessHostCallbacks {
  onImport3DModels?: (files: File[]) => Promise<void> | void;
  onPlayAudioFile?: (file: File, permissionId?: string) => Promise<void> | void;
}

export class FileAccessService {
  private permissionMgr: PermissionManager;
  private selectedFiles: Map<string, { file: File; metadata: SelectedFileMetadata }> = new Map();
  private createdObjectUrls: string[] = [];
  private hostCallbacks: FileAccessHostCallbacks = {};

  constructor(permissionMgr: PermissionManager = defaultPermissionManager) {
    this.permissionMgr = permissionMgr;
  }

  public setHostCallbacks(callbacks: FileAccessHostCallbacks) {
    this.hostCallbacks = callbacks;
  }

  public registerSelectedFile(file: File): SelectedFileMetadata {
    const info = classifyFile(file);
    const fileId = `file-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const metadata: SelectedFileMetadata = {
      ...info,
      fileId,
      selectedAt: Date.now()
    };
    this.selectedFiles.set(fileId, { file, metadata });
    return metadata;
  }

  public getSelectedFileMetadata(fileId: string): SelectedFileMetadata | null {
    return this.selectedFiles.get(fileId)?.metadata ?? null;
  }

  public getRawFile(fileId: string): File | null {
    return this.selectedFiles.get(fileId)?.file ?? null;
  }

  public async pickFilesFromBrowser(options: { accept?: string; multiple?: boolean } = {}): Promise<{
    cancelled: boolean;
    files: SelectedFileMetadata[];
    error?: string;
  }> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        cancelled: false,
        files: [],
        error: 'Browser file picker is unavailable in this non-DOM runtime.'
      };
    }

    // Prefer native showOpenFilePicker if available
    if ('showOpenFilePicker' in window && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function') {
      try {
        const picker = (window as unknown as {
          showOpenFilePicker: (opts?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker;
        const handles = await picker({ multiple: Boolean(options.multiple) });
        const picked: SelectedFileMetadata[] = [];
        for (const handle of handles) {
          const file = await handle.getFile();
          picked.push(this.registerSelectedFile(file));
        }
        return { cancelled: picked.length === 0, files: picked };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { cancelled: true, files: [] };
        }
        // Fall through cleanly to <input type="file"> on SecurityError / cross-origin iframe restriction
      }
    }

    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (options.accept) input.accept = options.accept;
      if (options.multiple) input.multiple = true;
      input.style.display = 'none';

      let settled = false;
      const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
        window.removeEventListener('focus', onWindowFocus);
      };

      const onWindowFocus = () => {
        setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) {
            settled = true;
            cleanup();
            resolve({ cancelled: true, files: [] });
          }
        }, 350);
      };

      input.onchange = () => {
        settled = true;
        const list = input.files ? Array.from(input.files) : [];
        cleanup();
        if (list.length === 0) {
          resolve({ cancelled: true, files: [] });
          return;
        }
        const registered = list.map((f) => this.registerSelectedFile(f));
        resolve({ cancelled: false, files: registered });
      };

      input.oncancel = () => {
        settled = true;
        cleanup();
        resolve({ cancelled: true, files: [] });
      };

      document.body.appendChild(input);
      window.addEventListener('focus', onWindowFocus, { once: true });
      input.click();
    });
  }

  public requestFileAccessPermission(
    fileId: string,
    reason = 'Open and inspect user-selected file'
  ): { metadata: SelectedFileMetadata | null; permissionRequest?: PermissionRequest; error?: string } {
    const entry = this.selectedFiles.get(fileId);
    if (!entry) {
      return {
        metadata: null,
        error: 'Selected file reference was not found in active session.'
      };
    }

    const { metadata } = entry;
    if (!metadata.supported) {
      return {
        metadata,
        error: metadata.reasonIfUnsupported || `Unsupported file format ".${metadata.extension}".`
      };
    }

    const riskLevel = metadata.kind === 'MODEL_3D' || metadata.kind === 'DOCUMENT' ? 'MEDIUM' : 'LOW';
    const permissionRequest = this.permissionMgr.createRequest({
      category: 'FILE_ACCESS',
      requestedAction: metadata.intendedOperation,
      target: metadata.name,
      reason: `${reason} (${metadata.sizeFormatted}, .${metadata.extension || 'unknown'})`,
      riskLevel,
      requestedScope: `Single-use read access to "${metadata.name}" only`,
      metadata: {
        fileId: metadata.fileId,
        kind: metadata.kind,
        extension: metadata.extension,
        sizeBytes: metadata.sizeBytes
      }
    });

    return { metadata, permissionRequest };
  }

  public async openAuthorizedFile(fileId: string, permissionId: string): Promise<FileInspectionResult> {
    const entry = this.selectedFiles.get(fileId);
    if (!entry) {
      return {
        ok: false,
        fileId,
        name: 'Unknown',
        extension: '',
        kind: 'UNSUPPORTED',
        sizeFormatted: '0 B',
        intendedOperation: 'Open file',
        error: 'Selected file is no longer in session memory.'
      };
    }

    const { file, metadata } = entry;
    if (!metadata.supported) {
      return {
        ok: false,
        fileId,
        name: metadata.name,
        extension: metadata.extension,
        kind: metadata.kind,
        sizeFormatted: metadata.sizeFormatted,
        intendedOperation: metadata.intendedOperation,
        error: metadata.reasonIfUnsupported || 'Unsupported file format.'
      };
    }

    const auth = this.permissionMgr.beginAuthorizedExecution(permissionId, 'FILE_ACCESS', metadata.name);
    if (!auth.authorized) {
      return {
        ok: false,
        fileId,
        name: metadata.name,
        extension: metadata.extension,
        kind: metadata.kind,
        sizeFormatted: metadata.sizeFormatted,
        intendedOperation: metadata.intendedOperation,
        error: auth.error || 'Explicit file permission required.'
      };
    }

    try {
      if (metadata.kind === 'TEXT') {
        const textContent = await file.text();
        const trimmedPreview = textContent.slice(0, 12000);
        const lineCount = textContent.split(/\r?\n/).length;
        const summary = `Opened "${metadata.name}" (${metadata.sizeFormatted}, ${lineCount} lines).`;
        this.permissionMgr.completeExecution(permissionId, true, summary);
        return {
          ok: true,
          fileId,
          name: metadata.name,
          extension: metadata.extension,
          kind: metadata.kind,
          sizeFormatted: metadata.sizeFormatted,
          intendedOperation: metadata.intendedOperation,
          textContent: trimmedPreview,
          summary
        };
      }

      if (metadata.kind === 'DOCUMENT') {
        const previewUrl =
          typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file)
            : undefined;
        if (previewUrl) this.createdObjectUrls.push(previewUrl);

        if (metadata.extension === 'rtf') {
          const rawRtf = await file.text();
          const stripped = rawRtf.replace(/\\[a-z]+\d* ?|[{}]/g, ' ').replace(/\s+/g, ' ').trim();
          const summary = `Opened RTF document "${metadata.name}" (${metadata.sizeFormatted}).`;
          this.permissionMgr.completeExecution(permissionId, true, summary);
          return {
            ok: true,
            fileId,
            name: metadata.name,
            extension: metadata.extension,
            kind: metadata.kind,
            sizeFormatted: metadata.sizeFormatted,
            intendedOperation: metadata.intendedOperation,
            textContent: stripped.slice(0, 12000),
            previewUrl,
            summary
          };
        }

        const buffer = await file.arrayBuffer();
        const extracted = extractReadablePdfText(buffer);
        const summary = extracted
          ? `Opened PDF "${metadata.name}" (${metadata.sizeFormatted}) with extracted readable text preview.`
          : `Opened PDF "${metadata.name}" (${metadata.sizeFormatted}). Compressed or scanned PDF binary streams cannot be plain-text parsed; use the embedded/external preview link.`;

        this.permissionMgr.completeExecution(permissionId, true, summary);
        return {
          ok: true,
          fileId,
          name: metadata.name,
          extension: metadata.extension,
          kind: metadata.kind,
          sizeFormatted: metadata.sizeFormatted,
          intendedOperation: metadata.intendedOperation,
          textContent: extracted || undefined,
          previewUrl,
          summary
        };
      }

      if (metadata.kind === 'IMAGE') {
        if (metadata.extension === 'svg') {
          const svgText = await file.text();
          const previewUrl =
            typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
              ? URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
              : undefined;
          if (previewUrl) this.createdObjectUrls.push(previewUrl);
          const summary = `Opened SVG image "${metadata.name}" (${metadata.sizeFormatted}) safely without script execution.`;
          this.permissionMgr.completeExecution(permissionId, true, summary);
          return {
            ok: true,
            fileId,
            name: metadata.name,
            extension: metadata.extension,
            kind: metadata.kind,
            sizeFormatted: metadata.sizeFormatted,
            intendedOperation: metadata.intendedOperation,
            previewUrl,
            summary
          };
        }

        const previewUrl =
          typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file)
            : undefined;
        if (previewUrl) this.createdObjectUrls.push(previewUrl);
        const summary = `Opened image "${metadata.name}" (${metadata.sizeFormatted}).`;
        this.permissionMgr.completeExecution(permissionId, true, summary);
        return {
          ok: true,
          fileId,
          name: metadata.name,
          extension: metadata.extension,
          kind: metadata.kind,
          sizeFormatted: metadata.sizeFormatted,
          intendedOperation: metadata.intendedOperation,
          previewUrl,
          summary
        };
      }

      if (metadata.kind === 'AUDIO') {
        if (this.hostCallbacks.onPlayAudioFile) {
          await this.hostCallbacks.onPlayAudioFile(file, permissionId);
        }
        const summary = `Authorized audio file "${metadata.name}" (${metadata.sizeFormatted}) ready in Music Player.`;
        this.permissionMgr.completeExecution(permissionId, true, summary);
        return {
          ok: true,
          fileId,
          name: metadata.name,
          extension: metadata.extension,
          kind: metadata.kind,
          sizeFormatted: metadata.sizeFormatted,
          intendedOperation: metadata.intendedOperation,
          handedOffToMusic: true,
          summary
        };
      }

      if (metadata.kind === 'MODEL_3D') {
        if (!this.hostCallbacks.onImport3DModels) {
          const msg = 'Holographic Object Lab import handler is unavailable in current view.';
          this.permissionMgr.completeExecution(permissionId, false, msg, msg);
          return {
            ok: false,
            fileId,
            name: metadata.name,
            extension: metadata.extension,
            kind: metadata.kind,
            sizeFormatted: metadata.sizeFormatted,
            intendedOperation: metadata.intendedOperation,
            error: msg
          };
        }
        await this.hostCallbacks.onImport3DModels([file]);
        const summary = `Imported 3D model "${metadata.name}" (${metadata.sizeFormatted}) into Holographic Object Lab.`;
        this.permissionMgr.completeExecution(permissionId, true, summary);
        return {
          ok: true,
          fileId,
          name: metadata.name,
          extension: metadata.extension,
          kind: metadata.kind,
          sizeFormatted: metadata.sizeFormatted,
          intendedOperation: metadata.intendedOperation,
          handedOffToLab: true,
          summary
        };
      }

      const unsupportedMsg = `Unsupported file kind "${metadata.kind}".`;
      this.permissionMgr.completeExecution(permissionId, false, unsupportedMsg, unsupportedMsg);
      return {
        ok: false,
        fileId,
        name: metadata.name,
        extension: metadata.extension,
        kind: metadata.kind,
        sizeFormatted: metadata.sizeFormatted,
        intendedOperation: metadata.intendedOperation,
        error: unsupportedMsg
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed reading selected file.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      return {
        ok: false,
        fileId,
        name: metadata.name,
        extension: metadata.extension,
        kind: metadata.kind,
        sizeFormatted: metadata.sizeFormatted,
        intendedOperation: metadata.intendedOperation,
        error: msg
      };
    }
  }

  public summarizeTextContent(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return 'File contains no readable text content.';
    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const preview = sentences.slice(0, 3).join(' ');
    return preview.length > 360 ? `${preview.slice(0, 357)}...` : preview;
  }

  public disposeAllPreviewUrls() {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const u of this.createdObjectUrls) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // ignore
        }
      }
    }
    this.createdObjectUrls = [];
  }

  public clearSessionFiles() {
    this.disposeAllPreviewUrls();
    this.selectedFiles.clear();
  }
}

export const fileAccessService = new FileAccessService();
