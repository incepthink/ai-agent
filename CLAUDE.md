# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Filler Post Intelligence Agent**. It takes a target Twitter/X handle plus a set of competitor handles and produces:

1. `output/posts.json` — a ranked library of filler post candidates (default: 7 hero + 20 backup)
2. `output/insights.json` — mined competitor intelligence (hooks, formats, hot topics, posting cadence)
3. `output/voice-profile.json` — the target's voice fingerprint
4. `output/dashboard.html` — copy-paste UI with cards, scores, source evidence, theme/format filters

"Filler posts" are the quick takes, hooks, hot takes, observations, and one-liners that go between high-effort posts (launches, threads). The agent learns the target's voice from their last ~50 tweets, mines transferable patterns (never wording) from competitors, generates original candidates, and ranks them against 5 explicit scores.

## Commands

```bash
# Real run
npm start -- --target "@me" --competitors "@a,@b,@c"

# Demo run (no API keys for Apify; uses mock tweet generator)
npm start -- --target "@me" --competitors "@a,@b,@c" --demo

# Optional flags
#   --count 27       total candidates (7 hero + rest backup), default 27
#   --days 14        days back to look (passed through, not yet enforced by Apify wrapper)
#   --max-tweets 50  per-user fetch limit

# Type-check
npx tsc --noEmit

# Compile
npx tsc
```

No test runner is configured.

## Environment Variables

`.env` (not committed):
- `OPENAI_API_KEY` — required for voice inference, pattern mining, candidate generation, scoring
- `APIFY_API_KEY` — required unless `--demo`; used by `apidojo/tweet-scraper`

## Pipeline (src/agent.ts)

The agent is a **deterministic pipeline**, not a tool-use loop — the steps are fixed, and the LLM is invoked inside each step where judgment is needed.

1. **Fetch** target + competitor tweets in parallel ([src/tools/twitter.ts](src/tools/twitter.ts) or [src/tools/twitter-mock.ts](src/tools/twitter-mock.ts))
2. **Voice inference** ([src/tools/voice.ts](src/tools/voice.ts)) — heuristics for length/emoji/punctuation/vocabulary + LLM for hook patterns, taboo, style notes
3. **Pattern mining** ([src/tools/mining.ts](src/tools/mining.ts)) — LLM extracts transferable patterns (kind=hook|format|angle|topic) per competitor; cross-competitor dedupe; ranked by `avgEngagement × log(frequency)`
4. **Candidate generation** ([src/tools/generate.ts](src/tools/generate.ts)) — LLM produces ~1.5× over-sample using voice + patterns; hard rules prohibit wording reuse
5. **Scoring** ([src/tools/score.ts](src/tools/score.ts)) — five scores per candidate:
   - `quality`, `brandFit`, `expectedEngagement` — LLM-rated (batched, 10 per call)
   - `plagiarismRisk` — Jaccard similarity on 4-grams vs every competitor tweet
   - `effort` — heuristic on length and sentence count
   - `composite = 0.30·quality + 0.25·brandFit + 0.20·expectedEngagement + 0.15·(1−risk) + 0.10·(1−effort)`
6. **Filter + rank** — drop candidates with `plagiarismRisk ≥ 0.15`; top 7 = hero tier, next N = backup
7. **Write artifacts + render dashboard** ([src/tools/artifacts.ts](src/tools/artifacts.ts), [src/tools/dashboard.ts](src/tools/dashboard.ts))

## Key Design Decisions

- **ESM-only** (`"type": "module"`) — `.js` extensions in imports for `.ts` source files (tsx handles this at runtime)
- **OpenAI `gpt-4o-mini`** everywhere — cheap, fast, good enough for the structured-output tasks here. All LLM calls use `response_format: { type: "json_object" }`
- **Deterministic pipeline over tool-use loop** — every step has well-typed inputs and outputs. Easier to debug, cheaper to run, equally autonomous given a fixed workflow
- **Plagiarism gate is structural** — Jaccard 4-grams vs source corpus, threshold 0.15. No API call needed. Embedding-based similarity is left as a future optional upgrade
- **Voice fingerprint is reusable** — `voice-profile.json` is its own artifact so other apps (schedulers, CMS) can consume it
- **Mock provider** ([src/tools/twitter-mock.ts](src/tools/twitter-mock.ts)) — deterministic seeded RNG keyed on handle. `--demo` switches the provider; OpenAI key still required for LLM calls
- **Cache** — Apify responses are cached to `./cache/{handle}_tweets.json` and `./cache/{handle}_profile.json` (gitignored). Delete the cache to force a re-fetch

## File Layout

- [src/index.ts](src/index.ts) — CLI parsing, env validation, cross-platform browser open
- [src/agent.ts](src/agent.ts) — the pipeline
- [src/types.ts](src/types.ts) — `Tweet`, `UserProfile`, `Pattern`, `VoiceProfile`, `PostCandidate`, `Insights`, `AgentOptions`
- [src/tools/twitter.ts](src/tools/twitter.ts) — Apify wrapper (unchanged from previous iteration)
- [src/tools/twitter-mock.ts](src/tools/twitter-mock.ts) — deterministic mock
- [src/tools/voice.ts](src/tools/voice.ts) — voice profile inference
- [src/tools/mining.ts](src/tools/mining.ts) — pattern extraction + insights aggregation
- [src/tools/generate.ts](src/tools/generate.ts) — candidate generation + evidence assembly
- [src/tools/score.ts](src/tools/score.ts) — scoring, plagiarism gate, filter+rank
- [src/tools/artifacts.ts](src/tools/artifacts.ts) — writes the three JSON files
- [src/tools/dashboard.ts](src/tools/dashboard.ts) — renders `output/dashboard.html` (vanilla HTML/CSS/JS, no CDN)

All outputs land in `./output/` (gitignored).
