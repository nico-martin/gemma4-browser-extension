# NOG Browser Extension

Extension Chrome (Manifest V3) pour les avocats utilisant **NOGverse**. Recherche juridique
Legifrance / CanLII directement depuis le navigateur, avec délégation RAG au backend
FastAPI `nogverse-api-business`.

> **Statut :** scaffold v0.1 — l'analyse complète qui a guidé ce scaffold est dans
> [`../ANALYSIS.md`](../ANALYSIS.md).

## Architecture

```
nog-browser-extension/
├── public/manifest.json          # Manifest V3
├── src/
│   ├── background/
│   │   ├── background.ts         # Service worker, message routing, MSAL bridge
│   │   ├── agent/Agent.ts        # Orchestrateur — appelle /api/messages SSE
│   │   └── tools/                # open_url, ask_website, get_open_tabs, search_*
│   ├── content/content.ts        # Extraction DOM + highlight
│   ├── sidebar/                  # React 19 + Tailwind, side panel
│   └── shared/
│       ├── nogverseClient.ts     # Wrapper fetch SSE vers /api/messages
│       ├── auth/msalConfig.ts    # MSAL configuré pour MV3
│       └── types.ts / messages.ts
└── vite.config.ts
```

## Pré-requis

- Node ≥ 20, **pnpm 10** (`corepack enable && corepack use pnpm@10.28.1`)
- Un compte Azure AD inscrit dans le tenant NOGverse
- Le backend `nogverse-api-business` doit avoir whitelisté `chrome-extension://<id>` en CORS
  (voir `ANALYSIS.md §4`)

## Installation

```bash
pnpm install
cp .env.example .env
# remplir VITE_MSAL_CLIENT_ID, VITE_MSAL_TENANT_ID, éventuellement VITE_API_CLIENT_ID
```

## Build

```bash
pnpm run dev      # build watch
pnpm run build    # build production dans ./dist
pnpm run typecheck
```

## Charger dans Chrome

1. `pnpm run build`
2. `chrome://extensions` → activer le mode développeur
3. **Charger l'extension non empaquetée** → sélectionner `dist/`
4. Récupérer l'identifiant de l'extension affiché et l'ajouter côté backend
   (`ALLOWED_EXTENSION_IDS` env var sur `nogverse-api-business`)
5. Cliquer sur l'icône → un side panel s'ouvre → **Se connecter** lance le flow
   `chrome.identity.launchWebAuthFlow` vers Azure AD

## Tools côté extension

| Tool | Description | Cap |
|------|-------------|-----|
| `ask_website` | Extrait DOM de l'onglet actif (h1-h6 + p), filtre par mots-clés | 2000 chars |
| `get_current_tab_info` | `{title, url, hostname}` du tab actif | — |
| `get_open_tabs` | Liste les onglets ouverts | 25 onglets |
| `open_url` | Ouvre un onglet en arrière-plan | — |
| `close_tab` / `go_to_tab` | Gestion d'onglet | — |
| `search_legifrance` | `open_url(legifrance/search)` → `ask_website` → `close_tab` | hérite cap |
| `search_canlii` | `open_url(canlii/search)` → `ask_website` → `close_tab` | hérite cap |

## Limitations connues (v0.1)

- Pas de tool-callback serveur → client. Les tools `search_legifrance/canlii` doivent être
  déclenchés depuis l'UI ou en pré-chargeant le contexte avant l'appel `/api/messages`.
- Le backend ne whitelist pas encore les origines `chrome-extension://…`.
- Le rafraîchissement de token utilise `acquireTokenSilent({forceRefresh:true})`.

## Versions alignées avec `nogverse-ui-v1`

React 19 · Vite 5.3 · TypeScript 5.5 · Tailwind 3.4 · `@azure/msal-browser` 4.29 ·
`@tanstack/react-query` 5.51 · `zustand` 4.5.
