import { Readable } from 'node:stream';
import { getDriveAccessToken } from '../server/google-drive.js';
import { isMediaConfigured } from '../server/media-auth.js';

const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,120}$/;
const FORWARDED_HEADERS = ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified'];
const MAX_RANGE_BYTES = 4 * 1024 * 1024;

const boundedRange = (rangeHeader) => {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(rangeHeader || ''));
  if (!match) return `bytes=0-${MAX_RANGE_BYTES - 1}`;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
  const end = Math.min(requestedEnd, start + MAX_RANGE_BYTES - 1);
  return `bytes=${start}-${end}`;
};

const sendError = (response, status, message) => response.status(status).json({ error: { message } });

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return sendError(response, 405, 'Phương thức không được hỗ trợ.');
  }
  if (!isMediaConfigured()) return sendError(response, 503, 'Máy chủ chưa được cấu hình để phát video.');
  const fileId = String(request.query?.fileId || '');
  if (!FILE_ID_PATTERN.test(fileId)) return sendError(response, 400, 'ID video không hợp lệ.');

  try {
    const accessToken = await getDriveAccessToken();
    const driveHeaders = { Authorization: `Bearer ${accessToken}` };
    if (request.method === 'GET') driveHeaders.Range = boundedRange(request.headers.range);
    if (request.headers['if-range']) driveHeaders['If-Range'] = request.headers['if-range'];

    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: request.method,
      headers: driveHeaders,
      redirect: 'error',
    });
    if (!driveResponse.ok && driveResponse.status !== 206) {
      console.error('Drive media request failed', driveResponse.status);
      return sendError(response, driveResponse.status === 404 ? 404 : 502, 'Không thể tải video từ Google Drive.');
    }

    response.statusCode = driveResponse.status;
    response.setHeader('Cache-Control', 'private, no-store');
    for (const header of FORWARDED_HEADERS) {
      const value = driveResponse.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    if (request.method === 'HEAD' || !driveResponse.body) return response.end();
    return Readable.fromWeb(driveResponse.body).pipe(response);
  } catch (error) {
    console.error('Media proxy failed', error?.message || 'unknown');
    return sendError(response, 502, 'Không thể kết nối tới Google Drive.');
  }
}
