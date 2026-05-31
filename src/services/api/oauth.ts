/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi'
  | 'kiro'
  | 'xai';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  // Kiro device flow returns a user code the user must enter at the verification URL.
  user_code?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

const WEBUI_SUPPORTED: OAuthProvider[] = [
  'codex',
  'anthropic',
  'antigravity',
  'gemini-cli',
  'kiro',
  'xai'
];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini'
};

export const oauthApi = {
  startAuth: (
    provider: OAuthProvider,
    options?: { projectId?: string; idcStartURL?: string; region?: string; username?: string }
  ) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    // Kiro device flow: an IDC start URL selects IAM Identity Center; region overrides
    // the default AWS OIDC region. Both are optional (blank => AWS Builder ID flow).
    if (provider === 'kiro') {
      const idcStartURL = options?.idcStartURL?.trim();
      const region = options?.region?.trim();
      const username = options?.username?.trim();
      if (idcStartURL) params.idc_start_url = idcStartURL;
      if (region) params.region = region;
      // Username is required by the backend for IDC login (used to name the saved
      // auth file). Only send it when present; validation is enforced at the call site.
      if (username) params.username = username;
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state }
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl
    });
  }
};
