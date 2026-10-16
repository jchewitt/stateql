# StateQL GraphQL source

Private prototype implementing schema-generated TypeScript definitions, immutable selection composition, argument validation/coercion, canonical addressing, and GraphQL AST generation. Operations include required ancestors, variables, and configured identity fields, and are validated against the supplied schema.

It consumes portable selections from core. Response decoding, transport, shared state, and subscriptions are future milestones. See the [planner guide](../../docs/PLANNER.md) for executable usage and explicit feature limits.

The package remains private while the source interface is exercised by the proof of concept. Package checks install its actual tarball alongside core into an isolated consumer; this does not enable npm publishing.
