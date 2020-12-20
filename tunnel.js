const net = require('net')
const cipherutils = require('./cipher_utils.js')

module.exports = {
  netConnect,
  cipherUpgrade
}

function netConnect(address) {
  return new Promise((resolve, reject) => {
    let parts = address.split(':')
    let host = parts[0]
    let port = +parts[1]
    let conn = net.connect({host, port}, function () {
      conn.removeListener('error', onerror)
      resolve(conn)
    })

    let onerror = function (err) {
      conn.removeListener('error', onerror)
      reject(err)
    }
    conn.on('error', onerror)
  })
}

function cipherUpgrade(conn, secret) {
  let decoder = null
  
  let {iv, data} = cipherutils.genIvData(secret)
  let encoder = cipherutils.makeCipherStream(secret, iv)
  conn.write(data)

  return new Promise((_resolve, _reject) => {
    conn.on('data', ondata)
    conn.on('error', onerror)
    function defer() {
      conn.removeListener('data', ondata)
      conn.removeListener('error', onerror)
    }

    let resolve = function () {
      defer();
      _resolve.apply(this, arguments);
    }
    let reject = () => {
      defer();
      _reject.apply(this, arguments);
    }

    function ondata(buf) {
      let {iv, ok} = cipherutils.checkIvData(secret, buf)
      if (!ok) {
        return reject('cipher handshake failed')
      }
      decoder = cipherutils.makeCipherStream(secret, iv)

      conn.onSecureData = function (onSecureDataCb) {
        conn.on('data', function (buf) {
          let decoded = decoder.update(buf)
          onSecureDataCb(decoded)
        })
      }
      conn.removeSecureDataListener = function (onSecureDataCb) {
        // not implement
        throw "remove secure listener not implement"
      }
      conn.secureWrite = function (buf) {
        let encoded = encoder.update(buf)
        conn.write(encoded)
      }

      return resolve(conn)
    }

    function onerror(err) {
      reject(err)
    }
  })
}
