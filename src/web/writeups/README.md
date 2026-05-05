# Writeups (linked from the AIBTC deck)

Drop long-form documents here. Slides reference them by relative path so the deck stays scannable while detail lives one click away.

## Slots referenced by the May 5 deck

| Slot | Path | Slide |
|---|---|---|
| Cloudflare $900 incident writeup | `20260505-cloudflare-incident.md` | 04 |
| agent-runtime status / spec | `20260505-agent-runtime.md` | 09 |
| bitcoin-agent-os reference | `20260505-bitcoin-agent-os.md` | 10 |

Filenames are conventional — slides hard-link to those exact paths. If you save under different names, update the `<a href>` in `src/web/presentation.html` to match.

## Suggested format

Plain markdown. First line = `# Title`. Second line = one-sentence summary. Then sections. The deck links to the file directly; clicking opens the raw markdown in the served `/writeups/` route (or GitHub if you commit + push).
