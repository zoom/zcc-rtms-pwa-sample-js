let tokens = { accessToken: null, refreshToken: null, expiresAt: null };

async function setTokens({ accessToken, refreshToken, expiresAt }) {
  tokens = { accessToken, refreshToken, expiresAt };
  console.log('Tokens stored in memory');
}

async function getTokens() {
  return tokens;
}

async function clearTokens() {
  tokens = { accessToken: null, refreshToken: null, expiresAt: null };
  console.log('Tokens cleared');
}

async function hasValidToken() {
  return !!tokens.accessToken && (!tokens.expiresAt || tokens.expiresAt > Date.now());
}

module.exports = { setTokens, getTokens, clearTokens, hasValidToken };
