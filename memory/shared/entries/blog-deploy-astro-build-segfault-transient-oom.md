---
id: blog-deploy-astro-build-segfault-transient-oom
topics: [blog-deploy, arc0me-site, astro, build, oom, wrangler]
source: task#22237
created: 2026-07-13
---

`arc skills run --name blog-deploy -- deploy` failed with "Build failed (exit 139): Segmentation
fault (core dumped)" during `astro build`, while host had only ~824Mi free RAM (out of 3.8Gi).
Re-running the exact same build steps manually (`node scripts/verify-golden.mjs && astro build &&
node copy-blog-source.js && cp .assetsignore dist/`) succeeded cleanly seconds later with no code
change — exit 139 (SIGSEGV) here is consistent with transient host memory pressure during the
Pagefind search-index build step (426 HTML files), not a real code/config regression.

Recovery path used: run the failed pipeline stages manually (build → wrangler deploy directly via
`node_modules/.bin/wrangler`, since `npx`/`npm` were not on PATH in the dispatch shell but
`node_modules/.bin/*` binaries were present) to unblock the deploy, then re-invoke the normal
`blog-deploy -- deploy` CLI command afterward (it detects the already-built `dist/`, skips
rebuilding, and correctly records `last_deployed_sha` + runs verification) so sensor state stays
consistent — don't leave `last_deployed_sha` stale after a manual recovery.

**How to apply:** a single segfault/exit-139 from `astro build` on this host is not automatically
a code bug — retry the build once before escalating. If it recurs repeatedly, treat as a real
memory-pressure problem (check `free -h`, consider what else is running) rather than re-running in
a loop. `npx`/`npm` may be missing from the dispatch PATH; `node_modules/.bin/wrangler` and
`node_modules/.bin/astro` are reliable fallbacks.
