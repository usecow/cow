export function getmicrotime () {
  return (Date.now() % 1000) / 1000
}