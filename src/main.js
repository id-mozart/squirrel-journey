const params = new URLSearchParams(location.search);
const debug = params.get('debug');
if (debug === 'textures') {
  import('./debug/textures.js').then((m) => m.run());
} else if (debug === 'squirrel') {
  import('./debug/squirrel.js').then((m) => m.run());
} else {
  import('./game.js').then((m) => m.start());
}
