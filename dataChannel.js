const debug = require('debug')('datachannel')
const io = require('socket.io-client')
const { poll, getStringByteLength } = require('./util')

const noop = () => {}
const MAX_MESSAGE_SIZE = 64 * 1024
const HIGH_WATERMARK = 1024 * 1024

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: process.env.turnserver,
      username: process.env.turnuser,
      credential: process.env.turnpassword
    }
  ]
}

module.exports = async function dataChannel (
  localPeerId,
  config,
  onData = noop
) {
  if (!localPeerId) {
    throw new Error('peerId required')
  }
  if (!/^\w+$/.test(localPeerId)) {
    throw new Error('peerId must be alphanumeric')
  }
  const localId = localPeerId

  config = {
    rtcConfig,
    ...config
  }
  if (!config.wrtc) {
    throw new Error('config.wrtc required')
  }
  if (!config.signalServer) {
    throw new Error('config.signalServer required')
  }

  const messageQueue = [] // of type {data, lengthInBytes, resolve, reject}
  let remoteId, connection, channel, remoteMaxMessageSize
  const socket = io(config.signalServer, { query: { peerId: localId } })
  await new Promise(resolve => socket.on('connect', resolve)) // TODO respect nodejs callback semantics
  socket.on('signal', async data => {
    if (data.signal.offer) {
      debug(localId, 'got offer signal')
      remoteId = data.from
      connection.setRemoteDescription(data.signal.offer)
      extractRemoteMaxMessageSize(data.signal.offer)
      try {
        const answer = await connection.createAnswer()
        connection.setLocalDescription(answer)
        await signal({ answer })
      } catch (e) {
        debug(localId, 'failed to set local description', e)
      }
    } else if (data.signal.answer) {
      debug(localId, 'got answer signal')
      try {
        connection.setRemoteDescription(data.signal.answer)
      } catch (e) {
        debug(localId, 'failed to set remote description', e)
      }
      extractRemoteMaxMessageSize(data.signal.answer)
    } else if (data.signal.candidate) {
      debug(localId, 'got candidate signal')
      try {
        await connection.addIceCandidate(data.signal.candidate)
      } catch (e) {
        debug(localId, 'failed to add ICE candidate', e)
      }
    } else {
      debug(localId, 'got unknown signal', data.signal)
    }
  })
  connection = new config.wrtc.RTCPeerConnection(config.rtcConfig)
  connection.addEventListener('icecandidate', async event => {
    const candidate = event.candidate
    debug(localId, 'got ICE candidate:', candidate)
    if (candidate === null) {
      return
    }
    await signal({ candidate })
  })
  connection.addEventListener('datachannel', event => {
    debug(localId, 'received channel callback')
    channel = event.channel
    setupChannel()
  })

  return {
    async connect (othersPeerId) {
      remoteId = othersPeerId
      channel = connection.createDataChannel({ ordered: true })
      channel.binaryType = 'arraybuffer'
      setupChannel()
      const offer = await connection.createOffer()
      connection.setLocalDescription(offer)
      debug(localId, 'got offer')
      await signal({ offer })
      await poll(() => connection && connection.connectionState === 'connected')
    },
    async ready () {
      await poll(() => connection && connection.connectionState === 'connected')
    },
    send (message) {
      try {
        debug(localId, 'bufferedAmount before send:', channel.bufferedAmount)
        channel.send(message)
        setTimeout(
          // give chance to update bufferedAmount async
          () =>
            debug(
              localId,
              'bufferedAmount after send:',
              channel.bufferedAmount
            ),
          0
        )
        return true
      } catch (e) {
        debug(localId, 'sending message failed', e)
        debugState()
        return false
      }
    },
    sendAsync (message) {
      const lengthInBytes = validateMessage(message)
      return new Promise((resolve, reject) => {
        messageQueue.push({ data: message, lengthInBytes, resolve, reject })
        return sendAsyncInternal()
      })
    },
    debugState () {
      debugState()
    }
  }

  async function sendAsyncInternal () {
    const message = messageQueue.shift()
    if (!message) {
      debug(localId, 'message queue is empty')
      return
    }
    const { data, lengthInBytes, resolve, reject } = message
    // TODO check connection state and maybe signaling state too
    if (channel.readyState !== 'open') {
      await poll(() => channel.readyState === 'open')
    }
    if (channel.readyState !== 'open') {
      // TODO try to create a new datachannel
      reject(new Error('datachannel is not open'))
    }
    // see sendData() in https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/datatransfer/js/main.js
    let bufferedAmount = channel.bufferedAmount
    bufferedAmount += lengthInBytes
    if (bufferedAmount >= HIGH_WATERMARK) {
      // since event onbufferedamountlow is not fired, we retry after some delay
      // 100 ms worked well during tests
      setTimeout(() => sendAsyncInternal(), 100)
      debug(
        localId,
        `did custom delay, bufferedAmount: ${bufferedAmount} (announced: ${
          channel.bufferedAmount
        })`
      )
      messageQueue.unshift(message) // back into the queue
      return
    }
    try {
      channel.send(data)
      resolve()
    } catch (e) {
      reject(e)
    }
  }

  function signal (sig) {
    return new Promise((resolve, reject) => {
      socket.emit(
        'signal',
        {
          to: remoteId,
          signal: sig
        },
        err => {
          if (err) {
            reject(new Error('sending signal failed: ' + err))
          } else {
            resolve()
          }
        }
      )
    })
  }

  function setupChannel () {
    channel.bufferedAmountLowThreshold = MAX_MESSAGE_SIZE
    channel.addEventListener('bufferedamountlow', e => {
      // didn't see this fired, but leave it here, doesn't hurt
      debug(localId, 'bufferedamountlow event', e)
      sendAsyncInternal()
    })
    channel.addEventListener('open', debugState)
    channel.addEventListener('close', debugState)
    channel.addEventListener('error', e => {
      debug(localId, 'channel error:', e)
      debugState()
    })
    channel.addEventListener('message', message => {
      // debug(myId, 'got channel message')
      onData(message.data)
    })
  }

  function debugState () {
    debug(localId, 'state', {
      channelId: channel.id,
      // localDescription: connection.currentLocalDescription,
      // remoteDescription: connection.currentRemoteDescription,
      iceConnectionState: connection.iceConnectionState,
      connectionState: connection.connectionState,
      signalingState: connection.signalingState,
      channelState: channel.readyState,
      channelBufferedAmount: channel.bufferedAmount,
      sctpMaxMessageSize: connection.sctp && connection.sctp.maxMessageSize,
      remoteMaxMessageSize
    })
  }

  // from: https://blog.mozilla.org/webrtc/large-data-channel-messages/
  function extractRemoteMaxMessageSize (description) {
    remoteMaxMessageSize = 65535
    try {
      const match = description.sdp.match(/a=max-message-size:\s*(\d+)/)
      if (match !== null && match.length >= 2) {
        remoteMaxMessageSize = parseInt(match[1])
        debug(localId, 'got remoteMaxMessageSize from sdp prop')
      }
    } catch (e) {
      debug(
        localId,
        'failed to extract remoteMaxMessageSize from',
        description,
        'error:',
        e
      )
    }
  }

  function validateMessage (msg) {
    if (!msg) return
    let msgLength
    if (typeof msg === 'string') {
      msgLength = getStringByteLength(msg)
    } else if (
      // checks for Buffer, ArrayBuffer and typed arrays
      msg instanceof Buffer ||
      msg instanceof ArrayBuffer ||
      msg.buffer instanceof ArrayBuffer
    ) {
      msgLength = msg.byteLength
    } else {
      throw new Error('unknown type of message')
    }
    if (msgLength > MAX_MESSAGE_SIZE) {
      throw new Error(
        `message too big, allowed are ${MAX_MESSAGE_SIZE} bytes, but message has ${msgLength} bytes`
      )
    }
    return msgLength
  }
}
