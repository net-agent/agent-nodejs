const hkdf = require('futoin-hkdf')
const crypto = require('crypto')

module.exports = {
  hkdfsha1,
  makeCipherStream,
  genIvData,
  checkIvData
}

function hkdfsha1(secret, size) {
  let salt = 'cipherconn-of-exchanger'
  return hkdf(secret, size, {info: '', salt, hash: 'sha1'})
}

function makeCipherStream(secret, iv) {
  key = hkdfsha1(secret, 16)
  c = crypto.createCipheriv('aes-128-ctr', key, iv)
  return c
}

function genIvData(secret) {
  let buf = Buffer.from([0x09]) // code: 0x09

  let iv = crypto.randomBytes(16) // iv: size16
  buf = Buffer.concat([buf, iv])

  let md5 = crypto.createHash('md5')
  md5.update(iv)
  md5.update(secret)
  buf = Buffer.concat([buf, md5.digest()])

  return {
    iv,
    data: buf
  }
}

function checkIvData(secret, buf) {
  let code = buf[0]
  let iv = buf.slice(1, 17)
  let checksum = buf.slice(17, 33)

  let md5 = crypto.createHash('md5')
  md5.update(iv)
  md5.update(secret)
  let sum = md5.digest()

  return {
    iv,
    ok: code == 0x09 && checksum.equals(sum) && buf.length == 33
  }
}