const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_API_URL = 'https://api.heygen.com/v1/streaming.create_token';

export interface HeyGenTokenResponse {
  token: string;
  expiresAt: number;
}

interface HeyGenApiResponse {
  data?: {
    token?: string;
  };
}

export async function createHeyGenToken(): Promise<HeyGenTokenResponse> {
  if (!HEYGEN_API_KEY) {
    throw new Error('HEYGEN_API_KEY is not configured');
  }

  console.log('Requesting HeyGen token...');

  const response = await fetch(HEYGEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': HEYGEN_API_KEY,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('HeyGen API error:', response.status, errorText);
    throw new Error(`HeyGen API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as HeyGenApiResponse;

  if (!data.data?.token) {
    throw new Error('Invalid response from HeyGen API: missing token');
  }

  return {
    token: data.data.token,
    expiresAt: Date.now() + 3600000, // Token valid for 1 hour
  };
}

export function isHeyGenEnabled(): boolean {
  return Boolean(HEYGEN_API_KEY);
}
