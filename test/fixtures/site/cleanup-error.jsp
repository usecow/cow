<?js
cow.onCleanup(() => {
  throw new Error('cleanup failed intentionally')
})
res.send('not released')
