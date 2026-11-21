// Every text prompt the INTENT module (MobileCLIP-S0) can compare a photo against.
// tools/embed_prompts.mjs turns each string into a text embedding ahead of time
// (data/prompt-embeddings.json), so the phone only ever runs the small image encoder.
// After editing this file: cd tools && npm run embed

// Plain scene descriptions. They are the "nothing special" side of every zero-shot test:
// a concept only counts when it beats all of these.
export const GENERIC = [
  'a photo of a street', 'a photo of a sidewalk', 'a photo of a building', 'a photo of a room',
  'a photo of a wall', 'a photo of a floor', 'a photo of a ceiling', 'a photo of the sky',
  'a photo of a tree', 'a photo of a car', 'a photo of a table', 'a photo of a chair',
  'a photo of a desk', 'a photo of a window', 'a photo of a door', 'a photo of a person',
  'a photo of a man', 'a photo of a woman', 'a photo of people walking', 'a photo of a face',
  'a photo of a hand', 'a photo of an object', 'a photo of a screen', 'a photo of a phone',
  'a photo of a bag', 'a photo of food', 'a photo of a plant', 'a photo of a sign',
  'a blurry photo', 'a dark photo',
];

// Abstract requests. pos = what the Office asked for; neg = its opposites.
export const CONCEPTS = {
  sadness: {
    pos: ['a photo of a sad person', 'a photo of a person crying', 'a sad and gloomy scene', 'a person looking down, feeling sad'],
    neg: ['a photo of a happy person', 'a photo of a person smiling', 'a cheerful and bright scene'],
  },
  alone: {
    pos: ['a photo of a person alone', 'a single person by themselves', 'a lonely person sitting alone'],
    neg: ['a photo of a group of people', 'a photo of two people talking', 'a photo of a crowd', 'an empty place with no people'],
  },
  waiting: {
    pos: ['a person waiting', 'a person standing and waiting', 'a person waiting for a bus or a train', 'a person sitting and waiting'],
    neg: ['a person walking', 'a person running', 'a person working'],
  },
  hurry: {
    pos: ['a person in a hurry', 'a person rushing down the street', 'a person running', 'a motion-blurred person walking fast'],
    neg: ['a person standing still', 'a person sitting down', 'a person waiting'],
  },
  tired: {
    pos: ['a tired person', 'an exhausted person', 'a person yawning', 'a person sleeping'],
    neg: ['an energetic person', 'a happy, alert person'],
  },
  outofplace: {
    pos: ['an object that is out of place', 'something strange that does not belong here', 'an unusual object in an ordinary place', 'a weird thing'],
    neg: [],
  },
  notbelong: {
    pos: ['a person who looks out of place', 'a stranger who does not fit in here', 'a person who looks lost', 'an unusual looking person'],
    neg: ['a person who fits in', 'an ordinary person in an ordinary place'],
  },
  suspicious: {
    pos: ['something suspicious', 'a suspicious person', 'a suspicious package left alone', 'a person hiding something'],
    neg: ['an ordinary object', 'an ordinary person'],
  },
  abandoned: {
    pos: ['an abandoned object', 'something left behind', 'a lost item on the ground', 'an abandoned, empty place'],
    neg: ['an object being used', 'a clean, tidy place'],
  },
  hiding: {
    pos: ['a hiding place', 'a dark corner', 'a place where someone could hide', 'a narrow, dark alley'],
    neg: ['an open, bright space', 'a well lit room'],
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
  const set = new Set(GENERIC);
  for (const c of Object.values(CONCEPTS)) { c.pos.forEach((p) => set.add(p)); c.neg.forEach((p) => set.add(p)); }
  for (const list of Object.values(PROFILE)) list.forEach((p) => set.add(p));
  LABELS.forEach((l) => set.add(labelPrompt(l)));
  return [...set];
}
