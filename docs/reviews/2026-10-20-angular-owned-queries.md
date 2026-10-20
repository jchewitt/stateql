# P4.2 Angular query ownership review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: typed client provider ownership, reactive query bindings and command gating, shared guarded observation, lifecycle/error/reentrant cases, GraphQL typing/invalidation, installed APF consumers, API documentation, Changeset, and npm release-readiness handoff tasks.

The reviewer assessed the design before implementation and recommended separate provider/query lifetimes, descriptor-based gating, consistent injection context on initial and later opening, untracked factories, and reuse of the guarded observation primitive. The implementation follows those boundaries. No actionable findings remained in the code or final documentation/package review.

The reviewer independently passed all 21 Angular tests, type checks, and diff checks. Tests cover lazy/inherited provider clients, replacement before effect flush, observed A/B/A transitions, parameter/factory failures and recovery, stable snapshots, reentrant creation/destruction, subscription failures, command disposal, and two owners sharing a real core acquisition. A GraphQL scenario verifies that alias invalidation remains narrow and preserves cached siblings. Type negatives preserve target paths, required arguments, readonly state, and provider token/factory compatibility.

The parent passed `pnpm check`: formatting, builds, generated-schema verification, strict type checks, 186 tests (16 tooling, 81 core, 4 fixture API, 6 Apollo baseline, 56 GraphQL, 2 vanilla examples, 21 Angular), and isolated packed-package consumers. Installed APF checks exercise native ESM observation and owned query/provider behavior plus Angular AOT template compilation.

Server testing packages are development-only support for exercising Angular's scheduler in Node, not an SSR implementation. Form bindings, StateQL demo views, and production streaming remain later work. The release checklist explicitly requires notifying the user and obtaining their trusted-publisher setup at readiness; multi-package CI publication remains an R1 task. The existing publisher and disabled readiness flag are unchanged. No package was published.
