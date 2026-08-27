// Emscripten 3.1.56's pthread library reports Linux-compatible advisory
// priority ranges even though Web workers cannot set scheduling priorities.
// The pinned MonoGame archives call these functions without enabling pthreads.
mergeInto(LibraryManager.library, {
  sched_get_priority_max: policy => policy === 1 || policy === 2 ? 99 : 0,
  sched_get_priority_min: policy => policy === 1 || policy === 2 ? 1 : 0,
});
