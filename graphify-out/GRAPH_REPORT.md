# Graph Report - botmon  (2026-11-15)

## Corpus Check
- 29 files · ~38,246 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 521 nodes · 1306 edges · 32 communities (23 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Analysis, Feelings & Mental Model Routes
- Auth API & Account Sessions
- Coach Route & Fact Extraction Actions
- Coach Chat & Memory Sync UI
- Chat Parsing, Drag & Paste UI
- Chat Upload API & Person Profile
- Chat Attachment & Migration Actions
- Analysis Advice & Stat Presentation
- Core AI Model Dependencies
- TypeScript Project Configuration
- Development Tools & Types
- Dashboard & Person Editing
- Person Layout & Privacy Views
- App Shell & Account Restoration
- Voice Analysis & Tone Profiler
- Prisma & Reactive AI Packages
- Account Settings & API Key Mutators
- Onboarding & Key Setup UI
- Project Scripts & Lifecycle
- Root Layout & Global Styles
- Linting & Code Quality
- Prisma & Database Schema Config
- Botmon Features & Architecture Docs
- Neon Cloud Infrastructure
- Icon Library
- Neon Environment Config
- Postgres Client Driver
- Tailwind Merge Utility
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `next` - 22 edges
2. `getPerson` - 21 edges
3. `db` - 19 edges
4. `vitest` - 16 edges
5. `react` - 16 edges
6. `compilerOptions` - 16 edges
7. `sonner` - 15 edges
8. `coachTools()` - 14 edges
9. `requireUser` - 13 edges
10. `POST()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Onboarding()` --calls--> `KeyForm()`  [EXTRACTED]
  app/(app)/onboarding/page.tsx → components/key-form.tsx
- `PersonLayout()` --calls--> `getPerson`  [EXTRACTED]
  app/(app)/people/[id]/layout.tsx → lib/data.ts
- `KeyForm()` --indirect_call--> `saveKey()`  [INFERRED]
  components/key-form.tsx → app/actions.ts
- `AppLayout()` --calls--> `SignOutButton()`  [EXTRACTED]
  app/(app)/layout.tsx → components/sign-out-button.tsx
- `RestoreAccount()` --calls--> `SignOutButton()`  [EXTRACTED]
  app/restore-account/page.tsx → components/sign-out-button.tsx

## Import Cycles
- None detected.

## Communities (32 total, 9 thin omitted)

### Community 0 - "Analysis, Feelings & Mental Model Routes"
Cohesion: 0.06
Nodes (59): FEELINGS_SINCE, maxDuration, maxDuration, anchorSection(), buildMemoryReadPrompt(), buildModelPatchPrompt(), buildPrompt(), Fact (+51 more)

### Community 1 - "Auth API & Account Sessions"
Cohesion: 0.07
Nodes (35): DELETE, GET, PATCH, POST, PUT, CoachPage(), metadata, metadata (+27 more)

### Community 2 - "Coach Route & Fact Extraction Actions"
Cohesion: 0.15
Nodes (34): factSchema, POST(), bodySchema, maxDuration, newId, POST(), buildCoachContext(), COACH_HISTORY (+26 more)

### Community 3 - "Coach Chat & Memory Sync UI"
Cohesion: 0.09
Nodes (26): renameThread(), saveFact(), changedMemory(), CoachChat(), errorText(), Message(), starters(), Thread (+18 more)

### Community 4 - "Chat Parsing, Drag & Paste UI"
Cohesion: 0.12
Nodes (22): ChatUploader(), accept(), onFiles(), readPasted(), upload(), Existing, fmt(), key() (+14 more)

### Community 5 - "Chat Upload API & Person Profile"
Cohesion: 0.14
Nodes (23): POST(), POST(), fmtMin(), PersonPage(), Stat(), trend(), ADVICE_MAX_AGE_DAYS, adviceStale() (+15 more)

### Community 6 - "Chat Attachment & Migration Actions"
Cohesion: 0.16
Nodes (19): ChildDelegate, children, detachChat(), keySchema, moveChat(), OwnedChat, ownedChat(), ownedItem() (+11 more)

### Community 7 - "Analysis Advice & Stat Presentation"
Cohesion: 0.15
Nodes (19): loadRead(), AdviceStatus, AnalysisView(), pick(), Block(), Bullets(), errorText(), Evidence() (+11 more)

### Community 8 - "Core AI Model Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, ai@^7.0.172, @ai-sdk/google@^4.0.120, @ai-sdk/openai@^4.0.117, @ai-sdk/xai@^5.0.45, clsx@^2.1.1, @neon/auth@^0.8.2, next@16.4.6 (+13 more)

### Community 9 - "TypeScript Project Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 10 - "Development Tools & Types"
Cohesion: 0.11
Nodes (18): devDependencies, tailwindcss@4.3.3, @tailwindcss/turbopack@4.3.3, tsx@^4.23.15, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19 (+10 more)

### Community 11 - "Dashboard & Person Editing"
Cohesion: 0.21
Nodes (11): savePerson(), Dashboard(), metadata, EditPerson(), Person, Person, PersonForm(), RELATIONS (+3 more)

### Community 12 - "Person Layout & Privacy Views"
Cohesion: 0.19
Nodes (8): deletePerson(), PersonLayout(), metadata, DeletePersonButton(), PersonTabs(), nextConfig, securityHeaders, next

### Community 13 - "App Shell & Account Restoration"
Cohesion: 0.20
Nodes (9): restoreAccount(), AppLayout(), dynamic, dynamic, metadata, RestoreAccount(), SignOutButton(), authClient (+1 more)

### Community 14 - "Voice Analysis & Tone Profiler"
Cohesion: 0.21
Nodes (12): applyVoice(), bump(), COMMON, pct(), pickSamples(), share(), casual, t (+4 more)

### Community 15 - "Prisma & Reactive AI Packages"
Cohesion: 0.14
Nodes (13): @ai-sdk/groq@^4.0.83, @ai-sdk/react@^4.0.176, fflate@^0.8.3, @prisma/adapter-pg@^7.10.1, @prisma/client@^7.10.1, name, private, version (+5 more)

### Community 16 - "Account Settings & API Key Mutators"
Cohesion: 0.26
Nodes (9): ActionState, deleteAccount(), deleteKey(), setDefaultProvider(), metadata, Settings(), ConfirmButton(), DeleteAccountButton() (+1 more)

### Community 17 - "Onboarding & Key Setup UI"
Cohesion: 0.29
Nodes (8): saveKey(), metadata, Onboarding(), KeyForm(), CHAR_BUDGET, PROVIDER_IDS, ProviderId, PROVIDERS

### Community 18 - "Project Scripts & Lifecycle"
Cohesion: 0.22
Nodes (9): scripts, build, dev, lint, postinstall, purge, start, test (+1 more)

### Community 19 - "Root Layout & Global Styles"
Cohesion: 0.29
Nodes (4): fraunces, geist, metadata, viewport

### Community 20 - "Linting & Code Quality"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.6, eslint, eslint-config-next

### Community 21 - "Prisma & Database Schema Config"
Cohesion: 0.40
Nodes (4): dotenv@^18.0.10, prisma@^7.10.1, dotenv, prisma

### Community 22 - "Botmon Features & Architecture Docs"
Cohesion: 0.67
Nodes (4): Botmon Overview, Chat Timeline Memory, Coach Chat, 30-Day Trash Purge

## Knowledge Gaps
- **2 isolated node(s):** `30-Day Trash Purge`, `Next.js Agent Rules`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 147 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Person Layout & Privacy Views` to `Auth API & Account Sessions`, `Coach Chat & Memory Sync UI`, `Chat Parsing, Drag & Paste UI`, `Chat Upload API & Person Profile`, `Chat Attachment & Migration Actions`, `Analysis Advice & Stat Presentation`, `Core AI Model Dependencies`, `Dashboard & Person Editing`, `App Shell & Account Restoration`, `Prisma & Reactive AI Packages`, `Onboarding & Key Setup UI`, `Root Layout & Global Styles`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `30-Day Trash Purge`, `Next.js Agent Rules` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Analysis, Feelings & Mental Model Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.05693693693693694 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Coach Chat & Memory Sync UI` to `Analysis, Feelings & Mental Model Routes`, `Auth API & Account Sessions`, `Coach Route & Fact Extraction Actions`, `Chat Parsing, Drag & Paste UI`, `Chat Upload API & Person Profile`, `Development Tools & Types`, `Voice Analysis & Tone Profiler`, `Prisma & Reactive AI Packages`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Should `Auth API & Account Sessions` be split into smaller, more focused modules?**
  _Cohesion score 0.06708595387840671 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Dashboard & Person Editing` to `Auth API & Account Sessions`, `Coach Chat & Memory Sync UI`, `Chat Parsing, Drag & Paste UI`, `Chat Upload API & Person Profile`, `Chat Attachment & Migration Actions`, `Analysis Advice & Stat Presentation`, `Core AI Model Dependencies`, `App Shell & Account Restoration`, `Prisma & Reactive AI Packages`, `Account Settings & API Key Mutators`, `Onboarding & Key Setup UI`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `Coach Route & Fact Extraction Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.14709851551956815 - nodes in this community are weakly interconnected._