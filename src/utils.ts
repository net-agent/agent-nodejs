import { StreamLike } from './stream'
import * as net from 'net'
import { readFile } from 'fs'

export function sleep(tick:number):Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, tick)
  })
}

export function linkStream(s1:StreamLike, s2:StreamLike, target?:string) {
  let startTime = Date.now()
  let s1tos2 = 0
  let s2tos1 = 0

  // data event
  s1.on('data', buf => {
    s1tos2 += buf.length
    s2.write(buf)
  })
  s2.on('data', buf => {
    s2tos1 += buf.length
    s1.write(buf)
  })

  // end event
  // s1.on('end', s2.end)
  // s2.on('end', s1.end)


  // error
  let errored = false
  let onerror = (err:any) => {
    if (errored) return
    errored = true
    s1.destroy()
    s2.destroy()
    console.log(`on error, target[${target}] err=[${err}]`)
  }
  s1.on('error', () => onerror )
  s2.on('error', () => onerror )

  // close
  let closed = false
  let onclose = () => {
    if (closed) return
    closed = true
    let lifetime = Date.now() - startTime
    console.log(`conn closed, target[${target}] send[${byteUnit(s1tos2)}] recv[${byteUnit(s2tos1)}] lifetime[${timestr(lifetime)}]`)
  }
  s1.on('close', onclose)
  s2.on('close', onclose)
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

export function byteUnit(n:number):string {
  let units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let index = 0
  let max = units.length - 1
  while (n >= 1024) {
    n = n / 1024
    index++
    if (index >= max) break
  }
  if (index == 0) return `${n}${units[index]}`
  return `${n.toFixed(2)}${units[index]}`
}

export function timestr(n:number):string {
  if (n < 1000) return `${n}ms`

  let mi = String(n % 1000).padStart(3, '0')
  n = (n / 1000) >> 0
  if (n < 60) return `${n}.${mi}s`

  let s = String(n % 60).padStart(2, '0')
  n = (n / 60) >> 0
  if (n < 60) return `${n}:${s}`

  let m = String(n % 60).padStart(2, '0')
  n = (n / 60) >> 0
  if (n < 60) return `${n}:${m}:${s}:`

  let h = String(n % 60).padStart(2, '0')
  n = (n / 60) >> 0
  return `${n}d ${h}:${m}:${s}`
}

export function loadJSONFile(path:string):Promise<any> {
  return new Promise((resolve, reject) => {
    readFile(path, {encoding:'utf-8'}, function (err, str) {
      if (err) return reject(err)

      let re = /(^|\n)\s*\/\/.*/g
      str = str.replace(re, '')

      let obj:any
      try {
        obj = JSON.parse(str)
      } catch (ex) {
        return reject(`parse json (${path}) error: ${ex}`)
      }
      resolve(obj)
    })
  })
}