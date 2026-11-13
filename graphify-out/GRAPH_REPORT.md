# Graph Report - botmon  (2026-11-14)

## Corpus Check
- Corpus is ~20,243 words - fits in a single context window. You may not need a graph.

## Summary
- 382 nodes · 946 edges · 23 communities (18 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 500 input · 200 output

## Community Hubs (Navigation)
- Server Actions & Mutations
- Coach Chat & Context Engine
- Authentication & Account Management
- Chat Parsing & Upload UI
- Dashboard & Person Navigation
- Analysis & Export API Routes
- Person Profile & Analysis UI
- Runtime Core Dependencies
- TypeScript Project Configuration
- Development Tools & Types
- Auth & UI Framework Libraries
- Landing Page & Google Auth
- Multi-Model AI Providers
- NPM Scripts & Lifecycle
- Root Layout & Global Styles
- Linting & Code Quality
- Prisma & Database Schema Config
- Botmon Features & Architecture Docs
- Neon Backend Infrastructure
- Daily Trash Purge Cron
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `requireUser` - 28 edges
2. `next` - 21 edges
3. `getPerson()` - 18 edges
4. `db` - 16 edges
5. `compilerOptions` - 16 edges
6. `react` - 13 edges
7. `POST()` - 12 edges
8. `POST()` - 11 edges
9. `getUserId()` - 11 edges
10. `loadChat()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Dashboard()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/dashboard/page.tsx → lib/auth/server.ts
- `AppLayout()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/layout.tsx → lib/auth/server.ts
- `Onboarding()` --calls--> `KeyForm()`  [EXTRACTED]
  app/(app)/onboarding/page.tsx → components/key-form.tsx
- `CoachPage()` --calls--> `getPerson()`  [EXTRACTED]
  app/(app)/people/[id]/coach/page.tsx → lib/data.ts
- `PersonLayout()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/people/[id]/layout.tsx → lib/auth/server.ts

## Import Cycles
- None detected.

## Communities (23 total, 5 thin omitted)

### Community 0 - "Server Actions & Mutations"
Cohesion: 0.07
Nodes (47): ActionState, deleteAccount(), deleteKey(), deletePerson(), factSchema, keySchema, ownedItem(), personSchema (+39 more)

### Community 1 - "Coach Chat & Context Engine"
Cohesion: 0.10
Nodes (34): bodySchema, maxDuration, buildCoachContext(), COACH_HISTORY, COACH_SYSTEM, coachTools(), searchMessages(), msgs (+26 more)

### Community 2 - "Authentication & Account Management"
Cohesion: 0.09
Nodes (28): restoreAccount(), DELETE, GET, PATCH, POST, PUT, authorized(), GET() (+20 more)

### Community 3 - "Chat Parsing & Upload UI"
Cohesion: 0.15
Nodes (22): ChatUploader(), accept(), onFiles(), upload(), Existing, fmt(), key(), mergeChats() (+14 more)

### Community 4 - "Dashboard & Person Navigation"
Cohesion: 0.12
Nodes (18): savePerson(), Dashboard(), metadata, PersonLayout(), metadata, ConfirmButton(), EditPerson(), Person (+10 more)

### Community 5 - "Analysis & Export API Routes"
Cohesion: 0.21
Nodes (20): GET(), maxDuration, POST(), POST(), POST(), getModel(), providerError(), getUserId() (+12 more)

### Community 6 - "Person Profile & Analysis UI"
Cohesion: 0.17
Nodes (17): fmtMin(), PersonPage(), Stat(), trend(), AnalysisView(), Block(), Bullets(), errorText() (+9 more)

### Community 7 - "Runtime Core Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, ai@^7.0.172, clsx@^2.1.1, lucide-react@^1.72.0, next@16.4.6, pg@^8.23.1, @prisma/adapter-pg@^7.10.1, @prisma/client@^7.10.1 (+12 more)

### Community 8 - "TypeScript Project Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 9 - "Development Tools & Types"
Cohesion: 0.13
Nodes (15): devDependencies, tailwindcss@4.3.3, @tailwindcss/turbopack@4.3.3, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19, typescript@^5 (+7 more)

### Community 10 - "Auth & UI Framework Libraries"
Cohesion: 0.14
Nodes (13): @ai-sdk/react@^4.0.176, fflate@^0.8.3, @neon/auth@^0.8.2, @neon/env@^2.1.3, react-dom@19.3.0, name, private, version (+5 more)

### Community 11 - "Landing Page & Google Auth"
Cohesion: 0.29
Nodes (6): Bubble(), dynamic, Landing(), steps, GoogleButton(), authClient

### Community 12 - "Multi-Model AI Providers"
Cohesion: 0.20
Nodes (9): ProviderId, @ai-sdk/google@^4.0.120, @ai-sdk/groq@^4.0.83, @ai-sdk/openai@^4.0.117, @ai-sdk/xai@^5.0.45, @ai-sdk/google, @ai-sdk/groq, @ai-sdk/openai (+1 more)

### Community 13 - "NPM Scripts & Lifecycle"
Cohesion: 0.25
Nodes (8): scripts, build, dev, lint, postinstall, start, test, vercel-build

### Community 14 - "Root Layout & Global Styles"
Cohesion: 0.29
Nodes (4): fraunces, geist, metadata, viewport

### Community 15 - "Linting & Code Quality"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.6, eslint, eslint-config-next

### Community 16 - "Prisma & Database Schema Config"
Cohesion: 0.40
Nodes (4): dotenv@^18.0.10, prisma@^7.10.1, dotenv, prisma

### Community 17 - "Botmon Features & Architecture Docs"
Cohesion: 0.67
Nodes (4): Botmon Overview, Chat Timeline Memory, Coach Chat, 30-Day Trash Purge

## Knowledge Gaps
- **2 isolated node(s):** `Next.js Agent Rules`, `30-Day Trash Purge`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 104 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Dashboard & Person Navigation` to `Server Actions & Mutations`, `Authentication & Account Management`, `Chat Parsing & Upload UI`, `Person Profile & Analysis UI`, `Runtime Core Dependencies`, `Auth & UI Framework Libraries`, `Landing Page & Google Auth`, `Root Layout & Global Styles`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **What connects `Next.js Agent Rules`, `30-Day Trash Purge` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server Actions & Mutations` be split into smaller, more focused modules?**
  _Cohesion score 0.07017543859649122 - nodes in this community are weakly interconnected._
- **Why does `ai` connect `Coach Chat & Context Engine` to `Server Actions & Mutations`, `Authentication & Account Management`, `Analysis & Export API Routes`, `Person Profile & Analysis UI`, `Runtime Core Dependencies`, `Auth & UI Framework Libraries`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `Coach Chat & Context Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.10042283298097252 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Dashboard & Person Navigation` to `Server Actions & Mutations`, `Authentication & Account Management`, `Chat Parsing & Upload UI`, `Person Profile & Analysis UI`, `Runtime Core Dependencies`, `Auth & UI Framework Libraries`, `Landing Page & Google Auth`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `Authentication & Account Management` be split into smaller, more focused modules?**
  _Cohesion score 0.08859357696567 - nodes in this community are weakly interconnected._