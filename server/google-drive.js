import crypto from 'node:crypto';
import { getMediaConfig } from './media-auth.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let tokenCache = { value: '', expiresAt: 0 };

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export const getDriveAccessToken = async () => {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const { serviceAccountEmail, privateKey } = getMediaConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const claims = encodeJson({
    iss: serviceAccountEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now - 30,
    exp: now + 3600,
  });
  const unsignedToken = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(privateKey, 'base64url')}`;

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Không thể xác thực tài khoản dịch vụ Google Drive.');

  tokenCache = {
    value: tokenData.access_token,
    expiresAt: Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
  };
  return tokenCache.value;
};
