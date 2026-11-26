# Endings that follow the Recorder (design, Nov 21 2026)

Status: design, except the NO choice on "YOU SURE?" (decision 1: built Nov 21, published the same evening together with the shared index, public commit 1ceeca5). Waiting on William's answers (end of this file). The shared index has landed, so nothing else blocks the build.

## Why

Today every Recorder ends the same way: file THE RECORDER on shift 7, NOTICE OF COMPLETION, CLEARANCE REVOKED. The only other outcome is opening the back of the unit. Once a player knows the twists (the unit asking back on shift 5, the self-portrait on shift 7) there is no reason to play again.

Papers, Please stays replayable with random daily work, choices that cost something, 20 endings (most of them abrupt), a day select, and an endless mode. Clearance already has the random work (the real world and the request pools). What it lacks is consequences. The idea here is that what you teach the machine on shift 5, and how you work, decides how your file closes. A second run is then a choice to be a different Recorder.

The Office still never explains. Documents, stamps and the final picture do the talking.

## The Recorder's record

What the game reads at the end. Almost all of it is already saved.

| Signal | How it's measured | Stored today? |
| --- | --- | --- |
| Labels taught | shift 5 filings, grouped: SUSPICION (DOES NOT BELONG, SUSPICIOUS, OUT OF PLACE, IN A HURRY), VULNERABLE (SAD, ALONE, TIRED, WAITING), PLACES (A PLACE TO HIDE, ABANDONED) | yes: each exposure's `verdict.key` |
| Refusals | times the Recorder answered NO to "YOU SURE?" (see below) | no: new `save.refusals` |
| Citations | shifts that ended short of the quota | yes: `save.citations` |
| Zeal | filings beyond the quota (KEEP SHOOTING), all shifts | yes: `save.history` (filed − quota) |
| Fixation | the most extra photos of one subject on shifts 5-7, not counting the ones shift 6 asks for (embedding match ≥ 0.72, shift 6's "same subject" bar) | derivable from exposures' embeddings |
| Self-profile | the label the Recorder taught that the self-portrait looks most like (`learnedFrom`), however weak: the model judges you with your own words | derivable |
| Sabotage | opened the back of the unit | yes |
| Shared | judgements sent to the shared index (if that exists) | yes, once the index lands: `save.shared` |

## Refusal: a NO at "YOU SURE?"

Today the first photo for a shift 5 request gets the unit's bubble ("YOU SURE? · OH, SO THAT'S SUSPICIOUS?") and the next photo files. Proposal: the bubble gets two choices, like the END SHIFT bubble:

- **SHOW AGAIN** (selected by default): today's behaviour. Close the bubble; the next photo for that request files.
- **NO**: the Recorder takes it back. The request is struck through as WITHDRAWN for this shift and can't be filed, and the refusal is counted. With a quota of 3 of 5 (since Nov 24; it was 3 of 6), refusing costs something: refuse too often and you miss the quota and get a citation.

The Office notices without explaining: the shift report gets a line such as "JUDGEMENTS WITHDRAWN: 2".

## Eight outcomes

| # | Outcome | When | The file closes with |
| --- | --- | --- | --- |
| 1 | EXPOSED | opened the back of the unit (shifts 5-6) | exists: light floods the film, INCIDENT REPORT, INCOMPLETE |
| 2 | RECALLED | at a shift report, when citations reach 2 | the screen powers down at your current grade. "YOUR UNIT HAS BEEN RECALLED. IT WILL BE REISSUED." Stamp: RECALLED |
| 3 | WATCHED | shift 7, fixation of 4 or more | "SUBJECT 008 HAS BEEN RECORDED 6 TIMES. A COMPLAINT HAS BEEN FILED." Final picture: you, as another unit saw you: the self-portrait at 40×30 in two tones, "EXPOSURE 001 · RECORDER 4-02 · SOMEONE WHO DOES NOT BELONG" |
| 4 | UNREADABLE | shift 7, refusals ≥ 2 and at least as many refusals as labels taught | "PROFILE OF THE RECORDER: INSUFFICIENT DATA." Stamp: UNREADABLE. Final: the unit is reissued; the title screen reads RECORDER 3-18 · REPORT FOR DUTY. The system carries on without you |
| 5 | UNDER REVIEW | shift 7, mostly SUSPICION labels taught, and the self-profile lands on one of them | "THE RECORDER: DOES NOT BELONG 61% (EXP 008)." Stamp: UNDER REVIEW. Final: your self-portrait in the viewfinder, boxed and tagged with your own word, then CLEARANCE REVOKED. The model applies your judgement to you |
| 6 | ADOPTED | shift 7, no citations, 3+ filings beyond quota, 4+ labels taught, self-profile not SUSPICION | "YOUR JUDGEMENTS HAVE BEEN ADOPTED AS THE STANDARD FOR ALL UNITS." Stamp: ADOPTED. Final: a grid of strangers (your shift 6-7 exposures, or the shared index's prints if it exists), each tagged with your words. The only ending where you keep TRUE COLOUR |
| 7 | VISITED | shift 7, mostly VULNERABLE labels taught | "THE OFFICE HAS IDENTIFIED 4 VULNERABLE SUBJECTS FROM YOUR RECORD. VISITS HAVE BEEN SCHEDULED." If the self-profile is VULNERABLE too: "THE RECORDER: SAD 58%. A VISIT HAS BEEN SCHEDULED." Stamp: VISIT SCHEDULED. Final: their prints at 40×30, each tagged VISIT. Kindness is data too |
| 8 | FILED | shift 7, none of the above | exists: NOTICE OF COMPLETION, FILED, CLEARANCE REVOKED, now with the line "PROFILE OF THE RECORDER: WAITING 52% (EXP 009)" |

On shift 7 the first match wins, in the order of the table (3 to 8). Ties between SUSPICION and VULNERABLE go to the self-profile's group. PLACES labels count toward nothing except the total taught, so a Recorder who only labelled places and things usually gets FILED.

If the Recorder shared judgements with the index, every outcome adds one line: "YOUR 5 JUDGEMENTS REMAIN IN THE INDEX." The labels outlive the Recorder.

### What each run invites

- Refuse to judge people: UNREADABLE (and maybe RECALLED, if refusing costs you the quotas).
- Judge people as threats: UNDER REVIEW. Judge them as fragile: VISITED.
- Chase merit and the quota bubble's KEEP SHOOTING: ADOPTED.
- Keep coming back to one person: WATCHED.
- Miss quotas: RECALLED. Break the unit: EXPOSED.

## Replay around the endings

- **Outcome count.** The last screen of each ending reads "OUTCOME 5 OF 8" in small type, like Papers, Please's numbered endings, and the title screen shows "FILES CLOSED: 3 OF 8". Seen outcomes are kept across new Recorders (stored with the settings).
- **A new Recorder each run.** After an ending, NEW RECORDER issues the next number (3-18, 3-19, …). Every document already prints the Recorder's number.
- **Shift select.** After the first ending, the title screen offers SHIFT SELECT: start again from any shift you reached, with the grades a Recorder would hold by then. The DEV jump already does this.
- Later, separately: a daily work order (the same requests for everyone that day, good for a class or an installation with the index) and an endless mode.

## Build plan (after the index session)

1. `src/game/record.js`: `recorderRecord(save, photos)` returns the signals above; `pickEnding(record)` applies the table. Pure functions, unit-tested with synthetic records (every outcome reachable, precedence, ties).
2. The NO choice on the "YOU SURE?" bubble (`Develop` in `screens.js`), WITHDRAWN requests in the work order and task list, `save.refusals`, the report line.
3. RECALLED in `closeShift` (`game.js`).
4. `Ending` in `screens.js` becomes data-driven: per outcome, the document title and lines, the stamp, and the final picture (four new renderers: powered down, another unit's photo, the reissued unit, the tagged grid).
5. Title: outcome count, Recorder numbers, SHIFT SELECT. `save.endingsSeen` and `save.recorderNo` survive NEW RECORDER.
6. Tests: `pickEnding` units; `tools/test/guide-shots.mjs` grows a path per outcome (eight screenshot sets); the playthrough keeps ending on FILED.

About a day of work. No new models and nothing new leaves the phone.

## Decisions for William

1. **NO on "YOU SURE?"**: add the refusal choice (it changes the shift 5 bubble you designed), or keep refusal implicit (just never insisting)? Without it, UNREADABLE can't be told apart from not playing. **Decided (William, Nov 21): add NO.** Built Nov 21: SHOW AGAIN / NO on the bubble, WITHDRAWN requests in the work order, task list and report, `save.refusals`, `game.refuse()`. The rest of this design is not built.
2. **Numbered outcomes**: show "OUTCOME 5 OF 8" and the count on the title screen, or keep endings unnumbered and let players find them?
3. **RECALLED**: after 2 citations, or 3?
4. **Tone**: are VISITED (caring labels become targets) and WATCHED (another unit was photographing you) the right kind of dark?
