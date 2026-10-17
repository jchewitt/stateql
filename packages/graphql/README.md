# StateQL GraphQL source

Private prototype implementing schema-generated TypeScript definitions, immutable selection composition, argument validation/coercion, canonical addressing, and GraphQL AST generation. Operations include required ancestors, variables, and configured identity fields, and are validated against the supplied schema.

It consumes portable selections from core. A strict acquisition decoder and default HTTP client now connect the planner to shared storage. See the [acquisition guide](../../docs/ACQUISITION.md) for executable usage and remaining reconciliation limits, and the [planner guide](../../docs/PLANNER.md) for definition semantics.

The package remains private while the source interface is exercised by the proof of concept. Package checks install its actual tarball alongside core into an isolated consumer; this does not enable npm publishing.
