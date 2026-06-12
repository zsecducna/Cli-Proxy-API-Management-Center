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

// KiroLoginType selects which Kiro authentication flow to start:
//   - 'builder-id': AWS Builder ID device flow (default, personal AWS account).
//   - 'idc':        AWS IAM Identity Center device flow (needs a start URL + username).
//   - 'sso':        Kiro hosted enterprise SSO / social login (federates Google, GitHub,
//                   and enterprise IdPs such as an Azure AD tenant; no start URL needed).
export type KiroLoginType = 'builder-id' | 'idc' | 'sso';

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
    options?: {
      projectId?: string;
      idcStartURL?: string;
      region?: string;
      username?: string;
      loginType?: KiroLoginType;
    }
  ) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    // Kiro login: "method" selects the flow — builder-id (AWS Builder ID), idc (AWS IAM
    // Identity Center), or sso (the Kiro hosted enterprise SSO / social login that
    // federates Google, GitHub, and enterprise IdPs such as an Azure AD tenant).
    if (provider === 'kiro') {
      const loginType: KiroLoginType = options?.loginType ?? 'builder-id';
      params.method = loginType;
      const region = options?.region?.trim();
      // Region applies to the AWS OIDC endpoints (builder-id / idc); SSO ignores it.
      if (region) params.region = region;
      // IDC-only inputs: the start URL selects the org's Identity Center and the username
      // names the saved auth file. Builder ID and SSO do not use them.
      if (loginType === 'idc') {
        const idcStartURL = options?.idcStartURL?.trim();
        const username = options?.username?.trim();
        if (idcStartURL) params.idc_start_url = idcStartURL;
        if (username) params.username = username;
      }
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
