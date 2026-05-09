import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";

const CLIENT_ID = import.meta.env.VITE_MSAL_CLIENT_ID as string;
const TENANT_ID = (import.meta.env.VITE_MSAL_TENANT_ID as string) ?? "common";
const API_CLIENT_ID = (import.meta.env.VITE_API_CLIENT_ID as string) ?? CLIENT_ID;

export const REDIRECT_URI =
  typeof chrome !== "undefined" && chrome.identity?.getRedirectURL
    ? chrome.identity.getRedirectURL()
    : (import.meta.env.VITE_MSAL_REDIRECT_URI as string);

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: REDIRECT_URI,
  },
  cache: {
    // LocalStorage required: MV3 service workers restart and lose sessionStorage.
    cacheLocation: "localStorage",
  },
  system: {
    tokenRenewalOffsetSeconds: 300,
  },
};

export const API_SCOPES =
  API_CLIENT_ID && API_CLIENT_ID !== CLIENT_ID
    ? [
        `api://${API_CLIENT_ID}/Chat.Read`,
        `api://${API_CLIENT_ID}/Chat.Write`,
        `api://${API_CLIENT_ID}/Search.Execute`,
        `api://${API_CLIENT_ID}/Citations.Read`,
      ]
    : [`api://${API_CLIENT_ID}/.default`];

export const LOGIN_SCOPES = ["User.Read", "profile", "email", "openid"];

export const msalInstance = new PublicClientApplication(msalConfig);

let initPromise: Promise<void> | null = null;
export function ensureMsalInitialized(): Promise<void> {
  if (!initPromise) initPromise = msalInstance.initialize();
  return initPromise;
}

export async function getActiveAccount(): Promise<AccountInfo | null> {
  await ensureMsalInitialized();
  const active = msalInstance.getActiveAccount();
  if (active) return active;
  const all = msalInstance.getAllAccounts();
  if (all.length > 0) {
    msalInstance.setActiveAccount(all[0]!);
    return all[0]!;
  }
  return null;
}

export async function acquireApiToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
  await ensureMsalInitialized();
  const account = await getActiveAccount();
  if (!account) throw new Error("Not signed in");
  const result: AuthenticationResult = await msalInstance.acquireTokenSilent({
    scopes: API_SCOPES,
    account,
    forceRefresh: opts.forceRefresh ?? false,
  });
  return result.accessToken;
}
