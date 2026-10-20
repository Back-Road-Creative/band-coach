// Spanish level names. The English names stay the source of truth in the
// MODS / instrument records (progress, tests and stage ids key off them); this
// map is looked up by the exact English name at the moment a name is shown.
// Pure -- no DOM, no state: the caller passes the active locale. A name with
// no entry falls back to English, never to a blank. Note letters (C, D, E)
// stay letters: level names do not follow Settings > Note names.

const STRINGS = { 'Low E': 'E grave', 'A': 'A', 'D': 'D', 'G': 'G', 'B': 'B', 'High E': 'E aguda', 'E': 'E', 'C': 'C' };
const stringNames = {};
for (const [en, es] of Object.entries(STRINGS)) {
  stringNames[en + ' string, frets 1 to 5'] = 'Cuerda ' + es + ', trastes 1 a 5';
  stringNames[en + ' string, up the neck'] = 'Cuerda ' + es + ', subiendo por el mástil';
  stringNames[en + ' string, positions 1 to 5'] = 'Cuerda ' + es + ', posiciones 1 a 5';
}

export const es = Object.assign({}, stringNames, {
  'C, D and E': 'C, D y E',
  'Add F and G': 'Añade F y G',
  'Add A, B and high C': 'Añade A, B y C agudo',
  'Black keys: F sharp and B flat': 'Teclas negras: F sostenido y B bemol',
  'Black keys: C sharp, E flat, A flat': 'Teclas negras: C sostenido, E bemol, A bemol',
  'Moves: two notes': 'Movimientos: dos notas',
  'Moves: three notes': 'Movimientos: tres notas',
  'The octave below': 'La octava de abajo',
  'Five-note runs': 'Escalas de cinco notas',
  'Chords: C, F and G': 'Acordes: C, F y G',
  'Chords: A minor, D minor, E minor': 'Acordes: A menor, D menor, E menor',
  'Chord changes': 'Cambios de acorde',
  'Hands together: five-finger position (MIDI exact, mic approximate)': 'Manos juntas: posición de cinco dedos (MIDI exacto, micrófono aproximado)',
  'Hands together: matching rhythms (MIDI or computer keys)': 'Manos juntas: ritmos iguales (MIDI o teclas del ordenador)',
  'Hands together: held bass under the melody (MIDI or computer keys)': 'Manos juntas: bajo sostenido bajo la melodía (MIDI o teclas del ordenador)',
  'Hands together: different rhythms in each hand (MIDI or computer keys)': 'Manos juntas: ritmos distintos en cada mano (MIDI o teclas del ordenador)',
  'Hands together: hand position change (MIDI or computer keys)': 'Manos juntas: cambio de posición de la mano (MIDI o teclas del ordenador)',
  'The open strings': 'Las cuerdas al aire',
  'Find it by name, no dot': 'Encuéntrala por su nombre, sin marca',
  'Sharps and flats by name': 'Sostenidos y bemoles por su nombre',
  'First chords (listening is experimental)': 'Primeros acordes (la escucha es experimental)',
  'More chords': 'Más acordes',
  'Match a note: Do, Re, Mi': 'Iguala una nota: Do, Re, Mi',
  'Add Fa and Sol': 'Añade Fa y Sol',
  'Add La, Ti and high Do': 'Añade La, Si y Do agudo',
  'From Do only: find the note yourself': 'Solo desde Do: encuentra la nota tú mismo',
  'Two notes in a row': 'Dos notas seguidas',
  'Long tones: hold it steady for two seconds': 'Notas largas: sostenla firme dos segundos',
  'Three notes in a row': 'Tres notas seguidas',
  'The notes in between': 'Las notas intermedias',
  'First three notes': 'Las tres primeras notas',
  'Two more, going up': 'Dos más, subiendo',
  'Going down': 'Bajando',
  'Down to low C': 'Hasta el C grave',
  'F sharp and B flat': 'F sostenido y B bemol',
  'Long tones: two steady seconds': 'Notas largas: dos segundos firmes',
  'The upper notes': 'Las notas agudas',
  'Second, third or fifth (going up)': 'Segunda, tercera o quinta (subiendo)',
  'Add the fourth and the octave': 'Añade la cuarta y la octava',
  'Add the minor third and minor second': 'Añade la tercera menor y la segunda menor',
  'Add the sixths, tritone and sevenths': 'Añade las sextas, el tritono y las séptimas',
  'Both notes at once': 'Las dos notas a la vez',
  'Major or minor chord': 'Acorde mayor o menor',
  'Add diminished and augmented': 'Añade disminuido y aumentado',
  'Seventh chords': 'Acordes de séptima',
  'Quarter notes and rests': 'Negras y silencios',
  'Add pairs of eighths': 'Añade pares de corcheas',
  'Add half notes': 'Añade blancas',
  'The off-beat eighth': 'La corchea a contratiempo',
  'Dotted quarter and eighth': 'Negra con puntillo y corchea',
  'Sixteenth notes': 'Semicorcheas',
  'Eighth and two sixteenths': 'Corchea y dos semicorcheas',
  'Syncopation': 'Síncopa',
  'Rests: halves and wholes': 'Silencios: de blanca y de redonda',
  'Ties': 'Ligaduras',
  'Dotted eighth and sixteenth': 'Corchea con puntillo y semicorchea',
  'Triplets': 'Tresillos',
  'Three-four time': 'Compás de tres por cuatro',
  'Six-eight time': 'Compás de seis por ocho',
  'Swing eighths': 'Corcheas en swing',
  'Two-bar phrases': 'Frases de dos compases',
  'First three notes: B, A, G': 'Las tres primeras notas: B, A, G',
  'Two more, going up: high C and D': 'Dos más, subiendo: C y D agudos',
  'Going down: E': 'Bajando: E',
  'Down to low D and C': 'Hasta el D y el C graves',
  'The tricky note: F (forked fingering)': 'La nota difícil: F (digitación en horquilla)',
  'First three notes: D, E, F sharp': 'Las tres primeras notas: D, E, F sostenido',
  'Two more, going up: G and A': 'Dos más, subiendo: G y A',
  'Finishing the octave: B and C sharp': 'Completar la octava: B y C sostenido',
  'The top of the octave: high D': 'El final de la octava: D agudo',
  'Sharps and flats: F sharp and B flat': 'Sostenidos y bemoles: F sostenido y B bemol',
  'Sharps and flats: C sharp, E flat, A flat': 'Sostenidos y bemoles: C sostenido, E bemol, A bemol',
  'Up an octave': 'Subir una octava',
  'Written C, D and E': 'C, D y E escritas',
  'Written G, A and B': 'G, A y B escritas',
  'Add C and D': 'Añade C y D',
  'Add E, F and high G': 'Añade E, F y G agudo',
  'Sharps and flats: C sharp and F sharp': 'Sostenidos y bemoles: C sostenido y F sostenido',
  'Up to the top': 'Hasta arriba del todo',
  'Written D, E and F sharp': 'D, E y F sostenido escritas',
  'Add G and A': 'Añade G y A',
  'Add B, C sharp and high D': 'Añade B, C sostenido y D agudo',
  'Sharps and flats: E flat and G sharp': 'Sostenidos y bemoles: E bemol y G sostenido',
  'Sharps and flats: A flat and C sharp': 'Sostenidos y bemoles: A bemol y C sostenido',
  'Written B flat, B and C': 'B bemol, B y C escritas',
  'Add D and E': 'Añade D y E',
  'Add F, F sharp and high G': 'Añade F, F sostenido y G agudo',
  'Sharps and flats: E flat and C sharp': 'Sostenidos y bemoles: E bemol y C sostenido',
  'One drum at a time': 'Un tambor cada vez',
  'Bass drum and snare on the beat': 'Bombo y caja al tiempo',
  'Rock beat: eighths on the hi-hat': 'Ritmo de rock: corcheas en el hi-hat',
  'Bass drum variations': 'Variaciones del bombo',
  'Fills around the toms': 'Rellenos por los toms',
  'Snare rudiments: singles, doubles, paradiddle, flam': 'Rudimentos de caja: sencillos, dobles, paradiddle, flam',
  'Swing ride pattern': 'Patrón de swing en el ride',
  'Blow holes 4, 5 and 6': 'Soplar en los agujeros 4, 5 y 6',
  'Draw holes 4, 5 and 6': 'Aspirar en los agujeros 4, 5 y 6',
  'Moves: blow to draw': 'Movimientos: de soplar a aspirar',
  'Hole 7 completes the scale': 'El agujero 7 completa la escala',
  'Scale runs of three': 'Escalas de tres notas',
  'The low end: holes 1 to 3': 'Los graves: agujeros 1 a 3',
  'The top end: holes 8 to 10': 'Los agudos: agujeros 8 a 10',
  'Runs of four': 'Escalas de cuatro notas',
  'Easy bends: one semitone down': 'Bends fáciles: un semitono hacia abajo',
  'Moderate bends: two semitones down': 'Bends medios: dos semitonos hacia abajo',
  'The deepest bend: hole 3, three semitones down': 'El bend más profundo: agujero 3, tres semitonos hacia abajo',
  'Your captured melody': 'Tu melodía capturada',
});

// "Everything, faster (N)" is built by levelDef for levels past the last staged one.
const FASTER = /^Everything, faster \((\d+)\)$/;

// The level's name in `locale`; English (the name itself) when the locale is
// not Spanish or the name has no entry.
export function levelLabel(name, locale) {
  if (locale !== 'es' || typeof name !== 'string') return name;
  const m = FASTER.exec(name);
  if (m) return 'Todo, más rápido (' + m[1] + ')';
  return Object.prototype.hasOwnProperty.call(es, name) ? es[name] : name;
}

export function levelNumLabel(n, locale) {
  return (locale === 'es' ? 'Nivel ' : 'Level ') + n;
}
