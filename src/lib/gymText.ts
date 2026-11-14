import { orderedItems } from '../data/gymItems.ts';
import type { GymItemId } from '../types';

/**
 * (#357) "What does your gym have?" read on the phone. Best effort (lesson 3): the chips are the truth
 * and the lifter fixes them with a tap. Phrases are matched longest first and each stretch of text is
 * used once, so "leg extension" never also reads as "leg ext", and "bench press machine" is a chest press,
 * not a bench. A phrase mapped to nothing (a rowing machine is cardio) only uses up its words.
 */
const PHRASES: [string, GymItemId[]][] = [
  // Read as nothing: cardio and words that look like kit.
  ['rowing machine', []], ['row erg', []], ['erg', []], ['treadmill', []], ['bike', []], ['elliptical', []],
  ['stair', []], ['bands', []], ['band', []],

  ['leg press machine', ['leg-press']], ['leg press', ['leg-press']], ['legpress', ['leg-press']], ['leg sled', ['leg-press']],
  ['leg extensions', ['leg-extension']], ['leg extension', ['leg-extension']], ['leg extention', ['leg-extension']],
  ['leg ext', ['leg-extension']], ['quad extension', ['leg-extension']], ['knee extension', ['leg-extension']],
  ['hamstring curl', ['leg-curl']], ['ham curl', ['leg-curl']], ['lying leg curl', ['leg-curl']], ['seated leg curl', ['leg-curl']],
  ['leg curls', ['leg-curl']], ['leg curl', ['leg-curl']],
  ['hip thrust machine', ['hip-thrust-machine']], ['hip thrust', ['hip-thrust-machine']], ['glute drive', ['hip-thrust-machine']],
  ['glute machine', ['hip-thrust-machine']], ['glute bridge machine', ['hip-thrust-machine']],
  ['calf raise machine', ['calf-raise-machine']], ['calf raise', ['calf-raise-machine']], ['calf machine', ['calf-raise-machine']],
  ['seated calf', ['calf-raise-machine']], ['standing calf', ['calf-raise-machine']], ['calves machine', ['calf-raise-machine']],
  ['hack squat', ['hack-squat']], ['hack', ['hack-squat']],
  ['smith machine', ['smith-machine']], ['smith', ['smith-machine']],
  ['chest press machine', ['chest-press']], ['bench press machine', ['chest-press']], ['machine chest press', ['chest-press']],
  ['chest press', ['chest-press']], ['machine press', ['chest-press']],
  ['pec deck', ['pec-deck']], ['pec dec', ['pec-deck']], ['peck deck', ['pec-deck']], ['pec fly', ['pec-deck']],
  ['fly machine', ['pec-deck']], ['chest fly machine', ['pec-deck']], ['rear delt machine', ['pec-deck']], ['butterfly', ['pec-deck']],
  ['shoulder press machine', ['shoulder-press-machine']], ['machine shoulder press', ['shoulder-press-machine']],
  ['overhead press machine', ['shoulder-press-machine']], ['shoulder press', ['shoulder-press-machine']],
  ['lat pulldown', ['lat-pulldown']], ['lat pull down', ['lat-pulldown']], ['lat pulldowns', ['lat-pulldown']],
  ['pulldown machine', ['lat-pulldown']], ['pulldown', ['lat-pulldown']], ['pull down', ['lat-pulldown']], ['lat machine', ['lat-pulldown']],
  ['seated cable row', ['seated-row']], ['seated row machine', ['seated-row']], ['seated row', ['seated-row']],
  ['row machine', ['seated-row']], ['cable row', ['seated-row']], ['low row', ['seated-row']],
  ['assisted pull up machine', ['assisted-pull-up']], ['assisted pull up', ['assisted-pull-up']], ['assisted pullup', ['assisted-pull-up']],
  ['assisted chin', ['assisted-pull-up']], ['assisted dip', ['assisted-pull-up']], ['gravitron', ['assisted-pull-up']],
  ['cable crossover', ['cable-crossover']], ['cable cross over', ['cable-crossover']], ['crossover', ['cable-crossover']],
  ['cable cross', ['cable-crossover']], ['dual cable', ['cable-crossover']], ['double cable', ['cable-crossover']],
  ['dual pulley', ['cable-crossover']], ['functional trainer', ['cable-crossover']],
  ['cable stack', ['cable-stack']], ['cable machine', ['cable-stack']], ['cable station', ['cable-stack']],
  ['single cable', ['cable-stack']], ['cable tower', ['cable-stack']], ['pulley', ['cable-stack']], ['cables', ['cable-stack']], ['cable', ['cable-stack']],
  ['dumbbells', ['dumbbells']], ['dumbbell', ['dumbbells']], ['dumbells', ['dumbbells']], ['dumbell', ['dumbbells']],
  ['dumb bells', ['dumbbells']], ['dbs', ['dumbbells']], ['db', ['dumbbells']],
  ['barbells', ['barbell']], ['barbell', ['barbell']], ['bar bell', ['barbell']], ['olympic bar', ['barbell']],
  ['kettlebells', ['kettlebells']], ['kettlebell', ['kettlebells']], ['kettle bells', ['kettlebells']], ['kettle bell', ['kettlebells']],
  ['kbs', ['kettlebells']], ['kb', ['kettlebells']],
  ['power tower', ['pull-up-bar', 'dip-bars']], ['captains chair', ['pull-up-bar', 'dip-bars']],
  ['squat rack', ['squat-rack']], ['power rack', ['squat-rack']], ['half rack', ['squat-rack']], ['squat cage', ['squat-rack']],
  ['power cage', ['squat-rack']], ['squat stand', ['squat-rack']], ['racks', ['squat-rack']], ['rack', ['squat-rack']], ['cage', ['squat-rack']],
  ['benches', ['bench']], ['bench', ['bench']],
  ['pull up bar', ['pull-up-bar']], ['pullup bar', ['pull-up-bar']], ['chin up bar', ['pull-up-bar']], ['chinup bar', ['pull-up-bar']],
  ['pull up', ['pull-up-bar']], ['pullup', ['pull-up-bar']], ['chin up', ['pull-up-bar']],
  ['dip bars', ['dip-bars']], ['dip bar', ['dip-bars']], ['dip station', ['dip-bars']], ['parallel bars', ['dip-bars']], ['dips', ['dip-bars']],
  ['plyo box', ['box']], ['jump box', ['box']], ['step box', ['box']], ['boxes', ['box']], ['box', ['box']],
  ['ab wheel', ['ab-wheel']], ['ab roller', ['ab-wheel']], ['ab wheels', ['ab-wheel']],
];

/** Lower case, hyphens and punctuation to spaces, one space between words, apostrophes dropped. */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

const ORDERED = [...PHRASES]
  .map(([phrase, items]) => [normalise(phrase), items] as const)
  .sort((a, b) => b[0].length - a[0].length);

/** The items the text names, in list order. Nothing found is an empty list, never a guess. */
export function readGymText(text: string): GymItemId[] {
  let rest = normalise(text);
  const found = new Set<GymItemId>();
  for (const [phrase, items] of ORDERED) {
    while (rest.includes(phrase)) {
      for (const item of items) found.add(item);
      // Keep the spaces on both sides so the words around it still stand alone.
      rest = rest.replace(phrase, ' | ');
    }
  }
  return orderedItems(found);
}
