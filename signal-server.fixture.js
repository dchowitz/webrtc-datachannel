const getPort = require('get-port')
let server = require('http').createServer()
server = require('http-shutdown')(server)
require('./signal-server')(server)

module.exports = function (avaTest) {
  let serverUrl
  avaTest.beforeEach(openServerAsync)
  avaTest.afterEach.always(closeServerAsync)

  return {
    getServerUrl () {
      return serverUrl
    }
  }

  async function openServerAsync () {
    const port = await getPort()
    await new Promise((resolve, reject) => {
      server.listen(port, err => {
        if (err) reject(err)
        else {
          resolve()
        }
      })
    })
    serverUrl = 'http://localhost:' + port
  }

  function closeServerAsync () {
    serverUrl = undefined
    return new Promise(resolve => server.forceShutdown(resolve))
  }
}
