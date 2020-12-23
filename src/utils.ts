import { StreamLike } from './stream'
import * as net from 'net'

export function sleep(tick:number):Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, tick)
  })
}

export function linkStream(s1:StreamLike, s2:StreamLike) {
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

export function splitHostPort(addr:string):{host:string,port:number} {
  let parts = addr.split(':')
  let host = parts[0]
  let port = parseInt(parts[1], 10)
  return {host, port}
}

export function dial(host:string, port:number):Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let conn = net.connect({host, port}, function () {
      conn.removeAllListeners()
      resolve(conn)
    })
    conn.once('error', reject)
  })
}