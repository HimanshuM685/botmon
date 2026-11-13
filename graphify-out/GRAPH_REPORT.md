# Graph Report - botmon  (2026-11-14)

## Corpus Check
- 19 files · ~22,403 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 400 nodes · 959 edges · 27 communities (17 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 400 input · 150 output

## Community Hubs (Navigation)
- Server Actions & Mutations
- Coach Chat & Context Engine
- Analysis & Export API Routes
- Dashboard & Person Navigation
- Chat Parsing & Upload UI
- Person Profile & Analysis UI
- Trash & Account Restoration
- Root Layout & Global Styles
- TypeScript Project Configuration
- Runtime Core Dependencies
- Development Tools & Types
- Multi-Model AI Providers & Styling
- Auth Catch-All API Handler
- Project Scripts & Lifecycle
- Linting & Code Quality
- Prisma & Database Schema Config
- Botmon Features & Architecture Docs
- Neon Cloud Infrastructure
- xAI Model Provider Package
- Compression Library
- Icon Library
- Neon Environment Config
- Postgres Driver
- React DOM Library
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `requireUser` - 28 edges
2. `next` - 21 edges
3. `getPerson()` - 18 edges
4. `db` - 17 edges
5. `compilerOptions` - 16 edges
6. `react` - 13 edges
7. `getUserId()` - 11 edges
8. `sonner` - 11 edges
9. `vitest` - 11 edges
10. `ChatUploader()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Trash()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/trash/page.tsx → lib/auth/server.ts
- `AppLayout()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/layout.tsx → lib/auth/server.ts
- `Onboarding()` --calls--> `KeyForm()`  [EXTRACTED]
  app/(app)/onboarding/page.tsx → components/key-form.tsx
- `CoachPage()` --calls--> `CoachChat()`  [EXTRACTED]
  app/(app)/people/[id]/coach/page.tsx → components/coach-chat.tsx
- `CoachPage()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/people/[id]/coach/page.tsx → lib/auth/server.ts

## Import Cycles
- None detected.

## Communities (27 total, 10 thin omitted)

### Community 0 - "Server Actions & Mutations"
Cohesion: 0.07
Nodes (47): ActionState, ChildDelegate, children, deleteAccount(), deleteKey(), deletePerson(), factSchema, keySchema (+39 more)

### Community 1 - "Coach Chat & Context Engine"
Cohesion: 0.08
Nodes (39): bodySchema, maxDuration, newId, buildCoachContext(), COACH_HISTORY, COACH_SYSTEM, coachTools(), searchMessages() (+31 more)

### Community 2 - "Analysis & Export API Routes"
Cohesion: 0.11
Nodes (32): GET(), maxDuration, POST(), seedFor(), POST(), POST(), CoachPage(), metadata (+24 more)

### Community 3 - "Dashboard & Person Navigation"
Cohesion: 0.12
Nodes (18): savePerson(), Dashboard(), metadata, PersonLayout(), metadata, ConfirmButton(), EditPerson(), Person (+10 more)

### Community 4 - "Chat Parsing & Upload UI"
Cohesion: 0.17
Nodes (19): ChatUploader(), accept(), onFiles(), upload(), Existing, fmt(), key(), mergeChats() (+11 more)

### Community 5 - "Person Profile & Analysis UI"
Cohesion: 0.14
Nodes (20): fmtMin(), PersonPage(), Stat(), trend(), AnalysisView(), Block(), Bullets(), errorText() (+12 more)

### Community 6 - "Trash & Account Restoration"
Cohesion: 0.16
Nodes (12): restoreAccount(), metadata, Row, Trash(), dynamic, metadata, purgeExpired(), daysLeft() (+4 more)

### Community 7 - "Root Layout & Global Styles"
Cohesion: 0.13
Nodes (12): fraunces, geist, metadata, viewport, Bubble(), dynamic, Landing(), steps (+4 more)

### Community 8 - "TypeScript Project Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 9 - "Runtime Core Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, ai@^7.0.172, @ai-sdk/groq@^4.0.83, @ai-sdk/react@^4.0.176, @neon/auth@^0.8.2, next@16.4.6, @prisma/adapter-pg@^7.10.1, @prisma/client@^7.10.1 (+10 more)

### Community 10 - "Development Tools & Types"
Cohesion: 0.12
Nodes (17): devDependencies, tailwindcss@4.3.3, @tailwindcss/turbopack@4.3.3, tsx@^4.23.15, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19 (+9 more)

### Community 11 - "Multi-Model AI Providers & Styling"
Cohesion: 0.17
Nodes (11): @ai-sdk/google@^4.0.120, @ai-sdk/openai@^4.0.117, clsx@^2.1.1, tailwind-merge@^3.7.0, name, private, version, @ai-sdk/google (+3 more)

### Community 12 - "Auth Catch-All API Handler"
Cohesion: 0.22
Nodes (7): DELETE, GET, PATCH, POST, PUT, auth, config

### Community 13 - "Project Scripts & Lifecycle"
Cohesion: 0.22
Nodes (9): scripts, build, dev, lint, postinstall, purge, start, test (+1 more)

### Community 14 - "Linting & Code Quality"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.6, eslint, eslint-config-next

### Community 15 - "Prisma & Database Schema Config"
Cohesion: 0.40
Nodes (4): dotenv@^18.0.10, prisma@^7.10.1, dotenv, prisma

### Community 16 - "Botmon Features & Architecture Docs"
Cohesion: 0.67
Nodes (4): Botmon Overview, Chat Timeline Memory, Coach Chat, 30-Day Trash Purge

## Knowledge Gaps
- **2 isolated node(s):** `Next.js Agent Rules`, `30-Day Trash Purge`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 111 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Dashboard & Person Navigation` to `Server Actions & Mutations`, `Analysis & Export API Routes`, `Chat Parsing & Upload UI`, `Person Profile & Analysis UI`, `Trash & Account Restoration`, `Root Layout & Global Styles`, `Runtime Core Dependencies`, `Multi-Model AI Providers & Styling`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **What connects `Next.js Agent Rules`, `30-Day Trash Purge` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server Actions & Mutations` be split into smaller, more focused modules?**
  _Cohesion score 0.06715063520871144 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Coach Chat & Context Engine` to `Analysis & Export API Routes`, `Multi-Model AI Providers & Styling`, `Chat Parsing & Upload UI`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `Coach Chat & Context Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.07896575821104122 - nodes in this community are weakly interconnected._
- **Why does `ai` connect `Coach Chat & Context Engine` to `Server Actions & Mutations`, `Analysis & Export API Routes`, `Person Profile & Analysis UI`, `Runtime Core Dependencies`, `Multi-Model AI Providers & Styling`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `Analysis & Export API Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.10904255319148937 - nodes in this community are weakly interconnected._