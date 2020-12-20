const frame = require('./frame.js')
const tunnel = require('./tunnel.js')
const vnet = require('./vnet.js')
const utils = require('./utils.js')

main()

async function main() {
  let secret = ''
  let address = 'localhost:2035'

  let conn = await tunnel.netConnect(address)
  let cc = await tunnel.cipherUpgrade(conn, secret)
  let fconn = frame.upgrade(cc)
  let vnc = vnet.upgrade(fconn)

  console.log('upgrade done')

  try {
    await vnc.ping()
    console.log('ping~ pong~')
  } catch (ex) {
    console.warn('ping failed:', ex)
  }

  try {
    let resp = await vnc.request('cluster/Login', {vhost: 'nodejs-demo'})
    console.log('login success, start heartbeat', resp)
    startHeartbeat(vnc)
  } catch (ex) {
    console.warn('login failed', ex)
  }
}

async function startHeartbeat(vnc) {
  let err = null
  do {
    await utils.sleep(1000 * 4)
    try {
      await vnc.request('cluster/Heartbeat', {})
    } catch (ex) {
      err = ex
    }
  } while(!err)

  console.warn('heartbeat stopped', err)
}