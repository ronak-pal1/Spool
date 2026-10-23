import { ApiError, SpoolApi } from '@spool/shared';
import { clearSession, type ExtensionSettings } from './settings';

/**
 * Builds an API client bound to a settings snapshot. Extension pages hold `<all_urls>` host
 * permissions, so requests to the Spool API and to presigned storage URLs are exempt from CORS.
 */
export function createApi(getSettings: () => ExtensionSettings): SpoolApi {
  return new SpoolApi({
    get baseUrl() {
      return getSettings().apiUrl;
    },
    getToken: () => getSettings().token,
    getWorkspaceId: () => getSettings().activeWorkspaceId,
    onUnauthorized: () => {
      void clearSession();
    },
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
