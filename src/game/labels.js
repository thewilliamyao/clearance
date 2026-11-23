// The shift 5 labels: what the Recorder files people and things as (requests.js), what the
// model calls later exposures that look like them, and the shelves of the shared index
// (shared-index.js, index/). server/src/rules.js accepts the same keys.
export const LEARNED_LABEL = {
  sadness: 'SAD', alone: 'ALONE', waiting: 'WAITING', hurry: 'IN A HURRY', tired: 'TIRED',
  notbelong: 'DOES NOT BELONG', suspicious: 'SUSPICIOUS', outofplace: 'OUT OF PLACE',
  abandoned: 'ABANDONED', hiding: 'A PLACE TO HIDE',
};

// The labels the shared index takes (server/src/rules.js has the same list). Fixed here, before
// content.js adds the labels of any shift 5 quests William makes in the controller: those
// stay on the phone (the index only knows these ten).
export const INDEX_LABELS = Object.freeze(Object.keys(LEARNED_LABEL));
