# content/

`edits.json` is what William changed in the controller (`editor/`: online at https://thewilliamyao.github.io/clearance/editor/, or http://localhost:8077/editor/ with `python3 serve.py` running): shift names, memos, issue notes, quotas, work-order pools, request wording and merit, his own new requests, and any line of the game's text. It holds only the changes; anything not in it is the game as written in `src/game/days.js`, `requests.js` and `text.js`.

The game loads it at start (`src/game/content.js`); anything that doesn't check out is skipped with a warning in the console, never fatal.

There are two copies. The online controller saves straight into the public repo's `content/edits.json`, a commit each time, and the game updates without a publish. The local controller saves this one, which goes out with the next publish. `publish/publish.sh` keeps whichever copy changed since the last publish and copies an online change back here. If both changed, it stops and asks (`--edits=online` or `--edits=local`).

- Undo one change: the controller's ↺ next to it, or delete the key here.
- Back to the game as written: `{ "v": 1 }`.
- `backups/` (not in git) keeps the last 30 versions the local controller replaced, newest last. Online saves are in the public repo's history.
