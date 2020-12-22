import {Frame, FrameConn} from './src/frame_conn'
import {CipherConn} from './src/cipher_conn'
import * as net from 'net'
import {VNet} from './src/vnet'
import {Stream, StreamLike} from './src/stream'

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
        vnet.startHeartbeat()
      } catch (ex) {
        console.log('login failed', ex)
      }

      // run portproxy
      net.createServer(async (conn: net.Socket) => {
        let stream:Stream
        try {
          stream = await vnet.clusterDial('test.tunnel', 1081)
        } catch (ex) {
          console.log('dial tunnel:1081 failed', ex)
          conn.destroy()
          return
        }

        linkStream(conn, stream)
      }).listen(1082, 'localhost', () => {
        console.log('listen on port 1082')
      })
    })
  })
}

function linkStream(s1:StreamLike, s2:StreamLike) {
  let s1tos2 = 0
  let s2tos1 = 0
  s1.on('data', buf => {
    s1tos2 += buf.length
    s2.write(buf)
  })
  s2.on('data', buf => {
    s2tos1 += buf.length
    s1.write(buf)
  })
  s1.on('close', () => {
    s2.destroy()
    console.log(`conn closed, s1->s2[${s1tos2}] s2->s1[${s2tos1}]`)
  })
  s2.on('close', () => {
    s1.destroy()
    console.log(`conn closed, s1->s2[${s1tos2}] s2->s1[${s2tos1}]`)
  })
}