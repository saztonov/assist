/**
 * Типизированный доступ к /documents + прямая загрузка файла в S3 по presigned URL.
 * Presigned PUT — единственное прямое browser→storage взаимодействие (by design).
 * URL не логируется; Content-Type PUT обязан совпадать с переданным в upload-session.
 */
import { api } from './client';

export interface UploadSessionResponse {
  documentId: string;
  versionId: string;
  objectKey: string;
  uploadUrl: string;
  status: string;
}

export interface DocumentCard {
  id: string;
  status: string;
  title: string | null;
  documentType: string | null;
  securityLevel: string;
  createdAt: string;
  version?: { id: string; mimeType: string | null; sizeBytes: number | null };
}

export interface CreateUploadSessionInput {
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  title?: string;
  documentType?: string;
  securityLevel?: 'public' | 'internal' | 'confidential' | 'secret';
}

export const documentsApi = {
  createUploadSession: (input: CreateUploadSessionInput): Promise<UploadSessionResponse> =>
    api.post<UploadSessionResponse>('/documents/upload-session', input),
  confirm: (id: string): Promise<{ documentId: string; status: string; parseJobId: string }> =>
    api.post(`/documents/${id}/confirm`),
  get: (id: string): Promise<DocumentCard> => api.get<DocumentCard>(`/documents/${id}`),
};

/**
 * Загрузка файла напрямую в S3 по presigned PUT. `Content-Type` ДОЛЖЕН совпадать
 * с `mimeType`, отправленным в upload-session, иначе S3 вернёт 403. URL не логируем.
 */
export async function putToPresignedUrl(uploadUrl: string, file: File, mimeType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Загрузка в хранилище не удалась (HTTP ${res.status})`);
  }
}
