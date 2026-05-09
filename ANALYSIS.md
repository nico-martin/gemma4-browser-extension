# NOG Browser Extension — Analyse d'intégration

> Synthèse des trois dépôts EggOn-Technology (`gemma4-browser-extension`, `nogverse-api-business`, `nogverse-ui-v1`) en vue de la création d'une extension Chrome (Manifest V3) pour les avocats utilisant NOGverse, avec recherche Legifrance / CanLII et délégation RAG au backend FastAPI.
>
> **Date :** 2026-05-09  
> **Branche cible :** `claude/nog-extension-analysis-EheN9`  
> **Statut :** analyse uniquement — aucun code production.

---

## 1. Endpoint « RAG » — contrat réel

### Constat
Le backend `nogverse-api-business` ne contient **aucune** route `/rag`, `/search` ou `/retrieval`. Recherche `mcp__github__search_code` sur `rag` et `qdrant` : 0 résultat. Le module `src/services/agent_executor.py` orchestre un agent côté serveur dont les tools (`web_search`, `sharepoint`, …) jouent le rôle de retrieval.

### Endpoint à utiliser : `POST /api/messages` (SSE)
Source : `src/main.py:107` (mount `/api`) + `src/routes/messages.py:84`.

| Champ | Détail |
|-------|--------|
| Méthode | `POST` |
| URL prod | `https://api.nogverse.ai/api/messages` |
| Content-Type | `application/json` |
| Accept | `text/event-stream` |
| Réponse | `StreamingResponse(media_type="text/event-stream")` (`messages.py:198-205`) avec headers `Cache-Control: no-cache`, `X-Accel-Buffering: no` |

### Payload (Pydantic `MessageCreate`, `messages.py:24-30`)
```json
{
  "conversationId": "uuid-v4",
  "content": "string",
  "role": "user",
  "agentId": "string | null"
}
```

### Format des chunks SSE (`AgentRunChunk`)
Lignes `data: <json>\n` séparées par `\n\n`, terminées par `data: [DONE]`.
```ts
type AgentRunChunk = {
  step?: string;
  tool?: string;
  content?: string;
  sources?: Source[];
  artifact?: unknown;
  runId?: string;
  done?: boolean;
  error?: string;
};
```
Implémentation client : voir `nogverse-ui-v1/src/features/chat/hooks/useChatStream.ts` (`getReader`/`TextDecoder` — pas `EventSource` car POST).

### Pré-requis : créer une conversation
`POST /api/conversations` (`src/routes/conversations.py`) → renvoie `{ id }` à passer ensuite en `conversationId`. Doit précéder le premier message.

### Endpoints utiles
| Route | Usage côté extension |
|-------|----------------------|
| `GET /api/users` | Profil + rôle de l'utilisateur courant |
| `POST /api/users` | Onboarding idempotent (au 1er login) |
| `POST /api/conversations` | Crée une conversation avant le 1er message |
| `GET /api/messages?conversationId=…` | Recharge l'historique |
| `GET /api/health` | Probe de connectivité |

---

## 2. Authentification — JWT Azure AD

### Schéma
- **Header** : `Authorization: Bearer <access_token>` (`src/auth/dependencies.py:55-65`).
- **Type** : OAuth2 / OpenID Connect Microsoft, RS256, JWKS `https://login.microsoftonline.com/common/discovery/v2.0/keys` (`.env.example` `JWKS_URL`).
- **Validation** : dépendance FastAPI `get_current_user` (pas un middleware — injectée par route) → `JWTValidator.validate_token` (`src/auth/jwt_validator.py:60`).
- **Audience** acceptée : `<CLIENT_ID>` ou `api://<CLIENT_ID>` (`jwt_validator.py:91-93`).
- **Issuer** accepté : `https://login.microsoftonline.com/…` ou `https://sts.windows.net/…` (`jwt_validator.py:118-124`).
- **Claims utilisés** : `oid` (fallback `sub`), `tid`, `aud`, `iss`, `exp`, `nbf`, `iat`, `groups`, `email`/`preferred_username`, `name`.
- **Mode dev** : `ALLOW_DEV_MODE=true` accepte `Authorization: Bearer dev-mock-token` (`dependencies.py:71-83`).

### Acquisition côté extension (différences vs UI web)
Référence : `nogverse-ui-v1/src/lib/msal/{config,scopes,acquireToken}.ts`.

| Aspect | Web (UI v1) | Extension MV3 |
|--------|-------------|---------------|
| Lib | `@azure/msal-browser@^4.29` + `@azure/msal-react@^3.0` | `@azure/msal-browser@^4.29` |
| `redirectUri` | `window.location.origin` | `chrome.identity.getRedirectURL()` |
| Cache | `SessionStorage` | **`LocalStorage`** (le service worker MV3 redémarre) |
| Acquisition interactive | `acquireTokenPopup` | `chrome.identity.launchWebAuthFlow({ url, interactive: true })` |
| Acquisition silencieuse | `acquireTokenSilent({...TOKEN_REQUEST, account, forceRefresh})` | identique |
| Scopes API | `api://<API_CLIENT_ID>/Chat.Read,Chat.Write,Search.Execute,Citations.Read` ou `.default` | identique |
| Scopes login | `User.Read profile email openid` | identique |

### Tenant
Pas de header `X-Tenant-Id` ni de paramètre `tenant_id` dans le payload. Le tenant est **extrait du claim `tid`** côté serveur (`jwt_validator.py:151`) et propagé en `user["tenantId"]` ; toutes les requêtes Cosmos sont scopées par `organizationId = tenantId` (`messages.py:51`). **L'extension ne doit donc rien envoyer** ; il suffit que le JWT soit valide.

Whitelist optionnelle via env `ALLOWED_TENANTS` (`jwt_validator.py:50-58`).

---

## 3. Stack UI à aligner

Versions exactes (`nogverse-ui-v1/package.json`) :

| Catégorie | Package | Version |
|-----------|---------|---------|
| Framework | `react`, `react-dom` | `^19.0.0` |
| Build | `vite` | `^5.3.5` |
| Plugin | `@vitejs/plugin-react` | `^4.3.1` |
| Langage | `typescript` | `^5.5.4` |
| Auth | `@azure/msal-browser` | `^4.29.0` |
| HTTP | `fetch` natif (pas d'axios) | — |
| Server state | `@tanstack/react-query` | `^5.51.0` |
| Client state | `zustand` | `^4.5.4` |
| Styling | `tailwindcss` | `^3.4.7` |
| CSS utils | `clsx ^2.1.1`, `tailwind-merge ^2.4.0`, `class-variance-authority ^0.7.0` | |
| Markdown | `react-markdown ^9.0.1`, `remark-gfm ^4.0.0`, `rehype-sanitize ^6.0.0` | |
| Icônes | `lucide-react ^0.400.0` | |
| Test | `vitest ^2.0.4` | |

### TypeScript
`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `strict: true` + `noUnusedLocals/Parameters`, `noImplicitOverride`, `forceConsistentCasingInFileNames`. Alias `@/*` → `./src/*` (mirroir dans `vite.config.ts`).

### Style / design tokens (`nogverse-ui-v1/src/styles/globals.css`)
- Palette HSL via CSS custom properties, `darkMode: 'class'`.
- `--radius: 0.75rem`. Fonts : `Inter`, `Libre Baskerville`, `JetBrains Mono`.
- BG clair `hsl(48 43% 97%)`, BG sombre `hsl(60 3% 12%)`, primary-500 `hsl(40 12% 56%)`.

---

## 4. CORS — obstacle bloquant à corriger

`src/middleware/cors.py:9-15` whitelist actuelle :
```python
ALLOWED_ORIGINS = [
  "https://nogverse.ai", "https://www.nogverse.ai",
  "https://staging.nogverse.ai", "https://www.staging.nogverse.ai",
  # + http://localhost:3000 / 5173 si ENVIRONMENT != "production"
]
allow_credentials=True
allow_headers=["Content-Type","Authorization"]
expose_headers=["X-Request-Id"]
```

**`chrome-extension://<id>` n'est pas accepté.** Avec `allow_credentials=True`, FastAPI refuse le wildcard.

### Action requise (côté backend)
```python
ALLOWED_ORIGINS += [f"chrome-extension://{ext_id}" for ext_id in os.getenv("ALLOWED_EXTENSION_IDS","").split(",") if ext_id]
```

---

## 5. Points de divergence vs `gemma4-browser-extension`

À retirer (modèle on-device, embeddings locaux) :

| Fichier source de référence | Ligne(s) | Élément à supprimer |
|---|---|---|
| `package.json:14` | `@huggingface/transformers ^4.2.0` | dépendance entière |
| `src/shared/constants.ts:1, 8-45` | imports `@huggingface/transformers` + `MODELS[]` (Gemma E2B/E4B, Granite, all-MiniLM) | tout le tableau |
| `src/background/agent/Agent.ts:1-6,54-62,152-153` | `TextGenerationPipeline`, `DynamicCache`, `device:"webgpu"`, `max_new_tokens:1024` | toute la logique d'inférence locale |
| `src/background/utils/FeatureExtractor.ts:1,16-26` | `FeatureExtractionPipeline` WebGPU | fichier entier |
| `src/background/background.ts:1,88-117` | `ModelRegistry`, `is_pipeline_cached` | toute la logique de download/cache modèle |
| `src/background/tools/askWebsite.ts:104-107` | embeddings + cosine similarity | remplacer par extraction DOM brute capée à 2000 chars |
| `src/background/vectorHistory/VectorHistory.ts:6-14,71-88,96-107` | vecteurs + cosineSimilarity | retirer le RAG local |
| `public/manifest.json:9` | `'wasm-unsafe-eval'` dans CSP | retirer |

### Conséquences

1. **L'« agent loop » côté extension n'existe plus**. Le backend NOGverse contient déjà un agent (`agent_executor.execute_agent`). Le `Agent.ts` côté extension se réduit à : (a) collecter le contexte (`askWebsite`, `getOpenTabs`), (b) POSTer `/api/messages`, (c) consommer le SSE et router les événements vers l'UI.

2. **Pas de tool-calling client → serveur**. Le contrat `/api/messages` actuel n'expose pas de mécanisme de callback. En v1 les tools `searchLegifrance` / `searchCanLII` / `openUrl` / `closeTab` doivent rester déclenchés côté client.

3. **Cap des réponses de tools** : `askWebsite` max **2000 chars**, `getOpenTabs` max **25 onglets**.

4. **`get_current_tab_info` dédié** (leçon review Nico Martin) : tool séparé qui retourne `{title, url, hostname}` du tab actif sans toucher au system prompt.

5. **Permissions Manifest V3 minimales** : `sidePanel`, `activeTab`, `storage`, `scripting`, `tabs`, `identity`. `host_permissions` ciblées : `https://api.nogverse.ai/*`, `https://*.nogverse.ai/*`, `https://login.microsoftonline.com/*`, `https://*.legifrance.gouv.fr/*`, `https://*.canlii.org/*`. Pas de `<all_urls>`.

---

## 6. Interface `NOGverseClient` adaptée

L'interface du brief (`query() → {answer, sources}`) ne correspond pas au contrat réel (SSE streaming). Version alignée :

```typescript
export type AgentRunChunk = {
  step?: "tool_start" | "tool_end" | "content" | "sources" | "done";
  tool?: string;
  content?: string;
  sources?: Source[];
  artifact?: unknown;
  runId?: string;
  done?: boolean;
  error?: string;
};

export interface NOGverseClient {
  createConversation(opts?: { title?: string }): Promise<{ id: string }>;
  streamMessage(params: {
    conversationId: string;
    content: string;
    agentId?: string;
    signal?: AbortSignal;
    onChunk: (c: AgentRunChunk) => void;
  }): Promise<{ text: string; sources: Source[] }>;
  me(): Promise<UserProfile>;
}
```
Le client injecte automatiquement `Authorization: Bearer <token>` via `acquireTokenSilent` (avec retry `forceRefresh: true` sur 401, comme `nogverse-ui-v1/src/lib/api/client.ts:178-188`). `tenant_id` n'est pas un paramètre — il est porté par le claim `tid` du JWT.

---

## 7. Risques & dépendances bloquantes

| # | Risque | Impact | Action |
|---|--------|--------|--------|
| R1 | CORS ne whitelist pas `chrome-extension://…` | **Bloquant** : preflight 403 | PR sur `nogverse-api-business/src/middleware/cors.py` |
| R2 | Pas de protocole de tool-calling client | Tools Legifrance/CanLII confinés à des actions UI | Étendre `AgentRunChunk` côté backend |
| R3 | MSAL en service worker MV3 | Popup non disponible | Utiliser `chrome.identity.launchWebAuthFlow` + `LocalStorage` |
| R4 | Pas de refresh token | UX dégradée si expiration | Retry 401 → `forceRefresh:true` puis fallback `launchWebAuthFlow` |
| R5 | `agentId` par défaut peut renvoyer un agent non-juridique | Réponses hors-sujet | Créer un agent dédié côté Cosmos `agents` |
| R6 | `wasm-unsafe-eval` retiré → vérifier qu'aucune lib build-time ne l'exige | Build cassé | Build initial sur CI |

---

## 8. Récapitulatif décisionnel

- ✅ **Endpoint** : `POST /api/messages` SSE.
- ✅ **Auth** : Azure AD via MSAL, `Bearer <jwt>`, `tid` claim = tenant.
- ✅ **Stack** : React 19 + Vite 5 + TS 5.5 + Tailwind 3 + MSAL 4 + react-query 5.
- ✅ **Permissions MV3** : `sidePanel, activeTab, storage, scripting, tabs, identity` + `host_permissions` ciblées.
- ❌ **À retirer** : Transformers.js, WebGPU, Gemma, all-MiniLM, KV cache, embeddings locaux, `wasm-unsafe-eval`.
- ⚠️ **Côté backend** : ajouter la whitelist CORS `chrome-extension://<id>` avant déploiement.
- ⚠️ **Tools client-side** : Legifrance/CanLII restent locaux v1.
