import * as events from 'events'
import * as net from 'net'
import * as hkdf from 'futoin-hkdf'
import * as crypto from 'crypto'

export class CipherConn extends events.EventEmitter {
  static cipherMode:string = 'aes-128-ctr'
  static version:number = 0x09
  static keyLen:number = 16
  static ivLen:number = 16
  static hkdfSalt:string = 'cipherconn-of-exchanger'
  static hkdfHash:string = 'sha1'

  private secret:string
  private iv:Buffer
  private key:Buffer

  private conn:net.Socket
  private encoder:crypto.Cipher
  private decoder:crypto.Cipher

  constructor(conn: net.Socket, secret:string) {
    super()
    this.conn = conn
    this.secret = secret
    this.iv = this.getRandIV()
    this.key = this.getKey()
    this.encoder = this.getCipher(this.iv)

    this.conn.write(this.getBuffer())
    this.conn.once('data', buf => {
      try {
        this.decoder = this.getEncoder(buf)
      } catch (ex) {
        this.conn.destroy()
        this.emit('error', `getCipher failed: ${ex}`)
        return
      }

      this.emit('ready')
      this.conn.on('data', buf => {
        buf = this.decoder.update(buf)
        this.emit('data', buf)
      })
    })
  }

  write(buf:Buffer):boolean {
    buf = this.encoder.update(buf)
    return this.conn.write(buf)
  }

  on(event:string, listener: (...args: any[]) => void): this {
    if ('close|connect|drain|end|error|lookup|timeout'.indexOf(event) >= 0) {
      this.conn.on(event, listener)
      return this
    } else {
      return super.on(event, listener)
    }
  }

  // 生成随机的iv
  private getRandIV():Buffer {
    let iv = crypto.randomBytes(CipherConn.ivLen)
    return iv
  }

  // 生成握手的内容
  private getBuffer() {
    let buf = Buffer.from([CipherConn.version])
    let md5 = crypto.createHash('md5')
    md5.update(this.iv)
    md5.update(this.secret)

    return Buffer.concat([buf, this.iv, md5.digest()])
  }

  // 使用hkdf算法生成长度合法的key
  private getKey():Buffer {
    return hkdf(this.secret, CipherConn.keyLen, {
      info: '',
      salt: 'cipherconn-of-exchanger',
      hash: 'sha1'
    })
  }

  private getCipher(iv:Buffer):crypto.Cipher {
    return crypto.createCipheriv(CipherConn.cipherMode, this.key, iv)
  }

  // 检查握手内容是否通过校验
  private getEncoder(buf:Buffer):crypto.Cipher {
    if (!buf || buf.length != 33) {
      throw 'invalid buffer size'
    }
    if (buf[0] != CipherConn.version) {
      throw 'version not allow'
    }
    let iv = buf.slice(1,17)
    let sum = buf.slice(17,33)

    let md5 = crypto.createHash('md5')
    md5.update(iv)
    md5.update(this.secret)
    let checksum = md5.digest()

    if (!checksum.equals(sum)) {
      throw 'checksum not equal'
    }

    return this.getCipher(iv)
  }
}
