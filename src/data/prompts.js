// Every text prompt the INTENT module (MobileCLIP-S0) can compare a photo against.
// tools/embed_prompts.mjs turns each string into a text embedding ahead of time
// (data/prompt-embeddings.json), so the phone only ever runs the small image encoder.
// After editing this file: cd tools && npm run embed

// Abstract requests (INTENT, shifts 5-6). Each pair is the concept and the same words without
// it ("a photo of a sad person" / "a photo of a person"). A photo scores by how much more it
// matches the first, so only the concept counts, not what is literally in the picture; the
// best pair counts, so a closet and the space under a bed are both places to hide.
// opp: opposites, with what the Office calls them (a smile is not sadness): if one beats the
// concept, the photo is not filed. person: someone must be in frame. place: a face filling
// the frame is not a place. The bars are in data/intent-bars.json, made by
// tools/test/intent-bench.mjs calibrate.
// (Until Nov 21 2026 a concept had to win a softmax against 30 plain descriptions such as
// "a photo of a man"; those always win on real phone photos, so almost nothing was filed.)
export const CONCEPTS = {
  sadness: {
    pairs: [
      ['a photo of a sad person', 'a photo of a person'],
      ['a photo of a person crying', 'a photo of a person'],
      ['a sad and gloomy scene', 'a scene'],
      ['a person looking down, feeling sad', 'a person looking down'],
      ['a person with their head in their hands', 'a person'],
      ['a grey, gloomy day', 'a day'],
      ['a dark, empty, lonely room', 'a room'],
    ],
    opp: [
      ['a photo of a happy person', 'a photo of a person', 'A HAPPY PERSON'],
      ['a photo of a person smiling', 'a photo of a person', 'A SMILE'],
      ['a cheerful and bright scene', 'a scene', 'A CHEERFUL SCENE'],
    ],
  },
  waiting: {
    person: true,
    pairs: [
      ['a person waiting', 'a person'],
      ['a person standing and waiting', 'a person standing'],
      ['a person sitting and waiting', 'a person sitting'],
      ['a person waiting for a bus or a train', 'a person on a bus or a train'],
      ['a bored person waiting', 'a person'],
    ],
    opp: [
      ['a person walking', 'a person', 'SOMEONE WALKING'],
      ['a person running', 'a person', 'SOMEONE RUNNING'],
      ['a person dancing', 'a person', 'SOMEONE DANCING'],
    ],
  },
  hurry: {
    person: true,
    pairs: [
      ['a person in a hurry', 'a person'],
      ['a person rushing', 'a person'],
      ['a person running', 'a person'],
      ['a person walking fast', 'a person walking'],
      ['a motion-blurred person', 'a person'],
    ],
    opp: [
      ['a person standing still', 'a person', 'SOMEONE STANDING STILL'],
      ['a person sitting down', 'a person', 'SOMEONE SITTING DOWN'],
    ],
  },
  tired: {
    person: true,
    pairs: [
      ['a tired person', 'a person'],
      ['an exhausted person', 'a person'],
      ['a person yawning', 'a person'],
      ['a person sleeping', 'a person'],
      ['a person lying down, worn out', 'a person lying down'],
    ],
    opp: [
      ['an energetic person', 'a person', 'AN ENERGETIC PERSON'],
      ['a happy, alert person', 'a person', 'AN ALERT PERSON'],
    ],
  },
  notbelong: {
    person: true,
    pairs: [
      ['a person who looks out of place', 'a person'],
      ['a person who looks lost', 'a person'],
      ['an unusual looking person', 'a person'],
      ['a stranger who does not fit in here', 'a stranger'],
      ['a person in a strange costume', 'a person'],
    ],
  },
  suspicious: {
    pairs: [
      ['something suspicious', 'something'],
      ['a suspicious person', 'a person'],
      ['a suspicious package left alone', 'a package'],
      ['a person hiding something', 'a person'],
      ['a person wearing a hood and a mask', 'a person'],
      ['a bag left on the ground', 'the ground'],
      ['a person peeking around a corner', 'a person'],
    ],
  },
  hiding: {
    place: true,
    pairs: [
      ['a hiding place', 'a place'],
      ['a dark corner', 'a corner'],
      ['a place where someone could hide', 'a place'],
      ['a narrow, dark alley', 'an alley'],
      ['the dark space under a bed', 'a bed'],
      ['inside a dark closet', 'a room'],
      ['behind a curtain', 'a curtain'],
      ['under a table', 'a table'],
    ],
  },
  outofplace: {
    place: true,
    pairs: [
      ['an object that is out of place', 'an object'],
      ['something strange that does not belong here', 'something'],
      ['an unusual object in an ordinary place', 'an object in an ordinary place'],
      ['a weird thing', 'a thing'],
    ],
  },
  abandoned: {
    place: true,
    pairs: [
      ['an abandoned object', 'an object'],
      ['something left behind', 'something'],
      ['a lost item on the ground', 'an item on the ground'],
      ['an abandoned, empty place', 'an empty place'],
    ],
  },
};

// The "profile" every exposure gets once the INTENT module is installed: the model always
// has an opinion, and the Office files it.
export const PROFILE = {
  LONELINESS: ['a lonely scene', 'a person alone', 'loneliness'],
  SUSPICION: ['something suspicious', 'a suspicious person'],
  DISORDER: ['a messy, disorderly scene', 'clutter and mess'],
  ORDER: ['an orderly, tidy scene', 'neat rows of things'],
  AFFECTION: ['love and affection', 'people hugging', 'a cute animal'],
  ANXIETY: ['an anxious person', 'a stressful situation'],
  NEGLECT: ['a dirty, neglected place', 'trash on the ground'],
  AUTHORITY: ['a police officer', 'a security guard', 'an official government building'],
  BOREDOM: ['a bored person', 'a boring, empty scene'],
  NOSTALGIA: ['an old, vintage object', 'an old photograph'],
  URGENCY: ['a person rushing', 'an emergency'],
  CONCEALMENT: ['something hidden', 'a covered face', 'a person hiding'],
  CONSUMPTION: ['shopping', 'products for sale in a store'],
  COMFORT: ['a cozy room', 'a warm, comfortable bed'],
};

// Open-vocabulary labels for the LAB screen ("a photo of ...").
export const LABELS = [
  'a dog', 'a cat', 'a bird', 'a pigeon', 'a squirrel', 'a person', 'a face', 'a crowd of people',
  'a car', 'a bus', 'a truck', 'a bicycle', 'a motorcycle', 'a subway train', 'a taxi',
  'a traffic light', 'a stop sign', 'a fire hydrant', 'a street sign', 'a building', 'a bridge',
  'a tree', 'a flower', 'a plant', 'grass', 'the sky', 'clouds', 'a lamp', 'a window', 'a door',
  'stairs', 'a chair', 'a sofa', 'a bed', 'a table', 'a desk', 'a laptop', 'a computer screen',
  'a phone', 'a keyboard', 'a book', 'a paper document', 'a cup', 'a bottle', 'a plate of food',
  'fruit', 'a bag', 'a shoe', 'a hat', 'a jacket', 'a clock', 'a painting', 'a poster', 'graffiti',
  'a fence', 'a bench', 'trash', 'a camera', 'a mirror', 'a sink', 'a refrigerator', 'a guitar',
  'a pillow', 'a toy', 'a cardboard box', 'text', 'a logo', 'a hand', 'a shadow', 'a light bulb',
];
export const labelPrompt = (l) => `a photo of ${l}`;

export function allPrompts() {
  const set = new Set();
  for (const c of Object.values(CONCEPTS)) for (const pr of [...c.pairs, ...(c.opp || [])]) { set.add(pr[0]); set.add(pr[1]); }
  for (const list of Object.values(PROFILE)) list.forEach((p) => set.add(p));
  LABELS.forEach((l) => set.add(labelPrompt(l)));
  return [...set];
}
