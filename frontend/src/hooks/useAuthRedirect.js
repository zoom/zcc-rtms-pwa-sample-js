// Reads the OAuth result from the URL, exposes a user-facing status message, and removes the result parameter after handling it.
import { useState, useEffect } from 'react';

export function useAuthRedirect() {
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('auth');
    if (status === 'success') {
      setAuthMessage('Authentication successful!');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (status === 'error') {
      setAuthError('Authentication failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return { authMessage, authError };
}
