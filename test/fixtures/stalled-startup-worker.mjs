// A worker that never finishes starting, like one still loading its modules on
// a busy host: it neither reports ready nor reads a shutdown request.
setInterval(() => {}, 1000)
