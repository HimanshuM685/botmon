# Graph Report - botmon  (2026-11-14)

## Corpus Check
- 28 files · ~33,046 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 491 nodes · 1233 edges · 28 communities (18 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Server Actions & Mutations
- Analysis, Coach & Model Routes
- Prompt Construction & LLM Tools
- Auth & Account Management
- Dashboard & Layout Infrastructure
- Export & Chat Context Routes
- Chat Parsing & Upload UI
- Person Profile & Stats View
- Runtime Core Dependencies
- TypeScript Configuration
- Development Tools & Types
- App Shell Layout & Landing Page
- Multi-Model AI Providers & DB Client
- Project Scripts & Lifecycle
- Memory Map Visualization
- Linting & Code Quality
- Prisma & Database Schema Config
- Botmon Features & Architecture Docs
- Neon Cloud Infrastructure
- Groq Model Provider
- Vercel AI React Hooks
- Utility Class Merging
- Icon Library
- Tailwind Class Merge
- Vercel Functions Runtime
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `next` - 22 edges
2. `db` - 19 edges
3. `compilerOptions` - 16 edges
4. `react` - 15 edges
5. `vitest` - 15 edges
6. `sonner` - 14 edges
7. `getPerson()` - 13 edges
8. `requireUser` - 13 edges
9. `POST()` - 13 edges
10. `ai` - 12 edges

## Surprising Connections (you probably didn't know these)
- `factSchema` --calls--> `toEntities()`  [EXTRACTED]
  app/actions.ts → lib/facts.ts
- `POST()` --calls--> `mergeChats()`  [EXTRACTED]
  app/api/people/[id]/chat/route.ts → lib/merge.ts
- `POST()` --calls--> `computeStats()`  [EXTRACTED]
  app/api/people/[id]/chat/route.ts → lib/stats.ts
- `Landing()` --calls--> `getUserId()`  [EXTRACTED]
  app/page.tsx → lib/auth/server.ts
- `CoachPage()` --calls--> `getPerson()`  [EXTRACTED]
  app/(app)/people/[id]/coach/page.tsx → lib/data.ts

## Import Cycles
- None detected.

## Communities (28 total, 10 thin omitted)

### Community 0 - "Server Actions & Mutations"
Cohesion: 0.06
Nodes (51): ActionState, ChildDelegate, children, deleteAccount(), deleteKey(), deletePerson(), factSchema, keySchema (+43 more)

### Community 1 - "Analysis, Coach & Model Routes"
Cohesion: 0.08
Nodes (52): maxDuration, POST(), bodySchema, maxDuration, newId, POST(), maxDuration, POST() (+44 more)

### Community 2 - "Prompt Construction & LLM Tools"
Cohesion: 0.07
Nodes (43): buildCoachContext(), anchorSection(), buildModelPatchPrompt(), buildPrompt(), Fact, fitToBudget(), fmtLine(), FOCUS (+35 more)

### Community 3 - "Auth & Account Management"
Cohesion: 0.07
Nodes (34): restoreAccount(), DELETE, GET, PATCH, POST, PUT, CoachPage(), metadata (+26 more)

### Community 4 - "Dashboard & Layout Infrastructure"
Cohesion: 0.09
Nodes (20): savePerson(), Dashboard(), metadata, fraunces, geist, metadata, viewport, metadata (+12 more)

### Community 5 - "Export & Chat Context Routes"
Cohesion: 0.14
Nodes (19): POST(), getUserId(), ADVICE_MAX_AGE_DAYS, adviceStale(), contextHash(), facts, person, t (+11 more)

### Community 6 - "Chat Parsing & Upload UI"
Cohesion: 0.17
Nodes (20): ChatUploader(), accept(), onFiles(), upload(), Existing, fmt(), key(), mergeChats() (+12 more)

### Community 7 - "Person Profile & Stats View"
Cohesion: 0.13
Nodes (22): fmtMin(), PersonPage(), Stat(), trend(), AdviceStatus, AnalysisView(), Block(), Bullets() (+14 more)

### Community 8 - "Runtime Core Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, ai@^7.0.172, @ai-sdk/openai@^4.0.117, fflate@^0.8.3, @neon/auth@^0.8.2, @neon/env@^2.1.3, next@16.4.6, @prisma/adapter-pg@^7.10.1 (+11 more)

### Community 9 - "TypeScript Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 10 - "Development Tools & Types"
Cohesion: 0.11
Nodes (18): devDependencies, tailwindcss@4.3.3, @tailwindcss/turbopack@4.3.3, tsx@^4.23.15, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19 (+10 more)

### Community 11 - "App Shell Layout & Landing Page"
Cohesion: 0.18
Nodes (11): AppLayout(), dynamic, Bubble(), dynamic, Landing(), steps, RestoreAccount(), GoogleButton() (+3 more)

### Community 12 - "Multi-Model AI Providers & DB Client"
Cohesion: 0.17
Nodes (11): @ai-sdk/google@^4.0.120, @ai-sdk/xai@^5.0.45, pg@^8.23.1, zod@^4.6.7, name, private, version, @ai-sdk/google (+3 more)

### Community 13 - "Project Scripts & Lifecycle"
Cohesion: 0.22
Nodes (9): scripts, build, dev, lint, postinstall, purge, start, test (+1 more)

### Community 14 - "Memory Map Visualization"
Cohesion: 0.32
Nodes (5): FILL, layout(), MapFact, MapLink, MemoryMap()

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
- **2 isolated node(s):** `30-Day Trash Purge`, `Next.js Agent Rules`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 139 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Dashboard & Layout Infrastructure` to `Server Actions & Mutations`, `Auth & Account Management`, `Chat Parsing & Upload UI`, `Person Profile & Stats View`, `Runtime Core Dependencies`, `App Shell Layout & Landing Page`, `Multi-Model AI Providers & DB Client`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **What connects `30-Day Trash Purge`, `Next.js Agent Rules` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server Actions & Mutations` be split into smaller, more focused modules?**
  _Cohesion score 0.06394230769230769 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Prompt Construction & LLM Tools` to `Analysis, Coach & Model Routes`, `Auth & Account Management`, `Export & Chat Context Routes`, `Chat Parsing & Upload UI`, `Development Tools & Types`, `Multi-Model AI Providers & DB Client`, `Memory Map Visualization`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `Analysis, Coach & Model Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.08283730158730158 - nodes in this community are weakly interconnected._
- **Why does `ai` connect `Analysis, Coach & Model Routes` to `Server Actions & Mutations`, `Auth & Account Management`, `Person Profile & Stats View`, `Runtime Core Dependencies`, `Multi-Model AI Providers & DB Client`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `Prompt Construction & LLM Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.0734006734006734 - nodes in this community are weakly interconnected._