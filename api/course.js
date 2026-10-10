const CACHE_SECONDS = 5 * 60;
const STALE_SECONDS = 24 * 60 * 60;

const json = (response, status, body) => response.status(status).json(body);

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { error: { message: 'Phương thức không được hỗ trợ.' } });
  }

  const courseApiUrl = process.env.VITE_DRIVE_WEB_APP_URL;
  if (!courseApiUrl) return json(response, 503, { error: { message: 'Máy chủ chưa được cấu hình Drive Web App URL.' } });

  try {
    const courseResponse = await fetch(courseApiUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!courseResponse.ok) throw new Error(`Course API returned ${courseResponse.status}`);
    const courseData = await courseResponse.json();
    if (!courseData || !Array.isArray(courseData.children)) throw new Error('Course API returned invalid data');

    response.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`);
    return json(response, 200, courseData);
  } catch (error) {
    console.error('Course API request failed', error?.message || 'unknown');
    return json(response, 502, { error: { message: 'Không thể tải dữ liệu khóa học từ Drive API.' } });
  }
}
