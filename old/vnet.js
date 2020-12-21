const frame = require('./frame.js')

module.exports = {
  upgrade
}

let _uid = 1
function uid() { return _uid++ }

function upgrade(fconn) {
  let {onRequest, onResponse} = makeRequestResponse(fconn)
  let {onPing, onPong} = makePingPong(fconn)

  fconn.setFrameEventListener({
    onRequest, onResponse, onPing, onPong
  })

  return fconn
}

function makeRequestResponse(fconn) {
  let responseGuard = {}

  // request 发送RPC请求
  fconn.request = function(cmd, payload) {
    let id = uid()
    return new Promise((resolve, reject) => {
      let called = false
      let callback = function (f) {
        if (called) return
        called = true
        defer()

        if (f.type != frame.typeResponseOK) {
          return reject(f) // todo: depack
        }

        if (!f.data || f.data.length == 0) {
          return resolve(null)
        }

        if (f.dataType == frame.binaryData) {
          return resolve(f.data)
        }

        if (f.dataType == frame.textData) {
          return resolve(f.data.toString('utf-8'))
        }

        if (f.dataType == frame.jsonData) {
          let json = null
          try {
            json = JSON.parse(f.data.toString('utf-8'))
          } catch (ex) {
            return reject(ex)
          }
          return resolve(json)
        }
      }
      responseGuard[id] = callback
      let defer = function () {
        delete responseGuard[id]
      }

      fconn.sendFrame({
        id,
        type: frame.typeRequest,
        sid: 0,
        header: { cmd },
        dataType: frame.jsonData,
        data: Buffer.from(JSON.stringify(payload)),
      })
    })
  }

  // onRequest 处理请求
  let onRequestHandler = {}
  let onRequest = function (f) {
    let sid = f.id
    let handler = onRequestHandler[f.header.cmd]
    if (!handler || typeof handler != 'function') {
      return fconn.sendFrame({ id: uid(), type: frame.typeResponseErr,
        sid, header: {}, dataType: frame.textData, data: Buffer.from(`handler of cmd=${f.header.cmd} not found`),
      })
    }
    
    let {errCode, errMsg, data } = handler(f)
    if (errCode != 0) {
      return fconn.sendFrame({ id: uid(), type: frame.typeResponseErr,
        sid, header: {}, dataType: frame.textData, data: Buffer.from(`${errMsg}`),
      })
    }

    return fconn.sendFrame({ id: uid(), type: frame.typeResponseOK,
      sid, header: {}, dataType: frame.jsonData, data: Buffer.from(JSON.stringify(data)),
    })
  }

  // onResponse 处理应答包
  let onResponse = function (f) {
    let sid = f.sid
    let callback = responseGuard[sid]
    if (!callback || typeof callback != 'function') {
      return console.warn(`unhandled callback sid=${sid}`)
    }
    callback(f)
  }

  return {onRequest, onResponse}
}

function makePingPong(fconn) {

  let pingCallback = null

  fconn.ping = function () {
    return new Promise((resolve, reject) => {
      let pongGuardID = uid()
      let called = false
      pingCallback = function () {
        if (called) return
        called = true
        pingCallback = null
        resolve()
      }
      setTimeout(function () {
        if (called) return
        called = true
        pingCallback = null
        reject('ping timeout')
      }, 1000 * 3)

      fconn.sendFrame({
        id: uid(),
        type: frame.typePing,
        sid: 0,
        header: null,
        dataType: frame.binaryData,
        data: null,
      })
    })
  }

  let onPing = function (f) {
    fconn.sendFrame({ id: uid(), type: frame.typePong,
      sid: 0, header: null, dataType: frame.binaryData, data: null, })
  }

  let onPong = function (f) {
    if (pingCallback && typeof pingCallback == 'function') {
      pingCallback()
    }
  }

  return {onPing, onPong}
}