import { agent } from "./agent/Agent";
import { invokeTool } from "./tools";
import { BackgroundTasks, SidebarMessages } from "@/shared/messages";
import {
  ensureMsalInitialized,
  msalInstance,
  LOGIN_SCOPES,
  REDIRECT_URI,
} from "@/shared/auth/msalConfig";
import { getProfile } from "@/shared/nogverseClient";
import type { ToolName } from "@/shared/types";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
  return true;
});

async function handleMessage(message: { type: string; payload?: unknown }) {
  switch (message.type) {
    case BackgroundTasks.AGENT_SEND_MESSAGE: {
      const { content, agentId, includePageContext } = message.payload as {
        content: string;
        agentId?: string;
        includePageContext?: boolean;
      };
      const result = await agent.send(
        content,
        (chunk) => broadcast(SidebarMessages.AGENT_CHUNK, chunk),
        { agentId, includePageContext },
      );
      broadcast(SidebarMessages.AGENT_DONE, result);
      return { ok: true, data: result };
    }
    case BackgroundTasks.AGENT_GET_HISTORY:
      return { ok: true, data: agent.getHistory() };
    case BackgroundTasks.AGENT_CLEAR:
      agent.clear();
      return { ok: true };
    case BackgroundTasks.AGENT_ABORT:
      agent.abort();
      return { ok: true };
    case BackgroundTasks.AUTH_SIGN_IN:
      return { ok: true, data: await signIn() };
    case BackgroundTasks.AUTH_SIGN_OUT:
      return { ok: true, data: await signOut() };
    case BackgroundTasks.AUTH_GET_PROFILE:
      return { ok: true, data: await getProfile() };
    case BackgroundTasks.TOOL_INVOKE: {
      const { name, args } = message.payload as { name: ToolName; args: Record<string, unknown> };
      return { ok: true, data: await invokeTool(name, args) };
    }
    default:
      return { ok: false, error: `Unknown task: ${message.type}` };
  }
}

function broadcast(type: string, payload: unknown): void {
  void chrome.runtime.sendMessage({ type, payload }).catch(() => undefined);
}

async function signIn(): Promise<{ account: string }> {
  await ensureMsalInitialized();
  const authority = msalInstance.getConfiguration().auth.authority;
  const clientId = msalInstance.getConfiguration().auth.clientId;
  const authUrl =
    `${authority}/oauth2/v2.0/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent(LOGIN_SCOPES.join(" "))}` +
    `&prompt=select_account`;
  await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const accounts = msalInstance.getAllAccounts();
  if (accounts[0]) msalInstance.setActiveAccount(accounts[0]);
  return { account: accounts[0]?.username ?? "" };
}

async function signOut(): Promise<void> {
  await ensureMsalInitialized();
  const account = msalInstance.getActiveAccount();
  if (account) await msalInstance.clearCache({ account });
  msalInstance.setActiveAccount(null);
}
