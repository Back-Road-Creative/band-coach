// i18n scaffold -- English and Spanish (es, below) ship. This is the seam a locale
// plugs into, not a translation sweep: today it carries the strings that
// have already been moved through t() (see src/app.js's options/backup/
// update-check area), and grows as more slices convert. Pure -- no DOM,
// no AudioContext -- so callers own rendering, this only owns text.
//
// Every id is a stable dotted string (never the English text itself, so a
// later locale can key off it without caring what English says). A missing
// id must never throw or blank the UI -- the id itself comes back, which is
// ugly but visible and debuggable, never a silent hole. A missing {param}
// is left in the string verbatim for the same reason: better a visible
// placeholder than text that quietly loses information.
export const en = {
  // Shown when a save to this device's storage did not actually take (full
  // quota, private browsing, or storage disabled outright) -- writeDB() in
  // src/app.js verifies every write by reading it back rather than trusting
  // that localStorage.setItem not throwing means it worked (see
  // src/core/storage.js's safeSet). Cleared the moment a later save
  // succeeds, so it never outlives the problem it describes.
  'storage.saveFailed': "Your progress just now could not be saved on this device (storage may be full, or private browsing may be blocking it). Keep playing -- I'll keep trying to save.",
  'backup.saved': 'Backup saved to your downloads. Keep that file somewhere safe.',
  'backup.restored': 'Backup restored.',
  'backup.readError': 'That file could not be read.',
  'backup.confirmRestore': 'Restore this backup? It will replace your current progress.',
  'reset.confirm': 'Reset {name}? This clears your level and progress on it for good. Save a backup first if you might want it back.',
  'backup.err.unreadable': 'That file could not be read.',
  'backup.err.tooLarge': 'That backup file is too large to be a Band Coach backup.',
  'backup.err.notBackup': 'That does not look like a Band Coach backup file.',
  'backup.err.tooNew': 'This backup was made by a newer Band Coach. Update the app to restore it.',
  'backup.err.noProgress': 'That backup file has no saved progress in it, so nothing was changed.',
  'backup.err.damagedSong': 'That backup file has a damaged song in it, so nothing was changed.',
  'backup.err.songsNotStored': 'Nothing was changed: the saved songs in this backup could not be stored on this device.',
  'backup.err.notSaved': 'Your restored progress could not be saved on this device (storage may be full).',
  'reset.progressCleared': '{name} progress cleared. Back to level 1.',
  'audio.stoppedTitle': 'Sound stopped',
  'audio.stoppedWhy': 'Your device paused the sound (a call, a headphone change or another app). Press Resume to carry on.',
  'audio.tapToResume': 'Tap to resume sound.',
  // Keyboard mod's help panel text. States BOTH computer-key rows in plain
  // words -- a w s e d f t g y h u j k play C4 up to C5, z x c v b n m play
  // C3 up to B3 -- and says outright that this is screen and computer-key
  // practice, never a claim of a real keyboard (see src/core/pckeys.js for
  // the mapping this describes).
  // hintFor()'s truthful fallback for any mod that draws a hand-built staff
  // (MODS[mod].staff === true) and nothing else -- no lit-key diagram, no
  // fretboard, no hole diagram. Read the staff, not a key: this must never
  // say a key is "lit up" on a screen that never drew one.
  'hint.staffNote': 'Read {label} on the staff and play it. Hold it steady.',
  'kbd.help': 'Keyboard: plug in a MIDI keyboard and press Connect, or click the keys on screen, or use the computer keys as screen and computer-key practice (not a real keyboard) -- a w s e d f t g y h u j k play C4 up to C5, and z x c v b n m play C3 up to B3 (naturals only, no sharps on that row). New keys light up the first two times; after that you find them yourself. Hands together: a real MIDI keyboard, or two hands on the computer keys (one on each row), checks both notes and grades them exactly; a microphone only ever hears one note at a time, so that grading is approximate.',
  'update.checking': 'Checking…',
  'update.devBuild': 'This is a development build ({version}).',
  'update.upToDate': "You're running the latest version ({version}).",
  'update.behind': 'Version {version} is out. ',
  'update.error': "Couldn't reach the update server. ",
  'update.downloadLinkText': 'Download the current version',
  'mic.blocked': 'The microphone was blocked. Allow it in the browser, or open the standalone copy in Chrome.',
  'mic.notFound': 'No microphone found. Plug one in and press Connect.',
  'mic.busy': 'Another program, such as a call app, may be using the microphone. Close it and press Connect.',
  'mic.constraints': 'This microphone cannot be used here. Pick another input.',
  'mic.insecure': 'This page cannot use the microphone here. Use the standalone copy in Chrome.',
  'mic.noAudio': 'This browser has no audio engine to listen with. Use the standalone copy in Chrome.',
  'mic.unknown': 'The microphone could not start. Try Connect again.',
  'modelPack.absent': 'Not downloaded.',
  'modelPack.downloading': 'Downloading…',
  'modelPack.cached': 'Downloaded (version {version}).',
  'modelPack.notPublished': 'No model pack is published yet.',
  'modelPack.failed': "The download didn't finish, so nothing was kept. Try again.",
  'modelPack.noStorage': "This browser can't keep a download, so the model pack isn't available here.",

  // Static page labels -- headings, button text, help copy that src/app.js
  // never rewrites at runtime. Applied once at startup by applyStaticLabels
  // in src/app.js (this file stays DOM-free, see the header comment) from a
  // data-i18n="id" attribute on the element; the same English text is also
  // left sitting in src/index.html so the page still reads correctly before
  // that startup call runs, or if JS never runs at all.
  'app.subtitle': 'One coach, many instruments. It teaches where things are, then the moves between them, picks every next exercise from your own results, and watches your energy so practice stays fresh.',
  'nav.label': 'Main',
  'nav.practice': 'Practice',
  'nav.songs': 'Songs',
  'nav.progress': 'Progress',
  'nav.instrument': 'Instrument: {name}',
  'nav.chooseInstrument': 'Choose an instrument',
  'nav.settings': 'Settings',
  'settings.title': 'Settings',
  'settings.look': 'Look and names',
  'settings.language': 'Language',
  'settings.backups': 'Backups and reset',
  'settings.updates': 'Updates',
  'settings.modelPack': 'Model pack',
  'settings.how': 'How this works',
  'songs.addRow': 'Add a song',
  // A9: the collapsible <summary> wrapping the song list, Carry-on banner
  // and Assignments (challenges/band packs) so opening a song puts its
  // lesson in the first screen instead of below the whole library -- see
  // the .panel-songs-library <details> in mountSongsPanel().
  'songs.libraryToggle': 'Your song library',
  // "Download sheet (SVG)" in an open song's action row: the button, the <desc> read to a
  // screen reader (instrument known / not picked yet), and what is said if building fails.
  'songs.sheetDownload': 'Download sheet (SVG)',
  'songs.sheetDesc': 'Sheet music for {instrument}, part 1.',
  'songs.sheetDescNoInstrument': 'Sheet music, part 1.',
  'songs.sheetError': 'That song could not be saved as a sheet: {reason}',
  'picker.tools': 'Tools',
  'setup.button': 'Set up input',
  'setup.connect': 'Connect',
  'setup.midiDetails': 'MIDI details',
  'setup.inputLabel': 'Input',
  'setup.defaultMic': 'Default microphone',
  'setup.checkMic': 'Check my microphone',
  'setup.outputLabel': 'Play songs on',
  'setup.noOutput': 'No MIDI output (silent)',

  // "How to play it" panel (src/ui/fingerings.js): the routing fallback for
  // an instrument this app cannot yet draw guidance for, and the badge that
  // marks a fingering/curriculum record no player has checked yet (see
  // src/instruments/review.js's isReviewed -- null or reference-only
  // provenance both count as unreviewed).
  'fingerings.unavailable': "Guidance for this instrument isn't ready here yet.",
  'review.unreviewed': 'Not yet checked by a player.',
  'review.unreviewedWithRef': 'Not yet checked by a player (noted against {reference}).',

  'break.back': "I'm back, resume",
  'break.snooze': 'Keep going 5 more minutes',
  'break.end': 'End session',
  'stage.tapPad': 'Tap here, or press space',
  'stage.replay': 'Hear it again',
  'stage.showMe': 'Show me',
  'side.end': 'End session',
  'side.energyEyebrow': 'Your energy this session',
  'energy.full': 'Fresh',
  'side.easier': 'Make it easier',
  'side.harder': 'Skip ahead',
  'side.feedbackEyebrow': 'Instant feedback',
  'stats.last20': 'last 20',
  'stats.streak': 'streak',
  'stats.rtLabel': 'sec to answer',
  'side.weakEyebrow': 'What the coach is leaning on',
  'side.backupDismiss': 'Dismiss',
  'rail.reset': 'Reset this instrument (clears progress)',
  'rail.backupSave': 'Save a backup',
  'rail.backupRestore': 'Restore a backup',
  'rail.checkUpdates': 'Check for updates',
  'rail.modelPack': 'Download model pack',
  'rail.modelPackHelp': 'Optional. An extra download that some features can use; Band Coach works fully without it. Only fetched when you press the button, and nothing about your playing is sent.',
  'rail.updateHelp': 'Asks the Band Coach website for the latest version number. Sends nothing about your playing.',
  // Keyboard practice -> Songs hand-off (C11a): the button that opens a
  // starter song's lesson once the notes it uses are all taught, and the
  // way back once that lesson ends (src/ui/songs.js's renderPractice).
  'kbd.songHandoff.button': 'Play a song with these notes',
  'kbd.songHandoff.back': 'Back to practice',
  // Songs lesson modes (C11b): the one control's own label and its three
  // buttons, plus the counted/practice-only line a Check try's own verdict
  // shows (src/ui/songs.js's mode control and advance()).
  'songs.import.feelSwung': 'The feel of this recording: swung (the offbeat eighths come late).',
  'songs.import.feelStraight': 'The feel of this recording: straight (the eighths are even).',
  'songs.mode.label': 'Lesson mode',
  'songs.mode.learn': 'Learn',
  'songs.mode.rehearse': 'Rehearse',
  'songs.mode.check': 'Check',
  'songs.mode.counted': 'This try counted as a check.',
  'songs.mode.practiceOnly': 'Practice only: this try did not count as a check. On keyboard, only a MIDI keyboard counts.',
  // Songs teaching loop (src/core/teaching.js): the unjudged demo step before
  // a passage's guided steps, the hand-on step after a passed check, and the
  // notes for a delayed review (src/ui/songs.js renderInterlude/advance()).
  'songs.step.play': 'Play it',
  'songs.step.next': 'Next',
  'songs.step.yourTurn': 'Your turn',
  'songs.step.stopCheck': 'Stop and check',
  'songs.bars': 'bars {from}-{to}',
  'songs.demo.title': 'Watch and listen',
  'songs.demo.body': 'The app plays this passage slowly. You are not being judged yet. Play it again as often as you like, then press Next.',
  'songs.demo.again': 'Play it slowly',
  'songs.transfer.title': 'Next section',
  'songs.transfer.body': 'You passed {from}. Carry the same skill into {to}: listen first, then your turn. Press Next to start.',
  'songs.transfer.queued': 'Nice. Bars {bars} are saved for a quick review the next time you come back.',
  'songs.review.due': 'Review from last time: bars {bars}. Play through it once, then carry on.',
  // Songs hand selector (H3), src/ui/songs.js's renderPractice: the Both/
  // Right/Left control (keyboard two-hand songs only), the prep line naming
  // each hand's starting note, and the "this hand rests" line a step with
  // nothing for the chosen hand shows instead of "Your turn".
  'songs.playForMe': 'Play it for me',
  'songs.playForMeStop': 'Stop playing',
  'songs.hands.label': 'Hands',
  'songs.hands.both': 'Both hands',
  'songs.hands.right': 'Right hand',
  'songs.hands.left': 'Left hand',
  'songs.hands.startRight': 'Right hand starts on {note}.',
  'songs.hands.startLeft': 'Left hand starts on {note}.',
  'songs.hands.restRight': 'The right hand rests here. Listen, then press Next.',
  'songs.hands.restLeft': 'The left hand rests here. Listen, then press Next.',
  // Songs "How to play this" inline expander (C1b), src/ui/songs.js's
  // renderPractice: the toggle button next to the step's notation, tab or
  // fingering line, hidden in Check same as those views (only shows for an
  // instrument the Fingerings panel can draw, howKindFor() non-null).
  'howInline.button': 'How to play this',
  // "Your keyboard path" panel (P2), src/ui/pathway.js: the button that
  // opens it, the panel's own title/tag/current-step marker, the five
  // step names src/core/pathway.js's pathwayState steps through, and the
  // one action label per step (the wait label names the recheck date).
  'pathway.open': 'Your keyboard path',
  'pathway.title': 'Your keyboard path',
  'pathway.tag': 'Pathway',
  'pathway.current': 'You are here',
  'pathway.step.setup': 'Setup',
  'pathway.step.lesson': 'Lesson',
  'pathway.step.song': 'Song',
  'pathway.step.check': 'Check',
  'pathway.step.return': 'Return',
  'pathway.action.trainer': 'Go to the keyboard trainer',
  'pathway.action.song': 'Open {title} in Songs',
  'pathway.action.check': 'Check {title} in Songs',
  'pathway.action.wait': 'Come back on {date} to check it again',
};

// Spanish (es). MACHINE-TRANSLATED first pass -- every en key has an entry
// (tests/unit/i18n-locales.test.mjs fails a key that is missing or whose
// {param} tokens differ) but no native speaker has reviewed the wording yet.
// Same order as `en` so the two tables can be read side by side. Strings the
// app has not yet routed through t() still show in English.
export const es = {
  'storage.saveFailed': 'Tu progreso de hace un momento no se pudo guardar en este dispositivo (puede que el almacenamiento esté lleno o que la navegación privada lo esté bloqueando). Sigue tocando: seguiré intentando guardar.',
  'backup.saved': 'Copia de seguridad guardada en tus descargas. Guarda ese archivo en un lugar seguro.',
  'backup.restored': 'Copia de seguridad restaurada.',
  'backup.readError': 'No se pudo leer ese archivo.',
  'backup.confirmRestore': '¿Restaurar esta copia de seguridad? Reemplazará tu progreso actual.',
  'reset.confirm': '¿Reiniciar {name}? Esto borra tu nivel y tu progreso de forma definitiva. Guarda antes una copia de seguridad si quizá la quieras recuperar.',
  'backup.err.unreadable': 'No se pudo leer ese archivo.',
  'backup.err.tooLarge': 'Ese archivo de copia de seguridad es demasiado grande para ser de Band Coach.',
  'backup.err.notBackup': 'Eso no parece un archivo de copia de seguridad de Band Coach.',
  'backup.err.tooNew': 'Esta copia de seguridad la hizo una versión más nueva de Band Coach. Actualiza la app para restaurarla.',
  'backup.err.noProgress': 'Ese archivo de copia de seguridad no tiene progreso guardado, así que no se cambió nada.',
  'backup.err.damagedSong': 'Ese archivo de copia de seguridad tiene una canción dañada, así que no se cambió nada.',
  'backup.err.songsNotStored': 'No se cambió nada: las canciones guardadas de esta copia no se pudieron almacenar en este dispositivo.',
  'backup.err.notSaved': 'Tu progreso restaurado no se pudo guardar en este dispositivo (puede que el almacenamiento esté lleno).',
  'reset.progressCleared': 'Progreso de {name} borrado. Vuelves al nivel 1.',
  'audio.stoppedTitle': 'Sonido detenido',
  'audio.stoppedWhy': 'Tu dispositivo pausó el sonido (una llamada, un cambio de auriculares u otra aplicación). Pulsa el botón de reanudar para continuar.',
  'audio.tapToResume': 'Toca para reanudar el sonido.',
  'hint.staffNote': 'Lee {label} en el pentagrama y tócalo. Mantenlo firme.',
  'kbd.help': 'Teclado: conecta un teclado MIDI y pulsa Conectar, o haz clic en las teclas de la pantalla, o usa las teclas del ordenador como práctica en pantalla (no es un teclado real): a w s e d f t g y h u j k tocan de Do4 a Do5, y z x c v b n m tocan de Do3 a Si3 (solo notas naturales, sin sostenidos en esa fila). Las teclas nuevas se iluminan las dos primeras veces; después las encuentras tú solo. Manos juntas: un teclado MIDI real, o dos manos en las teclas del ordenador (una en cada fila), comprueba ambas notas y las califica con exactitud; un micrófono solo oye una nota a la vez, así que esa calificación es aproximada.',
  'update.checking': 'Comprobando…',
  'update.devBuild': 'Esta es una versión de desarrollo ({version}).',
  'update.upToDate': 'Estás usando la última versión ({version}).',
  'update.behind': 'Ya está disponible la versión {version}. ',
  'update.error': 'No se pudo conectar con el servidor de actualizaciones. ',
  'update.downloadLinkText': 'Descargar la versión actual',
  'mic.blocked': 'Se bloqueó el micrófono. Permítelo en el navegador, o abre la copia independiente en Chrome.',
  'mic.notFound': 'No hay micrófono. Conecta uno y pulsa Conectar.',
  'mic.busy': 'Otro programa, como una app de llamadas, puede estar usando el micrófono. Ciérralo y pulsa Conectar.',
  'mic.constraints': 'Este micrófono no se puede usar aquí. Elige otra entrada.',
  'mic.insecure': 'Esta página no puede usar el micrófono aquí. Usa la copia independiente en Chrome.',
  'mic.noAudio': 'Este navegador no tiene motor de audio para escuchar. Usa la copia independiente en Chrome.',
  'mic.unknown': 'No se pudo iniciar el micrófono. Prueba Conectar otra vez.',
  'modelPack.absent': 'Sin descargar.',
  'modelPack.downloading': 'Descargando…',
  'modelPack.cached': 'Descargado (versión {version}).',
  'modelPack.notPublished': 'Todavía no se ha publicado ningún paquete de modelo.',
  'modelPack.failed': 'La descarga no terminó, así que no se guardó nada. Inténtalo de nuevo.',
  'modelPack.noStorage': 'Este navegador no puede guardar descargas, así que el paquete de modelo no está disponible aquí.',

  'app.subtitle': 'Un entrenador, muchos instrumentos. Te enseña dónde están las cosas, luego los movimientos entre ellas, elige cada siguiente ejercicio según tus propios resultados y vigila tu energía para que la práctica se mantenga fresca.',
  'nav.label': 'Principal',
  'nav.practice': 'Práctica',
  'nav.songs': 'Canciones',
  'nav.progress': 'Progreso',
  'nav.instrument': 'Instrumento: {name}',
  'nav.chooseInstrument': 'Elige un instrumento',
  'nav.settings': 'Ajustes',
  'settings.title': 'Ajustes',
  'settings.look': 'Apariencia y nombres',
  'settings.language': 'Idioma',
  'settings.backups': 'Copias de seguridad y reinicio',
  'settings.updates': 'Actualizaciones',
  'settings.modelPack': 'Paquete de modelo',
  'settings.how': 'Cómo funciona',
  'songs.addRow': 'Añadir una canción',
  'songs.libraryToggle': 'Tu biblioteca de canciones',
  'songs.sheetDownload': 'Descargar partitura (SVG)',
  'songs.sheetDesc': 'Partitura para {instrument}, parte 1.',
  'songs.sheetDescNoInstrument': 'Partitura, parte 1.',
  'songs.sheetError': 'No se pudo guardar esa canción como partitura: {reason}',
  'picker.tools': 'Herramientas',
  'setup.button': 'Configurar entrada',
  'setup.connect': 'Conectar',
  'setup.midiDetails': 'Detalles de MIDI',
  'setup.inputLabel': 'Entrada',
  'setup.defaultMic': 'Micrófono predeterminado',
  'setup.checkMic': 'Comprobar mi micrófono',
  'setup.outputLabel': 'Tocar las canciones en',
  'setup.noOutput': 'Sin salida MIDI (en silencio)',

  'fingerings.unavailable': 'La guía para este instrumento aún no está lista aquí.',
  'review.unreviewed': 'Aún no revisado por un músico.',
  'review.unreviewedWithRef': 'Aún no revisado por un músico (anotado según {reference}).',

  'break.back': 'Ya volví, continuar',
  'break.snooze': 'Seguir 5 minutos más',
  'break.end': 'Terminar la sesión',
  'stage.tapPad': 'Toca aquí, o pulsa la barra espaciadora',
  'stage.replay': 'Oírlo otra vez',
  'stage.showMe': 'Muéstramelo',
  'side.end': 'Terminar la sesión',
  'side.energyEyebrow': 'Tu energía en esta sesión',
  'energy.full': 'Con energía',
  'side.easier': 'Hazlo más fácil',
  'side.harder': 'Avanzar',
  'side.feedbackEyebrow': 'Respuesta al instante',
  'stats.last20': 'últimas 20',
  'stats.streak': 'racha',
  'stats.rtLabel': 's para responder',
  'side.weakEyebrow': 'En qué se apoya el entrenador',
  'side.backupDismiss': 'Descartar',
  'rail.reset': 'Reiniciar este instrumento (borra el progreso)',
  'rail.backupSave': 'Guardar una copia de seguridad',
  'rail.backupRestore': 'Restaurar una copia de seguridad',
  'rail.checkUpdates': 'Buscar actualizaciones',
  'rail.modelPack': 'Descargar el paquete de modelo',
  'rail.modelPackHelp': 'Opcional. Una descarga adicional que algunas funciones pueden usar; Band Coach funciona por completo sin ella. Solo se descarga cuando pulsas el botón, y no se envía nada sobre cómo tocas.',
  'rail.updateHelp': 'Le pide al sitio web de Band Coach el número de la última versión. No envía nada sobre cómo tocas.',
  'kbd.songHandoff.button': 'Tocar una canción con estas notas',
  'kbd.songHandoff.back': 'Volver a la práctica',
  'songs.import.feelSwung': 'El aire de esta grabación: swing (las corcheas a contratiempo llegan tarde).',
  'songs.import.feelStraight': 'El aire de esta grabación: recto (las corcheas son iguales).',
  'songs.mode.label': 'Modo de lección',
  'songs.mode.learn': 'Aprender',
  'songs.mode.rehearse': 'Ensayar',
  'songs.mode.check': 'Comprobar',
  'songs.mode.counted': 'Este intento contó como comprobación.',
  'songs.mode.practiceOnly': 'Solo práctica: este intento no contó como comprobación. En el teclado, solo cuenta un teclado MIDI.',
  'songs.step.play': 'Tócalo',
  'songs.step.next': 'Siguiente',
  'songs.step.yourTurn': 'Te toca',
  'songs.step.stopCheck': 'Parar y comprobar',
  'songs.bars': 'compases {from}-{to}',
  'songs.demo.title': 'Mira y escucha',
  'songs.demo.body': 'La app toca este pasaje despacio. Todavía no se te evalúa. Vuelve a escucharlo tantas veces como quieras y luego pulsa Siguiente.',
  'songs.demo.again': 'Tocarlo despacio',
  'songs.transfer.title': 'Siguiente sección',
  'songs.transfer.body': 'Superaste {from}. Lleva la misma habilidad a {to}: primero escucha y luego te toca a ti. Pulsa Siguiente para empezar.',
  'songs.transfer.queued': 'Muy bien. Los compases {bars} quedan guardados para un repaso rápido la próxima vez que vuelvas.',
  'songs.review.due': 'Repaso de la última vez: compases {bars}. Tócalos una vez y luego sigue.',
  'songs.playForMe': 'Tócala por mí',
  'songs.playForMeStop': 'Dejar de tocar',
  'songs.hands.label': 'Manos',
  'songs.hands.both': 'Ambas manos',
  'songs.hands.right': 'Mano derecha',
  'songs.hands.left': 'Mano izquierda',
  'songs.hands.startRight': 'La mano derecha empieza en {note}.',
  'songs.hands.startLeft': 'La mano izquierda empieza en {note}.',
  'songs.hands.restRight': 'Aquí descansa la mano derecha. Escucha y luego pulsa Siguiente.',
  'songs.hands.restLeft': 'Aquí descansa la mano izquierda. Escucha y luego pulsa Siguiente.',
  'howInline.button': 'Cómo tocar esto',
  'pathway.open': 'Tu camino con el teclado',
  'pathway.title': 'Tu camino con el teclado',
  'pathway.tag': 'Camino',
  'pathway.current': 'Estás aquí',
  'pathway.step.setup': 'Preparación',
  'pathway.step.lesson': 'Lección',
  'pathway.step.song': 'Canción',
  'pathway.step.check': 'Comprobar',
  'pathway.step.return': 'Volver',
  'pathway.action.trainer': 'Ir al entrenador de teclado',
  'pathway.action.song': 'Abrir {title} en Canciones',
  'pathway.action.check': 'Comprobar {title} en Canciones',
  'pathway.action.wait': 'Vuelve el {date} para comprobarlo otra vez',
};

export const LOCALES = [{ code: 'en', name: 'English' }, { code: 'es', name: 'Español' }];

const locales = { en, es };
let activeLocale = 'en';

// Adds/merges strings into a locale (creating it if new) without discarding
// what that locale already had -- so a translation can be filled in one
// slice at a time, same as the English table itself is being grown.
export function registerLocale(code, table) {
  locales[code] = Object.assign({}, locales[code] || {}, table || {});
}

// Only ever called with a locale that registerLocale has already populated
// (or 'en', which always exists); an unknown code is left as a no-op rather
// than throwing, since a bad locale code must never take down the app.
export function setLocale(code) {
  if (locales[code]) activeLocale = code;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (whole, key) => (Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole));
}

// Looks up id in the active locale, falling back to English (never to the
// id) when the active locale hasn't got that string yet -- a partial
// translation must never regress to raw ids for the strings it hasn't
// reached. Only when NEITHER has it does the id itself come back.
export function t(id, params) {
  const table = locales[activeLocale] || locales.en;
  const str = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : locales.en[id];
  if (typeof str !== 'string') return id;
  return interpolate(str, params);
}
