# Graph Report - botmon  (2026-11-15)

## Corpus Check
- 184 files · ~101,777 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: .toml 2, .example 1, (none) 1)

## Summary
- 1007 nodes · 3184 edges · 44 communities (39 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.85)
- Token cost: 1,200 input · 500 output

## Community Hubs (Navigation)
- Self Coach Route & Memory Actions
- Server Actions & Account Mutations
- Rehearsal Persona Simulation
- Cheap Model Execution & History Search
- Coach Agent Context & Tools
- Graph Traversal & Resolution
- Chat Upload & Parser Components
- Coach Chat & Trace UI
- Self Traits & Coach Integration
- Self Voice Analysis & Merging
- Graph Topology & Neighborhoods
- Upload Processing & Crypto Utilities
- Dashboard & Person Navigation
- Graph Triple Extraction & Backfill
- AI Model Provider Infrastructure
- Relationship History & Eras
- Self Profile & Settings UI
- Conversation Goals & Model Patches
- TypeScript Project Configuration
- Graph Categories & Merges
- UI Framework & Database Adapters
- Development Tools & Types
- Person Profile & Read State
- Analysis & Advice View UI
- Trash & Recovery Management
- Graph Store & Asynchronous Jobs
- Export APIs & DB Helpers
- Coach Turn Execution & Route
- AI Schemas & Read Definitions
- Auth Catch-All API Handler
- Botmon Features & Architecture Docs
- Vector Embeddings & Semantic Search
- Graph Findings & Tensions
- Landing Page & Google Auth
- Project Scripts & Lifecycle
- Read History & Advice Actions
- Root Layout & Global Typography
- Linting & Code Quality
- Prisma & Database Schema Config
- Next.js Security & Headers Config
- Next.js Agent Guidelines

## God Nodes (most connected - your core abstractions)
1. `requireUser` - 44 edges
2. `buildGraph()` - 44 edges
3. `POST()` - 38 edges
4. `POST()` - 34 edges
5. `db` - 34 edges
6. `vitest` - 34 edges
7. `POST()` - 31 edges
8. `next` - 29 edges
9. `getPerson` - 25 edges
10. `planMemory()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `KeyForm()` --indirect_call--> `saveKey()`  [INFERRED]
  components/key-form.tsx → app/actions.ts
- `FactForm()` --indirect_call--> `saveFact()`  [INFERRED]
  components/timeline.tsx → app/actions.ts
- `Dashboard()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/dashboard/page.tsx → lib/auth/server.ts
- `AppLayout()` --calls--> `requireUser`  [EXTRACTED]
  app/(app)/layout.tsx → lib/auth/server.ts
- `MePage()` --calls--> `SelfProfileView()`  [EXTRACTED]
  app/(app)/me/page.tsx → components/self-profile.tsx

## Import Cycles
- None detected.

## Communities (44 total, 5 thin omitted)

### Community 0 - "Self Coach Route & Memory Actions"
Cohesion: 0.06
Nodes (104): factSchema, rebuildMemories(), saveFact(), bodySchema, maxDuration, newId, POST(), FEELINGS_SINCE (+96 more)

### Community 1 - "Server Actions & Account Mutations"
Cohesion: 0.05
Nodes (66): ActionState, ChildDelegate, children, deleteAccount(), deleteKey(), deletePerson(), detachChat(), fetchModels() (+58 more)

### Community 2 - "Rehearsal Persona Simulation"
Cohesion: 0.08
Nodes (44): buildPersonaContext(), delay(), exchangePairs(), NO_REPLY, Pair, Part, personaTurns(), REHEARSAL_BANNER() (+36 more)

### Community 3 - "Cheap Model Execution & History Search"
Cohesion: 0.08
Nodes (39): searchCoachHistory(), Ask, cheapAsk(), cheapText(), Key, withCheap(), anyWordQuery(), COACH_HISTORY (+31 more)

### Community 4 - "Coach Agent Context & Tools"
Cohesion: 0.10
Nodes (38): buildCoachContext(), capFor(), COACH_STEPS, COACH_SYSTEM, coachTools(), matchMemory(), searchMessages(), StoredMemory (+30 more)

### Community 5 - "Graph Traversal & Resolution"
Cohesion: 0.10
Nodes (34): buildGraph(), mentioned(), resolve(), make(), endpointKey(), GFact, GNode, isRel() (+26 more)

### Community 6 - "Chat Upload & Parser Components"
Cohesion: 0.12
Nodes (29): removeChat(), ChatUploader(), accept(), onFiles(), readPasted(), upload(), Existing, fmt() (+21 more)

### Community 7 - "Coach Chat & Trace UI"
Cohesion: 0.08
Nodes (30): loadTrace(), changedMemory(), errorText(), Message(), Thread, Trace, Why(), edgeColor() (+22 more)

### Community 8 - "Self Traits & Coach Integration"
Cohesion: 0.09
Nodes (26): SELF_KINDS, SELF_COACH_SYSTEM, promoteMeEdges(), Ev, Item, ME_EDGE, meEdgeItem(), rescope() (+18 more)

### Community 9 - "Self Voice Analysis & Merging"
Cohesion: 0.11
Nodes (20): mergeVoices(), rankMerge(), SHARES, casual, formal, bump(), COMMON, pct() (+12 more)

### Community 10 - "Graph Topology & Neighborhoods"
Cohesion: 0.14
Nodes (25): ancestors(), brief(), family(), link(), neighbours(), newest(), path(), renderSubgraph() (+17 more)

### Community 11 - "Upload Processing & Crypto Utilities"
Cohesion: 0.19
Nodes (17): edgeQuote(), POST(), selfAfterUpload(), decrypt(), decryptBuffer(), encrypt(), key(), chatPayloadSchema (+9 more)

### Community 12 - "Dashboard & Person Navigation"
Cohesion: 0.15
Nodes (16): savePerson(), Dashboard(), metadata, PersonLayout(), metadata, EditPerson(), Person, Person (+8 more)

### Community 13 - "Graph Triple Extraction & Backfill"
Cohesion: 0.14
Nodes (21): tripleSchema, acceptTriples(), BackfillAnswer, backfillAnswerSchema, backfillPrompt(), Fact, needsTriples(), allergy (+13 more)

### Community 14 - "AI Model Provider Infrastructure"
Cohesion: 0.08
Nodes (23): dependencies, ai@^7.0.172, @ai-sdk/google@^4.0.120, @ai-sdk/groq@^4.0.83, @ai-sdk/openai@^4.0.117, @ai-sdk/xai@^5.0.45, fflate@^0.8.3, lucide-react@^1.72.0 (+15 more)

### Community 15 - "Relationship History & Eras"
Cohesion: 0.15
Nodes (18): afterHistory(), CHAPTER_SHARE, day(), dayOf(), DIRECT_SHARE, eraRange(), HISTORY_SHARE, historyForPrompt() (+10 more)

### Community 16 - "Self Profile & Settings UI"
Cohesion: 0.18
Nodes (15): renameThread(), saveKey(), metadata, SelfCoachPage(), MePage(), metadata, metadata, RehearsePage() (+7 more)

### Community 17 - "Conversation Goals & Model Patches"
Cohesion: 0.16
Nodes (17): modelPatchSchema, signalsSchema, Baseline, checkGoals(), Goal, GOAL_STEP, Growth, GROWTH_DAYS (+9 more)

### Community 18 - "TypeScript Project Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 19 - "Graph Categories & Merges"
Cohesion: 0.18
Nodes (15): acceptCategories(), applyMerges(), BROAD, CategoryAnswer, categoryAnswerSchema, CategoryPlan, needsCategory(), HUBS (+7 more)

### Community 20 - "UI Framework & Database Adapters"
Cohesion: 0.11
Nodes (17): @ai-sdk/react@^4.0.176, clsx@^2.1.1, @neon/env@^2.1.3, @prisma/adapter-pg@^7.10.1, react-dom@19.3.0, tailwind-merge@^3.7.0, @vercel/functions@^3.11.2, name (+9 more)

### Community 21 - "Development Tools & Types"
Cohesion: 0.11
Nodes (18): devDependencies, tailwindcss@4.3.3, @tailwindcss/turbopack@4.3.3, tsx@^4.23.15, @types/node@^22.20.5, @types/pg@^8.23.1, @types/react@^19, @types/react-dom@^19 (+10 more)

### Community 22 - "Person Profile & Read State"
Cohesion: 0.20
Nodes (14): fmtMin(), PersonPage(), trend(), ReadState, ChatActions(), ADVICE_MAX_AGE_DAYS, adviceStale(), contextHash() (+6 more)

### Community 23 - "Analysis & Advice View UI"
Cohesion: 0.21
Nodes (16): AdviceStatus, Block(), Bullets(), ChatNumber, Evidence(), Fold(), List(), merged() (+8 more)

### Community 24 - "Trash & Recovery Management"
Cohesion: 0.25
Nodes (11): metadata, Row, Trash(), RestoreButton(), db, purgeExpired(), recountTraits(), daysLeft() (+3 more)

### Community 25 - "Graph Store & Asynchronous Jobs"
Cohesion: 0.21
Nodes (15): FactInput, categorize(), edgeSelect, EmbedKey, emptyDelta(), GraphDelta, linkMemories(), loadGraphRows() (+7 more)

### Community 26 - "Export APIs & DB Helpers"
Cohesion: 0.20
Nodes (10): GET(), create(), g, goalsForPrompt(), exportEdge(), exportEvidence, MODEL_LOCK_MS, MODEL_RUNS_PER_HOUR (+2 more)

### Community 27 - "Coach Turn Execution & Route"
Cohesion: 0.19
Nodes (10): CoachPage(), metadata, bodySchema, HOURLY_MESSAGE_LIMIT, newId, openGoal(), Person, StartedTurn (+2 more)

### Community 28 - "AI Schemas & Read Definitions"
Cohesion: 0.15
Nodes (10): aboutUserSchema, ADVICE_KEYS, ChapterResult, chapterSchema, EraResult, eraSchema, Generated, PATCH_SECTIONS (+2 more)

### Community 29 - "Auth Catch-All API Handler"
Cohesion: 0.18
Nodes (9): DELETE, GET, PATCH, POST, PUT, auth, @neon/auth@^0.8.2, config (+1 more)

### Community 30 - "Botmon Features & Architecture Docs"
Cohesion: 0.21
Nodes (12): Coach Brain Architecture, Entity Resolution & Trigram Matching, Memory Findings & Tensions, Memory Map Spoke Visualization, Rehearsal Persona Simulation, User Self Profile, Trait Consolidation & Voice Merging, Self Traits & Evidence Model (+4 more)

### Community 31 - "Vector Embeddings & Semantic Search"
Cohesion: 0.36
Nodes (11): embedModelFor(), contentWords(), COSINE_MIN, embed(), embedMissing(), focusNodes(), Key, literal() (+3 more)

### Community 32 - "Graph Findings & Tensions"
Cohesion: 0.24
Nodes (8): diffFindings(), newSince(), StoredFinding, make(), Memory, NOW, Said, Tension

### Community 33 - "Landing Page & Google Auth"
Cohesion: 0.29
Nodes (6): Bubble(), dynamic, Landing(), steps, GoogleButton(), authClient

### Community 34 - "Project Scripts & Lifecycle"
Cohesion: 0.20
Nodes (10): scripts, build, dev, eval, lint, postinstall, purge, start (+2 more)

### Community 35 - "Read History & Advice Actions"
Cohesion: 0.32
Nodes (7): loadRead(), AnalysisView(), pick(), readHistory(), run(), errorText(), overlay()

### Community 36 - "Root Layout & Global Typography"
Cohesion: 0.29
Nodes (4): fraunces, geist, metadata, viewport

### Community 37 - "Linting & Code Quality"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.6, eslint, eslint-config-next

### Community 38 - "Prisma & Database Schema Config"
Cohesion: 0.40
Nodes (4): dotenv@^18.0.10, prisma@^7.10.1, dotenv, prisma

## Knowledge Gaps
- **8 isolated node(s):** `Next.js Agent Rules`, `30-Day Trash Purge`, `Entity Resolution & Trigram Matching`, `Memory Findings & Tensions`, `Rehearsal Persona Simulation` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 276 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Self Voice Analysis & Merging` to `Self Coach Route & Memory Actions`, `Server Actions & Account Mutations`, `Rehearsal Persona Simulation`, `Cheap Model Execution & History Search`, `Coach Agent Context & Tools`, `Graph Findings & Tensions`, `Graph Traversal & Resolution`, `Coach Chat & Trace UI`, `Chat Upload & Parser Components`, `Self Traits & Coach Integration`, `Upload Processing & Crypto Utilities`, `Graph Triple Extraction & Backfill`, `Relationship History & Eras`, `Conversation Goals & Model Patches`, `Graph Categories & Merges`, `UI Framework & Database Adapters`, `Development Tools & Types`, `Person Profile & Read State`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `buildGraph()` (e.g. with `ancestors()` and `brief()`) actually correct?**
  _`buildGraph()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Next.js Agent Rules`, `30-Day Trash Purge`, `Entity Resolution & Trigram Matching` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Self Coach Route & Memory Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.05896358543417367 - nodes in this community are weakly interconnected._
- **Why does `next` connect `Dashboard & Person Navigation` to `Self Coach Route & Memory Actions`, `Server Actions & Account Mutations`, `Landing Page & Google Auth`, `Cheap Model Execution & History Search`, `Root Layout & Global Typography`, `Chat Upload & Parser Components`, `Coach Chat & Trace UI`, `Next.js Security & Headers Config`, `Graph Triple Extraction & Backfill`, `AI Model Provider Infrastructure`, `Self Profile & Settings UI`, `UI Framework & Database Adapters`, `Person Profile & Read State`, `Analysis & Advice View UI`, `Coach Turn Execution & Route`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `Server Actions & Account Mutations` be split into smaller, more focused modules?**
  _Cohesion score 0.05359831376091539 - nodes in this community are weakly interconnected._
- **Why does `ai` connect `Self Coach Route & Memory Actions` to `Server Actions & Account Mutations`, `Cheap Model Execution & History Search`, `Coach Agent Context & Tools`, `Coach Chat & Trace UI`, `Self Traits & Coach Integration`, `AI Model Provider Infrastructure`, `Self Profile & Settings UI`, `UI Framework & Database Adapters`, `Analysis & Advice View UI`, `Coach Turn Execution & Route`, `Vector Embeddings & Semantic Search`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._