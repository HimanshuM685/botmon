# Graph Report - botmon  (2026-11-14)

## Corpus Check
- 23 files · ~25,045 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 437 nodes · 1075 edges · 23 communities (16 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Analysis, Advice & Export APIs
- Server Actions & Account Mutations
- Coach LLM & Context Tools
- App Shell Layouts & Navigation
- Coach & Timeline Person Views
- Analysis & Advice Client Components
- Chat Parsing & Upload UI
- Runtime Core Dependencies
- TypeScript Project Configuration
- Dev Dependencies & Database Config
- Dashboard & Person Editing
- Auth Catch-All Handler
- Multi-Model AI Providers & Framework
- Project Scripts & Lifecycle
- Linting & Code Quality
- Botmon Features & Architecture Docs
- Neon Cloud Infrastructure
- Groq Model Provider
- Vercel AI React Hooks
- TypeScript Execution Tooling
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `next` - 22 edges
2. `getPerson()` - 20 edges
3. `db` - 18 edges
4. `compilerOptions` - 16 edges
5. `requireUser` - 14 edges
6. `react` - 14 edges
7. `sonner` - 14 edges
8. `ConfirmButton()` - 14 edges
9. `ai` - 12 edges
10. `vitest` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Onboarding()` --calls--> `KeyForm()`  [EXTRACTED]
  app/(app)/onboarding/page.tsx → components/key-form.tsx
- `KeyForm()` --indirect_call--> `saveKey()`  [INFERRED]
  components/key-form.tsx → app/actions.ts
- `POST()` --calls--> `computeStats()`  [EXTRACTED]
  app/api/people/[id]/chat/route.ts → lib/stats.ts
- `POST()` --calls--> `mergeChats()`  [EXTRACTED]
  app/api/people/[id]/chat/route.ts → lib/merge.ts
- `CoachPage()` --calls--> `CoachChat()`  [EXTRACTED]
  app/(app)/people/[id]/coach/page.tsx → components/coach-chat.tsx

## Import Cycles
- None detected.

## Communities (23 total, 7 thin omitted)

### Community 0 - "Analysis, Advice & Export APIs"
Cohesion: 0.10
Nodes (43): GET(), maxDuration, POST(), maxDuration, POST(), POST(), bodySchema, maxDuration (+35 more)

### Community 1 - "Server Actions & Account Mutations"
Cohesion: 0.07
Nodes (42): ActionState, ChildDelegate, children, deleteAccount(), deleteKey(), factSchema, keySchema, ownedItem() (+34 more)

### Community 2 - "Coach LLM & Context Tools"
Cohesion: 0.08
Nodes (37): buildCoachContext(), COACH_HISTORY, COACH_SYSTEM, coachTools(), searchMessages(), msgs, anchorSection(), buildAdvicePrompt() (+29 more)

### Community 3 - "App Shell Layouts & Navigation"
Cohesion: 0.07
Nodes (26): deletePerson(), restoreAccount(), AppLayout(), dynamic, PersonLayout(), fraunces, geist, metadata (+18 more)

### Community 4 - "Coach & Timeline Person Views"
Cohesion: 0.08
Nodes (30): CoachPage(), metadata, metadata, TimelinePage(), metadata, Row, Trash(), Timeline() (+22 more)

### Community 5 - "Analysis & Advice Client Components"
Cohesion: 0.10
Nodes (23): AdviceStatus, AnalysisView(), Block(), Bullets(), errorText(), Evidence(), Group(), List() (+15 more)

### Community 6 - "Chat Parsing & Upload UI"
Cohesion: 0.17
Nodes (20): ChatUploader(), accept(), onFiles(), upload(), Existing, fmt(), key(), mergeChats() (+12 more)

### Community 7 - "Runtime Core Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, ai@^7.0.172, @ai-sdk/xai@^5.0.45, clsx@^2.1.1, fflate@^0.8.3, lucide-react@^1.72.0, next@16.4.6, @prisma/client@^7.10.1 (+11 more)

### Community 8 - "TypeScript Project Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 9 - "Dev Dependencies & Database Config"
Cohesion: 0.12
Nodes (17): devDependencies, dotenv@^18.0.10, prisma@^7.10.1, tailwindcss@4.3.3, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19 (+9 more)

### Community 10 - "Dashboard & Person Editing"
Cohesion: 0.23
Nodes (11): savePerson(), Dashboard(), metadata, EditPerson(), Person, Person, PersonForm(), RELATIONS (+3 more)

### Community 11 - "Auth Catch-All Handler"
Cohesion: 0.18
Nodes (9): DELETE, GET, PATCH, POST, PUT, auth, @neon/auth@^0.8.2, config (+1 more)

### Community 12 - "Multi-Model AI Providers & Framework"
Cohesion: 0.17
Nodes (11): @ai-sdk/google@^4.0.120, @ai-sdk/openai@^4.0.117, @neon/env@^2.1.3, @tailwindcss/turbopack@4.3.3, name, private, version, @ai-sdk/google (+3 more)

### Community 13 - "Project Scripts & Lifecycle"
Cohesion: 0.22
Nodes (9): scripts, build, dev, lint, postinstall, purge, start, test (+1 more)

### Community 14 - "Linting & Code Quality"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.6, eslint, eslint-config-next

### Community 15 - "Botmon Features & Architecture Docs"
Cohesion: 0.67
Nodes (4): Botmon Overview, Chat Timeline Memory, Coach Chat, 30-Day Trash Purge

## Knowledge Gaps
- **2 isolated node(s):** `30-Day Trash Purge`, `Next.js Agent Rules`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 126 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `App Shell Layouts & Navigation` to `Analysis, Advice & Export APIs`, `Server Actions & Account Mutations`, `Coach & Timeline Person Views`, `Analysis & Advice Client Components`, `Chat Parsing & Upload UI`, `Runtime Core Dependencies`, `Dashboard & Person Editing`, `Multi-Model AI Providers & Framework`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **What connects `30-Day Trash Purge`, `Next.js Agent Rules` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Analysis, Advice & Export APIs` be split into smaller, more focused modules?**
  _Cohesion score 0.1003584229390681 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Coach LLM & Context Tools` to `Analysis, Advice & Export APIs`, `Coach & Timeline Person Views`, `Multi-Model AI Providers & Framework`, `Chat Parsing & Upload UI`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `Server Actions & Account Mutations` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Why does `ai` connect `Analysis, Advice & Export APIs` to `Server Actions & Account Mutations`, `Coach LLM & Context Tools`, `Coach & Timeline Person Views`, `Analysis & Advice Client Components`, `Runtime Core Dependencies`, `Multi-Model AI Providers & Framework`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `Coach LLM & Context Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.08081632653061224 - nodes in this community are weakly interconnected._