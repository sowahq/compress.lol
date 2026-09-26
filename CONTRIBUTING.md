# Contributing to compress.lol

Thanks for helping. compress.lol compresses videos entirely in the browser: no file is ever uploaded. Every change has to keep it that way.

## Getting started

Requirements: Node.js 20.9 or later (22 or 24 recommended) and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:5173. The `/lab` page (dev only) compresses the same file with every engine and compares speed, size and target accuracy.

## Project layout

| Path                                | Role                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `src/lib/compression/compressor.ts` | Analysis and compression flow, engine selection and fallback |
| `src/lib/compression/webcodecs.ts`  | WebCodecs engine (mediabunny), used by default               |
| `src/lib/compression/ffmpeg.ts`     | ffmpeg.wasm engine, loaded on demand as a fallback           |
| `src/lib/compression/settings.ts`   | Resolution, frame rate and bitrate choices for a target size |
| `src/lib/compression/target.ts`     | Re-encodes until the output fits the target                  |
| `src/lib/compression/presets.ts`    | Target presets (Discord, WhatsApp, email, sizes)             |
| `src/lib/components/compression/`   | UI components of the compression page                        |
| `src/routes/+page.svelte`           | Main page                                                    |
| `messages/`                         | Translations, one JSON file per language                     |

## Before opening a pull request

Run the same checks as the maintainers:

```bash
npm test         # unit tests (vitest)
npm run check    # type check (svelte-check)
npm run lint     # formatting (prettier), fix with npm run format
npm run build    # production build
```

- Add or update tests for any behaviour change. Table-driven tests (`it.each`) are preferred.
- For UI or compression changes, try a real video in at least one browser and say which one in the pull request.
- Use the existing UI components and Tailwind theme tokens; do not hardcode colours or pixel sizes.

## Commits and pull requests

- One topic per pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, in the imperative mood, explaining why.
- Keep commits atomic: each one should pass the checks on its own.

Merged pull requests are deployed automatically to https://compress.lol.

## Reporting issues

Use the issue templates. For bugs, the browser, the file type and the target size help a lot. Please do not attach private videos.

For a security problem, contact the maintainer on GitHub ([@sowahq](https://github.com/sowahq)) instead of opening a public issue.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
