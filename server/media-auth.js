export const getMediaConfig = () => ({
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
});

export const isMediaConfigured = () => {
  const config = getMediaConfig();
  return Boolean(config.serviceAccountEmail && config.privateKey);
};
