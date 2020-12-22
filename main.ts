import {Frame, FrameConn} from './src/frame_conn'
import {CipherConn} from './src/cipher_conn'
import * as net from 'net'
import {VNet} from './src/vnet'

main()

async function main() {
  let secret = ''
  let host = 'localhost'
  let port = 2035
  let vhost = 'nodets_test'

  let conn = net.connect({host, port}, function () {
    let cipherconn = new CipherConn(conn, secret)
    cipherconn.on('ready', async function () {
      let fconn = new FrameConn(cipherconn)
      fconn.on('frame', function (frame: Frame) {
        console.log('new frame', frame)
      })

      try {
        console.log('ping~~')
        await fconn.ping()
        console.log('pong~~')
      } catch (ex) {
        console.log('pong failed:', ex)
      }

      let vnet = new VNet(fconn)
      try {
        let [tid, finalVhost] = await vnet.login(vhost)
        console.log('login success', tid, finalVhost)
      } catch (ex) {
        console.log('login failed', ex)
      }
    })
  })
}
