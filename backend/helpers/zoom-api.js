const axios = require('axios');
const { setTokens, getTokens } = require('./token-store');

/**
 * Make a token request to Zoom OAuth endpoint
 * @param {Object} params - OAuth parameters
 * @param {string} clientId - Zoom client ID (optional, defaults to env)
 * @param {string} clientSecret - Zoom client secret (optional, defaults to env)
 * @returns {Promise} Token response data
 */
function tokenRequest(params, clientId = '', clientSecret = '') {
  const username = clientId || process.env.ZOOM_APP_CLIENT_ID;
  const password = clientSecret || process.env.ZOOM_APP_CLIENT_SECRET;

  const authHeader = Buffer.from(`${username}:${password}`).toString('base64');

  return axios({
    data: new URLSearchParams(params).toString(),
    baseURL: process.env.ZOOM_HOST || 'https://zoom.us',
    url: '/oauth/token',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }).then(({ data }) => data);
}

/**
 * Refresh an expired access token using a refresh token
 * @param {string} refreshToken - The refresh token
 * @returns {Promise} New token data with access_token and refresh_token
 */
async function refreshAccessToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new Error('refresh token must be a valid string');
  }

  return tokenRequest({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

// Refresh tokens and persist to Redis, returning new tokens
async function doTokenRefresh(refreshToken) {
  const tokenData = await refreshAccessToken(refreshToken);
  const newTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + ((tokenData.expires_in || 3600) * 1000)
  };
  await setTokens(newTokens);
  console.log('Token refreshed successfully and saved to Redis');
  return newTokens;
}

/**
 * Make an API call to Zoom with proactive and reactive token refresh
 * @param {Object} options - Axios request options
 * @param {Object} tokens - Token object with accessToken and refreshToken
 * @returns {Promise} API response data
 */
async function zoomApiRequest(options, tokens) {
  // Always read fresh tokens from Redis so expiresAt is available
  const stored = await getTokens();
  let { accessToken, refreshToken, expiresAt } = stored;

  // Override with any explicitly passed tokens
  if (tokens.accessToken) accessToken = tokens.accessToken;
  if (tokens.refreshToken) refreshToken = tokens.refreshToken;

  console.log('zoomApiRequest called. Has accessToken:', !!accessToken, '| Has refreshToken:', !!refreshToken);

  // Proactively refresh if token is expired or expiring within 5 minutes
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (refreshToken && expiresAt && (expiresAt - Date.now()) < FIVE_MINUTES) {
    console.log('Access token expired or expiring soon — refreshing proactively');
    try {
      const newTokens = await doTokenRefresh(refreshToken);
      accessToken = newTokens.accessToken;
      refreshToken = newTokens.refreshToken;
    } catch (refreshError) {
      console.error('Proactive token refresh failed:', refreshError.response?.data || refreshError.message);
      throw new Error('Authentication failed - please re-authenticate');
    }
  }

  if (!accessToken) {
    throw new Error('No access token available');
  }

  try {
    const response = await axios({
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    return response.data;
  } catch (error) {
    // Zoom returns 401 for unauthorized and 400 with code 124 for expired tokens
    const status = error.response?.status;
    const isExpired = status === 401 ||
      (status === 400 && error.response?.data?.code === 124);

    if (isExpired && refreshToken) {
      console.log('Token rejected by API (status:', status, ') — attempting reactive refresh');
      try {
        const newTokens = await doTokenRefresh(refreshToken);

        const retryResponse = await axios({
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${newTokens.accessToken}`,
          },
        });

        return retryResponse.data;
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError.response?.data || refreshError.message);
        throw new Error('Authentication failed - please re-authenticate');
      }
    }

    throw error;
  }
}

module.exports = {
  tokenRequest,
  refreshAccessToken,
  zoomApiRequest,
};
