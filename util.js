exports.poll = function poll (checkFn, timeout = 5000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let handle = setInterval(() => {
      const elapsed = Date.now() - start
      if (checkFn()) {
        clearInterval(handle)
        resolve()
      }
      if (elapsed > timeout) {
        clearInterval(handle)
        reject(new Error('poll timeout'))
      }
    }, 100)
  })
}

exports.emitAsync = function emitAsync (client, event, data) {
  return new Promise((resolve, reject) => {
    client.emit(event, data, err => {
      if (err) reject(new Error(err))
      else resolve()
    })
  })
}

// from: https://codereview.stackexchange.com/questions/37512/count-byte-length-of-string
exports.getStringByteLength = function getStringByteLength (str) {
  str = String(str)
  let len = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    len +=
      c < 1 << 7
        ? 1
        : c < 1 << 11
          ? 2
          : c < 1 << 16
            ? 3
            : c < 1 << 21
              ? 4
              : c < 1 << 26
                ? 5
                : c < 1 << 31
                  ? 6
                  : Number.NaN
  }
  return len
}
