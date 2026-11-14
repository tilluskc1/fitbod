import type { Exercise, GymItemId, SupportEquipment } from '../types';

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
] as const;

/** Primary equipment. Bodyweight is always available and not listed here. */
export const EQUIPMENT_OPTIONS = [
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Kettlebell',
] as const;

/** Support equipment. Owning dumbbells does not imply owning a bench. */
export const SUPPORT_OPTIONS: SupportEquipment[] = [
  'Bench',
  'Rack',
  'Pull-up bar',
  'Dip bars',
  'Box',
  'Ab wheel',
];

/** Fresh onboarding assumes no support gear; a bench is never pre-ticked. */
export const DEFAULT_SUPPORT: SupportEquipment[] = [];

/** (#357) A single-stack cable move also runs on either side of a crossover. */
const CABLE: GymItemId[] = ['cable-stack', 'cable-crossover'];

export const EXERCISES: Exercise[] = [
  // Chest
  { id: 'barbell-bench-press', name: 'Barbell Bench Press', muscles: ['Chest', 'Triceps', 'Shoulders'], equipment: 'Barbell', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['barbell', 'bench'], instructions: 'Lie on a flat bench, grip the bar slightly wider than shoulder width, lower it to mid-chest, then press up until your arms are extended.' },
  { id: 'dumbbell-floor-press', name: 'Dumbbell Floor Press', muscles: ['Chest', 'Triceps', 'Shoulders'], equipment: 'Dumbbell', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['dumbbell'], instructions: 'Lie on your back on the floor with a dumbbell in each hand. Lower until your upper arms touch the floor, pause, then press back up until your arms are straight.' },
  { id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', muscles: ['Chest', 'Triceps', 'Shoulders'], equipment: 'Dumbbell', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['dumbbell', 'bench'], instructions: 'Lie on a flat bench holding dumbbells above your chest. Lower until your elbows are at 90°, then press the weights back up.' },
  { id: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', muscles: ['Chest', 'Shoulders', 'Triceps'], equipment: 'Dumbbell', pattern: 'horizontal_push', secondaryPatterns: ['vertical_push', 'elbow_extension'], needs: ['dumbbell', 'bench'], instructions: 'Set the bench to 30–45°. Press dumbbells from chest level to full extension, keeping your upper back tight.' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', muscles: ['Chest', 'Triceps'], equipment: 'Machine', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['machine'], stations: ['chest-press'], instructions: 'Sit with the handles at chest height and press forward until your arms are nearly straight. Control the return.' },
  { id: 'cable-fly', name: 'Cable Fly', muscles: ['Chest'], equipment: 'Cable', pattern: 'horizontal_push', needs: ['cable'], stations: ['cable-crossover'], instructions: 'Stand between cables at chest height. Bring the handles together in front of you with a slight elbow bend, then return slowly.' },
  { id: 'push-up', name: 'Push-Up', muscles: ['Chest', 'Triceps', 'Shoulders'], equipment: 'Bodyweight', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: [], instructions: 'Keep a straight line from head to heels. Lower your chest to just above the floor, then press back up.' },
  { id: 'dip', name: 'Chest Dip', muscles: ['Chest', 'Triceps'], equipment: 'Bodyweight', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['dip-bars'], instructions: 'On parallel bars, lean slightly forward, lower until your shoulders are below your elbows, then press back up.' },

  // Back
  { id: 'deadlift', name: 'Deadlift', muscles: ['Back', 'Hamstrings', 'Glutes', 'Core'], equipment: 'Barbell', pattern: 'hinge', secondaryPatterns: [], needs: ['barbell'], instructions: 'With the bar over mid-foot, hinge at the hips, grip the bar, and stand up by driving through your legs while keeping your back flat.' },
  { id: 'barbell-row', name: 'Barbell Row', muscles: ['Back', 'Biceps'], equipment: 'Barbell', pattern: 'horizontal_pull', secondaryPatterns: ['elbow_flexion'], needs: ['barbell'], instructions: 'Hinge forward with a flat back, pull the bar to your lower ribs, squeeze your shoulder blades, then lower with control.' },
  { id: 'pull-up', name: 'Pull-Up', muscles: ['Back', 'Biceps'], equipment: 'Bodyweight', pattern: 'vertical_pull', secondaryPatterns: ['elbow_flexion'], needs: ['pull-up-bar'], instructions: 'Hang from a bar with an overhand grip, pull your chin above the bar, then lower fully under control.' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscles: ['Back', 'Biceps'], equipment: 'Cable', pattern: 'vertical_pull', secondaryPatterns: ['elbow_flexion'], needs: ['cable'], stations: ['lat-pulldown'], instructions: 'Grip the bar wider than shoulder width, pull it to your upper chest while driving your elbows down, then return slowly.' },
  { id: 'seated-cable-row', name: 'Seated Cable Row', muscles: ['Back', 'Biceps'], equipment: 'Cable', pattern: 'horizontal_pull', secondaryPatterns: ['elbow_flexion'], needs: ['cable'], stations: ['seated-row', 'cable-stack', 'cable-crossover'], instructions: 'Sit tall, pull the handle to your navel while squeezing your shoulder blades, then extend your arms fully.' },
  { id: 'dumbbell-row', name: 'Dumbbell Row', muscles: ['Back', 'Biceps'], equipment: 'Dumbbell', pattern: 'horizontal_pull', secondaryPatterns: ['elbow_flexion'], needs: ['dumbbell'], instructions: 'Hinge forward with a flat back and a dumbbell in each hand. Pull the weights to your hips, squeeze your shoulder blades, then lower until your arms are straight.' },
  { id: 'face-pull', name: 'Face Pull', muscles: ['Back', 'Shoulders'], equipment: 'Cable', pattern: 'shoulder_horizontal_abduction', needs: ['cable'], stations: CABLE, instructions: 'Set the rope at face height, pull it toward your forehead while flaring your elbows, then return slowly.' },

  // Shoulders
  { id: 'overhead-press', name: 'Overhead Press', muscles: ['Shoulders', 'Triceps'], equipment: 'Barbell', pattern: 'vertical_push', secondaryPatterns: ['elbow_extension'], needs: ['barbell'], instructions: 'From shoulder height, press the bar overhead until your arms lock out, keeping your core braced.' },
  { id: 'dumbbell-shoulder-press', name: 'Dumbbell Shoulder Press', muscles: ['Shoulders', 'Triceps'], equipment: 'Dumbbell', pattern: 'vertical_push', secondaryPatterns: ['elbow_extension'], needs: ['dumbbell'], instructions: 'Seated or standing, press dumbbells from shoulder height to overhead, then lower with control.' },
  { id: 'lateral-raise', name: 'Lateral Raise', muscles: ['Shoulders'], equipment: 'Dumbbell', pattern: 'shoulder_abduction', needs: ['dumbbell'], instructions: 'Raise the dumbbells out to your sides until they reach shoulder height, keeping a slight bend in the elbows.' },
  { id: 'rear-delt-fly', name: 'Rear Delt Fly', muscles: ['Back', 'Shoulders'], equipment: 'Dumbbell', pattern: 'shoulder_horizontal_abduction', secondaryPatterns: [], needs: ['dumbbell'], instructions: 'Hinge forward and raise the dumbbells out to the sides, squeezing your rear delts at the top.' },
  { id: 'arnold-press', name: 'Arnold Press', muscles: ['Shoulders', 'Triceps'], equipment: 'Dumbbell', pattern: 'vertical_push', secondaryPatterns: ['elbow_extension'], needs: ['dumbbell'], instructions: 'Start with palms facing you at shoulder height, rotate outward as you press overhead, then reverse.' },

  // Biceps
  { id: 'barbell-curl', name: 'Barbell Curl', muscles: ['Biceps'], equipment: 'Barbell', pattern: 'elbow_flexion', needs: ['barbell'], instructions: 'Curl the bar from thigh level to shoulder height while keeping your elbows pinned to your sides.' },
  { id: 'dumbbell-curl', name: 'Dumbbell Curl', muscles: ['Biceps'], equipment: 'Dumbbell', pattern: 'elbow_flexion', needs: ['dumbbell'], instructions: 'Curl the dumbbells while supinating your wrists, then lower slowly to full extension.' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscles: ['Biceps'], equipment: 'Dumbbell', pattern: 'elbow_flexion', needs: ['dumbbell'], instructions: 'Hold the dumbbells with a neutral grip and curl them without rotating your wrists.' },
  { id: 'cable-curl', name: 'Cable Curl', muscles: ['Biceps'], equipment: 'Cable', pattern: 'elbow_flexion', needs: ['cable'], stations: CABLE, instructions: 'Stand facing the cable and curl the bar to your shoulders, keeping constant tension.' },
  { id: 'chin-up', name: 'Chin-Up', muscles: ['Biceps', 'Back'], equipment: 'Bodyweight', pattern: 'vertical_pull', secondaryPatterns: ['elbow_flexion'], needs: ['pull-up-bar'], instructions: 'Hang with an underhand grip and pull your chin above the bar, then lower fully.' },

  // Triceps
  { id: 'triceps-pushdown', name: 'Triceps Pushdown', muscles: ['Triceps'], equipment: 'Cable', pattern: 'elbow_extension', needs: ['cable'], stations: CABLE, instructions: 'With elbows at your sides, push the bar down until your arms are straight, then return slowly.' },
  { id: 'overhead-triceps-extension', name: 'Overhead Triceps Extension', muscles: ['Triceps'], equipment: 'Cable', pattern: 'elbow_extension', needs: ['cable'], stations: CABLE, instructions: 'Hold the rope behind your head and extend your elbows fully, keeping your upper arms still.' },
  { id: 'dumbbell-overhead-triceps-extension', name: 'Dumbbell Overhead Triceps Extension', muscles: ['Triceps'], equipment: 'Dumbbell', pattern: 'elbow_extension', needs: ['dumbbell'], instructions: 'Hold one dumbbell overhead with both hands. Bend your elbows to lower it behind your head, keeping your upper arms still, then straighten your arms to lift it back up.' },
  { id: 'skull-crusher', name: 'Skull Crusher', muscles: ['Triceps'], equipment: 'Barbell', pattern: 'elbow_extension', needs: ['barbell', 'bench'], instructions: 'Lie on a bench and lower the bar toward your forehead by bending your elbows, then extend back up.' },
  { id: 'close-grip-bench', name: 'Close-Grip Bench Press', muscles: ['Triceps', 'Chest'], equipment: 'Barbell', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: ['barbell', 'bench'], instructions: 'Bench press with a shoulder-width grip, keeping your elbows tucked to emphasize the triceps.' },
  { id: 'diamond-push-up', name: 'Diamond Push-Up', muscles: ['Triceps', 'Chest'], equipment: 'Bodyweight', pattern: 'horizontal_push', secondaryPatterns: ['elbow_extension'], needs: [], instructions: 'Place your hands close together under your chest and perform a push-up, keeping your elbows tight.' },

  // Quads
  { id: 'back-squat', name: 'Back Squat', muscles: ['Quads', 'Glutes', 'Core'], equipment: 'Barbell', pattern: 'squat', secondaryPatterns: [], needs: ['barbell', 'rack'], instructions: 'With the bar on your upper back, squat until your thighs are at least parallel, then drive up through your heels.' },
  { id: 'front-squat', name: 'Front Squat', muscles: ['Quads', 'Core'], equipment: 'Barbell', pattern: 'squat', secondaryPatterns: [], needs: ['barbell', 'rack'], instructions: 'Rest the bar on your front delts, squat with an upright torso, then stand back up.' },
  { id: 'leg-press', name: 'Leg Press', muscles: ['Quads', 'Glutes'], equipment: 'Machine', pattern: 'squat', secondaryPatterns: [], needs: ['machine'], stations: ['leg-press'], instructions: 'Press the platform away until your legs are nearly straight, then lower until your knees reach 90°.' },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscles: ['Quads', 'Glutes'], equipment: 'Dumbbell', pattern: 'lunge', secondaryPatterns: ['squat'], needs: ['dumbbell', 'bench'], instructions: 'With your rear foot elevated, lower your back knee toward the floor, then drive up through your front leg.' },
  { id: 'walking-lunge', name: 'Walking Lunge', muscles: ['Quads', 'Glutes', 'Hamstrings'], equipment: 'Dumbbell', pattern: 'lunge', secondaryPatterns: ['squat'], needs: ['dumbbell'], instructions: 'Step forward into a lunge, then bring your back leg through into the next step.' },
  { id: 'leg-extension', name: 'Leg Extension', muscles: ['Quads'], equipment: 'Machine', pattern: 'knee_extension', needs: ['machine'], stations: ['leg-extension'], instructions: 'Extend your knees fully against the pad, pause, then lower with control.' },
  { id: 'goblet-squat', name: 'Goblet Squat', muscles: ['Quads', 'Glutes', 'Core'], equipment: 'Dumbbell', pattern: 'squat', secondaryPatterns: [], needs: ['dumbbell'], instructions: 'Hold one dumbbell at your chest and squat between your hips, keeping your chest tall. The same movement works with a kettlebell.' },
  { id: 'kettlebell-goblet-squat', name: 'Kettlebell Goblet Squat', muscles: ['Quads', 'Glutes', 'Core'], equipment: 'Kettlebell', pattern: 'squat', secondaryPatterns: [], needs: ['kettlebell'], instructions: 'Hold a kettlebell at your chest and squat between your hips, keeping your chest tall.' },
  { id: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian Deadlift', muscles: ['Hamstrings', 'Glutes', 'Back'], equipment: 'Dumbbell', pattern: 'hinge', secondaryPatterns: [], needs: ['dumbbell'], instructions: 'Hold a dumbbell in each hand in front of your thighs. Push your hips back with soft knees and a flat back until you feel your hamstrings stretch, then drive your hips forward to stand.' },
  { id: 'dumbbell-calf-raise', name: 'Standing Dumbbell Calf Raise', muscles: ['Calves'], equipment: 'Dumbbell', pattern: 'calf_raise', secondaryPatterns: [], needs: ['dumbbell'], instructions: 'Stand tall with a dumbbell in each hand. Rise onto the balls of your feet as high as you can, pause, then lower your heels slowly.' },
  { id: 'dumbbell-pullover', name: 'Dumbbell Pullover', muscles: ['Back', 'Chest'], equipment: 'Dumbbell', pattern: 'vertical_pull', secondaryPatterns: [], needs: ['dumbbell', 'bench'], instructions: 'Lie across a bench holding one dumbbell over your chest with both hands. With a slight bend in your elbows, lower it behind your head until you feel your lats stretch, then pull it back over your chest.' },
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', muscles: ['Glutes', 'Hamstrings', 'Back'], equipment: 'Kettlebell', pattern: 'hinge', secondaryPatterns: [], needs: ['kettlebell'], instructions: 'Hinge and hike the kettlebell back between your legs, then snap your hips forward so it floats to chest height. Let it fall back into the next hinge; the arms only guide it.' },
  { id: 'kettlebell-row', name: 'Kettlebell Row', muscles: ['Back', 'Biceps'], equipment: 'Kettlebell', pattern: 'horizontal_pull', secondaryPatterns: ['elbow_flexion'], needs: ['kettlebell'], instructions: 'Hinge forward with a flat back, one hand braced on your thigh. Row the kettlebell to your hip, squeeze your shoulder blade, then lower until your arm is straight.' },
  { id: 'kettlebell-press', name: 'Kettlebell Overhead Press', muscles: ['Shoulders', 'Triceps'], equipment: 'Kettlebell', pattern: 'vertical_push', secondaryPatterns: ['elbow_extension'], needs: ['kettlebell'], instructions: 'Hold the kettlebell at your shoulder in the rack position. Brace your glutes and press it straight overhead, then lower it back to your shoulder under control.' },
  { id: 'bodyweight-squat', name: 'Bodyweight Squat', muscles: ['Quads', 'Glutes'], equipment: 'Bodyweight', pattern: 'squat', secondaryPatterns: [], needs: [], instructions: 'Stand with feet shoulder-width apart. Sit your hips back and down until your thighs are at least parallel, keeping your chest tall, then stand up.' },
  { id: 'bodyweight-lunge', name: 'Bodyweight Lunge', muscles: ['Quads', 'Glutes'], equipment: 'Bodyweight', pattern: 'lunge', secondaryPatterns: [], needs: [], instructions: 'Step forward and lower until both knees are bent to about 90 degrees, front knee over the foot. Push through the front heel to step into the next lunge.' },

  // Hamstrings
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', muscles: ['Hamstrings', 'Glutes', 'Back'], equipment: 'Barbell', pattern: 'hinge', secondaryPatterns: [], needs: ['barbell'], instructions: 'With a slight knee bend, hinge at the hips and lower the bar along your legs, then drive your hips forward to stand.' },
  { id: 'leg-curl', name: 'Leg Curl', muscles: ['Hamstrings'], equipment: 'Machine', pattern: 'knee_flexion', needs: ['machine'], stations: ['leg-curl'], instructions: 'Curl the pad toward your glutes, squeezing your hamstrings, then lower slowly.' },
  { id: 'good-morning', name: 'Good Morning', muscles: ['Hamstrings', 'Glutes', 'Back'], equipment: 'Barbell', pattern: 'hinge', secondaryPatterns: [], needs: ['barbell', 'rack'], instructions: 'With the bar on your back, hinge forward until your torso is near parallel, then return.' },
  { id: 'nordic-curl', name: 'Nordic Curl', muscles: ['Hamstrings'], equipment: 'Bodyweight', pattern: 'knee_flexion', secondaryPatterns: [], needs: [], instructions: 'Kneel with your ankles anchored and lower your torso forward slowly, resisting with your hamstrings, then pull back.' },

  // Glutes
  { id: 'hip-thrust', name: 'Hip Thrust', muscles: ['Glutes', 'Hamstrings'], equipment: 'Barbell', pattern: 'hip_extension', secondaryPatterns: [], needs: ['barbell', 'bench'], instructions: 'With your upper back on a bench and the bar over your hips, thrust up until your body is straight, then lower.' },
  { id: 'glute-bridge', name: 'Glute Bridge', muscles: ['Glutes', 'Hamstrings'], equipment: 'Bodyweight', pattern: 'hip_extension', secondaryPatterns: [], needs: [], instructions: 'Lie on your back and drive your hips up, squeezing your glutes, then lower slowly.' },
  { id: 'cable-kickback', name: 'Cable Kickback', muscles: ['Glutes'], equipment: 'Cable', pattern: 'hip_extension', needs: ['cable'], stations: CABLE, instructions: 'With the ankle strap attached, kick your leg back while keeping your torso still.' },
  { id: 'step-up', name: 'Step-Up', muscles: ['Glutes', 'Quads'], equipment: 'Dumbbell', pattern: 'lunge', secondaryPatterns: ['squat'], needs: ['dumbbell', 'box'], instructions: 'Step onto a box or bench, driving through the working leg, then step down under control.' },

  // Calves
  { id: 'standing-calf-raise', name: 'Standing Calf Raise', muscles: ['Calves'], equipment: 'Machine', pattern: 'calf_raise', needs: ['machine'], stations: ['calf-raise-machine'], instructions: 'Rise onto your toes as high as possible, pause, then lower your heels below the platform.' },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', muscles: ['Calves'], equipment: 'Machine', pattern: 'calf_raise', needs: ['machine'], stations: ['calf-raise-machine'], instructions: 'With your knees bent, raise your heels against the pad, pause, then lower slowly.' },

  // Core
  { id: 'plank', name: 'Plank', muscles: ['Core'], equipment: 'Bodyweight', pattern: 'core_stability', needs: [], instructions: 'Hold a straight line from head to heels on your forearms, bracing your core.' },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', muscles: ['Core'], equipment: 'Bodyweight', pattern: 'core_flexion', needs: ['pull-up-bar'], instructions: 'Hang from a bar and raise your legs to hip height or higher, then lower with control.' },
  { id: 'cable-crunch', name: 'Cable Crunch', muscles: ['Core'], equipment: 'Cable', pattern: 'core_flexion', needs: ['cable'], stations: CABLE, instructions: 'Kneel facing the cable and crunch your torso down, keeping your hips fixed.' },
  { id: 'russian-twist', name: 'Russian Twist', muscles: ['Core'], equipment: 'Bodyweight', pattern: 'core_flexion', needs: [], instructions: 'Seated with your torso leaned back, rotate side to side, optionally holding a weight.' },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', muscles: ['Core'], equipment: 'Bodyweight', pattern: 'core_stability', secondaryPatterns: ['core_flexion'], needs: ['ab-wheel'], instructions: 'From your knees, roll the wheel forward while keeping your core braced, then pull back.' },
];

/**
 * Variations that train the same thing the same way. A day never holds two
 * from one group; the swap list skips them for the same reason.
 */
export const INCOMPATIBLE_GROUPS: string[][] = [
  ['push-up', 'diamond-push-up'],
  ['dumbbell-floor-press', 'dumbbell-bench-press'],
  ['dumbbell-overhead-triceps-extension', 'overhead-triceps-extension'],
  ['deadlift', 'romanian-deadlift', 'dumbbell-romanian-deadlift'],
  ['dumbbell-row', 'kettlebell-row'],
  ['arnold-press', 'dumbbell-shoulder-press', 'overhead-press', 'kettlebell-press'],
  ['goblet-squat', 'kettlebell-goblet-squat', 'bodyweight-squat'],
  ['walking-lunge', 'bodyweight-lunge'],
];

export function areIncompatible(a: string, b: string): boolean {
  return a !== b && INCOMPATIBLE_GROUPS.some((group) => group.includes(a) && group.includes(b));
}

/**
 * (#360) Additions unpublished since this phone cached them: readable by id so history keeps their name,
 * photo and units, but never in `EXERCISES`, so planning, Switch and Replace never offer them.
 */
export const RETIRED_EXERCISES = new Map<string, Exercise>();

export function exerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id) ?? RETIRED_EXERCISES.get(id);
}
