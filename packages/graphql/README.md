# StateQL GraphQL source

Reserved module for the schema-informed definition builder, operation generator, response decoder, and default HTTP transport. Implementation starts after the Apollo baseline.

It consumes the same canonical selections as the state runtime. It does not own a cache or framework subscriptions. Start with explicit supported schema features and validate generated documents against the fixture schema.

No package manifest or empty npm package is created until this module has an implementation. The source interface remains internal during the proof of concept.
