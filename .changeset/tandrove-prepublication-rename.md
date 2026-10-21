---
'@tandrove/core': patch
'@tandrove/graphql': patch
'@tandrove/angular': patch
---

Rename the unpublished StateQL release to Tandrove under the secured @tandrove scope. Publish core, graphql and angular as the matching 0.1.0-alpha.0 set. Angular's branded APIs are tandroveSignal and provideTandroveClient; generated imports, example consumers and APF entrypoints use the new names. This change is included in the initial prepared alpha rather than a version increment: no StateQL version was published and no compatibility aliases are shipped.
