# Summary evaluation benchmark

## Purpose

This is a small, reproducible benchmark for the behavior of Lingua's existing
`POST /api/summarize` endpoint. It measures how well the summary turns a labeled
conversation into structured actionable information and how often it extracts
facts that are not supported by the fixture.

It is an evaluation harness, not a replacement for production tests. It does not
import backend code and does not need a Gemini key; the already-running backend
owns Gemini authentication.

## Dataset and ground truth

`fixtures.json` contains 18 hand-labeled fixtures covering appointments, dates
and times, deadlines, instructions, locations, documents, decisions,
clarifications, next steps, small talk, negation, corrections, uncertainty,
competing dates, missing information, and school/clinic/housing/bank/government
conversations in English, Urdu, and mixed Urdu/English.

Each fixture contains the transcript payload accepted by `/api/summarize`, an
expected value for every current summary category, and a note describing the
behavior under test. Expected scalar facts may include a short, explicit alias
list. Aliases are human-reviewed alternatives, not fuzzy matching rules.

Appointment facts are matched one-to-one. Every non-null expected appointment
field (`date`, `time`, `location`, and `notes`) must match the corresponding
predicted field or an explicit alias. Scalar facts are also matched one-to-one,
so one prediction cannot satisfy two expected facts.

Matching normalizes Unicode with NFKC, case, surrounding/repeated whitespace,
and punctuation. It does not use fuzzy similarity, embeddings, semantic search,
or another model. The summary text itself is validated but is not scored as an
actionable fact.

## Metrics

- Schema validity checks the current response shape: a string `summary`, all
  eight current category arrays, string values in scalar arrays, and appointment
  objects with `date`, `time`, `location`, and `notes` of the production types.
- Precision is true positives divided by true positives plus false positives.
- Recall is true positives divided by true positives plus false negatives.
- F1 is the harmonic mean of precision and recall.
- Unsupported-fact rate is unmatched extracted facts divided by all extracted
  facts. It is a measurement of unsupported extraction against this labeled
  benchmark, not a universal hallucination rate.
- p50 and p95 use deterministic nearest-rank percentiles over the wall-clock
  latency of each HTTP request. Startup time is excluded.

Zero-denominator precision, recall, and F1 values are reported as `n/a` in the
human-readable output and `null` in machine-readable output.

Per-category true positives, false positives, false negatives, precision,
recall, and F1 are reported. HTTP failures and schema failures are listed in
failure analysis and are not silently treated as model predictions.

## Running the benchmark

From the repository root, start the backend in another terminal with a valid
`GEMINI_API_KEY`, then run:

```bash
LINGUA_EVAL_BASE_URL=http://localhost:3001 node eval/run-eval.mjs
```

The default URL is `http://localhost:3001`, so this is also sufficient:

```bash
node eval/run-eval.mjs
```

To additionally write machine-readable output after a real run:

```bash
node eval/run-eval.mjs --write-results
```

This writes `eval/results.json` with the run timestamp, safe backend origin,
metrics, latencies, and per-fixture results. It never writes API keys, tokens,
headers, or environment variables. Do not commit `results.json` unless the run
was actually completed and reviewed; do not create a fabricated `RESULTS.md`.

PowerShell:

```powershell
$env:LINGUA_EVAL_BASE_URL = "http://localhost:3001"
node eval/run-eval.mjs
```

If the backend cannot be reached, the runner exits with an actionable message
to start it; it does not silently produce failed model measurements.

## Offline verification

The scoring code and fixture validation can be checked without a backend or
Gemini credential:

```bash
node --test eval/*.test.mjs
node --input-type=module -e "import fs from 'node:fs'; import { validateFixtures } from './eval/scoring.mjs'; validateFixtures(JSON.parse(fs.readFileSync('./eval/fixtures.json', 'utf8'))); console.log('fixtures valid')"
```

## Limitations

This is a small hand-labeled benchmark, not a representative sample of every
language, domain, speaker, or conversation style. Exact deterministic aliases
cannot recognize every semantically equivalent paraphrase. Gemini output can
vary across model versions and prompts, and latency is affected by local
network conditions, backend load, and API conditions. Appointment notes are
matched as part of the appointment; unsupported details inside a matched note
are not separately factored. The benchmark measures only the categories and
contract currently exposed by Lingua.
