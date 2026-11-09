# Graph Report - web-programming  (2026-11-05)

## Corpus Check
- 16 files · ~80,908 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 342 file(s) not represented in the graph (top: (none) 337, .css 2, .db 1)

## Summary
- 100 nodes · 145 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- package.json
- database.js
- server.js
- routes/auth.js
- orders.js
- routes/admin.js
- api.test.js
- app.js
- scripts
- js/admin.js
- cart.js
- js/configurator.js

## God Nodes (most connected - your core abstractions)
1. `express` - 8 edges
2. `db` - 7 edges
3. `scripts` - 5 edges
4. `bcryptjs` - 4 edges
5. `jsonwebtoken` - 4 edges
6. `better-sqlite3` - 3 edges
7. `cors` - 3 edges
8. `multer` - 3 edges
9. `loadPopularPresets()` - 3 edges
10. `loadCatalog()` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (12 total, 3 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.13
Nodes (18): author, dependencies, bcryptjs@^3.0.2, better-sqlite3@^11.8.1, cors@^2.8.5, dotenv@^16.4.7, multer@^1.4.5-lts.1, description (+10 more)

### Community 1 - "database.js"
Cohesion: 0.15
Nodes (11): Database, dataDir, db, dbPath, fs, path, uploadsDir, express (+3 more)

### Community 2 - "server.js"
Cohesion: 0.19
Nodes (9): app, cors, express, fs, path, bcrypt, fs, path (+1 more)

### Community 3 - "routes/auth.js"
Cohesion: 0.22
Nodes (8): jsonwebtoken@^9.0.2, jsonwebtoken, jwt, requireAuth(), bcrypt, express, jwt, router

### Community 4 - "orders.js"
Cohesion: 0.20
Nodes (6): express@^4.21.2, express, crypto, express, https, router

### Community 5 - "routes/admin.js"
Cohesion: 0.25
Nodes (7): express, fs, multer, path, router, storage, upload

### Community 6 - "api.test.js"
Cohesion: 0.38
Nodes (4): assert, http, request(), runTests()

### Community 7 - "app.js"
Cohesion: 0.60
Nodes (4): escapeHtml(), formatPrice(), loadCatalog(), loadPopularPresets()

### Community 8 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, dev, seed, start, test

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `express` connect `orders.js` to `package.json`, `database.js`, `server.js`, `routes/auth.js`, `routes/admin.js`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13450292397660818 - nodes in this community are weakly interconnected._
- **Why does `scripts` connect `scripts` to `package.json`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `better-sqlite3` connect `package.json` to `database.js`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._