// A Song needs a non-empty `id` and `title` to pass validateSong, but a file
// or a mic take often carries neither. Every producer names its songs here so
// they all fall back the same way: the title in the file, else the file's
// name, else a plain label for the kind of source.

function stripExt(fileName) {
  return String(fileName).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

export function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// songIdentity({ title, fileName, fallback }) -> { id, title }
export function songIdentity({ title, fileName, fallback }) {
  const fromFile = fileName ? stripExt(fileName).trim() : '';
  const name = (title && String(title).trim()) || fromFile || fallback;
  return { id: slugify(fromFile || name) || slugify(fallback), title: name };
}
