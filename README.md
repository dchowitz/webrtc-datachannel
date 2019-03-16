# webrtc-datachannel

A simple abstraction over WebRTC datachannels.

Signal server included.

Still in its early stage.

Runs in browsers, Node.js and React Native apps.

## Install

```bash
npm install @dchowitz/webrtc-datachannel
```

## Usage

Peers A and B want to exchange arbitrary data with each other. By some other means (your application logic), they have agreed upon a unique identifier for their datachannel connection.

```js
const peerA = await datachannel('CHANNELID', {
  // required
  signalServerUrl: 'http://localhost:3333',
  // optional, ICE config, you should provide your own TURN server
  {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:your.turnserver.com:3478',
        username: 'turnuser',
        credential: 'turnpassword'
      }
    ]
  }
}, data => {
  // do something with incoming data
})

// ... somewhere else peer B
const peerB = await datachannel('CHANNELID', { /*...config*/} , data => {
  // do something with incoming data
})

// when channel is ready, both peers can send to each other
await peerA.send('hello from A')

// ... somewhere else
await peerB.send('hi back')
```

### Non-browser environments

webrtc-datachannel tries to obtain the WebRTC API objects `RTCPeerConnection`, `RTCSessionDescription` and `RTCIceCandidate` from the global object and complains otherwise.

If you're in Node.js or React Native, you can provide a WebRTC implementation this way:

```js
// in Node.js
const wrtc = require("wrtc");

// in React Native
const wrtc = require("react-native-webrtc");

// ...
const peer = await datachannel("CHANNELID", {
  signalServerUrl: "...",
  wrtc // an object: { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate }
});
```

## References

- [Determine max message size](https://blog.mozilla.org/webrtc/large-data-channel-messages/)
- [Channel message size limitations](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html)
- [Spec](https://cdn.rawgit.com/w3c/webrtc-pc/f4061e8ad0be1b849c863a01ebc391669d92d7f2/webrtc.html#rtcdatachannel)
- [Sample](https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/datatransfer/js/main.js)

## Limitations

Currently, max. message size is 64KB. This is to prevent chunking of big messages on receiver side. If you want to support messages of arbitrary side, you have to implement a protocol on top of webrtc-datachannel. This is planned for the future.

## Observations

Messages bigger than 256 kB get splitted into chunks of 256 kB in nodejs. The receiver is responsible for reassembling.

Typed arrays and buffers arrive as ArrayBuffer on receiver side. Most probably caused by `channel.binaryType = 'arraybuffer'`.

Strings arrive as strings.

Data channel works fine with really big string messages (tested with messages of up to 256 MB).

Data channel closes when sending medium-sized messages (up to 8 MB of type ArrayBuffer) in high frequency. We have to respect the channel buffer (see `channel.bufferedAmount`). [Sample] shows how to monitor and handle accordingly.

Data channel closes when sending two laaarge messages (256 MB). Most likely due to buffer overflow.

Once a channel closes (because of some error or due to `channel.close()`) there is no way to reopen it.

A channel state of `closed` on one side of the channel doesn't necessarily mean that the state of the remote channel side is closed as well. In my experiments, when one side got an error and was closed, the other side showed still `open`.

Event `onbufferedamountlow` never fires, but should...

## Open Points

**Task** Implement retries for `send()`. If the channel on one side closes, then we have to create a new one. The other side of the channel has to close the old one on `datachannel` event, if existing. We can also check the channel state before sending any messages and act accordingly. The abstraction for `send()` should return a Promise.

**Task** Ensure that a send message always equals the received message, or put another way, that no chunking occurs. Since our data channel abstraction is still low-level, a custom (use case specific) protocol on top of it has to handle chunking and reassembling. For that, the `send()` implementation must reject messages greater than a certain size, e. g. 64 KB (see [Channel message size limitations]).

**Q** What happens if the signalling resp. connection state changes, e. g. the address of one peer? Will the data channel be closed on both ends or is such situation handled transparently by WebRTC without affecting the current datachannel instance at all?

# License

MIT. Copyright (c) Denny Christochowitz
